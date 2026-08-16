# Crypto

This document describes the end-to-end encryption (E2E) layered on top of
the legacy-compatible protocol described in [PROTOCOL.md](PROTOCOL.md): key
lifecycle, the DM and channel handshakes, rotation, the threat model, and —
just as importantly — its explicit limitations. E2E is opt-in per channel
and automatic (whenever possible) for DMs; it is entirely separate from,
and supersedes the purpose of, the Java app's non-E2E transport encryption.

Two implementations exist, kept byte-for-byte interoperable (proven in
[`src/web/crypto/interop.test.ts`](../src/web/crypto/interop.test.ts), not
just assumed): the Electron desktop build uses Node's built-in `crypto`
module (source: [`src/main/crypto/`](../src/main/crypto/)); the browser
build uses the audited pure-JS [`@noble/*`](https://paulmillr.com/noble/)
libraries instead (source: [`src/web/crypto/`](../src/web/crypto/)) — see
"Why noble instead of the browser's native crypto" below for why. No
hand-rolled primitives on either side. Both implement the same
`CryptoProvider` interface ([`src/core/cryptoProvider.ts`](../src/core/cryptoProvider.ts)),
which is what the shared E2E policy logic
([`src/core/chatController.ts`](../src/core/chatController.ts)) is written
against — that logic runs unmodified on both platforms.

## Why this exists

The Java app's client↔server "encryption" (RSA-2048 key exchange, AES-128-CBC)
protects the wire from a passive network observer. It does **not** protect
users from the person running the server: the server generates the AES key
itself, never authenticates the client's RSA public key, and could trivially
substitute its own key at handshake time undetected. E2E closes that gap —
plaintext exists only at the sending and receiving endpoints; the server
only ever relays ciphertext (and, for channels, key material it cannot
decode).

## Why noble instead of the browser's native crypto

The browser build could in principle use the Web Crypto API
(`crypto.subtle`) instead of `@noble/*`. It doesn't, for a load-bearing
reason, not a style preference: **`crypto.subtle` only exists in a Secure
Context**, and this app's entire premise is serving a plain
`http://<lan-ip>:3456` page from a box on the LAN — no TLS, no
certificate, by design (see the README's LAN-first stance). That's not a
secure context, so `crypto.subtle` would simply be `undefined` there —
a `subtle`-based implementation would silently fail on exactly the
deployment this feature exists for, and only work if someone happened to
load the page over `localhost` or `https`. `crypto.getRandomValues`
(what noble actually needs) carries no such restriction.

Two secondary reasons reinforced the choice: `crypto.subtle` is
Promise-only, which would have forced `ChatController`'s send/receive
logic to become async and introduced message-reordering hazards that
don't exist today (decrypt of message *n* resolving after message
*n+1*); and native browser support for X25519 specifically (as opposed
to AES-GCM/SHA-256, which are universally available via `subtle`) is
still uneven across browsers. HKDF-SHA256, AES-256-GCM, and X25519 ECDH
are all deterministic standards regardless of implementation, so a
correct Node implementation and a correct noble implementation
interoperate byte-for-byte given identical inputs — verified directly in
`interop.test.ts`, not just assumed. The cost: pure-JS AES-GCM isn't
constant-time and is slower than a native implementation, an accepted
tradeoff for a LAN chat app's message sizes against a LAN-local
adversary.

## Identity

- Each client generates an X25519 keypair once, per launch (desktop) or per page load (browser).
  - **Desktop**: `crypto.generateKeyPairSync('x25519')`, kept in a single main-process module closure ([`crypto/identity.ts`](../src/main/crypto/identity.ts)) — **in memory only**, never written to disk, never sent to the renderer. References are dropped on `before-quit` (best-effort; Node/V8 have no guaranteed secure-wipe primitive for `KeyObject`s, so this relies on garbage collection rather than an explicit zeroing guarantee).
  - **Browser**: `x25519.keygen()` from `@noble/curves` ([`web/crypto/identity.ts`](../src/web/crypto/identity.ts)) — also in memory only, held in a module-level variable for the page's lifetime. **Deliberately not persisted to `sessionStorage`**, even though that would survive a reload — some browsers write `sessionStorage` to disk for session-restore, outside this app's control, the same reasoning that already kept this app off OS toast notifications (see "Zero persistence" below). Every page reload regenerates a fresh identity, same as the desktop build regenerating on every launch — the practical cost is that other users will see a "safety number changed" warning after any reload of a browser tab they're talking to, since browser tabs get refreshed far more often than the desktop app gets restarted.
- The raw 32-byte public key (what actually goes on the wire, in `UserData.e2eIdentityKey`) needs a JWK export/import round trip on the desktop build, since Node's `crypto` has no direct "give me the raw bytes" API for X25519 — JWK is the one format that exposes the key material directly rather than wrapping it in a DER/PEM envelope. Noble has no such gymnastics: it works with raw 32-byte keys natively, so the browser build's identity/ECDH code is noticeably simpler than the desktop equivalent despite doing the same thing.
- Sent to the server via `Request{SetE2EPublicKey}` immediately after connecting, before announcing a username. The server distributes it to other clients by including it in the same `UserData` broadcasts it already sends (`UserConnectionStatus`, `UserList`) — no separate round trip.
- A client with no identity key (i.e. an unmodified Java client) is simply not E2E-capable: DMs to/from it stay plaintext, and it's refused when trying to join an E2E channel (see PROTOCOL.md's `E2EChannelRequiresSupport`).

## Direct messages (DMs)

Automatic whenever both ends have exchanged identity keys — there's no
per-DM toggle, since there's no reason to prefer plaintext once both sides
support encryption. Falls back to plaintext only when the recipient has no
known identity key (a legacy client).

- **Key agreement**: static-static X25519 ECDH between the two identity keys, once per pair (cached for the session, not re-derived per message).
  ```
  shared = ECDH(myPrivateKey, peerPublicKey)
  key    = HKDF-SHA256(shared, salt = "PortoChatE2Ev1-DM-Salt", info = "dm:" + sort(userIdA, userIdB).join(":"), len = 32)
  ```
  Sorting the two user ids means both directions independently derive the identical key with **no extra handshake message**.
- **AEAD**: AES-256-GCM, fresh random 12-byte nonce per message (`crypto.randomBytes(12)`), AAD = `senderId|destinationId|dm`.
- No forward secrecy: the same derived key is used for the life of the session (or until either party reconnects with a fresh identity key, which never happens mid-session since identity keys don't rotate). This is a deliberate, explicit non-goal — see Limitations below.

## Per-channel E2E

Opt-in at creation (`Request.e2eChannel`), **immutable afterward** — a
plaintext channel can never become E2E and vice versa. The server tracks
only *that* a channel is E2E and its current key epoch (an integer); it
never possesses the channel key.

### Key generation and distribution on join

1. The creator generates a random 32-byte key with `crypto.randomBytes(32)` (epoch 0).
2. When a new member joins, **every existing member independently** wraps the current key to the joiner:
   ```
   shared  = ECDH(myPrivateKey, joinerPublicKey)
   wrapKey = HKDF-SHA256(shared, salt = "PortoChatE2Ev1-Channel-Salt", info = "keyshare:" + channel + ":" + epoch, len = 32)
   sealed  = AES-256-GCM-seal(wrapKey, channelKey, aad = channel + "|" + fromUserId + "|" + toUserId + "|" + epoch)
   ```
   delivered as a `KeyShare` message.
3. The joiner accepts the **first** `KeyShare` that authenticates successfully for the current epoch and silently discards any later ones as harmless duplicates.

This needs **no leader election and no server coordination** — it tolerates
any single existing member being offline or slow, since the joiner only
needs one of them to succeed.

### Key rotation on departure

The spec requirement ("rotate the key on every member departure") doesn't
by itself say who initiates the rotation. The rule implemented here,
computable independently and identically by every client from the same
information (no extra round trip):

> On any member's departure from an E2E channel, among the **remaining**
> members, the one whose user id is **lexicographically lowest** generates
> a fresh 32-byte key for the new epoch and sends a `KeyShare` to every
> other remaining member individually. Everyone else just waits for their
> `KeyShare`.

The server's role is limited to broadcasting a `KeyRotationNotice{channel,
keyEpoch}` to the remaining members when it detects the departure (part or
disconnect) — this carries **no key material**, only the new epoch number,
and exists purely so clients agree on which epoch they're rotating to.

### Channel messages

```
aad = channel + "|" + senderId + "|" + epoch
ciphertext = AES-256-GCM-seal(channelKey, plaintext, aad)
```

`e2eKeyEpoch` rides on the wire so a recipient who has already rotated past
that epoch (or hasn't received the current key yet) can show a clear
"undecryptable" placeholder instead of silently failing or crashing.

## Nonces

Every AEAD seal (DM, channel message, or keyshare wrap) uses a fresh random
12-byte nonce from `crypto.randomBytes(12)` — never a counter. This is a
deliberate choice to avoid needing any persisted state across restarts
(consistent with the app's zero-persistence requirement — a counter would
need to survive a restart to stay safe, and nothing here is allowed to touch
disk). The birthday-bound collision risk for random 96-bit nonces under one
key becomes non-negligible only after roughly 2^32 messages under that same
key (NIST SP 800-38D) — far beyond realistic usage for a LAN chat session,
and per-channel keys additionally rotate on every membership change, which
further bounds the number of messages ever encrypted under a single key.

## Trust and verification

- **Safety number / fingerprint**: SHA-256 of the raw X25519 public key, first 16 bytes, formatted as 8 groups of 4 uppercase hex characters (`crypto/fingerprint.ts` on the desktop build, `web/crypto/fingerprint.ts` on the browser build — byte-identical output, see `interop.test.ts`). Shown per-peer (via the 🔑 button and member-list fingerprint dialog) so users can compare it with the peer over a channel they trust (in person, a voice call) — **without this step, the server operator could substitute a key at any point and neither party would know.**
- **Trust-on-first-use (TOFU)**: the first identity key seen for a given user id is pinned for the session (in memory only, `crypto/trust.ts`). If a later key for that same user id differs, the UI shows a persistent warning banner and **outgoing E2E sends to that peer are blocked** until the user explicitly re-verifies the new safety number and clicks "Trust this key." Incoming messages under the new key can still be read (so the conversation isn't silently dropped), but the warning stays visible until acknowledged.
- Pins are **not** persisted across restarts — every launch starts fresh, consistent with identity keys themselves being regenerated every launch. This means the app currently cannot detect a key change *across* two separate sessions, only *within* one — see Limitations.
- **First-time verification nudge**: the first time a DM with a given peer becomes end-to-end encrypted in a session, a one-time banner prompts verifying their safety number — encryption happening automatically (see "Direct messages" above) shouldn't mean verification gets skipped entirely. Dismissible, and only shown once per peer per session (not persisted, same as everything else here); opening the safety-number dialog for that peer through any other path (the 🔑 button, the member list) also counts as having seen it.
- **The encryption badge itself degrades**, rather than just showing a flat "Encrypted": a DM or channel header badge distinguishes plain (`Not encrypted`), healthy (`🔒 Encrypted`), a channel whose key hasn't arrived yet (`⏳ Establishing encryption…`), and a conversation where a participant's key changed and hasn't been re-verified (`⚠ Key unverified`) — so the UI never claims a stronger guarantee than actually holds at that moment. Independently, any individual message that fails to decrypt (wrong/rotated key, tampered ciphertext) shows as an explicit "Undecryptable message" placeholder rather than being silently dropped or shown as empty.

## Legacy interop

- E2E fields ride in new, additively-numbered protobuf fields (see PROTOCOL.md) — old Java clients/servers ignore them and keep working on non-E2E traffic.
- A client without an identity key is refused (`E2EChannelRequiresSupport`) when trying to join an E2E channel, rather than being silently let in with a broken/undecryptable view.
- Non-E2E channels and DMs to/from legacy clients are unaffected — full plaintext interop, same as the original app.

## Threat model — what this protects against, and what it does not

**Protects against:**
- A passive network observer on the LAN.
- A malicious or compromised server operator reading channel/DM content, *provided* the users involved have verified each other's safety numbers out of band.
- A server silently substituting a peer's key mid-session going undetected (the trust-store warning catches this, provided the user checks it).

**Does not protect against:**
- **Metadata.** Who's talking to whom, when, how often, and message sizes are all visible to the server — only the message *content* is hidden. This app makes no attempt to hide channel membership, join/part timing, or traffic patterns.
- **No forward secrecy.** DM and channel keys are static for the life of the session (channel keys do rotate on membership changes, but not per-message, and not on any fixed schedule). Compromising a current key can decrypt everything encrypted under it, past and future, until the next rotation. This is an explicit non-goal per the project scope (no Double Ratchet).
- **No deniability / authentication guarantees beyond TOFU.** There's no signature scheme proving a message's authorship beyond "it decrypted under a key that was, at some point, presented as belonging to this user id" — trust rests entirely on out-of-band fingerprint verification.
- **A server that actively withholds or forges `UserData`/`KeyShare` traffic** could attempt more sophisticated MITM/eclipse attacks than simple key substitution (e.g. showing different users different rosters). Fingerprint verification catches key substitution but not a fully split view of who's even in a conversation.
- **The joiner briefly trusts the first `KeyShare` that authenticates**, without any cross-checking against a second source. A malicious existing member (one who already has a legitimately-obtained copy of the key) could always just relay it truthfully — there's no mechanism here to prevent an already-trusted member from *leaking* the key elsewhere; that's inherent to any symmetric group key, not specific to this implementation.
- **Compromise of either endpoint** (malware, physical access) exposes everything on that device, as with any E2E system.

## Zero persistence

No identity key, channel key, wrapped key, fingerprint pin, or message
plaintext/ciphertext is ever written to disk, logged, or included in a
crash dump by this app — see the README's no-persistence guarantee for the
narrow, explicit exception (window size, last nickname, last host/port).

This is also why the app deliberately has no popup/toast OS notifications
for new messages (only a passive numeric unread badge on the taskbar/dock
icon, which reveals a count and nothing else) — Windows Action Center and
macOS Notification Center both retain their own history of any
notification shown, outside this app's control, which would otherwise be
an uncontrolled second place message content could end up living. The
browser build's identity key follows the same reasoning: it lives in
memory only and is never written to `sessionStorage`, even though that
would survive a reload, since some browsers persist `sessionStorage` to
disk for session-restore — see "Identity" above. The browser build's
*nickname* (only) is persisted to `localStorage`, matching the desktop
build's own narrow exception for the same non-secret field.
