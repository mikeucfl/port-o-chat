import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from 'react'
import { reducer, type Action } from './reducer'
import { type AppState, initialState } from './types'

interface StoreContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
}

const StoreContext = createContext<StoreContextValue | null>(null)

/** Capped, exponentially-backed-off auto-reconnect attempts before requiring a manual "Retry" click — see the reconnect effect below. */
export const MAX_RECONNECT_ATTEMPTS = 5

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // A browser tab can only ever Join (never Host, and only the server that
  // served its own page) — skip straight past the Host/Join choice screen
  // rather than showing a screen with just one meaningful option on it.
  useEffect(() => {
    if (!window.portochat.capabilities.canHost) {
      dispatch({ type: 'SET_PHASE', phase: 'joinSetup' })
    }
  }, [])

  useEffect(() => {
    const api = window.portochat
    const unsubscribers = [
      api.onConnectionStatus((event) => dispatch({ type: 'CONNECTION_STATUS', event })),
      api.onIdentity((event) =>
        dispatch({ type: 'SET_IDENTITY', userId: event.userId, nickname: event.nickname })
      ),
      api.onChatMessage((message) => dispatch({ type: 'CHAT_MESSAGE', message })),
      api.onChannelList((channels) => dispatch({ type: 'CHANNEL_LIST', channels })),
      api.onChannelAdded((channel) => dispatch({ type: 'CHANNEL_ADDED', channel })),
      api.onChannelRemoved((name) => dispatch({ type: 'CHANNEL_REMOVED', name })),
      api.onChannelJoinPart((event) => dispatch({ type: 'CHANNEL_JOIN_PART', event })),
      api.onChannelTopicChanged((event) =>
        dispatch({ type: 'CHANNEL_TOPIC_CHANGED', channel: event.channel, topic: event.topic })
      ),
      api.onUserList((users, channel) => dispatch({ type: 'USER_LIST', users, channel })),
      api.onUserConnectionStatus((event) => dispatch({ type: 'USER_CONNECTION_STATUS', event })),
      api.onNameResult((event) => dispatch({ type: 'NAME_RESULT', ...event })),
      api.onPasswordResult((event) => dispatch({ type: 'PASSWORD_RESULT', ...event })),
      api.onError((event) => dispatch({ type: 'GENERAL_ERROR', message: event.message })),
      api.onPeerKeyChanged((event) => dispatch({ type: 'PEER_KEY_CHANGED', event })),
      api.onChannelKeyRotated((event) =>
        dispatch({ type: 'CHANNEL_KEY_ROTATED', channel: event.channel, epoch: event.epoch })
      )
    ]
    return () => unsubscribers.forEach((unsub) => unsub())
  }, [])

  // ---- auto-reconnect on an unexpected disconnect ----------------------
  //
  // Reacts directly to the raw connectionStatus event stream rather than to
  // derived state.connection — the reconnect loop's own clientConnect calls
  // cause connection to cycle through 'connecting'/'disconnected' itself,
  // which would retrigger a state-dependency-based effect and reset the
  // attempt counter every cycle instead of ever backing off or exhausting.
  // reconnectingRef is a mutex so that churn doesn't start a second loop;
  // latestRef keeps the fields the loop needs current without depending on
  // them (so a stale closure from an earlier render is never used).
  const reconnectingRef = useRef(false)
  const cancelledRef = useRef(false)
  const latestRef = useRef({
    phase: state.phase,
    connectionInfo: state.connectionInfo,
    nickname: state.myNickname,
    openConversations: state.openConversations,
    channels: state.channels
  })
  useEffect(() => {
    latestRef.current = {
      phase: state.phase,
      connectionInfo: state.connectionInfo,
      nickname: state.myNickname,
      openConversations: state.openConversations,
      channels: state.channels
    }
    // Leaving the 'chat' phase only ever happens via an intentional
    // disconnect (RESET_SESSION) or a successful NAME_RESULT into it — stop
    // any in-flight retry loop rather than fighting the user's own action.
    if (state.phase !== 'chat') cancelledRef.current = true
  })

  async function startReconnecting(): Promise<void> {
    if (reconnectingRef.current) return
    reconnectingRef.current = true
    cancelledRef.current = false

    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      if (cancelledRef.current) break
      dispatch({ type: 'RECONNECT_STATUS', status: 'reconnecting', attempt })
      const info = latestRef.current.connectionInfo
      if (!info) break
      try {
        await window.portochat.clientConnect(info.host, info.port, info.password)
        // clientConnect only resolves once the transport is up — it does NOT
        // mean the password or the nickname was actually accepted (see its
        // docstring in ipc-contract.ts). Waiting for the real verdicts here
        // (rather than firing setNickname and declaring victory) is what
        // stops a stale/incorrect remembered password from silently landing
        // in a half-connected state that looks fine but never joined.
        const passwordOk = await new Promise<boolean>((resolve) => {
          const unsubscribe = window.portochat.onPasswordResult((result) => {
            unsubscribe()
            resolve(result.success)
          })
        })
        if (!passwordOk) throw new Error('Incorrect password')

        await window.portochat.setNickname(latestRef.current.nickname)
        const nameOk = await new Promise<boolean>((resolve) => {
          const unsubscribe = window.portochat.onNameResult((result) => {
            unsubscribe()
            resolve(result.success)
          })
        })
        if (!nameOk) throw new Error('Nickname rejected')

        // The server we just reconnected to may not be the same process
        // that was running a moment ago (e.g. a restart) — its whole user
        // registry could be gone, with everyone (including people we
        // already knew about) reappearing under brand-new ids and no
        // "they disconnected" event ever sent for the old ones. Clearing
        // first avoids stale entries sitting around forever looking
        // online next to their own replacements — see RESET_ROSTER.
        dispatch({ type: 'RESET_ROSTER' })
        window.portochat.requestChannelList()

        // Best-effort: rejoin whatever channels were open. The server has
        // no memory of our old membership — a fresh connection is a fresh
        // join, same as any other client's first time.
        for (const ref of latestRef.current.openConversations) {
          if (ref.type === 'channel') {
            window.portochat.joinChannel(ref.name, latestRef.current.channels[ref.name]?.e2e ?? false)
          }
        }
        dispatch({ type: 'RECONNECT_STATUS', status: 'idle', attempt: 0 })
        reconnectingRef.current = false
        return
      } catch {
        if (cancelledRef.current) break
        const delayMs = Math.min(1000 * 2 ** (attempt - 1), 10000)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
    if (!cancelledRef.current) {
      dispatch({ type: 'RECONNECT_STATUS', status: 'exhausted', attempt: MAX_RECONNECT_ATTEMPTS })
    }
    reconnectingRef.current = false
  }

  useEffect(() => {
    return window.portochat.onConnectionStatus((event) => {
      if (event.state !== 'disconnected') return
      if (latestRef.current.phase !== 'chat' || !latestRef.current.connectionInfo) return
      void startReconnecting()
    })
  }, [])

  // Lets the "Retry" button (shown once MAX_RECONNECT_ATTEMPTS is
  // exhausted) kick off a fresh attempt sequence directly, without waiting
  // for another connectionStatus event.
  useEffect(() => {
    if (state.reconnectNonce === 0) return
    if (state.connection === 'disconnected' && state.phase === 'chat') void startReconnecting()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.reconnectNonce])

  // Keeps --app-height (see global.css) in sync with the actually-visible
  // viewport — only matters on phones, where the on-screen keyboard
  // shrinks this without the layout viewport (height: 100%'s reference)
  // ever changing.
  useEffect(() => {
    const vv = window.visualViewport
    function updateAppHeight(): void {
      const height = vv?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--app-height', `${height}px`)
    }
    updateAppHeight()
    vv?.addEventListener('resize', updateAppHeight)
    window.addEventListener('resize', updateAppHeight)
    return () => {
      vv?.removeEventListener('resize', updateAppHeight)
      window.removeEventListener('resize', updateAppHeight)
    }
  }, [])

  // Drives unread tracking: an unfocused window still accumulates unread
  // for the open conversation, same as Discord/Slack (see reducer.ts).
  useEffect(() => {
    const onFocus = (): void => dispatch({ type: 'WINDOW_FOCUS_CHANGED', focused: true })
    const onBlur = (): void => dispatch({ type: 'WINDOW_FOCUS_CHANGED', focused: false })
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // OS taskbar/dock unread badge (a passive count, no popups/interruptions),
  // kept in sync with total unread across all conversations.
  useEffect(() => {
    const total = Object.values(state.unreadCounts).reduce((sum, n) => sum + n, 0)
    window.portochat.setUnreadBadge(total)
  }, [state.unreadCounts])

  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within a StoreProvider')
  return ctx
}
