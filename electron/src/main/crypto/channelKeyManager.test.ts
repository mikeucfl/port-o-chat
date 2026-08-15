import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ChannelKeyManager } from './channelKeyManager'

interface Party {
  userId: string
  privateKey: KeyObject
  publicKeyRaw: Buffer
  manager: ChannelKeyManager
}

/** Simulates the roster + KeyShare relay between a small set of in-process parties, without any real transport. */
class Simulation {
  parties = new Map<string, Party>()

  addParty(userId: string): Party {
    const { privateKey, publicKey } = generateKeyPairSync('x25519')
    const publicKeyRaw = Buffer.from(
      (publicKey.export({ format: 'jwk' }) as { x: string }).x,
      'base64url'
    )
    const manager = new ChannelKeyManager({
      myUserId: userId,
      myPrivateKey: privateKey,
      sendKeyShare: (channel, toUserId, wrappedKey, nonce, epoch) => {
        const target = this.parties.get(toUserId)
        target?.manager.receiveKeyShare(channel, userId, wrappedKey, nonce, epoch)
      },
      getPeerPublicKey: (id) => this.parties.get(id)?.publicKeyRaw,
      getOtherMembers: (channel) =>
        [...(this.members.get(channel) ?? [])].filter((id) => id !== userId)
    })
    const party: Party = { userId, privateKey, publicKeyRaw, manager }
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

  it('does not rotate for a channel it has no other members left in (single survivor stays responsible but has nobody to notify)', () => {
    const alice = sim.addParty('alice')
    sim.setMembers('#secret', ['alice'])
    alice.manager.createChannel('#secret')

    sim.setMembers('#secret', [])
    expect(() => alice.manager.onKeyRotationNotice('#secret', 1)).not.toThrow()
    expect(alice.manager.getState('#secret')?.epoch).toBe(1)
  })
})
