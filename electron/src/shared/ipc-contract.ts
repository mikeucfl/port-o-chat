import type {
  AppConfig,
  ChannelDto,
  ChannelJoinPartEvent,
  ChannelKeyRotatedEvent,
  ChannelTopicChangedEvent,
  ChatMessageDto,
  ConnectionStatusEvent,
  ErrorEvent,
  HostStartResult,
  IdentityEvent,
  NameResultEvent,
  PasswordResultEvent,
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
  /** What this platform can actually do — e.g. a browser tab can never bind a listening socket, so it reports canHost: false and the UI hides the option rather than surfacing a confusing error after the fact. */
  readonly capabilities: { canHost: boolean }

  getConfig(): Promise<AppConfig>
  setConfig(patch: Partial<AppConfig>): Promise<void>

  hostStart(port: number, password?: string): Promise<HostStartResult>
  hostStop(): Promise<void>
  /** Changes (or clears, with an empty string) the running server's join password. Only ever affects future join attempts — never kicks anyone already connected. */
  hostSetPassword(password: string): Promise<void>

  /** Establishes the session and submits a join password (empty string if none) — does NOT register a username; call setNickname separately once ready (see onPasswordResult). */
  clientConnect(host: string, port: number, password: string): Promise<void>
  clientDisconnect(): Promise<void>

  sendMessage(params: SendMessageParams): Promise<void>
  joinChannel(name: string, e2e: boolean): Promise<void>
  partChannel(name: string): Promise<void>
  requestChannelList(): Promise<void>
  setNickname(name: string): Promise<void>
  setChannelTopic(channel: string, topic: string): Promise<void>

  getFingerprint(userId: string): Promise<string | null>
  getMyFingerprint(): Promise<string | null>
  trustPeerKey(userId: string): Promise<void>

  /** Sets the OS taskbar/dock unread badge (macOS/Linux: numeric count; Windows: a plain overlay dot, see main/badgeIcon.ts). */
  setUnreadBadge(count: number): Promise<void>
  /** Opens an http(s) URL in the user's default browser, after the renderer has already shown its own "open this link?" confirmation. */
  openExternalLink(url: string): Promise<void>

  onConnectionStatus(cb: (e: ConnectionStatusEvent) => void): () => void
  onIdentity(cb: (e: IdentityEvent) => void): () => void
  onChatMessage(cb: (m: ChatMessageDto) => void): () => void
  onChannelList(cb: (channels: ChannelDto[]) => void): () => void
  onChannelAdded(cb: (c: ChannelDto) => void): () => void
  onChannelRemoved(cb: (name: string) => void): () => void
  onChannelJoinPart(cb: (e: ChannelJoinPartEvent) => void): () => void
  onChannelTopicChanged(cb: (e: ChannelTopicChangedEvent) => void): () => void
  onUserList(cb: (users: UserDto[], channel?: string) => void): () => void
  onUserConnectionStatus(cb: (e: UserConnectionStatusEvent) => void): () => void
  onNameResult(cb: (e: NameResultEvent) => void): () => void
  onPasswordResult(cb: (e: PasswordResultEvent) => void): () => void
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
  hostSetPassword: 'host:setPassword',
  clientConnect: 'client:connect',
  clientDisconnect: 'client:disconnect',
  sendMessage: 'chat:sendMessage',
  joinChannel: 'channel:join',
  partChannel: 'channel:part',
  requestChannelList: 'channel:listRequest',
  setNickname: 'user:setNickname',
  setChannelTopic: 'channel:setTopic',
  getFingerprint: 'crypto:getFingerprint',
  getMyFingerprint: 'crypto:getMyFingerprint',
  trustPeerKey: 'crypto:trustPeerKey',
  setUnreadBadge: 'app:setUnreadBadge',
  openExternalLink: 'app:openExternalLink'
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
  channelTopicChanged: 'channel:topicChanged',
  userList: 'user:list',
  userConnectionStatus: 'user:connectionStatus',
  nameResult: 'user:nameResult',
  passwordResult: 'user:passwordResult',
  errorGeneric: 'error:generic',
  peerKeyChanged: 'crypto:peerKeyChanged',
  channelKeyRotated: 'crypto:channelKeyRotated'
} as const
