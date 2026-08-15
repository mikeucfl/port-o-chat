import { beforeEach, describe, expect, it } from 'vitest'
import { portochat } from '../proto-gen/portochat'
import { ChannelRegistry } from './channelRegistry'
import { ChatRouter } from './router'
import { FakePeer } from './testHelpers'
import { UserRegistry } from './userRegistry'

const RequestType = portochat.Request.RequestType
const ErrorType = portochat.ErrorMessage.ErrorType

function msg(props: portochat.IPortoChatMessage): portochat.PortoChatMessage {
  return new portochat.PortoChatMessage(props)
}

describe('ChatRouter', () => {
  let users: UserRegistry
  let channels: ChannelRegistry
  let router: ChatRouter

  beforeEach(() => {
    users = new UserRegistry()
    channels = new ChannelRegistry()
    router = new ChatRouter(users, channels)
  })

  function connectAndName(name: string, e2eKey?: Buffer) {
    const peer = new FakePeer()
    const user = router.handleConnect(peer, '127.0.0.1')
    if (e2eKey) {
      router.handleMessage(
        peer,
        msg({ request: { requestType: RequestType.SetE2EPublicKey, byteData: e2eKey } })
      )
    }
    router.handleMessage(
      peer,
      msg({
        request: { requestType: RequestType.SetUserName, stringRequestData: { value: name } }
      })
    )
    return { peer, user }
  }

  it('sets a username and broadcasts connection status to existing users', () => {
    const alice = connectAndName('alice')
    const bobPeer = new FakePeer()
    router.handleConnect(bobPeer, '127.0.0.1')

    alice.peer.sent.length = 0
    router.handleMessage(
      bobPeer,
      msg({ request: { requestType: RequestType.SetUserName, stringRequestData: { value: 'bob' } } })
    )

    expect(bobPeer.last()?.notification?.userNameSet?.name).toBe('bob')
    const statusMsg = alice.peer.sent.find((m) => m.notification?.userConnectionStatus)
    expect(statusMsg?.notification?.userConnectionStatus?.user?.name).toBe('bob')
    expect(statusMsg?.notification?.userConnectionStatus?.connected).toBe(true)
  })

  it('propagates a rename to already-connected users too, not just the initial name-set (bug-fix regression)', () => {
    const alice = connectAndName('alice')
    const bob = connectAndName('bob')
    alice.peer.sent.length = 0

    router.handleMessage(
      bob.peer,
      msg({ request: { requestType: RequestType.SetUserName, stringRequestData: { value: 'bobby' } } })
    )

    expect(bob.peer.last()?.notification?.userNameSet?.name).toBe('bobby')
    const statusMsg = alice.peer.sent.find(
      (m) => m.notification?.userConnectionStatus?.user?.id === bob.user.id
    )
    expect(statusMsg?.notification?.userConnectionStatus?.user?.name).toBe('bobby')
  })

  it('rejects a duplicate username with UserNameInUse and does not broadcast', () => {
    connectAndName('alice')
    const bobPeer = new FakePeer()
    router.handleConnect(bobPeer, '127.0.0.1')

    router.handleMessage(
      bobPeer,
      msg({
        request: { requestType: RequestType.SetUserName, stringRequestData: { value: 'alice' } }
      })
    )

    expect(bobPeer.last()?.errorMessage?.errorType).toBe(ErrorType.UserNameInUse)
    expect(users.isNameInUse('alice')).toBe(true)
    expect(users.listNamed()).toHaveLength(1)
  })

  it('creates a channel implicitly on first join and broadcasts ChannelAdded to everyone', () => {
    const alice = connectAndName('alice')
    const bob = connectAndName('bob')

    router.handleMessage(
      alice.peer,
      msg({
        request: {
          requestType: RequestType.ChannelJoin,
          stringRequestData: { value: '#general' }
        }
      })
    )

    expect(channels.channelExists('#general')).toBe(true)
    const added = bob.peer.sent.find((m) => m.notification?.channelAdded)
    expect(added?.notification?.channelAdded?.channel).toBe('#general')
    expect(added?.notification?.channelAdded?.e2eChannel).toBe(false)
  })

  it('notifies existing channel members (not the joiner) when a second user joins', () => {
    const alice = connectAndName('alice')
    const bob = connectAndName('bob')
    router.handleMessage(
      alice.peer,
      msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
    )
    alice.peer.sent.length = 0
    bob.peer.sent.length = 0

    router.handleMessage(
      bob.peer,
      msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
    )

    const aliceJoinNotice = alice.peer.sent.find((m) => m.notification?.channelJoin)
    expect(aliceJoinNotice?.notification?.channelJoin?.userId).toBe(bob.user.id)
    expect(bob.peer.sent.find((m) => m.notification?.channelJoin)).toBeUndefined()
  })

  it('tears down a channel and broadcasts ChannelRemoved when the last member parts', () => {
    const alice = connectAndName('alice')
    const bob = connectAndName('bob')
    router.handleMessage(
      alice.peer,
      msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
    )
    bob.peer.sent.length = 0

    router.handleMessage(
      alice.peer,
      msg({ notification: { channelPart: { channel: '#general' } } })
    )

    expect(channels.channelExists('#general')).toBe(false)
    const removed = bob.peer.sent.find((m) => m.notification?.channelRemoved)
    expect(removed?.notification?.channelRemoved?.channel).toBe('#general')
  })

  it('broadcasts ChannelPart (not ChannelRemoved) when other members remain', () => {
    const alice = connectAndName('alice')
    const bob = connectAndName('bob')
    for (const p of [alice.peer, bob.peer]) {
      router.handleMessage(
        p,
        msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
      )
    }
    bob.peer.sent.length = 0

    router.handleMessage(alice.peer, msg({ notification: { channelPart: { channel: '#general' } } }))

    expect(channels.channelExists('#general')).toBe(true)
    expect(channels.isUserInChannel('#general', alice.user.id)).toBe(false)
    const part = bob.peer.sent.find((m) => m.notification?.channelPart)
    expect(part?.notification?.channelPart?.userId).toBe(alice.user.id)
  })

  describe('E2E channel join refusal', () => {
    it('refuses to create an E2E channel for a creator with no identity key', () => {
      const alice = connectAndName('alice') // no e2e key
      router.handleMessage(
        alice.peer,
        msg({
          request: {
            requestType: RequestType.ChannelJoin,
            stringRequestData: { value: '#secret' },
            e2eChannel: true
          }
        })
      )

      expect(alice.peer.last()?.errorMessage?.errorType).toBe(ErrorType.E2EChannelRequiresSupport)
      expect(channels.channelExists('#secret')).toBe(false)
    })

    it('lets an E2E-capable creator make an E2E channel', () => {
      const alice = connectAndName('alice', Buffer.alloc(32, 1))
      router.handleMessage(
        alice.peer,
        msg({
          request: {
            requestType: RequestType.ChannelJoin,
            stringRequestData: { value: '#secret' },
            e2eChannel: true
          }
        })
      )

      expect(channels.get('#secret')?.e2e).toBe(true)
    })

    it('refuses a legacy/non-E2E-capable client joining an existing E2E channel', () => {
      const alice = connectAndName('alice', Buffer.alloc(32, 1))
      router.handleMessage(
        alice.peer,
        msg({
          request: {
            requestType: RequestType.ChannelJoin,
            stringRequestData: { value: '#secret' },
            e2eChannel: true
          }
        })
      )
      const legacyBob = connectAndName('bob') // no e2e key, e.g. an old Java client

      router.handleMessage(
        legacyBob.peer,
        msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#secret' } } })
      )

      expect(legacyBob.peer.last()?.errorMessage?.errorType).toBe(
        ErrorType.E2EChannelRequiresSupport
      )
      expect(channels.isUserInChannel('#secret', legacyBob.user.id)).toBe(false)
    })

    it('keeps the E2E flag immutable: a join request cannot upgrade an existing plaintext channel', () => {
      const alice = connectAndName('alice', Buffer.alloc(32, 1))
      router.handleMessage(
        alice.peer,
        msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
      )
      const bob = connectAndName('bob', Buffer.alloc(32, 2))

      router.handleMessage(
        bob.peer,
        msg({
          request: {
            requestType: RequestType.ChannelJoin,
            stringRequestData: { value: '#general' },
            e2eChannel: true
          }
        })
      )

      expect(channels.get('#general')?.e2e).toBe(false)
      expect(channels.isUserInChannel('#general', bob.user.id)).toBe(true)
    })
  })

  it('reports the actual missing recipient id on a DM to a nonexistent user (bug-fix regression)', () => {
    const alice = connectAndName('alice')

    router.handleMessage(
      alice.peer,
      msg({
        chatMessage: {
          senderId: alice.user.id,
          destinationId: 'no-such-user-id',
          isChannel: false,
          message: 'hello?'
        }
      })
    )

    const notFound = alice.peer.last()
    expect(notFound?.notification?.userDoesNotExist?.missingId).toBe('no-such-user-id')
    // The original Java bug wrapped the *sender's own* data here instead.
    expect(notFound?.notification?.userDoesNotExist?.user).toBeUndefined()
  })

  it('replies to a legacy SetUserPublicKey with an undecryptable SetServerSharedKey, never a UserList (bug-fix regression)', () => {
    // The original Java bug fell through into an unsolicited UserList send.
    // This server intentionally does reply now (see router.ts's
    // handleLegacySetUserPublicKey) — but only to unblock the Java client's
    // own sendUsername() call, never with a UserList, and never with key
    // material that could actually decrypt (which would flip the Java
    // client into sending flag=1 frames this server can't accept).
    const alice = connectAndName('alice')
    alice.peer.sent.length = 0

    router.handleMessage(
      alice.peer,
      msg({ request: { requestType: RequestType.SetUserPublicKey, byteData: Buffer.alloc(4) } })
    )

    expect(alice.peer.sent).toHaveLength(1)
    const reply = alice.peer.sent[0]
    expect(reply?.request?.requestType).toBe(RequestType.SetServerSharedKey)
    expect(reply?.userList).toBeUndefined()
  })

  it('overrides a spoofed senderId with the authenticated sender (hardening)', () => {
    const alice = connectAndName('alice')
    const bob = connectAndName('bob')

    router.handleMessage(
      alice.peer,
      msg({
        chatMessage: {
          senderId: bob.user.id, // alice lying about being bob
          destinationId: bob.user.id,
          isChannel: false,
          message: 'spoofed'
        }
      })
    )

    expect(bob.peer.last()?.chatMessage?.senderId).toBe(alice.user.id)
  })

  it('rejects a channel message from a user who is not a member (hardening)', () => {
    const alice = connectAndName('alice')
    const bob = connectAndName('bob')
    router.handleMessage(
      alice.peer,
      msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
    )

    router.handleMessage(
      bob.peer,
      msg({
        chatMessage: {
          senderId: bob.user.id,
          destinationId: '#general',
          isChannel: true,
          message: 'not a member'
        }
      })
    )

    expect(bob.peer.last()?.errorMessage?.errorType).toBe(ErrorType.ChannelDoesNotExist)
  })

  it('cleans up channels and broadcasts disconnect status on handleDisconnect', () => {
    const alice = connectAndName('alice')
    const bob = connectAndName('bob')
    router.handleMessage(
      alice.peer,
      msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
    )
    bob.peer.sent.length = 0

    router.handleDisconnect(alice.peer)

    expect(channels.channelExists('#general')).toBe(false)
    const status = bob.peer.sent.find((m) => m.notification?.userConnectionStatus)
    expect(status?.notification?.userConnectionStatus?.connected).toBe(false)
    expect(status?.notification?.userConnectionStatus?.user?.name).toBe('alice')
  })

  describe('E2E channel key rotation trigger', () => {
    it('bumps the key epoch and notifies remaining members when a member parts', () => {
      const alice = connectAndName('alice', Buffer.alloc(32, 1))
      router.handleMessage(
        alice.peer,
        msg({
          request: {
            requestType: RequestType.ChannelJoin,
            stringRequestData: { value: '#secret' },
            e2eChannel: true
          }
        })
      )
      const bob = connectAndName('bob', Buffer.alloc(32, 2))
      router.handleMessage(
        bob.peer,
        msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#secret' } } })
      )
      const carol = connectAndName('carol', Buffer.alloc(32, 3))
      router.handleMessage(
        carol.peer,
        msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#secret' } } })
      )
      expect(channels.get('#secret')?.keyEpoch).toBe(0)
      bob.peer.sent.length = 0
      carol.peer.sent.length = 0

      router.handleMessage(alice.peer, msg({ notification: { channelPart: { channel: '#secret' } } }))

      expect(channels.get('#secret')?.keyEpoch).toBe(1)
      const bobNotice = bob.peer.sent.find((m) => m.notification?.keyRotationNotice)
      const carolNotice = carol.peer.sent.find((m) => m.notification?.keyRotationNotice)
      expect(bobNotice?.notification?.keyRotationNotice?.keyEpoch).toBe(1)
      expect(carolNotice?.notification?.keyRotationNotice?.keyEpoch).toBe(1)
    })

    it('does not rotate keys for a plaintext channel', () => {
      const alice = connectAndName('alice')
      const bob = connectAndName('bob')
      for (const p of [alice.peer, bob.peer]) {
        router.handleMessage(
          p,
          msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
        )
      }
      bob.peer.sent.length = 0

      router.handleMessage(alice.peer, msg({ notification: { channelPart: { channel: '#general' } } }))

      expect(bob.peer.sent.find((m) => m.notification?.keyRotationNotice)).toBeUndefined()
    })
  })

  describe('channel topics (creator-only)', () => {
    it('lets the creator set the topic and broadcasts it to everyone', () => {
      const alice = connectAndName('alice')
      const bob = connectAndName('bob')
      router.handleMessage(
        alice.peer,
        msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
      )
      bob.peer.sent.length = 0

      router.handleMessage(alice.peer, msg({ channelTopic: { channel: '#general', topic: 'chat about stuff' } }))

      expect(channels.get('#general')?.topic).toBe('chat about stuff')
      const received = bob.peer.sent.find((m) => m.channelTopic)
      expect(received?.channelTopic?.topic).toBe('chat about stuff')
    })

    it('rejects a topic change from a non-creator member', () => {
      const alice = connectAndName('alice')
      const bob = connectAndName('bob')
      router.handleMessage(
        alice.peer,
        msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
      )
      router.handleMessage(
        bob.peer,
        msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
      )

      router.handleMessage(bob.peer, msg({ channelTopic: { channel: '#general', topic: 'sneaky' } }))

      expect(bob.peer.last()?.errorMessage?.errorType).toBe(ErrorType.NotAuthorized)
      expect(channels.get('#general')?.topic).toBe('')
    })

    it('rejects a topic change for a channel that does not exist', () => {
      const alice = connectAndName('alice')

      router.handleMessage(alice.peer, msg({ channelTopic: { channel: '#nope', topic: 'x' } }))

      expect(alice.peer.last()?.errorMessage?.errorType).toBe(ErrorType.ChannelDoesNotExist)
    })

    it('a fresh creator can set the topic after the channel is torn down and recreated', () => {
      const alice = connectAndName('alice')
      router.handleMessage(
        alice.peer,
        msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
      )
      router.handleMessage(alice.peer, msg({ notification: { channelPart: { channel: '#general' } } }))
      expect(channels.channelExists('#general')).toBe(false)

      const bob = connectAndName('bob')
      router.handleMessage(
        bob.peer,
        msg({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
      )

      // alice was the original creator but the channel was torn down; bob
      // (the new creator) should now be the one authorized to set the topic.
      router.handleMessage(alice.peer, msg({ channelTopic: { channel: '#general', topic: 'nope' } }))
      expect(alice.peer.last()?.errorMessage?.errorType).toBe(ErrorType.NotAuthorized)

      router.handleMessage(bob.peer, msg({ channelTopic: { channel: '#general', topic: 'bobs topic' } }))
      expect(channels.get('#general')?.topic).toBe('bobs topic')
    })
  })
})
