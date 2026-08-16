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

export interface AppState {
  phase: Phase
  connection: 'disconnected' | 'connecting' | 'connected'
  connectionError?: string
  myUserId: string | null
  myNickname: string
  hostInfo?: { port: number; lanAddresses: string[] }
  users: Record<string, UserDto>
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
  myUserId: null,
  myNickname: '',
  users: {},
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
