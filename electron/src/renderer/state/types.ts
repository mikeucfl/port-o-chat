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
  generalError: null,
  unreadCounts: {},
  firstUnreadMessageId: {},
  windowFocused: true
}
