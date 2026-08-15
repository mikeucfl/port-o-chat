import { contextBridge, ipcRenderer } from 'electron'
import { IPC_EVENT, IPC_INVOKE, type PortochatApi } from '@shared/ipc-contract'
import type {
  AppConfig,
  ChannelDto,
  ChannelJoinPartEvent,
  ChannelKeyRotatedEvent,
  ChatMessageDto,
  ConnectionStatusEvent,
  ErrorEvent,
  IdentityEvent,
  NameResultEvent,
  PeerKeyChangedEvent,
  SendMessageParams,
  UserConnectionStatusEvent,
  UserDto
} from '@shared/protocolTypes'

// This file must stay a thin pass-through: every call below is either a
// direct ipcRenderer.invoke (request/response) or an ipcRenderer.on
// subscription returning an unsubscribe function. No networking, no crypto,
// no state — all of that lives in the main process.

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: PortochatApi = {
  getConfig: () => ipcRenderer.invoke(IPC_INVOKE.getConfig),
  setConfig: (patch: Partial<AppConfig>) => ipcRenderer.invoke(IPC_INVOKE.setConfig, patch),

  hostStart: (port: number) => ipcRenderer.invoke(IPC_INVOKE.hostStart, port),
  hostStop: () => ipcRenderer.invoke(IPC_INVOKE.hostStop),

  clientConnect: (host: string, port: number, nickname: string) =>
    ipcRenderer.invoke(IPC_INVOKE.clientConnect, host, port, nickname),
  clientDisconnect: () => ipcRenderer.invoke(IPC_INVOKE.clientDisconnect),

  sendMessage: (params: SendMessageParams) => ipcRenderer.invoke(IPC_INVOKE.sendMessage, params),
  joinChannel: (name: string, e2e: boolean) => ipcRenderer.invoke(IPC_INVOKE.joinChannel, name, e2e),
  partChannel: (name: string) => ipcRenderer.invoke(IPC_INVOKE.partChannel, name),
  requestChannelList: () => ipcRenderer.invoke(IPC_INVOKE.requestChannelList),
  setNickname: (name: string) => ipcRenderer.invoke(IPC_INVOKE.setNickname, name),

  getFingerprint: (userId: string) => ipcRenderer.invoke(IPC_INVOKE.getFingerprint, userId),
  getMyFingerprint: () => ipcRenderer.invoke(IPC_INVOKE.getMyFingerprint),
  trustPeerKey: (userId: string) => ipcRenderer.invoke(IPC_INVOKE.trustPeerKey, userId),

  onConnectionStatus: (cb: (e: ConnectionStatusEvent) => void) =>
    subscribe(IPC_EVENT.connectionStatus, cb),
  onIdentity: (cb: (e: IdentityEvent) => void) => subscribe(IPC_EVENT.identity, cb),
  onChatMessage: (cb: (m: ChatMessageDto) => void) => subscribe(IPC_EVENT.chatMessage, cb),
  onChannelList: (cb: (channels: ChannelDto[]) => void) => subscribe(IPC_EVENT.channelList, cb),
  onChannelAdded: (cb: (c: ChannelDto) => void) => subscribe(IPC_EVENT.channelAdded, cb),
  onChannelRemoved: (cb: (name: string) => void) => subscribe(IPC_EVENT.channelRemoved, cb),
  onChannelJoinPart: (cb: (e: ChannelJoinPartEvent) => void) =>
    subscribe(IPC_EVENT.channelJoinPart, cb),
  onUserList: (cb: (users: UserDto[], channel?: string) => void) =>
    subscribe<[UserDto[], string | undefined]>(IPC_EVENT.userList, ([users, channel]) =>
      cb(users, channel)
    ),
  onUserConnectionStatus: (cb: (e: UserConnectionStatusEvent) => void) =>
    subscribe(IPC_EVENT.userConnectionStatus, cb),
  onNameResult: (cb: (e: NameResultEvent) => void) => subscribe(IPC_EVENT.nameResult, cb),
  onError: (cb: (e: ErrorEvent) => void) => subscribe(IPC_EVENT.errorGeneric, cb),
  onPeerKeyChanged: (cb: (e: PeerKeyChangedEvent) => void) =>
    subscribe(IPC_EVENT.peerKeyChanged, cb),
  onChannelKeyRotated: (cb: (e: ChannelKeyRotatedEvent) => void) =>
    subscribe(IPC_EVENT.channelKeyRotated, cb)
}

contextBridge.exposeInMainWorld('portochat', api)
