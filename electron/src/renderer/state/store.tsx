import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from 'react'
import type { ChatMessageDto } from '@shared/protocolTypes'
import { reducer, type Action } from './reducer'
import { type AppState, type ConversationRef, conversationKey, conversationRefForMessage, initialState, isBeingActivelyViewed } from './types'

interface StoreContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
}

const StoreContext = createContext<StoreContextValue | null>(null)

const NOTIFICATION_BODY_MAX = 120

function displayNameFor(ref: ConversationRef, message: ChatMessageDto, state: AppState): string {
  if (ref.type === 'channel') return ref.name
  return state.users[message.senderId]?.name ?? 'Someone'
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Native OS notification for a message that just went unread, plus a
 * taskbar/dock attention flash if the window isn't even focused. Never
 * includes real message content for an E2E conversation in the
 * notification body — OS notification centers (Windows Action Center,
 * macOS Notification Center) retain their own history, which would
 * otherwise leak "encrypted" content outside this app's zero-persistence
 * boundary via a channel this app doesn't control.
 */
function notifyNewMessage(
  message: ChatMessageDto,
  ref: ConversationRef,
  state: AppState,
  dispatch: React.Dispatch<Action>
): void {
  const senderName = state.users[message.senderId]?.name ?? 'Someone'
  const title = ref.type === 'channel' ? `New message in ${ref.name}` : `New message from ${senderName}`
  const bodyText = message.e2e
    ? 'Sent an encrypted message'
    : message.isAction
      ? `${senderName} ${message.message}`
      : message.message
  const body =
    ref.type === 'channel' && !message.e2e
      ? `${senderName}: ${truncate(bodyText, NOTIFICATION_BODY_MAX)}`
      : truncate(bodyText, NOTIFICATION_BODY_MAX)

  try {
    const notification = new Notification(title, { body, silent: false })
    notification.onclick = () => {
      window.portochat.focusWindow()
      dispatch({ type: 'OPEN_CONVERSATION', ref })
    }
  } catch {
    // Notification construction can throw in some sandboxed/headless
    // environments — never let a notification failure break message
    // delivery itself.
  }

  if (!state.windowFocused) {
    window.portochat.flashWindow()
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const api = window.portochat
    const unsubscribers = [
      api.onConnectionStatus((event) => dispatch({ type: 'CONNECTION_STATUS', event })),
      api.onIdentity((event) =>
        dispatch({ type: 'SET_IDENTITY', userId: event.userId, nickname: event.nickname })
      ),
      api.onChatMessage((message) => {
        // Evaluated against the state *before* this message is applied —
        // matches exactly what the reducer itself uses to decide whether
        // this message counts as unread.
        const current = stateRef.current
        const ref = conversationRefForMessage(message, current.myUserId)
        if (!isBeingActivelyViewed(current, conversationKey(ref))) {
          notifyNewMessage(message, ref, current, dispatch)
        }
        dispatch({ type: 'CHAT_MESSAGE', message })
      }),
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
      api.onError((event) => dispatch({ type: 'GENERAL_ERROR', message: event.message })),
      api.onPeerKeyChanged((event) => dispatch({ type: 'PEER_KEY_CHANGED', event })),
      api.onChannelKeyRotated((event) =>
        dispatch({ type: 'CHANNEL_KEY_ROTATED', channel: event.channel, epoch: event.epoch })
      )
    ]
    return () => unsubscribers.forEach((unsub) => unsub())
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

  // OS taskbar/dock unread badge, kept in sync with total unread across all conversations.
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
