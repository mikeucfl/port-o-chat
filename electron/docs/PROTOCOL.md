# Protocol

Port-O-Chat's Electron client/server speaks the same wire protocol as the
original Java application, byte-for-byte, so the two can interoperate on
everything except end-to-end encryption. This document describes the full
wire format as implemented here: framing, every message type and field, and
which parts are inherited from the Java app versus new in this port.

Source of truth in this repo:
- Schema: [`proto/portochat.proto`](../proto/portochat.proto)
- Framing/codec: [`src/main/net/framing.ts`](../src/main/net/framing.ts), [`src/main/net/codec.ts`](../src/main/net/codec.ts)

## Transport

TCP only, no UDP. No TLS. One message per frame, one frame per read.

## Wire framing

Reproduced exactly from the Java `ConnectionHandler`/`DefaultData`/`ProtoMessage`
classes — all integers are big-endian, fixed-width (**not** protobuf varints):

```
[uint16 BE outerLen]                 total length of everything below
  [uint8  encryptionFlag]            0 = plaintext (always 0 in this app — see below)
  [uint8  msgType]                   always 0x00 (the only registered type)
  [int32  BE bodyLen]                = 13 (header) + 4 (protobuf-len field) + protobufBytes.length
  [int64  BE timestamp]              epoch millis, informational only, not validated on receipt
  [int32  BE protobufLen]
  [bytes  protobufBytes]             serialized PortoChatMessage
```

`outerLen` caps a frame at 65535 bytes (`MAX_FRAME_SIZE`). This app additionally
enforces a stricter `MAX_PROTOBUF_SIZE` (32KB) on the protobuf payload itself,
well under the hard ceiling, and validates `bodyLen`/`protobufLen` against each
other and against the actual bytes present before ever calling into the
protobuf decoder — any mismatch, unknown `msgType`, or unsupported
`encryptionFlag` closes the connection rather than attempting to recover
(TCP byte streams can't be reliably resynchronized after corruption).

### Encryption flag (legacy) — not implemented here, but acknowledged

The Java app's `encryptionFlag` byte toggles a hand-rolled RSA+AES transport
encryption scheme (`SetUserPublicKey` / `SetServerSharedKey` request types,
below). This app **never sends `SetUserPublicKey`** and **always writes
`encryptionFlag = 0`** — it never actually implements that encryption scheme.
See [CRYPTO.md](CRYPTO.md) for what replaces it.

However, this server **does reply** to a `SetUserPublicKey` request it
receives (e.g. from a real Java client) with a `SetServerSharedKey` — this
turned out to be load-bearing, not optional: the Java client's own
`sendUsername()` call only fires as a side effect of processing that reply
(see `ServerConnection.java`'s `setServerSecretKey()`), regardless of
whether the key inside it actually decodes. Without a reply, a real Java
client connects at the TCP level but never registers a username at all —
confirmed by running the actual Java client against this server. The
`byteData` sent back is deliberately the wrong length for any real RSA
modulus, so it's guaranteed to fail to decrypt on the Java side — this
unblocks the username handshake while guaranteeing the Java client's own
`isEncryptionEnabled()` check stays false, so it keeps sending
`encryptionFlag = 0` (the only mode this server's codec accepts). See
`server/router.ts`'s `handleLegacySetUserPublicKey` for the exact reasoning.

## Message types

Every message is a `PortoChatMessage` envelope with a `oneof` payload. Field
numbers below are exactly as in the `.proto`; anything marked **(new)** is an
addition in this port using a fresh field number, so old Java peers silently
ignore it (proto3 unknown-field skipping) instead of breaking.

### `PortoChatMessage` (the envelope)

| Field | # | Notes |
|---|---|---|
| `originatorId` | 1 | Inherited from Java; declared but never set or read by either the original app or this one. Dead field, kept only for numbering compatibility. |
| `channelList` | 2 | See below |
| `chatMessage` | 3 | See below |
| `errorMessage` | 4 | See below |
| `notification` | 5 | See below |
| `ping` | 6 | `{ timestamp: int64 }` |
| `pong` | 7 | `{ timestamp: int64 }` |
| `request` | 8 | See below |
| `response` | 9 | Unused by this app in either direction — see legacy note above |
| `userList` | 10 | See below |
| `keyShare` | 11 | **(new)** See below |

**Ping/Pong**: server → client every 60s (5s initial delay); client must
reply Pong with the same timestamp within 3 minutes or the server closes
the connection (`server/keepalive.ts`). This app also replies to Pings it
receives, symmetrically.

### `ChatMessage` (field 3 of the envelope)

Carries both channel messages and DMs.

| Field | # | Notes |
|---|---|---|
| `senderId` | 1 | Server-assigned UUID of the sender. **This app always overwrites whatever the client sent** with the authenticated connection's real id before relaying — the Java server trusted the client's claim, this one doesn't (see PORTING-NOTES.md). |
| `destinationId` | 2 | Channel name or recipient's user id |
| `isChannel` | 3 | true = channel, false = DM |
| `message` | 4 | Plaintext. Left empty when the E2E fields below are populated. |
| `isAction` | 5 | Backs the client's `/me` command |
| `e2eCiphertext` | 6 | **(new)** AES-256-GCM ciphertext (tag appended), empty when not E2E |
| `e2eNonce` | 7 | **(new)** 12-byte AEAD nonce, unique per message |
| `e2eSenderEphemeralKey` | 8 | **(new)** Reserved for a future forward-secrecy upgrade; unused/always empty in this version |
| `e2eKeyEpoch` | 9 | **(new)** Which channel-key epoch a channel message was encrypted under, so a recipient who has already rotated past it can show "undecryptable" instead of guessing |

### `ErrorMessage` (field 4)

| `errorType` enum | Value | Notes |
|---|---|---|
| `UserNameInUse` | 0 | Inherited |
| `ChannelDoesNotExist` | 1 | Inherited. Also now returned when a channel message is sent by a non-member (the Java server didn't check membership) |
| `E2EChannelRequiresSupport` | 2 | **(new)** Returned when a client without an E2E identity key tries to join a channel that's flagged end-to-end encrypted |

`additionalMessage` (field 2) carries context (the name/id in question).

### `Request` (field 8) — client→server, and server→client for the legacy handshake

| `requestType` enum | Value | Direction | Notes |
|---|---|---|---|
| `ChannelList` | 0 | C→S | Inherited |
| `ChannelUserList` | 1 | C→S | Inherited; `stringRequestData` = channel name |
| `ChannelJoin` | 2 | C→S | Inherited; `stringRequestData` = channel name |
| `SetServerSharedKey` | 3 | S→C | Legacy transport handshake. This app's client never sends `SetUserPublicKey` so never receives one for real, but this app's **server does send one** in reply to a `SetUserPublicKey` it receives — with a deliberately-undecryptable `byteData` — purely to unblock the Java client's `sendUsername()` call, which is otherwise gated behind it. See the framing section above. |
| `SetUserName` | 4 | C→S | Inherited; `stringRequestData` = requested name |
| `SetUserPublicKey` | 5 | C→S | Legacy transport handshake — this app's client never sends it. This app's **server replies** to it (see above) rather than ignoring it. |
| `UserList` | 6 | C→S | Inherited |
| `SetE2EPublicKey` | 7 | C→S | **(new)** `byteData` = raw 32-byte X25519 identity public key. Sent once, immediately after connecting, before `SetUserName`. |

`Request.e2eChannel` (field 5, bool) — **(new)**. Only meaningful on a
`ChannelJoin` that creates a brand-new channel: declares it end-to-end
encrypted. Ignored (channel's existing flag wins) if the channel already
exists — the flag is immutable after creation.

### `Notification` (field 5 of the envelope)

| Variant | # | Direction | Notes |
|---|---|---|---|
| `channelJoin` | 1 | S→C (broadcast to channel, excluding joiner) | `{channel, userId}` |
| `channelPart` | 2 | C→S (to leave) and S→C (broadcast) | `{channel, userId}` — client only ever sets `channel`; server fills `userId` |
| `channelAdded` | 3 | S→C (broadcast to everyone) | `{channel, e2eChannel}` — `e2eChannel` is **(new)** |
| `channelRemoved` | 4 | S→C (broadcast to everyone) | `{channel}`, sent when the last member leaves |
| `userConnectionStatus` | 5 | S→C (broadcast) | `{user: UserData, connected}` |
| `userDoesNotExist` | 6 | S→C | `{user, missingId}` — `missingId` is **(new)**; `user` is left empty in this app (see PORTING-NOTES.md for the Java bug this replaces) |
| `userNameSet` | 7 | S→C | `{name}` — confirms a name was accepted |
| `keyRotationNotice` | 8 | S→C (broadcast to remaining channel members) | **(new)** `{channel, keyEpoch}` — no key material, just tells clients a rotation happened; see CRYPTO.md |

Note: unlike the Java client, this app never sends an explicit disconnect
notification — the server detects disconnection from the TCP socket closing,
same as the Java server did.

### `UserData` (used inside `UserList`/`UserConnectionStatus`/etc.)

| Field | # | Notes |
|---|---|---|
| `id` | 1 | Server-assigned UUID, fresh per connection, never persisted |
| `name` | 2 | |
| `host` | 3 | |
| `e2eIdentityKey` | 4 | **(new)** Raw 32-byte X25519 public key. Presence = E2E-capable client. Empty for legacy Java clients. |

### `ChannelList` (field 2 of the envelope)

| Field | # | Notes |
|---|---|---|
| `channels` | 1 | `StringList` of channel names — inherited, still populated for legacy clients |
| `channelMeta` | 2 | **(new)** `repeated ChannelMetadata {channel, e2eChannel}` — per-channel E2E flag, parallel to `channels` |

### `KeyShare` — **(new message, envelope field 11)**

Delivers a channel's symmetric key, wrapped to one recipient via
ECDH+HKDF+AEAD. The server relays this exactly like any other message it
doesn't specially interpret — it has no code path that decodes `wrappedKey`.

| Field | # |
|---|---|
| `channel` | 1 |
| `toUserId` | 2 |
| `fromUserId` | 3 — overwritten by the server with the real sender id, same as `ChatMessage.senderId` |
| `wrappedKey` | 4 — AES-256-GCM ciphertext + tag |
| `nonce` | 5 |
| `senderEphemeralKey` | 6 — reserved, unused |
| `keyEpoch` | 7 |

See [CRYPTO.md](CRYPTO.md) for the full key-wrap/rotation protocol this
message participates in.

## Server state model

In-memory only, dies with the process (`src/main/server/userRegistry.ts`,
`channelRegistry.ts`). Mirrors the Java `UserDatabase`/`ChannelDatabase`
semantics: a connection exists (and is addressable) from accept time, before
any username is set; channels are created implicitly by the first join and
torn down when the last member leaves; usernames are unique by exact string
match. This app additionally tracks, per channel, whether it's E2E and its
current key epoch (a number only — never the key itself).

## Known Java behaviors this app deliberately does not replicate

See [PORTING-NOTES.md](PORTING-NOTES.md) for the full list and reasoning;
summarized here since they affect wire-level behavior:
- A `SetUserPublicKey` request no longer triggers an unsolicited `UserList` reply (was a fallthrough bug in `Server.java`).
- A stale/timed-out client is actually disconnected, not just logged.
- `UserDoesNotExist` reports the real missing recipient id, not the sender's own data.
