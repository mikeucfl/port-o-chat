import type {
  ChannelDto,
  ChannelJoinPartEvent,
  ChatMessageDto,
  ConnectionStatusEvent,
  PeerKeyChangedEvent,
  UserConnectionStatusEvent,
  UserDto
} from '@shared/protocolTypes'
import { type AppState, type ConversationRef, type Phase, conversationKey, initialState } from './types'

export type Action =
  | { type: 'SET_PHASE'; phase: Phase }
  | { type: 'CONNECTION_STATUS'; event: ConnectionStatusEvent }
  | { type: 'SET_IDENTITY'; userId: string; nickname: string }
  | { type: 'HOST_INFO'; port: number; lanAddresses: string[] }
  | { type: 'USER_LIST'; users: UserDto[]; channel?: string }
  | { type: 'USER_CONNECTION_STATUS'; event: UserConnectionStatusEvent }
  | { type: 'CHANNEL_LIST'; channels: ChannelDto[] }
  | { type: 'CHANNEL_ADDED'; channel: ChannelDto }
  | { type: 'CHANNEL_REMOVED'; name: string }
  | { type: 'CHANNEL_JOIN_PART'; event: ChannelJoinPartEvent }
  | { type: 'CHAT_MESSAGE'; message: ChatMessageDto }
  | { type: 'CLEAR_MESSAGES'; key: string }
  | { type: 'OPEN_CONVERSATION'; ref: ConversationRef }
  | { type: 'CLOSE_CONVERSATION'; ref: ConversationRef }
  | { type: 'SET_ACTIVE_CONVERSATION'; ref: ConversationRef | null }
  | { type: 'NAME_RESULT'; success: boolean; name: string }
  | { type: 'GENERAL_ERROR'; message: string }
  | { type: 'CLEAR_GENERAL_ERROR' }
  | { type: 'PEER_KEY_CHANGED'; event: PeerKeyChangedEvent }
  | { type: 'TRUST_PEER'; userId: string }
  | { type: 'CHANNEL_KEY_ROTATED'; channel: string; epoch: number }
  | { type: 'RESET_SESSION' }

function upsertOpenConversation(list: ConversationRef[], ref: ConversationRef): ConversationRef[] {
  const key = conversationKey(ref)
  if (list.some((c) => conversationKey(c) === key)) return list
  return [...list, ref]
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_PHASE':
      return { ...state, phase: action.phase }

    case 'CONNECTION_STATUS':
      // Deliberately does NOT transition to 'chat' here: a TCP connect
      // succeeding only means the socket is up, not that our nickname was
      // accepted. Advancing on that alone would drop a UserNameInUse
      // rejection into a black hole once the chat UI is already showing.
      // The 'chat' phase transition instead happens on NAME_RESULT success.
      return { ...state, connection: action.event.state, connectionError: action.event.error }

    case 'SET_IDENTITY':
      return { ...state, myUserId: action.userId, myNickname: action.nickname }

    case 'HOST_INFO':
      return { ...state, hostInfo: { port: action.port, lanAddresses: action.lanAddresses } }

    case 'USER_LIST': {
      const users = { ...state.users }
      for (const u of action.users) users[u.id] = u
      if (action.channel) {
        return {
          ...state,
          users,
          channelMembers: { ...state.channelMembers, [action.channel]: action.users.map((u) => u.id) }
        }
      }
      return { ...state, users }
    }

    case 'USER_CONNECTION_STATUS': {
      const users = { ...state.users, [action.event.user.id]: action.event.user }
      return { ...state, users }
    }

    case 'CHANNEL_LIST': {
      const channels: AppState['channels'] = {}
      for (const c of action.channels) channels[c.name] = c
      return { ...state, channels }
    }

    case 'CHANNEL_ADDED':
      return { ...state, channels: { ...state.channels, [action.channel.name]: action.channel } }

    case 'CHANNEL_REMOVED': {
      const channels = { ...state.channels }
      delete channels[action.name]
      const channelMembers = { ...state.channelMembers }
      delete channelMembers[action.name]
      const openConversations = state.openConversations.filter(
        (c) => !(c.type === 'channel' && c.name === action.name)
      )
      return { ...state, channels, channelMembers, openConversations }
    }

    case 'CHANNEL_JOIN_PART': {
      const current = state.channelMembers[action.event.channel] ?? []
      const members = action.event.joined
        ? current.includes(action.event.userId)
          ? current
          : [...current, action.event.userId]
        : current.filter((id) => id !== action.event.userId)
      return {
        ...state,
        channelMembers: { ...state.channelMembers, [action.event.channel]: members }
      }
    }

    case 'CHAT_MESSAGE': {
      const isChannel = action.message.isChannel
      const otherPartyId = action.message.senderId === state.myUserId
        ? action.message.destinationId
        : action.message.senderId
      const ref: ConversationRef = isChannel
        ? { type: 'channel', name: action.message.destinationId }
        : { type: 'dm', userId: otherPartyId }
      const key = conversationKey(ref)
      const existing = state.messages[key] ?? []
      return {
        ...state,
        messages: { ...state.messages, [key]: [...existing, action.message] },
        openConversations: upsertOpenConversation(state.openConversations, ref)
      }
    }

    case 'CLEAR_MESSAGES':
      return { ...state, messages: { ...state.messages, [action.key]: [] } }

    case 'OPEN_CONVERSATION':
      return {
        ...state,
        openConversations: upsertOpenConversation(state.openConversations, action.ref),
        activeConversation: action.ref
      }

    case 'CLOSE_CONVERSATION': {
      const key = conversationKey(action.ref)
      const openConversations = state.openConversations.filter((c) => conversationKey(c) !== key)
      const wasActive = state.activeConversation && conversationKey(state.activeConversation) === key
      return {
        ...state,
        openConversations,
        activeConversation: wasActive ? (openConversations[0] ?? null) : state.activeConversation
      }
    }

    case 'SET_ACTIVE_CONVERSATION':
      return { ...state, activeConversation: action.ref }

    case 'NAME_RESULT':
      return {
        ...state,
        myNickname: action.success ? action.name : state.myNickname,
        nameError: action.success ? null : `"${action.name}" is already taken.`,
        phase: action.success ? 'chat' : state.phase
      }

    case 'GENERAL_ERROR':
      return { ...state, generalError: action.message }

    case 'CLEAR_GENERAL_ERROR':
      return { ...state, generalError: null }

    case 'PEER_KEY_CHANGED':
      return {
        ...state,
        peerKeyWarnings: { ...state.peerKeyWarnings, [action.event.userId]: action.event }
      }

    case 'TRUST_PEER': {
      const peerKeyWarnings = { ...state.peerKeyWarnings }
      delete peerKeyWarnings[action.userId]
      return { ...state, peerKeyWarnings }
    }

    case 'CHANNEL_KEY_ROTATED':
      return {
        ...state,
        channelKeyEpochs: { ...state.channelKeyEpochs, [action.channel]: action.epoch }
      }

    case 'RESET_SESSION':
      return { ...initialState, phase: 'launch' }

    default:
      return state
  }
}
