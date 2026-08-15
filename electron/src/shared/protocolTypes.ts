// Plain, JSON-safe DTOs shared between main and renderer. No protobuf, no
// Buffer/KeyObject, no Node APIs — safe for the renderer bundle.

export interface UserDto {
  id: string
  name: string
  host: string
  e2eCapable: boolean
}

export interface ChatMessageDto {
  /** Client-generated, for React list keys — not a protocol field. */
  clientMessageId: string
  senderId: string
  destinationId: string
  isChannel: boolean
  isAction: boolean
  message: string
  timestamp: number
  e2e: boolean
  decryptFailed: boolean
}

export interface ChannelDto {
  name: string
  e2e: boolean
}

export interface ConnectionStatusEvent {
  state: 'disconnected' | 'connecting' | 'connected'
  error?: string
}

export interface AppConfig {
  windowWidth?: number
  windowHeight?: number
  lastNickname?: string
  lastHost?: string
  lastPort?: number
}

export interface SendMessageParams {
  destinationId: string
  isChannel: boolean
  text: string
  isAction?: boolean
}

export interface ChannelJoinPartEvent {
  channel: string
  userId: string
  joined: boolean
}

export interface UserConnectionStatusEvent {
  user: UserDto
  connected: boolean
}

export interface NameResultEvent {
  success: boolean
  name: string
}

export interface ErrorEvent {
  message: string
}

export interface PeerKeyChangedEvent {
  userId: string
  oldFingerprint: string
  newFingerprint: string
}

export interface ChannelKeyRotatedEvent {
  channel: string
  epoch: number
}

export interface HostStartResult {
  port: number
  lanAddresses: string[]
}

export interface HostLanInfoEvent {
  addresses: string[]
  port: number
}

export interface IdentityEvent {
  userId: string
  nickname: string
}
