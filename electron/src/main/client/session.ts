import { EventEmitter } from 'node:events'
import { portochat } from '@proto/portochat'
import { TcpClient, type ConnectionState } from '../net/tcpClient'

const RequestType = portochat.Request.RequestType

/**
 * Client-side session logic: connect, announce identity, send/receive chat
 * traffic. Equivalent to the Java ServerConnection.java. Used identically
 * for JOIN mode and for the host's own loopback connection to its own
 * server (see PORTING-NOTES.md) — one code path either way.
 *
 * This class only knows about the *legacy-compatible* wire protocol
 * (usernames, channels, chat, requests/notifications). E2E crypto is
 * layered on top by ipc/handlers.ts, which intercepts outgoing plaintext
 * chat sends to encrypt them and incoming chat messages to decrypt them —
 * ChatSession itself never touches key material.
 *
 * Emits:
 *   'stateChange' (state: ConnectionState, error?: Error)
 *   'message'     (message: portochat.PortoChatMessage)   — raw, pass-through
 *   'identity'    (userId: string, username: string)      — once our own
 *                  server-assigned id becomes known (see observeSelfId)
 */
export class ChatSession extends EventEmitter {
  private client = new TcpClient()
  private myUserId: string | null = null
  private myUsername: string | null = null

  constructor() {
    super()
    this.client.on('stateChange', (state: ConnectionState, error?: Error) => {
      if (state === 'disconnected') {
        this.myUserId = null
        this.myUsername = null
      }
      this.emit('stateChange', state, error)
    })
    this.client.on('message', (message: portochat.PortoChatMessage) => {
      this.observeSelfId(message)
      if (message.ApplicationMessage === 'ping') {
        // Transport-level keepalive: reply immediately, same as the Java
        // client did. This must never depend on the renderer being alive
        // or responsive — a slow UI thread must not cause a keepalive
        // timeout, so it's handled here rather than round-tripped through
        // IPC.
        this.client.send({ pong: { timestamp: message.ping?.timestamp ?? 0 } })
        return
      }
      this.emit('message', message)
    })
  }

  /**
   * The server never tells a client its own id directly; it's inferred the
   * same way the Java client did — from the UserList/UserConnectionStatus
   * broadcast that carries our own (now-registered) username.
   */
  private observeSelfId(message: portochat.PortoChatMessage): void {
    if (!this.myUsername || this.myUserId) return
    const candidates: portochat.IUserData[] = []
    if (message.userList?.users) candidates.push(...message.userList.users)
    const status = message.notification?.userConnectionStatus
    if (status?.user) candidates.push(status.user)
    const self = candidates.find((u) => u.name === this.myUsername)
    if (self?.id) {
      this.myUserId = self.id
      this.emit('identity', self.id, this.myUsername)
    }
  }

  async connect(
    host: string,
    port: number,
    username: string,
    e2eIdentityPublicKey: Buffer | null
  ): Promise<void> {
    this.myUsername = username
    await this.client.connect(host, port)
    if (e2eIdentityPublicKey) {
      this.client.send({
        request: { requestType: RequestType.SetE2EPublicKey, byteData: e2eIdentityPublicKey }
      })
    }
    this.client.send({
      request: { requestType: RequestType.SetUserName, stringRequestData: { value: username } }
    })
  }

  disconnect(): void {
    this.client.disconnect()
  }

  getState(): ConnectionState {
    return this.client.getState()
  }

  get userId(): string | null {
    return this.myUserId
  }

  setUsername(name: string): void {
    this.myUsername = name
    this.client.send({
      request: { requestType: RequestType.SetUserName, stringRequestData: { value: name } }
    })
  }

  sendChatMessage(params: {
    destinationId: string
    isChannel: boolean
    message: string
    isAction?: boolean
    e2eCiphertext?: Buffer
    e2eNonce?: Buffer
    e2eKeyEpoch?: number
  }): void {
    this.client.send({
      chatMessage: {
        destinationId: params.destinationId,
        isChannel: params.isChannel,
        message: params.e2eCiphertext ? '' : params.message,
        isAction: params.isAction ?? false,
        e2eCiphertext: params.e2eCiphertext,
        e2eNonce: params.e2eNonce,
        e2eKeyEpoch: params.e2eKeyEpoch
      }
    })
  }

  sendKeyShare(params: {
    channel: string
    toUserId: string
    wrappedKey: Buffer
    nonce: Buffer
    keyEpoch: number
  }): void {
    this.client.send({
      keyShare: {
        channel: params.channel,
        toUserId: params.toUserId,
        wrappedKey: params.wrappedKey,
        nonce: params.nonce,
        keyEpoch: params.keyEpoch
      }
    })
  }

  joinChannel(channel: string, e2eChannel = false): void {
    this.client.send({
      request: {
        requestType: RequestType.ChannelJoin,
        stringRequestData: { value: channel },
        e2eChannel
      }
    })
  }

  partChannel(channel: string): void {
    this.client.send({ notification: { channelPart: { channel } } })
  }

  /** The server enforces creator-only authorization; a rejection comes back as an ErrorMessage. */
  setChannelTopic(channel: string, topic: string): void {
    this.client.send({ channelTopic: { channel, topic } })
  }

  requestChannelList(): void {
    this.client.send({ request: { requestType: RequestType.ChannelList } })
  }

  requestChannelUserList(channel: string): void {
    this.client.send({
      request: { requestType: RequestType.ChannelUserList, stringRequestData: { value: channel } }
    })
  }

  requestUserList(): void {
    this.client.send({ request: { requestType: RequestType.UserList } })
  }
}
