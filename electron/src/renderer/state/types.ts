import type {
  ChannelDto,
  ChatMessageDto,
  PeerKeyChangedEvent,
  UserDto
} from '@shared/protocolTypes'

export type Phase = 'launch' | 'hostSetup' | 'joinSetup' | 'chat'

export type ConversationRef = { type: 'channel'; name: string } | { type: 'dm'; userId: string }

export function conversationKey(ref: ConversationRef): string {
  return ref.type === 'channel' ? `channel:${ref.name}` : `dm:${ref.userId}`
}

/** Which conversation a given chat message belongs to, from the local user's point of view. */
export function conversationRefForMessage(
  message: ChatMessageDto,
  myUserId: string | null
): ConversationRef {
  if (message.isChannel) return { type: 'channel', name: message.destinationId }
  const otherPartyId = message.senderId === myUserId ? message.destinationId : message.senderId
  return { type: 'dm', userId: otherPartyId }
}

/**
 * A conversation only counts as "being read live as messages arrive" when
 * it's the active one AND the window actually has focus — matches Discord:
 * tab away from the app and the open conversation still piles up unread.
 */
export function isBeingActivelyViewed(state: AppState, key: string): boolean {
  return (
    state.windowFocused &&
    state.activeConversation !== null &&
    conversationKey(state.activeConversation) === key
  )
}

export interface ConnectionInfo {
  host: string
  port: number
  password: string
}

export type ReconnectStatus = 'idle' | 'reconnecting' | 'exhausted'

export interface AppState {
  phase: Phase
  connection: 'disconnected' | 'connecting' | 'connected'
  connectionError?: string
  /** Set once a connect attempt is made, so an unexpected drop can be retried against the same server without the user re-typing anything. Not cleared on disconnect — only on RESET_SESSION (an intentional disconnect). */
  connectionInfo: ConnectionInfo | null
  reconnectStatus: ReconnectStatus
  reconnectAttempt: number
  /** Bumped to make the manual "Retry" button re-trigger the reconnect effect after MAX_RECONNECT_ATTEMPTS is reached — see store.tsx. */
  reconnectNonce: number
  myUserId: string | null
  myNickname: string
  hostInfo?: { port: number; lanAddresses: string[] }
  users: Record<string, UserDto>
  /** userId -> true for users we've been told disconnected but who still linger in `users` (e.g. still shown in an open DM). Absence means online. */
  offlineUserIds: Record<string, true>
  /**
   * userId -> true for a stale id superseded by the same person
   * reconnecting under a new one. Kept out of the DM list (see Sidebar)
   * but the `users` record itself is deliberately never deleted for
   * these — old chat messages are still keyed by the original sender id
   * forever, and MessageList resolves a sender's display name from
   * `users` live at render time, not from anything stored per-message.
   */
  hiddenUserIds: Record<string, true>
  channels: Record<string, ChannelDto>
  channelMembers: Record<string, string[]>
  openConversations: ConversationRef[]
  activeConversation: ConversationRef | null
  messages: Record<string, ChatMessageDto[]>
  peerKeyWarnings: Record<string, PeerKeyChangedEvent>
  channelKeyEpochs: Record<string, number>
  nameError: string | null
  passwordError: string | null
  generalError: string | null
  /** conversationKey -> count of messages received while not being actively viewed. */
  unreadCounts: Record<string, number>
  /**
   * conversationKey -> the clientMessageId of the first message that arrived
   * while unread. Drives the "New Messages" divider — set the moment a
   * conversation's unread count goes from 0 to 1, and cleared when the user
   * navigates away from that conversation (so a later re-visit with no new
   * activity shows no stale divider).
   */
  firstUnreadMessageId: Record<string, string>
  /** Whether the app window currently has OS focus — an unfocused active conversation still accumulates unread, same as Discord. */
  windowFocused: boolean
}

export const initialState: AppState = {
  phase: 'launch',
  connection: 'disconnected',
  connectionInfo: null,
  reconnectStatus: 'idle',
  reconnectAttempt: 0,
  reconnectNonce: 0,
  myUserId: null,
  myNickname: '',
  users: {},
  offlineUserIds: {},
  hiddenUserIds: {},
  channels: {},
  channelMembers: {},
  openConversations: [],
  activeConversation: null,
  messages: {},
  peerKeyWarnings: {},
  channelKeyEpochs: {},
  nameError: null,
  passwordError: null,
  generalError: null,
  unreadCounts: {},
  firstUnreadMessageId: {},
  windowFocused: true
}
