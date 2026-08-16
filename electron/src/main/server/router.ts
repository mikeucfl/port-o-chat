import { randomUUID } from 'node:crypto'
import {
  MAX_CHANNEL_NAME_LENGTH,
  MAX_CHANNEL_TOPIC_LENGTH,
  MAX_E2E_CIPHERTEXT_LENGTH,
  MAX_MESSAGE_TEXT_LENGTH,
  MAX_NICKNAME_LENGTH
} from '@shared/constants'
import { portochat } from '@proto/portochat'
import type { ChannelRegistry } from './channelRegistry'
import type { PeerConnection } from './peer'
import type { UserRecord } from './userRegistry'
import type { UserRegistry } from './userRegistry'

const ErrorType = portochat.ErrorMessage.ErrorType

function userToUserData(user: UserRecord): portochat.IUserData {
  return {
    id: user.id,
    name: user.name ?? '',
    host: user.host,
    e2eIdentityKey: user.e2eIdentityKey ?? undefined
  }
}

function userConnectionStatus(user: UserRecord, connected: boolean): portochat.IPortoChatMessage {
  return { notification: { userConnectionStatus: { user: userToUserData(user), connected } } }
}

/**
 * Routes incoming protocol messages and maintains user/channel state.
 * Transport-agnostic (operates purely on PeerConnection) so it can be
 * exercised in unit tests without a real socket.
 *
 * Fixes, relative to the original Java Server.java, three confirmed bugs:
 *   1. No fallthrough from the legacy key-exchange path into UserList
 *      (that whole legacy RSA/AES path is dropped — see PORTING-NOTES.md).
 *   2. Stale/timed-out clients are actually disconnected (see keepalive.ts),
 *      not just logged.
 *   3. A DM to a disconnected/unknown user reports the *actual missing id*
 *      (UserDoesNotExist.missingId) instead of the sender's own data.
 *
 * Also adds two hardening checks the Java server never had: a relayed
 * ChatMessage's senderId is always overwritten with the authenticated
 * connection's own user id (a client can never spoof another user's
 * identity), and channel messages are only relayed if the sender is
 * actually a member of that channel.
 */
export class ChatRouter {
  /** Null = no password required. Set/changed live via setPassword — see ipc/handlers.ts's hostSetPassword. */
  private password: string | null = null
  private readonly passwordVerifiedPeers = new Set<PeerConnection>()

  constructor(
    private readonly users: UserRegistry,
    private readonly channels: ChannelRegistry
  ) {}

  setPassword(password: string | null): void {
    this.password = password && password.length > 0 ? password : null
  }

  handleConnect(peer: PeerConnection, host: string): UserRecord {
    return this.users.addConnection(peer, host)
  }

  handleDisconnect(peer: PeerConnection): void {
    this.passwordVerifiedPeers.delete(peer)
    const user = this.users.removeConnection(peer)
    if (!user) return

    const { removed, remaining } = this.channels.removeUserFromAllChannels(user.id)
    for (const channel of removed) {
      this.broadcastToAll({ notification: { channelRemoved: { channel } } })
    }
    for (const channel of remaining) {
      this.broadcastToChannel(channel, user.id, {
        notification: { channelPart: { channel, userId: user.id } }
      })
      this.triggerKeyRotationIfE2E(channel)
    }

    if (user.name !== null) {
      this.broadcastToAll(userConnectionStatus(user, false))
    }
  }

  handleMessage(peer: PeerConnection, message: portochat.PortoChatMessage): void {
    const user = this.users.getByPeer(peer)
    if (!user) return // shouldn't happen: connect always precedes messages

    switch (message.ApplicationMessage) {
      case 'request':
        if (message.request) this.handleRequest(user, message.request)
        break
      case 'notification':
        if (message.notification) this.handleNotification(user, message.notification)
        break
      case 'chatMessage':
        if (message.chatMessage) this.handleChatMessage(user, message.chatMessage)
        break
      case 'keyShare':
        if (message.keyShare) this.handleKeyShare(user, message.keyShare)
        break
      case 'channelTopic':
        if (message.channelTopic) this.handleSetChannelTopic(user, message.channelTopic)
        break
      case 'ping':
        user.peer.send({ pong: { timestamp: message.ping?.timestamp ?? 0 } })
        break
      case 'pong':
        this.users.touchLastSeen(user)
        break
      default:
        // response/legacy/unknown cases: nothing for this server to do.
        break
    }
  }

  // ---- Request handling -------------------------------------------------

  private handleRequest(user: UserRecord, request: portochat.IRequest): void {
    const RequestType = portochat.Request.RequestType
    switch (request.requestType) {
      case RequestType.ChannelList:
        this.sendChannelList(user)
        break
      case RequestType.ChannelUserList:
        this.sendChannelUserList(user, request.stringRequestData?.value ?? '')
        break
      case RequestType.ChannelJoin:
        this.handleChannelJoin(user, request)
        break
      case RequestType.SetUserName:
        this.handleSetUserName(user, request.stringRequestData?.value ?? '')
        break
      case RequestType.SetE2EPublicKey:
        this.handleSetE2EPublicKey(user, request.byteData)
        break
      case RequestType.SetJoinPassword:
        this.handleSetJoinPassword(user, request.stringRequestData?.value ?? '')
        break
      case RequestType.UserList:
        this.sendUserList(user)
        break
      case RequestType.SetUserPublicKey:
        this.handleLegacySetUserPublicKey(user)
        break
      case RequestType.SetServerSharedKey:
        // Only ever sent server-to-client in the legacy protocol; a client
        // should never send us this. Ignore defensively.
        break
      default:
        break
    }
  }

  private sendChannelList(user: UserRecord): void {
    const channels = this.channels.listChannels()
    user.peer.send({
      channelList: {
        channels: { values: channels.map((c) => c.name) },
        channelMeta: channels.map((c) => ({
          channel: c.name,
          e2eChannel: c.e2e,
          creatorId: c.creatorId,
          topic: c.topic
        }))
      }
    })
  }

  private sendChannelUserList(user: UserRecord, channelName: string): void {
    const memberIds = this.channels.getUsersInChannel(channelName)
    if (!memberIds) {
      user.peer.send({
        errorMessage: { errorType: ErrorType.ChannelDoesNotExist, additionalMessage: channelName }
      })
      return
    }
    const members = memberIds.map((id) => this.users.getById(id)).filter((u): u is UserRecord => !!u)
    user.peer.send({
      userList: { users: members.map(userToUserData), channel: channelName }
    })
  }

  private sendUserList(user: UserRecord): void {
    user.peer.send({ userList: { users: this.users.listNamed().map(userToUserData) } })
  }

  private handleSetUserName(user: UserRecord, newName: string): void {
    if (this.password !== null && !this.passwordVerifiedPeers.has(user.peer)) {
      user.peer.send({ errorMessage: { errorType: ErrorType.IncorrectPassword } })
      return
    }

    if (newName.length === 0 || newName.length > MAX_NICKNAME_LENGTH) {
      user.peer.send({
        errorMessage: { errorType: ErrorType.UserNameInUse, additionalMessage: newName }
      })
      return
    }

    const success = this.users.setName(user, newName)

    if (!success) {
      user.peer.send({
        errorMessage: { errorType: ErrorType.UserNameInUse, additionalMessage: newName }
      })
      return
    }

    this.users.touchLastSeen(user)
    // Broadcast on both the initial name-set AND a later rename — the
    // original Java server only ever did this for the initial set (a
    // rename only updated its own internal object references), so already-
    // connected clients' own contact lists would silently keep showing the
    // stale name until they reconnected. UserConnectionStatus{connected:true}
    // is reused rather than adding a new message type, since it's already
    // just "here is this user's current UserData" and every client already
    // handles it as an upsert keyed by user id.
    this.broadcastToAll(userConnectionStatus(user, true))
    user.peer.send({ notification: { userNameSet: { name: newName } } })
  }

  private handleSetE2EPublicKey(user: UserRecord, keyBytes: Uint8Array | undefined | null): void {
    if (!keyBytes || keyBytes.length === 0) return
    user.e2eIdentityKey = Buffer.from(keyBytes)
  }

  /**
   * A password change only ever gates *future* SetUserName attempts on
   * *new* connections — an already-registered user is never kicked or
   * re-challenged retroactively when the host changes the password while
   * running. Sent before SetUserName, so a not-yet-named peer's own
   * PeerConnection identity is enough to key passwordVerifiedPeers by
   * (UserRegistry already tracks a connection from accept time, before any
   * name is set — see handleConnect).
   */
  private handleSetJoinPassword(user: UserRecord, attempt: string): void {
    if (this.password === null || attempt === this.password) {
      this.passwordVerifiedPeers.add(user.peer)
      user.peer.send({ notification: { passwordAccepted: {} } })
      return
    }
    user.peer.send({ errorMessage: { errorType: ErrorType.IncorrectPassword } })
  }

  /**
   * The legacy Java client's SetUserName call is NOT independent of this
   * handshake — it only fires as a side effect of ClientHandler receiving
   * SetServerSharedKey (see ServerConnection.java's setServerSecretKey()),
   * unconditionally, regardless of whether the RSA-encrypted key it
   * contains actually decodes. Confirmed by running the real Java client
   * against this server: without any reply here, it never sends a
   * username at all and its own GUI sits stuck at "connecting" forever.
   *
   * This server still does not implement the actual legacy AES/RSA
   * transport encryption (see PORTING-NOTES.md/CRYPTO.md) — the byteData
   * below is deliberately the wrong length for any real RSA modulus, so
   * Cipher.doFinal() on the Java side throws IllegalBlockSizeException
   * before attempting real decryption, `serverSecretKey` stays null, and
   * the Java client's own isEncryptionEnabled() check stays false — it
   * keeps sending flag=0 plaintext, which is the only mode this server's
   * codec accepts. This reply's only purpose is unblocking sendUsername();
   * it deliberately can never result in the Java client switching to
   * flag=1 encrypted frames.
   */
  private handleLegacySetUserPublicKey(user: UserRecord): void {
    user.peer.send({
      request: {
        requestId: randomUUID(),
        requestType: portochat.Request.RequestType.SetServerSharedKey,
        byteData: new Uint8Array(1)
      }
    })
  }

  private handleChannelJoin(user: UserRecord, request: portochat.IRequest): void {
    const channelName = request.stringRequestData?.value ?? ''
    if (channelName.length === 0 || channelName.length > MAX_CHANNEL_NAME_LENGTH) {
      user.peer.send({
        errorMessage: { errorType: ErrorType.ChannelDoesNotExist, additionalMessage: channelName }
      })
      return
    }

    const requestedE2E = request.e2eChannel ?? false
    const existingRecord = this.channels.get(channelName)
    const channelIsE2E = existingRecord ? existingRecord.e2e : requestedE2E

    if (channelIsE2E && !user.e2eIdentityKey) {
      user.peer.send({
        errorMessage: {
          errorType: ErrorType.E2EChannelRequiresSupport,
          additionalMessage: channelName
        }
      })
      return
    }

    const { record, created } = this.channels.ensureChannel(channelName, requestedE2E, user.id)
    if (created) {
      this.broadcastToAll({
        notification: {
          channelAdded: { channel: channelName, e2eChannel: record.e2e, creatorId: record.creatorId }
        }
      })
    }

    this.channels.addUserToChannel(channelName, user.id)
    this.broadcastToChannel(channelName, user.id, {
      notification: { channelJoin: { channel: channelName, userId: user.id } }
    })
  }

  /** Only the channel's creator (immutable, set at creation) may change its topic. */
  private handleSetChannelTopic(user: UserRecord, channelTopic: portochat.IChannelTopic): void {
    const channelName = channelTopic.channel ?? ''
    const record = this.channels.get(channelName)
    if (!record) {
      user.peer.send({
        errorMessage: { errorType: ErrorType.ChannelDoesNotExist, additionalMessage: channelName }
      })
      return
    }
    if (record.creatorId !== user.id) {
      user.peer.send({
        errorMessage: { errorType: ErrorType.NotAuthorized, additionalMessage: channelName }
      })
      return
    }

    const topic = (channelTopic.topic ?? '').slice(0, MAX_CHANNEL_TOPIC_LENGTH)
    this.channels.setTopic(channelName, topic)
    this.broadcastToAll({ channelTopic: { channel: channelName, topic } })
  }

  // ---- Notification handling --------------------------------------------

  private handleNotification(user: UserRecord, notification: portochat.INotification): void {
    // `notification` here is typed as the plain INotification interface (a
    // nested oneof field, not a decoded top-level message), so the
    // `NotificationData` discriminant getter isn't available on the type —
    // check field presence directly instead. ChannelPart is the only
    // Notification variant a client ever sends to the server.
    if (notification.channelPart) {
      this.handleChannelPart(user, notification.channelPart.channel ?? '')
    }
  }

  private handleChannelPart(user: UserRecord, channelName: string): void {
    const result = this.channels.removeUserFromChannel(channelName, user.id)
    if (result === 'not-a-member') return

    if (result === 'channel-removed') {
      this.broadcastToAll({ notification: { channelRemoved: { channel: channelName } } })
      return
    }

    this.broadcastToChannel(channelName, user.id, {
      notification: { channelPart: { channel: channelName, userId: user.id } }
    })
    this.triggerKeyRotationIfE2E(channelName)
  }

  /**
   * The server never generates or holds channel keys — it only tracks that a
   * rotation should happen and reports the new epoch number. The actual key
   * regeneration and re-wrap-to-members happens client-side (see
   * crypto/channelKeys.ts), triggered by this notification.
   */
  private triggerKeyRotationIfE2E(channelName: string): void {
    const record = this.channels.get(channelName)
    if (!record || !record.e2e) return
    const keyEpoch = this.channels.bumpKeyEpoch(channelName)
    if (keyEpoch === undefined) return
    this.broadcastToChannel(channelName, null, {
      notification: { keyRotationNotice: { channel: channelName, keyEpoch } }
    })
  }

  // ---- Chat / keyshare relay ---------------------------------------------

  private handleChatMessage(user: UserRecord, chatMessage: portochat.IChatMessage): void {
    const message = (chatMessage.message ?? '').slice(0, MAX_MESSAGE_TEXT_LENGTH)
    const ciphertext = chatMessage.e2eCiphertext
    if (ciphertext && ciphertext.length > MAX_E2E_CIPHERTEXT_LENGTH) return

    // Hardening beyond the original Java server: never trust a client's
    // self-reported senderId — always stamp the authenticated user's own id.
    const outgoing: portochat.IPortoChatMessage = {
      chatMessage: { ...chatMessage, senderId: user.id, message }
    }

    if (chatMessage.isChannel) {
      const channelName = chatMessage.destinationId ?? ''
      if (
        !this.channels.channelExists(channelName) ||
        !this.channels.isUserInChannel(channelName, user.id)
      ) {
        user.peer.send({
          errorMessage: {
            errorType: ErrorType.ChannelDoesNotExist,
            additionalMessage: channelName
          }
        })
        return
      }
      this.broadcastToChannel(channelName, user.id, outgoing)
    } else {
      const destinationId = chatMessage.destinationId ?? ''
      const recipient = this.users.getById(destinationId)
      if (!recipient) {
        user.peer.send({ notification: { userDoesNotExist: { missingId: destinationId } } })
        return
      }
      recipient.peer.send(outgoing)
    }
  }

  /** Relayed opaquely — this method must never inspect or decode wrappedKey. */
  private handleKeyShare(user: UserRecord, keyShare: portochat.IKeyShare): void {
    const recipient = this.users.getById(keyShare.toUserId ?? '')
    if (!recipient) return
    recipient.peer.send({ keyShare: { ...keyShare, fromUserId: user.id } })
  }

  // ---- Broadcast helpers ---------------------------------------------------

  private broadcastToAll(message: portochat.IPortoChatMessage, exceptUserId?: string): void {
    for (const user of this.users.listAllConnections()) {
      if (user.id === exceptUserId) continue
      user.peer.send(message)
    }
  }

  private broadcastToChannel(
    channelName: string,
    exceptUserId: string | null,
    message: portochat.IPortoChatMessage
  ): void {
    const memberIds = this.channels.getUsersInChannel(channelName) ?? []
    for (const id of memberIds) {
      if (id === exceptUserId) continue
      const user = this.users.getById(id)
      user?.peer.send(message)
    }
  }
}
