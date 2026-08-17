import { IPC_EVENT } from '@shared/ipc-contract'
import type { PortochatApi } from '@shared/ipc-contract'
import type {
  AppConfig,
  ChannelDto,
  ChannelJoinPartEvent,
  ChannelKeyRotatedEvent,
  ChannelTopicChangedEvent,
  ChatMessageDto,
  ConnectionStatusEvent,
  ErrorEvent,
  IdentityEvent,
  NameResultEvent,
  PasswordResultEvent,
  PeerKeyChangedEvent,
  SendMessageParams,
  UserConnectionStatusEvent,
  UserDto
} from '@shared/protocolTypes'
import { ChatController } from '@core/chatController'
import { WebCryptoProvider } from './crypto/webCryptoProvider'
import { getConfig, setConfig } from './config'
import { openExternalLink, setUnreadBadge } from './platform'
import { BrowserWsClient } from './wsClient'

type Listener = (payload: unknown) => void

/**
 * Browser-side implementation of the exact same PortochatApi interface
 * preload.ts implements for Electron — backed by an in-page ChatController
 * (core/chatController.ts) and a subscriber map instead of IPC. Because the
 * interface is identical, the entire renderer (screens, components, state
 * management) runs completely unmodified against this — see web/main.tsx.
 */
export function createBrowserApi(): PortochatApi {
  const subscribers = new Map<string, Set<Listener>>()

  function emit(channel: string, payload: unknown): void {
    subscribers.get(channel)?.forEach((cb) => cb(payload))
  }

  function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
    let set = subscribers.get(channel)
    if (!set) {
      set = new Set()
      subscribers.set(channel, set)
    }
    const wrapped = cb as Listener
    set.add(wrapped)
    return () => set?.delete(wrapped)
  }

  const chat = new ChatController({
    crypto: new WebCryptoProvider(),
    createTransport: () => new BrowserWsClient(),
    emit
  })

  return {
    capabilities: { canHost: false },

    getConfig: () => Promise.resolve(getConfig()),
    setConfig: (patch: Partial<AppConfig>) => {
      setConfig(patch)
      return Promise.resolve()
    },

    hostStart: () =>
      Promise.reject(new Error('This build cannot host — a browser tab can never bind a listening socket.')),
    hostStop: () => Promise.resolve(),
    hostSetPassword: () =>
      Promise.reject(new Error('This build cannot host — a browser tab can never bind a listening socket.')),

    clientConnect: (host: string, port: number, password: string) => chat.connect(host, port, password),
    clientDisconnect: () => {
      chat.disconnect()
      return Promise.resolve()
    },

    sendMessage: (params: SendMessageParams) => {
      chat.sendMessage(params)
      return Promise.resolve()
    },
    joinChannel: (name: string, e2e: boolean) => {
      chat.joinChannel(name, e2e)
      return Promise.resolve()
    },
    partChannel: (name: string) => {
      chat.partChannel(name)
      return Promise.resolve()
    },
    requestChannelList: () => {
      chat.requestChannelList()
      return Promise.resolve()
    },
    setNickname: (name: string) => {
      chat.setNickname(name)
      return Promise.resolve()
    },
    setChannelTopic: (channel: string, topic: string) => {
      chat.setChannelTopic(channel, topic)
      return Promise.resolve()
    },
    resetChannelKey: (channel: string) => {
      chat.resetChannelKey(channel)
      return Promise.resolve()
    },

    getFingerprint: (userId: string) => Promise.resolve(chat.getFingerprint(userId)),
    getMyFingerprint: () => Promise.resolve(chat.getMyFingerprint()),
    trustPeerKey: (userId: string) => {
      chat.trustPeerKey(userId)
      return Promise.resolve()
    },

    setUnreadBadge: (count: number) => {
      setUnreadBadge(count)
      return Promise.resolve()
    },
    openExternalLink: (url: string) => {
      openExternalLink(url)
      return Promise.resolve()
    },

    onConnectionStatus: (cb: (e: ConnectionStatusEvent) => void) =>
      subscribe(IPC_EVENT.connectionStatus, cb),
    onIdentity: (cb: (e: IdentityEvent) => void) => subscribe(IPC_EVENT.identity, cb),
    onChatMessage: (cb: (m: ChatMessageDto) => void) => subscribe(IPC_EVENT.chatMessage, cb),
    onChannelList: (cb: (channels: ChannelDto[]) => void) => subscribe(IPC_EVENT.channelList, cb),
    onChannelAdded: (cb: (c: ChannelDto) => void) => subscribe(IPC_EVENT.channelAdded, cb),
    onChannelRemoved: (cb: (name: string) => void) => subscribe(IPC_EVENT.channelRemoved, cb),
    onChannelJoinPart: (cb: (e: ChannelJoinPartEvent) => void) =>
      subscribe(IPC_EVENT.channelJoinPart, cb),
    onChannelTopicChanged: (cb: (e: ChannelTopicChangedEvent) => void) =>
      subscribe(IPC_EVENT.channelTopicChanged, cb),
    onUserList: (cb: (users: UserDto[], channel?: string) => void) =>
      subscribe<[UserDto[], string | undefined]>(IPC_EVENT.userList, ([users, channel]) =>
        cb(users, channel)
      ),
    onUserConnectionStatus: (cb: (e: UserConnectionStatusEvent) => void) =>
      subscribe(IPC_EVENT.userConnectionStatus, cb),
    onNameResult: (cb: (e: NameResultEvent) => void) => subscribe(IPC_EVENT.nameResult, cb),
    onPasswordResult: (cb: (e: PasswordResultEvent) => void) => subscribe(IPC_EVENT.passwordResult, cb),
    onError: (cb: (e: ErrorEvent) => void) => subscribe(IPC_EVENT.errorGeneric, cb),
    onPeerKeyChanged: (cb: (e: PeerKeyChangedEvent) => void) => subscribe(IPC_EVENT.peerKeyChanged, cb),
    onChannelKeyRotated: (cb: (e: ChannelKeyRotatedEvent) => void) =>
      subscribe(IPC_EVENT.channelKeyRotated, cb)
  }
}
