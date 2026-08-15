import type {
  AppConfig,
  ChannelDto,
  ChannelJoinPartEvent,
  ChannelKeyRotatedEvent,
  ChatMessageDto,
  ConnectionStatusEvent,
  ErrorEvent,
  HostStartResult,
  IdentityEvent,
  NameResultEvent,
  PeerKeyChangedEvent,
  SendMessageParams,
  UserConnectionStatusEvent,
  UserDto
} from './protocolTypes'

/**
 * The full contextBridge surface. preload.ts implements this exactly;
 * renderer code only ever sees this interface (via `window.portochat`),
 * never raw ipcRenderer — the renderer has no sockets, no crypto, no Node
 * access of any kind beyond this typed surface.
 */
export interface PortochatApi {
  getConfig(): Promise<AppConfig>
  setConfig(patch: Partial<AppConfig>): Promise<void>

  hostStart(port: number): Promise<HostStartResult>
  hostStop(): Promise<void>

  clientConnect(host: string, port: number, nickname: string): Promise<void>
  clientDisconnect(): Promise<void>

  sendMessage(params: SendMessageParams): Promise<void>
  joinChannel(name: string, e2e: boolean): Promise<void>
  partChannel(name: string): Promise<void>
  requestChannelList(): Promise<void>
  setNickname(name: string): Promise<void>

  getFingerprint(userId: string): Promise<string | null>
  getMyFingerprint(): Promise<string | null>
  trustPeerKey(userId: string): Promise<void>

  onConnectionStatus(cb: (e: ConnectionStatusEvent) => void): () => void
  onIdentity(cb: (e: IdentityEvent) => void): () => void
  onChatMessage(cb: (m: ChatMessageDto) => void): () => void
  onChannelList(cb: (channels: ChannelDto[]) => void): () => void
  onChannelAdded(cb: (c: ChannelDto) => void): () => void
  onChannelRemoved(cb: (name: string) => void): () => void
  onChannelJoinPart(cb: (e: ChannelJoinPartEvent) => void): () => void
  onUserList(cb: (users: UserDto[], channel?: string) => void): () => void
  onUserConnectionStatus(cb: (e: UserConnectionStatusEvent) => void): () => void
  onNameResult(cb: (e: NameResultEvent) => void): () => void
  onError(cb: (e: ErrorEvent) => void): () => void
  onPeerKeyChanged(cb: (e: PeerKeyChangedEvent) => void): () => void
  onChannelKeyRotated(cb: (e: ChannelKeyRotatedEvent) => void): () => void
}

/** IPC invoke channel names. Referenced by both preload.ts and ipc/handlers.ts so they can never drift apart. */
export const IPC_INVOKE = {
  getConfig: 'app:getConfig',
  setConfig: 'app:setConfig',
  hostStart: 'host:start',
  hostStop: 'host:stop',
  clientConnect: 'client:connect',
  clientDisconnect: 'client:disconnect',
  sendMessage: 'chat:sendMessage',
  joinChannel: 'channel:join',
  partChannel: 'channel:part',
  requestChannelList: 'channel:listRequest',
  setNickname: 'user:setNickname',
  getFingerprint: 'crypto:getFingerprint',
  getMyFingerprint: 'crypto:getMyFingerprint',
  trustPeerKey: 'crypto:trustPeerKey'
} as const

/** IPC event (main -> renderer) channel names. */
export const IPC_EVENT = {
  connectionStatus: 'net:connectionStatus',
  identity: 'app:identity',
  chatMessage: 'chat:message',
  channelList: 'channel:list',
  channelAdded: 'channel:added',
  channelRemoved: 'channel:removed',
  channelJoinPart: 'channel:joinPart',
  userList: 'user:list',
  userConnectionStatus: 'user:connectionStatus',
  nameResult: 'user:nameResult',
  errorGeneric: 'error:generic',
  peerKeyChanged: 'crypto:peerKeyChanged',
  channelKeyRotated: 'crypto:channelKeyRotated'
} as const
