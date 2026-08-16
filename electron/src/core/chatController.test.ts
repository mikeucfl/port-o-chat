import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { portochat } from '@proto/portochat'
import { NodeCryptoProvider } from '../main/crypto/nodeCryptoProvider'
import { ChatController } from './chatController'
import type { CryptoProvider } from './cryptoProvider'
import type { ChatTransport, ChatTransportEvents, ConnectionState } from './transport'

type Listener = (...args: unknown[]) => void

/** In-memory stand-in for a real transport — captures everything sent and lets a test push server-originated messages down via deliver(). */
class FakeTransport implements ChatTransport {
  sent: portochat.IPortoChatMessage[] = []
  private state: ConnectionState = 'disconnected'
  private listeners = new Map<string, Set<Listener>>()

  connect(): Promise<void> {
    this.state = 'connected'
    return Promise.resolve()
  }

  send(message: portochat.IPortoChatMessage): void {
    this.sent.push(message)
  }

  disconnect(): void {
    this.state = 'disconnected'
  }

  getState(): ConnectionState {
    return this.state
  }

  on<K extends keyof ChatTransportEvents>(
    event: K,
    listener: (...args: ChatTransportEvents[K]) => void
  ): void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener)
  }

  deliver(message: portochat.PortoChatMessage): void {
    this.listeners.get('message')?.forEach((l) => l(message))
  }
}

function makeIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const publicKeyRaw = Buffer.from(
    (publicKey.export({ format: 'jwk' }) as { x: string }).x,
    'base64url'
  )
  return { privateKey, publicKey, publicKeyRaw }
}

interface RecordedEvent {
  channel: string
  payload: unknown
}

/** A CryptoProvider reporting no identity at all — every crypto operation throws, since a platform with no identity key should never need to call one (see the identityPublicKey guard in sendMessage). Mirrors the browser build before its crypto backend lands. */
function noIdentityCryptoProvider(): CryptoProvider {
  const unreachable = (): never => {
    throw new Error('unreachable: this platform has no E2E identity')
  }
  return {
    identityPublicKey: null,
    randomId: () => Math.random().toString(36).slice(2),
    fingerprint: unreachable,
    generateChannelKey: unreachable,
    encryptDm: unreachable,
    decryptDm: unreachable,
    wrapChannelKey: unreachable,
    unwrapChannelKey: unreachable,
    encryptChannelMessage: unreachable,
    decryptChannelMessage: unreachable
  }
}

/** A ChatController that has completed the connect handshake and learned its own userId, ready to exercise sendMessage/handleMessage against. */
async function connected(userId = 'me-id', nickname = 'tester', crypto: CryptoProvider = new NodeCryptoProvider(makeIdentity())) {
  const transport = new FakeTransport()
  const events: RecordedEvent[] = []
  const controller = new ChatController({
    crypto,
    createTransport: () => transport,
    emit: (channel, payload) => events.push({ channel, payload })
  })
  await controller.connect('127.0.0.1', 3456, nickname)
  // The server never tells a client its own id directly — it's inferred
  // from a UserList/UserConnectionStatus broadcast naming it, same as the
  // real ChatSession does.
  transport.deliver(new portochat.PortoChatMessage({ userList: { users: [{ id: userId, name: nickname }] } }))
  // Discard connect-time noise (SetUserName/requestUserList sends, identity/userList events) so each test's assertions are about its own actions.
  transport.sent.length = 0
  events.length = 0
  return { controller, transport, events }
}

describe('ChatController E2E policy', () => {
  it('refuses to send on a known-E2E channel before its key has arrived, rather than downgrading to plaintext', async () => {
    const { controller, transport, events } = await connected()
    transport.deliver(
      new portochat.PortoChatMessage({
        channelList: {
          channels: { values: ['#secret'] },
          channelMeta: [{ channel: '#secret', e2eChannel: true, creatorId: 'someone-else' }]
        }
      })
    )

    controller.sendMessage({ destinationId: '#secret', isChannel: true, text: 'hello' })

    expect(transport.sent).toHaveLength(0)
    expect(events.find((e) => e.channel === 'error:generic')).toBeDefined()
  })

  it('auto-encrypts a DM once the peer\'s identity key is known, and falls back to plaintext before that', async () => {
    const { controller, transport } = await connected()
    const peer = makeIdentity()

    controller.sendMessage({ destinationId: 'peer-id', isChannel: false, text: 'hi (plain)' })
    const plainSend = transport.sent.at(-1)?.chatMessage
    expect(plainSend?.message).toBe('hi (plain)')
    expect(plainSend?.e2eCiphertext?.length ?? 0).toBe(0)

    transport.deliver(
      new portochat.PortoChatMessage({
        notification: {
          userConnectionStatus: {
            connected: true,
            user: { id: 'peer-id', name: 'peer', e2eIdentityKey: peer.publicKeyRaw }
          }
        }
      })
    )

    controller.sendMessage({ destinationId: 'peer-id', isChannel: false, text: 'hi (e2e)' })
    const e2eSend = transport.sent.at(-1)?.chatMessage
    expect(e2eSend?.message).toBe('')
    expect(e2eSend?.e2eCiphertext?.length ?? 0).toBeGreaterThan(0)
  })

  it('falls back to plaintext when this platform has no E2E identity of its own, even if the peer is E2E-capable', async () => {
    const { controller, transport } = await connected('me-id', 'tester', noIdentityCryptoProvider())
    const peer = makeIdentity()

    transport.deliver(
      new portochat.PortoChatMessage({
        notification: {
          userConnectionStatus: {
            connected: true,
            user: { id: 'peer-id', name: 'peer', e2eIdentityKey: peer.publicKeyRaw }
          }
        }
      })
    )

    // Must not throw (the stub crypto's encrypt methods all throw) and must
    // send in plaintext, since we have nothing to encrypt with.
    expect(() =>
      controller.sendMessage({ destinationId: 'peer-id', isChannel: false, text: 'hi anyway' })
    ).not.toThrow()
    const sent = transport.sent.at(-1)?.chatMessage
    expect(sent?.message).toBe('hi anyway')
    expect(sent?.e2eCiphertext?.length ?? 0).toBe(0)
  })

  it('blocks outgoing E2E sends to a peer whose key changed, until explicitly re-trusted', async () => {
    const { controller, transport } = await connected()
    const peer1 = makeIdentity()
    const peer2 = makeIdentity()

    transport.deliver(
      new portochat.PortoChatMessage({
        notification: {
          userConnectionStatus: {
            connected: true,
            user: { id: 'peer-id', name: 'peer', e2eIdentityKey: peer1.publicKeyRaw }
          }
        }
      })
    )
    controller.sendMessage({ destinationId: 'peer-id', isChannel: false, text: 'first' })
    const sentBeforeKeyChange = transport.sent.length

    // The peer's identity key changes mid-session (e.g. they reconnected with a new one).
    transport.deliver(
      new portochat.PortoChatMessage({
        notification: {
          userConnectionStatus: {
            connected: true,
            user: { id: 'peer-id', name: 'peer', e2eIdentityKey: peer2.publicKeyRaw }
          }
        }
      })
    )

    controller.sendMessage({ destinationId: 'peer-id', isChannel: false, text: 'blocked?' })
    expect(transport.sent.length).toBe(sentBeforeKeyChange)

    controller.trustPeerKey('peer-id')
    controller.sendMessage({ destinationId: 'peer-id', isChannel: false, text: 'after re-trust' })
    expect(transport.sent.length).toBe(sentBeforeKeyChange + 1)
  })

  it('surfaces a failed decrypt as decryptFailed rather than throwing', async () => {
    const { transport, events } = await connected('me-id', 'tester')

    transport.deliver(
      new portochat.PortoChatMessage({
        chatMessage: {
          senderId: 'ghost-id',
          destinationId: 'me-id',
          isChannel: false,
          e2eCiphertext: Buffer.alloc(32, 0x41),
          e2eNonce: Buffer.alloc(12, 0x42)
        }
      })
    )

    const chatEvent = events.find((e) => e.channel === 'chat:message')
    expect(chatEvent).toBeDefined()
    expect((chatEvent?.payload as { decryptFailed: boolean }).decryptFailed).toBe(true)
    expect((chatEvent?.payload as { message: string }).message).toBe('')
  })
})
