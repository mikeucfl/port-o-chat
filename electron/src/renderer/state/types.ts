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
  generalError: null
}
