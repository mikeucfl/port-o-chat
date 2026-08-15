# Porting notes

What mapped cleanly from the Java app, what changed, what was deliberately
dropped, and the honest state of Java-interop testing.

## What mapped cleanly

- **Wire framing and protobuf schema.** The `.proto` file was directly
  reusable; the outer length-prefix + legacy `DefaultData`/`ProtoMessage`
  header framing is fully reproduced byte-for-byte in
  [`net/framing.ts`](../src/main/net/framing.ts) /
  [`net/codec.ts`](../src/main/net/codec.ts). This is the reason the new
  app can talk to an unmodified Java client or server at all.
- **Server state model.** In-memory-only user/channel registries, implicit
  channel creation on first join, teardown on last member leaving, exact-
  string username uniqueness — all carried over as-is
  ([`server/userRegistry.ts`](../src/main/server/userRegistry.ts),
  [`server/channelRegistry.ts`](../src/main/server/channelRegistry.ts)).
- **Message routing logic.** [`server/router.ts`](../src/main/server/router.ts)
  is a direct port of `Server.java`'s dispatch switch, including the
  ping/pong keepalive cadence (60s interval, 5s initial delay, 3-minute
  timeout) and the general shape of channel join/part/list handling.
- **Client-side flow.** [`client/session.ts`](../src/main/client/session.ts)
  mirrors `ServerConnection.java`: connect, announce identity, set username,
  and the request/notification vocabulary for channels and chat.
- **The `/me` and `/clear` local client commands** carried over into the
  composer (`renderer/components/Composer.tsx`) — `/me` still maps to
  `ChatMessage.isAction`, `/clear` is still purely local (clears the
  conversation's message list, sends nothing to the server).
- **Default port (3456)** kept identical to the Java app's
  `Settings.DEFAULT_SERVER_PORT`, so joining an existing Java server needs
  no port guessing.

## What changed

- **Language/runtime/architecture.** Java/Swing → TypeScript/Electron,
  single process split into main (all networking + crypto, via raw `net`
  sockets) and renderer (React UI only, via a typed `contextBridge` — see
  `shared/ipc-contract.ts`). Host mode runs the server in the main process
  and connects to it as an ordinary loopback client through the exact same
  `TcpClient`/`ChatSession` code path used for JOIN mode — there's no
  separate in-memory shortcut for local traffic anywhere in this codebase.
- **Concurrency model.** Java's per-connection `IncomingThread`/
  `OutgoingThread` pair and `ConcurrentHashMap`-based registries became
  plain `Map`s driven by Node's single-threaded event loop — no locking
  needed, since there's no actual concurrent mutation to guard against.
- **Three confirmed Java bugs, fixed rather than replicated** (per explicit
  agreement before implementation):
  1. `Server.handleRequest`'s missing `break` after `SetUserPublicKey`,
     which fell through into an unsolicited `UserList` send. Moot here
     anyway since the whole legacy key-exchange path is a no-op (see
     below), but confirmed there's no equivalent fallthrough.
  2. `Server.removeStaleClients()` computed staleness correctly but had its
     actual disconnect calls commented out. `server/keepalive.ts` here
     actually closes the connection on timeout, and does so by triggering
     the exact same disconnect path a normal client-initiated close would
     (never a second, parallel cleanup routine).
  3. `UserDoesNotExist` wrapped the **sender's own** `User` data instead of
     anything about the actual missing recipient. This app adds a
     `missingId` field carrying the real id and leaves the legacy `user`
     field empty (harmless no-op for old clients, which already handled
     this case incorrectly/silently).
- **Two additional hardening checks the Java server never had**, added
  under the "treat every inbound frame as hostile" requirement rather than
  as strict bug-for-bug parity:
  - A relayed `ChatMessage.senderId` is always overwritten with the
    authenticated connection's real user id — the Java server trusted
    whatever the client claimed, which would let one client impersonate
    another.
  - A channel message is now rejected (`ChannelDoesNotExist`) unless the
    sender is verified as an actual member of that channel — the Java
    server would relay it to the channel's members regardless of whether
    the sender was one of them.
- **Explicit length caps.** `MAX_FRAME_SIZE`, `MAX_PROTOBUF_SIZE`,
  `MAX_MESSAGE_TEXT_LENGTH`, `MAX_NICKNAME_LENGTH`, `MAX_CHANNEL_NAME_LENGTH`
  (`shared/constants.ts`) — the Java app had no application-level caps
  beyond the incidental 65535-byte outer-frame ceiling.
- **UI.** Swing's multi-window/tabbed-pane layout became a single-window
  Discord-like three-pane layout (channels+DMs / messages / members), dark
  theme, React + CSS Modules. Feature-equivalent for channels, DMs, and
  join/part/list, but the visual design and window management model are
  entirely new rather than ported.

## What was deliberately dropped or scoped out

- **The Java app's RSA+AES transport encryption** (`SetUserPublicKey` /
  `SetServerSharedKey`) is not reimplemented — it's unauthenticated (the
  server can substitute keys undetected) and E2E fully supersedes its
  purpose for this app's own traffic. This app's client never sends
  `SetUserPublicKey`, and this app's server never actually implements the
  AES/RSA scheme itself.

  This was initially designed as a straight no-op on the server side (just
  ignore `SetUserPublicKey`), on the assumption that an old Java client
  would independently fall back to plaintext. **Running the actual Java
  client against this server during development showed that assumption was
  wrong**: the Java client's `sendUsername()` call is not independent of
  this handshake — it only fires as a side effect of processing a
  `SetServerSharedKey` reply (see `ServerConnection.java`), regardless of
  whether the key inside it decodes. With a plain no-op, a real Java client
  connects at the TCP level but never registers a username at all, and its
  own GUI sits stuck at "connecting" forever.

  The fix: this server **does** reply to `SetUserPublicKey`, with a
  `SetServerSharedKey` whose `byteData` is deliberately the wrong length
  for any real RSA modulus — guaranteed to fail to decrypt on the Java
  side (confirmed: throws `BadPaddingException`, caught internally,
  `serverSecretKey` stays null), which unblocks `sendUsername()` while
  guaranteeing the Java client's `isEncryptionEnabled()` check stays false
  and it keeps sending `encryptionFlag = 0` — the only mode this server's
  codec accepts. See `server/router.ts`'s `handleLegacySetUserPublicKey`.
  Framing and every other message stay fully interoperable either way;
  only the actual AES/RSA transport-encryption layer doesn't cross
  implementations. See [CRYPTO.md](CRYPTO.md) for what replaces it for
  this app's own traffic.
- **Message history / replay on join.** Matches the original (the Java app
  never had this either) and is an explicit non-goal per the project scope.
- **Accounts, registration, kick/ban/ops, typing indicators, file transfer,
  Double Ratchet / per-message forward secrecy, NAT traversal.** All
  explicit non-goals; none of these existed in the Java app either except
  where noted.
- **The Java client's version-check-against-a-remote-server feature**
  (`VersionChecker`) was dropped — out of scope for a chat feature, and
  would have been an unexplained outbound network call beyond the
  LAN-first, no-telemetry spirit of this port.
- **Legacy public-key exchange UI** (the Java client's implicit
  "encryption enabled" state once the shared-key handshake completed) has
  no equivalent here; encryption state in the UI now reflects only the new
  E2E system (a lock badge per channel/DM, described in CRYPTO.md), not the
  legacy transport layer, since that layer no longer exists on this side.

## Known simplifications / open edge cases

- **Simultaneous channel creation.** If two clients race to create a new
  E2E channel with the identical name at (almost) the same instant, each
  could end up generating its own channel key independently before either
  sees the other's `ChannelAdded` confirmation, since there's no
  server-side arbitration of *who* generated the key — only of who won the
  channel-creation race itself (the server does correctly ensure only one
  channel record is created). This is not handled specially and is an
  accepted edge case given how infrequent and deliberate channel creation
  is in practice; a mismatched key would show up as "undecryptable" for
  whichever side lost the race, resolvable by leaving and rejoining.
- **Trust pins reset every launch.** Since identity keys are also
  regenerated every launch (in-memory only, by design), the key-change
  warning can currently only fire *within* a single running session, not
  across restarts of either party. This is a direct consequence of the
  zero-persistence requirement, not an oversight — see CRYPTO.md.
- **The encryption badge reflects a channel's declared E2E status**, not
  moment-to-moment key readiness. Sending is still correctly blocked with
  an error message if a key genuinely isn't available yet (e.g., the instant
  after joining, before the first `KeyShare` arrives) — the badge itself
  just doesn't show that transient sub-state.

## Java interop — honest status

Real cross-implementation testing **was performed**, though it took an
extra step to get there: `build.gradle` pins `sourceCompatibility`/
`targetCompatibility` to Java 17, and only a JDK 8 installation was
initially found on this development machine — `./gradlew build` failed
immediately with `invalid source release: 17`. A JDK 17 (Eclipse Temurin)
was installed specifically to unblock this, after which the Java project
built and ran cleanly.

With a real JDK 17 available, two live cross-implementation checks were
run (see `electron/scripts/verify-java-interop.ts` and
`tools/JavaInteropTester.java`, both kept in the repo so you can re-run
these yourself):

1. **This app's client against the real Java server** (`./gradlew runServer`):
   connected, set a username, joined a channel, sent a channel message, and
   requested the channel list — all correctly round-tripped over a real
   socket to the unmodified Java server.
2. **The real Java client's own networking code** (`ServerConnection`/
   `ServerDataListener` — the same classes the Swing GUI uses, exercised
   headlessly to avoid popping a GUI window from an automated script)
   **against this app's server**: same sequence, same result. This is what
   actually caught the legacy-handshake gap described above — the first
   run showed a real, working Java client silently failing to ever
   register a username against this server, which no unit test could have
   caught since it depends on the real Java client's exact internal call
   sequence, not just the wire format. After the fix, a second run
   confirmed `handleServerConnection(username, success=true)` fires
   correctly (the callback that flips the Java Swing client's own UI to
   "connected").

**What this does *not* cover**: the real Java Swing GUI client was
deliberately never launched from this automated environment (only its
underlying networking classes, headlessly) — clicking through the actual
Java UI, and a live session with both a real Java client and this app's
GUI open side by side, are still worth doing by hand if you want that last
mile of confidence. Confidence otherwise also rests on byte-level unit
tests of the framing/codec layer (`net/framing.test.ts`, `net/codec.test.ts`)
and a forward-compatibility test asserting messages with the new E2E-only
fields still decode cleanly under protobuf3's unknown-field skipping.

## Verification performed

- 63 automated tests covering the framing/codec byte formulas (including
  hostile-input/corruption cases), the crypto primitives (ECDH determinism,
  AEAD round-trip and tamper detection, fingerprint determinism, the
  channel-key join and rotation coordination flows simulated across
  multiple in-process parties), and the server router (username collisions,
  implicit channel lifecycle, E2E join refusal, and regression tests for
  all three fixed Java bugs).
- A real end-to-end networking test: an actual `TcpChatServer` bound to a
  real loopback TCP port, with two real `TcpClient` connections exchanging
  a channel message and a DM, plus `EADDRINUSE` and malformed-frame
  handling — all over genuine sockets, not mocks.
- A full production build (`electron-vite build`) and a packaged Windows
  installer (`npm run build` → `release/Port-O-Chat-1.0.0-x64.exe`) both
  succeed.
- **Not yet performed by the developer of this port**: actually launching
  the built app's GUI and driving a real two-window (host + join) session
  by hand. The development environment used for this port runs with
  `ELECTRON_RUN_AS_NODE=1` set, which forces any Electron binary launched
  from that shell to run as plain Node with no window — so this specific
  environment cannot pop a real `BrowserWindow` to click through. This is
  flagged rather than glossed over; see the README's "Verifying this build
  yourself" section for the exact steps to run that check.
