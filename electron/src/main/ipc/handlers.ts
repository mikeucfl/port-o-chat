import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import { IPC_INVOKE, IPC_EVENT } from '@shared/ipc-contract'
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
} from '@shared/protocolTypes'
import { ChatSession } from '../client/session'
import { AeadOpenError } from '../crypto/aead'
import { ChannelKeyManager } from '../crypto/channelKeyManager'
import { decryptChannelMessage, encryptChannelMessage } from '../crypto/channelKeys'
import { decryptDm, deriveDmKey, encryptDm } from '../crypto/dm'
import { computeFingerprint } from '../crypto/fingerprint'
import { getOrCreateIdentity } from '../crypto/identity'
import { TrustStore } from '../crypto/trust'
import { loadConfig, saveConfigPatch } from '../config/settings'
import { getLanIPv4Addresses } from '../net/lanAddresses'
import { TcpChatServer } from '../net/tcpServer'
import { portochat } from '../proto-gen/portochat'

interface RosterEntry {
  id: string
  name: string
  host: string
  e2eIdentityKeyRaw: Buffer | null
}

/**
 * Owns every piece of live session state in the main process: the host-mode
 * TCP server (if any), the client session (always present once connected —
 * host mode connects to its own server exactly like any other client, no
 * shortcut), the roster/channel caches needed to drive E2E, and the bridge
 * to the renderer over IPC. The renderer never sees any of this directly.
 */
export class SessionController {
  private window: BrowserWindow | null = null
  private hostServer: TcpChatServer | null = null
  private session: ChatSession | null = null
  private readonly identity = getOrCreateIdentity()
  private readonly trustStore = new TrustStore()
  private keyManager: ChannelKeyManager | null = null
  private roster = new Map<string, RosterEntry>()
  private channelMembers = new Map<string, Set<string>>()
  private channelMeta = new Map<string, { e2e: boolean }>()
  private pendingCreations = new Set<string>()

  attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  shutdown(): void {
    this.session?.disconnect()
    this.hostServer?.close()
  }

  private send<T>(channel: string, payload: T): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send(channel, payload)
  }

  // ---- config -------------------------------------------------------------

  getConfig(): AppConfig {
    return loadConfig()
  }

  setConfig(patch: Partial<AppConfig>): void {
    saveConfigPatch(patch)
  }

  // ---- host -----------------------------------------------------------------

  async hostStart(port: number): Promise<HostStartResult> {
    if (this.hostServer) {
      throw new Error('A server is already running in this app instance')
    }
    const server = new TcpChatServer()
    const { port: boundPort } = await server.listen(port)
    this.hostServer = server
    return { port: boundPort, lanAddresses: getLanIPv4Addresses() }
  }

  hostStop(): void {
    this.hostServer?.close()
    this.hostServer = null
  }

  // ---- client ---------------------------------------------------------------

  async clientConnect(host: string, port: number, nickname: string): Promise<void> {
    this.session?.disconnect()
    this.roster.clear()
    this.channelMembers.clear()
    this.channelMeta.clear()
    this.pendingCreations.clear()
    this.keyManager = null

    const session = new ChatSession()
    this.session = session

    session.on('stateChange', (state: ConnectionStatusEvent['state'], error?: Error) => {
      this.send<ConnectionStatusEvent>(IPC_EVENT.connectionStatus, { state, error: error?.message })
    })
    session.on('message', (message: portochat.PortoChatMessage) => this.handleMessage(message))
    session.on('identity', (userId: string, username: string) => {
      this.ensureKeyManager()
      this.send<IdentityEvent>(IPC_EVENT.identity, { userId, nickname: username })
      // Broadcasts only tell us about users connecting/renaming *after* we
      // did; without this, anyone already online when we joined would
      // never show up (no DM entry, no E2E identity key) until they
      // happened to do something that re-broadcasts their UserData.
      session.requestUserList()
    })

    await session.connect(host, port, nickname, this.identity.publicKeyRaw)
  }

  clientDisconnect(): void {
    this.session?.disconnect()
    this.session = null
    this.hostServer?.close()
    this.hostServer = null
  }

  private ensureKeyManager(): ChannelKeyManager | null {
    if (this.keyManager) return this.keyManager
    const myUserId = this.session?.userId
    if (!myUserId) return null

    this.keyManager = new ChannelKeyManager({
      myUserId,
      myPrivateKey: this.identity.privateKey,
      sendKeyShare: (channel, toUserId, wrappedKey, nonce, epoch) => {
        this.session?.sendKeyShare({ channel, toUserId, wrappedKey, nonce, keyEpoch: epoch })
      },
      getPeerPublicKey: (userId) => this.roster.get(userId)?.e2eIdentityKeyRaw ?? undefined,
      getOtherMembers: (channel) =>
        [...(this.channelMembers.get(channel) ?? [])].filter((id) => id !== myUserId),
      onKeyReady: (channel, epoch) => {
        this.send<ChannelKeyRotatedEvent>(IPC_EVENT.channelKeyRotated, { channel, epoch })
      }
    })
    return this.keyManager
  }

  // ---- outgoing actions -------------------------------------------------------

  /**
   * The server never echoes a message back to its own sender (same as the
   * original Java server) — the Java *client* worked around this with local
   * optimistic echo the instant the user hit send. This is that same local
   * echo, reusing the exact chat:message event/DTO shape incoming messages
   * use so the renderer needs no separate "is this mine" display path.
   */
  private echoOwnMessage(
    myUserId: string,
    params: SendMessageParams,
    e2e: boolean
  ): void {
    this.send<ChatMessageDto>(IPC_EVENT.chatMessage, {
      clientMessageId: randomUUID(),
      senderId: myUserId,
      destinationId: params.destinationId,
      isChannel: params.isChannel,
      isAction: !!params.isAction,
      message: params.text,
      timestamp: Date.now(),
      e2e,
      decryptFailed: false
    })
  }

  sendMessage(params: SendMessageParams): void {
    const session = this.session
    const myUserId = session?.userId
    if (!session || !myUserId) return

    if (params.isChannel) {
      const meta = this.channelMeta.get(params.destinationId)
      if (meta?.e2e) {
        // Never silently downgrade a known-E2E channel to plaintext — if
        // the key hasn't arrived yet (e.g. sent an instant after joining),
        // refuse the send rather than leak plaintext onto the wire.
        const keyState = this.ensureKeyManager()?.getState(params.destinationId)
        if (!keyState) {
          this.send<ErrorEvent>(IPC_EVENT.errorGeneric, {
            message: `Encryption for "${params.destinationId}" isn't ready yet — try again in a moment.`
          })
          return
        }
        const sealed = encryptChannelMessage(
          keyState.key,
          params.text,
          params.destinationId,
          myUserId,
          keyState.epoch
        )
        session.sendChatMessage({
          destinationId: params.destinationId,
          isChannel: true,
          message: '',
          isAction: params.isAction,
          e2eCiphertext: sealed.ciphertext,
          e2eNonce: sealed.nonce,
          e2eKeyEpoch: keyState.epoch
        })
        this.echoOwnMessage(myUserId, params, true)
        return
      }
      session.sendChatMessage({
        destinationId: params.destinationId,
        isChannel: true,
        message: params.text,
        isAction: params.isAction
      })
      this.echoOwnMessage(myUserId, params, false)
      return
    }

    // DM: automatically E2E whenever we know the recipient's identity key
    // (i.e. they're running an E2E-capable client too) — no per-DM opt-in
    // toggle, since there's no reason to prefer plaintext when both ends
    // support encryption. Falls back to plaintext for legacy peers.
    const recipient = this.roster.get(params.destinationId)
    if (recipient?.e2eIdentityKeyRaw) {
      if (this.trustStore.isBlocked(params.destinationId)) {
        this.send<ErrorEvent>(IPC_EVENT.errorGeneric, {
          message: `${recipient.name || 'This user'}'s key changed. Verify their new safety number before sending.`
        })
        return
      }
      const key = deriveDmKey(
        this.identity.privateKey,
        recipient.e2eIdentityKeyRaw,
        myUserId,
        params.destinationId
      )
      const sealed = encryptDm(key, params.text, myUserId, params.destinationId)
      session.sendChatMessage({
        destinationId: params.destinationId,
        isChannel: false,
        message: '',
        isAction: params.isAction,
        e2eCiphertext: sealed.ciphertext,
        e2eNonce: sealed.nonce
      })
      this.echoOwnMessage(myUserId, params, true)
      return
    }

    session.sendChatMessage({
      destinationId: params.destinationId,
      isChannel: false,
      message: params.text,
      isAction: params.isAction
    })
    this.echoOwnMessage(myUserId, params, false)
  }

  joinChannel(name: string, e2e: boolean): void {
    if (e2e && !this.channelMeta.has(name)) this.pendingCreations.add(name)
    this.session?.joinChannel(name, e2e)
    this.session?.requestChannelUserList(name)
  }

  partChannel(name: string): void {
    this.session?.partChannel(name)
    this.channelMembers.delete(name)
    this.channelMeta.delete(name)
    this.keyManager?.forget(name)
  }

  requestChannelList(): void {
    this.session?.requestChannelList()
  }

  setNickname(name: string): void {
    this.session?.setUsername(name)
  }

  getFingerprint(userId: string): string | null {
    const key = this.roster.get(userId)?.e2eIdentityKeyRaw
    return key ? computeFingerprint(key) : null
  }

  getMyFingerprint(): string {
    return computeFingerprint(this.identity.publicKeyRaw)
  }

  trustPeerKey(userId: string): void {
    this.trustStore.trust(userId)
  }

  // ---- incoming message handling ---------------------------------------------

  private handleMessage(message: portochat.PortoChatMessage): void {
    switch (message.ApplicationMessage) {
      case 'channelList':
        this.handleChannelList(message.channelList)
        break
      case 'chatMessage':
        this.handleChatMessage(message.chatMessage)
        break
      case 'errorMessage':
        this.handleErrorMessage(message.errorMessage)
        break
      case 'notification':
        this.handleNotification(message.notification)
        break
      case 'userList':
        this.handleUserList(message.userList)
        break
      case 'keyShare':
        this.handleKeyShare(message.keyShare)
        break
      default:
        break
    }
  }

  private toDto(user: portochat.IUserData): UserDto {
    return {
      id: user.id ?? '',
      name: user.name ?? '',
      host: user.host ?? '',
      e2eCapable: !!user.e2eIdentityKey && user.e2eIdentityKey.length > 0
    }
  }

  private updateRoster(user: portochat.IUserData): void {
    if (!user.id) return
    const rawKey = user.e2eIdentityKey && user.e2eIdentityKey.length > 0
      ? Buffer.from(user.e2eIdentityKey)
      : null
    this.roster.set(user.id, {
      id: user.id,
      name: user.name ?? '',
      host: user.host ?? '',
      e2eIdentityKeyRaw: rawKey
    })
    if (rawKey) {
      const changeEvent = this.trustStore.observe(user.id, rawKey)
      if (changeEvent) {
        this.send<PeerKeyChangedEvent>(IPC_EVENT.peerKeyChanged, changeEvent)
      }
    }
  }

  private handleChannelList(channelList: portochat.IChannelList | null | undefined): void {
    if (!channelList) return
    const names = channelList.channels?.values ?? []
    const metaByName = new Map((channelList.channelMeta ?? []).map((m) => [m.channel, m]))
    const dtos: ChannelDto[] = names.map((name) => {
      const meta = metaByName.get(name)
      const e2e = meta?.e2eChannel ?? false
      this.channelMeta.set(name, { e2e })
      return { name, e2e }
    })
    this.send<ChannelDto[]>(IPC_EVENT.channelList, dtos)
  }

  private handleChatMessage(chatMessage: portochat.IChatMessage | null | undefined): void {
    const session = this.session
    const myUserId = session?.userId
    if (!chatMessage || !myUserId) return

    const senderId = chatMessage.senderId ?? ''
    const destinationId = chatMessage.destinationId ?? ''
    const isChannel = !!chatMessage.isChannel
    const ciphertext = chatMessage.e2eCiphertext
    const nonce = chatMessage.e2eNonce
    const e2e = !!ciphertext && ciphertext.length > 0

    let text = chatMessage.message ?? ''
    let decryptFailed = false

    if (e2e && ciphertext && nonce) {
      try {
        if (isChannel) {
          const keyState = this.ensureKeyManager()?.getState(destinationId)
          if (!keyState) throw new AeadOpenError('no channel key yet')
          text = decryptChannelMessage(
            keyState.key,
            { ciphertext: Buffer.from(ciphertext), nonce: Buffer.from(nonce) },
            destinationId,
            senderId,
            chatMessage.e2eKeyEpoch ?? 0
          )
        } else {
          const senderKey = this.roster.get(senderId)?.e2eIdentityKeyRaw
          if (!senderKey) throw new AeadOpenError('unknown sender identity key')
          const key = deriveDmKey(this.identity.privateKey, senderKey, myUserId, senderId)
          text = decryptDm(
            key,
            { ciphertext: Buffer.from(ciphertext), nonce: Buffer.from(nonce) },
            senderId,
            myUserId
          )
        }
      } catch {
        text = ''
        decryptFailed = true
      }
    }

    const dto: ChatMessageDto = {
      clientMessageId: randomUUID(),
      senderId,
      destinationId,
      isChannel,
      isAction: !!chatMessage.isAction,
      message: text,
      timestamp: Date.now(),
      e2e,
      decryptFailed
    }
    this.send<ChatMessageDto>(IPC_EVENT.chatMessage, dto)
  }

  private handleErrorMessage(errorMessage: portochat.IErrorMessage | null | undefined): void {
    if (!errorMessage) return
    const ErrorType = portochat.ErrorMessage.ErrorType
    if (errorMessage.errorType === ErrorType.UserNameInUse) {
      this.send<NameResultEvent>(IPC_EVENT.nameResult, {
        success: false,
        name: errorMessage.additionalMessage ?? ''
      })
      return
    }
    const message =
      errorMessage.errorType === ErrorType.E2EChannelRequiresSupport
        ? `"${errorMessage.additionalMessage}" is an encrypted channel and requires an E2E-capable client.`
        : `Channel "${errorMessage.additionalMessage}" does not exist or you are not a member.`
    this.send<ErrorEvent>(IPC_EVENT.errorGeneric, { message })
  }

  private handleNotification(notification: portochat.INotification | null | undefined): void {
    if (!notification) return
    const myUserId = this.session?.userId

    if (notification.channelJoin) {
      const { channel, userId } = notification.channelJoin
      if (channel && userId) {
        const set = this.channelMembers.get(channel) ?? new Set<string>()
        set.add(userId)
        this.channelMembers.set(channel, set)

        const meta = this.channelMeta.get(channel)
        if (meta?.e2e && userId !== myUserId && this.keyManager?.getState(channel)) {
          this.keyManager.wrapForNewMember(channel, userId)
        }
        this.send<ChannelJoinPartEvent>(IPC_EVENT.channelJoinPart, { channel, userId, joined: true })
      }
      return
    }

    if (notification.channelPart) {
      const { channel, userId } = notification.channelPart
      if (channel && userId) {
        this.channelMembers.get(channel)?.delete(userId)
        this.send<ChannelJoinPartEvent>(IPC_EVENT.channelJoinPart, { channel, userId, joined: false })
      }
      return
    }

    if (notification.channelAdded) {
      const { channel, e2eChannel } = notification.channelAdded
      if (channel) {
        this.channelMeta.set(channel, { e2e: !!e2eChannel })
        if (this.pendingCreations.has(channel)) {
          this.pendingCreations.delete(channel)
          if (e2eChannel) this.ensureKeyManager()?.createChannel(channel)
        }
        this.send<ChannelDto>(IPC_EVENT.channelAdded, { name: channel, e2e: !!e2eChannel })
      }
      return
    }

    if (notification.channelRemoved) {
      const { channel } = notification.channelRemoved
      if (channel) {
        this.channelMeta.delete(channel)
        this.channelMembers.delete(channel)
        this.keyManager?.forget(channel)
        this.send<string>(IPC_EVENT.channelRemoved, channel)
      }
      return
    }

    if (notification.userConnectionStatus) {
      const { user, connected } = notification.userConnectionStatus
      if (user) {
        this.updateRoster(user)
        this.send<UserConnectionStatusEvent>(IPC_EVENT.userConnectionStatus, {
          user: this.toDto(user),
          connected: !!connected
        })
      }
      return
    }

    if (notification.userDoesNotExist) {
      const missingId = notification.userDoesNotExist.missingId ?? ''
      this.send<ErrorEvent>(IPC_EVENT.errorGeneric, { message: `User "${missingId}" is not connected.` })
      return
    }

    if (notification.userNameSet) {
      this.send<NameResultEvent>(IPC_EVENT.nameResult, {
        success: true,
        name: notification.userNameSet.name ?? ''
      })
      return
    }

    if (notification.keyRotationNotice) {
      const { channel, keyEpoch } = notification.keyRotationNotice
      if (channel && keyEpoch !== undefined && keyEpoch !== null) {
        this.ensureKeyManager()?.onKeyRotationNotice(channel, keyEpoch)
      }
    }
  }

  private handleUserList(userList: portochat.IUserList | null | undefined): void {
    if (!userList) return
    const users = userList.users ?? []
    for (const user of users) this.updateRoster(user)

    if (userList.channel) {
      this.channelMembers.set(userList.channel, new Set(users.map((u) => u.id ?? '')))
    }
    this.send<[UserDto[], string | undefined]>(IPC_EVENT.userList, [
      users.map((u) => this.toDto(u)),
      userList.channel || undefined
    ])
  }

  private handleKeyShare(keyShare: portochat.IKeyShare | null | undefined): void {
    if (!keyShare?.channel || !keyShare.fromUserId || !keyShare.wrappedKey || !keyShare.nonce) return
    this.ensureKeyManager()?.receiveKeyShare(
      keyShare.channel,
      keyShare.fromUserId,
      Buffer.from(keyShare.wrappedKey),
      Buffer.from(keyShare.nonce),
      keyShare.keyEpoch ?? 0
    )
  }
}

export function registerIpcHandlers(controller: SessionController): void {
  ipcMain.handle(IPC_INVOKE.getConfig, () => controller.getConfig())
  ipcMain.handle(IPC_INVOKE.setConfig, (_e, patch: AppConfig) => controller.setConfig(patch))

  ipcMain.handle(IPC_INVOKE.hostStart, (_e, port: number) => controller.hostStart(port))
  ipcMain.handle(IPC_INVOKE.hostStop, () => controller.hostStop())

  ipcMain.handle(IPC_INVOKE.clientConnect, (_e, host: string, port: number, nickname: string) =>
    controller.clientConnect(host, port, nickname)
  )
  ipcMain.handle(IPC_INVOKE.clientDisconnect, () => controller.clientDisconnect())

  ipcMain.handle(IPC_INVOKE.sendMessage, (_e, params: SendMessageParams) =>
    controller.sendMessage(params)
  )
  ipcMain.handle(IPC_INVOKE.joinChannel, (_e, name: string, e2e: boolean) =>
    controller.joinChannel(name, e2e)
  )
  ipcMain.handle(IPC_INVOKE.partChannel, (_e, name: string) => controller.partChannel(name))
  ipcMain.handle(IPC_INVOKE.requestChannelList, () => controller.requestChannelList())
  ipcMain.handle(IPC_INVOKE.setNickname, (_e, name: string) => controller.setNickname(name))

  ipcMain.handle(IPC_INVOKE.getFingerprint, (_e, userId: string) => controller.getFingerprint(userId))
  ipcMain.handle(IPC_INVOKE.getMyFingerprint, () => controller.getMyFingerprint())
  ipcMain.handle(IPC_INVOKE.trustPeerKey, (_e, userId: string) => controller.trustPeerKey(userId))
}
