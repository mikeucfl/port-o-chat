import { IPC_EVENT } from '@shared/ipc-contract'
import type {
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
import { portochat } from '@proto/portochat'
import { ChannelKeyManager } from './channelKeyManager'
import type { CryptoProvider } from './cryptoProvider'
import { ChatSession } from './session'
import type { ChatTransport } from './transport'
import { TrustStore } from './trust'

interface RosterEntry {
  id: string
  name: string
  host: string
  e2eIdentityKeyRaw: Buffer | null
}

export type ChatControllerEmit = (channel: string, payload: unknown) => void

export interface ChatControllerDeps {
  crypto: CryptoProvider
  /** A fresh transport per connect() call — Electron injects WsClient (net/wsClient.ts), the browser build injects its own WebSocket-backed one. */
  createTransport: () => ChatTransport
  /** Fans out to IPC (Electron) or an in-page subscriber map (browser) — see IPC_EVENT for the channel names used. */
  emit: ChatControllerEmit
}

/**
 * All the chat/E2E policy that used to live inline in SessionController:
 * connect/disconnect, the roster and channel-metadata caches, the
 * TrustStore and ChannelKeyManager, and every incoming/outgoing message
 * decision (which channel is E2E, DM auto-encrypt, refuse-rather-than-
 * downgrade, decrypt-failure handling). Platform-specific concerns (the
 * Electron BrowserWindow, host-mode server, OS badge/link-opening) stay
 * out of this file — see ipc/handlers.ts (Electron) and web/api.ts
 * (browser), which both just wire this up differently.
 */
export class ChatController {
  private session: ChatSession | null = null
  private readonly trustStore: TrustStore
  private keyManager: ChannelKeyManager | null = null
  private roster = new Map<string, RosterEntry>()
  private channelMembers = new Map<string, Set<string>>()
  private channelMeta = new Map<string, { e2e: boolean; creatorId: string; topic: string }>()
  private pendingCreations = new Set<string>()

  constructor(private readonly deps: ChatControllerDeps) {
    this.trustStore = new TrustStore((key) => this.deps.crypto.fingerprint(key))
  }

  private send<T>(channel: string, payload: T): void {
    this.deps.emit(channel, payload)
  }

  get myUserId(): string | null {
    return this.session?.userId ?? null
  }

  // ---- connection -------------------------------------------------------

  /**
   * Establishes the session and submits host/port + the join password
   * (empty string if none) — does NOT register a username. Callers choose
   * how to sequence the rest: fire setNickname() right after for a
   * single-shot flow and react to onPasswordResult/onNameResult failures
   * (the Electron desktop client), or await a passwordResult event before
   * ever prompting for a nickname (the browser client) — see
   * PORTING-NOTES.md for why the two flows differ.
   */
  async connect(host: string, port: number, password: string): Promise<void> {
    this.session?.disconnect()
    this.roster.clear()
    this.channelMembers.clear()
    this.channelMeta.clear()
    this.pendingCreations.clear()
    this.keyManager = null

    const session = new ChatSession(this.deps.createTransport())
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

    await session.connect(host, port, this.deps.crypto.identityPublicKey, password)
  }

  disconnect(): void {
    this.session?.disconnect()
    this.session = null
  }

  private ensureKeyManager(): ChannelKeyManager | null {
    if (this.keyManager) return this.keyManager
    const myUserId = this.session?.userId
    if (!myUserId) return null

    this.keyManager = new ChannelKeyManager({
      myUserId,
      crypto: this.deps.crypto,
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

  // ---- outgoing actions -------------------------------------------------

  /**
   * The server never echoes a message back to its own sender (same as the
   * original Java server) — the Java *client* worked around this with local
   * optimistic echo the instant the user hit send. This is that same local
   * echo, reusing the exact chat:message event/DTO shape incoming messages
   * use so the UI needs no separate "is this mine" display path.
   */
  private echoOwnMessage(myUserId: string, params: SendMessageParams, e2e: boolean): void {
    this.send<ChatMessageDto>(IPC_EVENT.chatMessage, {
      clientMessageId: this.deps.crypto.randomId(),
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
        const sealed = this.deps.crypto.encryptChannelMessage(
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
    // support encryption. Falls back to plaintext for legacy peers — and
    // for us, if this platform has no E2E identity of its own yet (e.g.
    // the browser build before its crypto backend lands): a recipient
    // supporting E2E doesn't mean we're able to do our half of it.
    const recipient = this.roster.get(params.destinationId)
    if (recipient?.e2eIdentityKeyRaw && this.deps.crypto.identityPublicKey) {
      if (this.trustStore.isBlocked(params.destinationId)) {
        this.send<ErrorEvent>(IPC_EVENT.errorGeneric, {
          message: `${recipient.name || 'This user'}'s key changed. Verify their new safety number before sending.`
        })
        return
      }
      const sealed = this.deps.crypto.encryptDm(
        recipient.e2eIdentityKeyRaw,
        params.text,
        myUserId,
        params.destinationId
      )
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

  setChannelTopic(channel: string, topic: string): void {
    this.session?.setChannelTopic(channel, topic)
  }

  getFingerprint(userId: string): string | null {
    const key = this.roster.get(userId)?.e2eIdentityKeyRaw
    return key ? this.deps.crypto.fingerprint(key) : null
  }

  getMyFingerprint(): string | null {
    const key = this.deps.crypto.identityPublicKey
    return key ? this.deps.crypto.fingerprint(key) : null
  }

  trustPeerKey(userId: string): void {
    this.trustStore.trust(userId)
  }

  // ---- incoming message handling -----------------------------------------

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
      case 'channelTopic':
        this.handleChannelTopic(message.channelTopic)
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
    const rawKey =
      user.e2eIdentityKey && user.e2eIdentityKey.length > 0 ? Buffer.from(user.e2eIdentityKey) : null
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
      const creatorId = meta?.creatorId ?? ''
      const topic = meta?.topic ?? ''
      this.channelMeta.set(name, { e2e, creatorId, topic })
      return { name, e2e, creatorId, topic }
    })
    this.send<ChannelDto[]>(IPC_EVENT.channelList, dtos)
  }

  private handleChannelTopic(channelTopic: portochat.IChannelTopic | null | undefined): void {
    if (!channelTopic?.channel) return
    const topic = channelTopic.topic ?? ''
    const existing = this.channelMeta.get(channelTopic.channel)
    if (existing) existing.topic = topic
    this.send<ChannelTopicChangedEvent>(IPC_EVENT.channelTopicChanged, {
      channel: channelTopic.channel,
      topic
    })
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
          if (!keyState) throw new Error('no channel key yet')
          text = this.deps.crypto.decryptChannelMessage(
            keyState.key,
            { ciphertext: Buffer.from(ciphertext), nonce: Buffer.from(nonce) },
            destinationId,
            senderId,
            chatMessage.e2eKeyEpoch ?? 0
          )
        } else {
          const senderKey = this.roster.get(senderId)?.e2eIdentityKeyRaw
          if (!senderKey) throw new Error('unknown sender identity key')
          text = this.deps.crypto.decryptDm(
            senderKey,
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
      clientMessageId: this.deps.crypto.randomId(),
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
    if (errorMessage.errorType === ErrorType.IncorrectPassword) {
      this.send<PasswordResultEvent>(IPC_EVENT.passwordResult, { success: false })
      return
    }
    const message =
      errorMessage.errorType === ErrorType.E2EChannelRequiresSupport
        ? `"${errorMessage.additionalMessage}" is an encrypted channel and requires an E2E-capable client.`
        : errorMessage.errorType === ErrorType.NotAuthorized
          ? `Only the creator of "${errorMessage.additionalMessage}" can change its topic.`
          : `Channel "${errorMessage.additionalMessage}" does not exist or you are not a member.`
    this.send<ErrorEvent>(IPC_EVENT.errorGeneric, { message })
  }

  private handleNotification(notification: portochat.INotification | null | undefined): void {
    if (!notification) return
    const myUserId = this.session?.userId

    if (notification.passwordAccepted) {
      this.send<PasswordResultEvent>(IPC_EVENT.passwordResult, { success: true })
      return
    }

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
      const { channel, e2eChannel, creatorId } = notification.channelAdded
      if (channel) {
        this.channelMeta.set(channel, { e2e: !!e2eChannel, creatorId: creatorId ?? '', topic: '' })
        if (this.pendingCreations.has(channel)) {
          this.pendingCreations.delete(channel)
          if (e2eChannel) this.ensureKeyManager()?.createChannel(channel)
        }
        this.send<ChannelDto>(IPC_EVENT.channelAdded, {
          name: channel,
          e2e: !!e2eChannel,
          creatorId: creatorId ?? '',
          topic: ''
        })
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
