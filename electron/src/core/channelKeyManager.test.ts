import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { x25519 } from '@noble/curves/ed25519.js'
import { NodeCryptoProvider } from '../main/crypto/nodeCryptoProvider'
import { WebCryptoProvider } from '../web/crypto/webCryptoProvider'
import type { CryptoProvider } from './cryptoProvider'
import { ChannelKeyManager } from './channelKeyManager'

interface Party {
  userId: string
  crypto: CryptoProvider
  manager: ChannelKeyManager
}

function makeNodeCryptoProvider(): CryptoProvider {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const publicKeyRaw = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url')
  return new NodeCryptoProvider({ privateKey, publicKey, publicKeyRaw })
}

function makeWebCryptoProvider(): CryptoProvider {
  const { secretKey, publicKey } = x25519.keygen()
  const privateKey = Buffer.from(secretKey)
  const publicKeyRaw = Buffer.from(publicKey)
  return new WebCryptoProvider({ privateKey, publicKey: publicKeyRaw, publicKeyRaw })
}

/** Simulates the roster + KeyShare relay between a small set of in-process parties, without any real transport. */
class Simulation {
  parties = new Map<string, Party>()

  addParty(userId: string, platform: 'node' | 'web' = 'node'): Party {
    const crypto = platform === 'node' ? makeNodeCryptoProvider() : makeWebCryptoProvider()
    const manager = new ChannelKeyManager({
      myUserId: userId,
      crypto,
      sendKeyShare: (channel, toUserId, wrappedKey, nonce, epoch) => {
        const target = this.parties.get(toUserId)
        target?.manager.receiveKeyShare(channel, userId, wrappedKey, nonce, epoch)
      },
      getPeerPublicKey: (id) => this.parties.get(id)?.crypto.identityPublicKey ?? undefined,
      getOtherMembers: (channel) =>
        [...(this.members.get(channel) ?? [])].filter((id) => id !== userId)
    })
    const party: Party = { userId, crypto, manager }
    this.parties.set(userId, party)
    return party
  }

  members = new Map<string, Set<string>>()

  setMembers(channel: string, ids: string[]): void {
    this.members.set(channel, new Set(ids))
  }
}

describe('ChannelKeyManager', () => {
  let sim: Simulation

  beforeEach(() => {
    sim = new Simulation()
  })

  it('a joiner ends up with the same key as the creator via wrapForNewMember/receiveKeyShare', () => {
    const alice = sim.addParty('alice')
    const bob = sim.addParty('bob')
    sim.setMembers('#secret', ['alice'])

    const created = alice.manager.createChannel('#secret')
    // bob joins; alice (the only existing member) wraps for him.
    alice.manager.wrapForNewMember('#secret', 'bob')

    const bobState = bob.manager.getState('#secret')
    expect(bobState).toBeDefined()
    expect(bobState?.key.equals(created.key)).toBe(true)
    expect(bobState?.epoch).toBe(0)
  })

  it('every existing member wraps independently; the joiner accepts the first valid one and ignores duplicates', () => {
    const alice = sim.addParty('alice')
    const bob = sim.addParty('bob')
    const carol = sim.addParty('carol')
    sim.setMembers('#secret', ['alice'])

    const created = alice.manager.createChannel('#secret')
    // bob joins first; alice wraps for him.
    alice.manager.wrapForNewMember('#secret', 'bob')
    sim.setMembers('#secret', ['alice', 'bob'])

    // carol joins next; both existing members (alice and bob) independently
    // wrap for her — she should end up with the same key either way, and
    // the second (duplicate, same-epoch) KeyShare should be a harmless no-op.
    alice.manager.wrapForNewMember('#secret', 'carol')
    bob.manager.wrapForNewMember('#secret', 'carol')

    const carolState = carol.manager.getState('#secret')
    expect(carolState?.key.equals(created.key)).toBe(true)
  })

  it('rejects a KeyShare not actually wrapped for the recipient', () => {
    const alice = sim.addParty('alice')
    const bob = sim.addParty('bob')
    const mallory = sim.addParty('mallory')
    sim.setMembers('#secret', ['alice'])
    alice.manager.createChannel('#secret')

    // mallory crafts a bogus KeyShare claiming to be from alice, wrapped
    // with mallory's own key material instead of a real ECDH result meant
    // for bob — should fail AEAD auth and be discarded, not crash.
    const accepted = bob.manager.receiveKeyShare(
      '#secret',
      'alice',
      Buffer.alloc(48, 0x41),
      Buffer.alloc(12, 0x42),
      0
    )
    expect(accepted).toBe(false)
    expect(bob.manager.getState('#secret')).toBeUndefined()
    void mallory
  })

  it('on rotation, the lowest-id remaining member generates and distributes a new key to the others', () => {
    const alice = sim.addParty('alice') // departs
    const bob = sim.addParty('bob')
    const carol = sim.addParty('carol')
    sim.setMembers('#secret', ['alice', 'bob', 'carol'])

    const created = alice.manager.createChannel('#secret')
    alice.manager.wrapForNewMember('#secret', 'bob')
    alice.manager.wrapForNewMember('#secret', 'carol')
    expect(bob.manager.getState('#secret')?.key.equals(created.key)).toBe(true)
    expect(carol.manager.getState('#secret')?.key.equals(created.key)).toBe(true)

    // Alice departs; remaining roster is bob + carol.
    sim.setMembers('#secret', ['bob', 'carol'])
    const lowestId = ['bob', 'carol'].sort()[0] as 'bob' | 'carol'
    const other = lowestId === 'bob' ? carol : bob
    const responsible = lowestId === 'bob' ? bob : carol

    responsible.manager.onKeyRotationNotice('#secret', 1)
    other.manager.onKeyRotationNotice('#secret', 1) // no-op for the non-responsible party

    const responsibleState = responsible.manager.getState('#secret')
    const otherState = other.manager.getState('#secret')
    expect(responsibleState?.epoch).toBe(1)
    expect(otherState?.epoch).toBe(1)
    expect(responsibleState?.key.equals(otherState?.key as Buffer)).toBe(true)
    expect(responsibleState?.key.equals(created.key)).toBe(false)
  })

  it('shares channel keys correctly across mixed Node/noble parties, including through a rotation', () => {
    // A desktop user (Node) creates the channel; a browser user (noble)
    // joins it; a second browser user (noble) joins after that; then the
    // desktop user departs and one of the two browser users must correctly
    // take over rotation — proving the whole flow works with any mix of
    // the two CryptoProvider implementations, not just same-platform pairs.
    const desktopAlice = sim.addParty('alice', 'node') // departs
    const browserBob = sim.addParty('bob', 'web')
    const browserCarol = sim.addParty('carol', 'web')
    sim.setMembers('#mixed', ['alice'])

    const created = desktopAlice.manager.createChannel('#mixed')
    desktopAlice.manager.wrapForNewMember('#mixed', 'bob')
    sim.setMembers('#mixed', ['alice', 'bob'])
    desktopAlice.manager.wrapForNewMember('#mixed', 'carol')
    browserBob.manager.wrapForNewMember('#mixed', 'carol')

    expect(browserBob.manager.getState('#mixed')?.key.equals(created.key)).toBe(true)
    expect(browserCarol.manager.getState('#mixed')?.key.equals(created.key)).toBe(true)

    // Alice (Node) departs; remaining roster is bob + carol, both noble.
    sim.setMembers('#mixed', ['bob', 'carol'])
    const lowestId = ['bob', 'carol'].sort()[0] as 'bob' | 'carol'
    const responsible = lowestId === 'bob' ? browserBob : browserCarol
    const other = lowestId === 'bob' ? browserCarol : browserBob

    responsible.manager.onKeyRotationNotice('#mixed', 1)
    other.manager.onKeyRotationNotice('#mixed', 1)

    const responsibleState = responsible.manager.getState('#mixed')
    const otherState = other.manager.getState('#mixed')
    expect(responsibleState?.epoch).toBe(1)
    expect(otherState?.key.equals(responsibleState?.key as Buffer)).toBe(true)
    expect(responsibleState?.key.equals(created.key)).toBe(false)
  })

  it('resetChannel recovers a joiner stuck with no key by re-sharing a fresh one to everyone actually present', () => {
    // Simulates the reconnect race: bob "joins" a channel the server still
    // thinks alice (his own stale, already-dead old connection) is in, so
    // nobody ever wraps a key for him — he's stuck. A real, live carol is
    // also in the channel with the (never-received-by-bob) original key.
    const alice = sim.addParty('alice')
    const bob = sim.addParty('bob')
    const carol = sim.addParty('carol')
    sim.setMembers('#secret', ['alice', 'carol'])
    const created = alice.manager.createChannel('#secret')
    alice.manager.wrapForNewMember('#secret', 'carol')
    expect(carol.manager.getState('#secret')?.key.equals(created.key)).toBe(true)
    expect(bob.manager.getState('#secret')).toBeUndefined()

    // The dead "alice" connection is gone from the roster bob and carol
    // actually see; bob manually recovers.
    sim.setMembers('#secret', ['bob', 'carol'])
    bob.manager.resetChannel('#secret')

    const bobState = bob.manager.getState('#secret')
    const carolState = carol.manager.getState('#secret')
    expect(bobState).toBeDefined()
    // carol converges onto bob's new key rather than being left on the old
    // one bob never had — otherwise the two of them just can't talk either.
    expect(carolState?.key.equals(bobState?.key as Buffer)).toBe(true)
    expect(carolState?.key.equals(created.key)).toBe(false)
  })

  it('does not rotate for a channel it has no other members left in (single survivor stays responsible but has nobody to notify)', () => {
    const alice = sim.addParty('alice')
    sim.setMembers('#secret', ['alice'])
    alice.manager.createChannel('#secret')

    sim.setMembers('#secret', [])
    expect(() => alice.manager.onKeyRotationNotice('#secret', 1)).not.toThrow()
    expect(alice.manager.getState('#secret')?.epoch).toBe(1)
  })
})
