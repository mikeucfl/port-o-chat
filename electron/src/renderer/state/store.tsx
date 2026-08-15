import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react'
import { reducer, type Action } from './reducer'
import { type AppState, initialState } from './types'

interface StoreContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
}

const StoreContext = createContext<StoreContextValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

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

  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within a StoreProvider')
  return ctx
}
