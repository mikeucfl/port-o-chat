# Port-O-Chat (Electron)

A small LAN chat client and server, ported from the original Java/Swing
[port-o-chat](../README.md) to a single Electron app — plus a browser-based
client that joins the exact same server — with opt-in end-to-end encryption
for channels and direct messages that the person running the server cannot
break, on both clients.

The **server** is wire-compatible with the original Java client for
everything except transport encryption. The **Electron client** itself
speaks WebSocket, not raw TCP, so it can no longer JOIN a server hosted by
a standalone, unmodified Java app — a deliberate tradeoff, since a server
hosted *by this app* is unaffected either way. See
[docs/PORTING-NOTES.md](docs/PORTING-NOTES.md).

## Requirements

- Node.js 20+ and npm

## Getting started

```bash
npm install
npm run dev
```

This launches the app with hot reload. A launch screen lets you choose
**Host** (start a server on this machine and connect to it) or **Join**
(connect to a server already running on your network).

### Building a packaged app

```bash
npm run build
```

Produces a packaged desktop binary in `release/` via `electron-builder`
(configured for Windows/macOS/Linux — see the caveat below on what's
actually been verified). This also builds the browser client
(`npm run build:web`, into `out/web/`) first and bundles it into the
package, so a freshly built desktop app can immediately serve it to
browsers the moment you start hosting — see "Browser client" below.

To build or dev-serve just the browser client on its own:

```bash
npm run build:web   # -> out/web/
npm run dev:web      # hot-reloading dev server for the browser client alone
```

### Running the test suite

```bash
npm test          # unit + integration tests (real TCP/WebSocket sockets, no GUI needed)
npm run typecheck
```

## Hosting

Pick **Host**, choose a nickname and a port (defaults to `3456`, matching
the original Java app), and start hosting. The app binds a TCP server on
that port and immediately connects to it as an ordinary client — there is
no separate "server-only, headless" mode; hosting and chatting happen in
the same app window.

**This is LAN-only.** The app shows the LAN IP address(es) other people on
your network should use to join. Port-O-Chat does **not** implement NAT
traversal, relaying, or any form of tunneling — reaching your server from
outside your local network requires manually forwarding the chosen port on
your router, and doing so exposes an unauthenticated, unencrypted-by-default
(unless you use E2E channels) chat server to the internet. If you don't
know whether you need this, you probably don't want it.

If the chosen port is already in use, hosting fails with a clear error
rather than crashing — pick a different port and try again.

The same port also serves the browser client — see "Browser client" below.

## Joining

Pick **Join**, enter a nickname, the host's address (an IP or hostname) and
port, and connect. This works against a server hosted by another instance
of this app (desktop or browser) — **not** against a standalone, unmodified
Java server, since this app's client speaks WebSocket and the Java app only
ever speaks raw TCP. A server hosted *by this app* still accepts old Java
clients just fine; only this app's own client lost that ability, not the
server.

## Browser client

Hosting also serves a browser-based client on the same port — anyone on
your LAN can open `http://<the-address-shown-when-hosting>:<port>/` in a
regular browser tab and join, no install required. It's the same UI, the
same protocol, and the same end-to-end encryption as the desktop app (see
[docs/CRYPTO.md](docs/CRYPTO.md) for why it uses a different crypto
library under the hood to make that work without HTTPS). The one thing a
browser tab can never do is **host** — that's not a missing feature, a web
page can't bind a listening socket for others to connect to, so the
browser build only ever offers Join.

A browser tab can only join the server that served its page — typing a
different address into the Join screen from a browser is rejected as a
security measure (see PORTING-NOTES.md). If the build hasn't been produced
yet (`npm run build:web`), navigating there shows a page explaining that
instead of an error.

## Encryption

Channels can optionally be created as end-to-end encrypted (a checkbox when
creating a channel); the flag can't be changed after creation. Direct
messages are automatically end-to-end encrypted whenever the other person's
client also supports it (shown as a 🔒 next to their name), and fall back
to plaintext for old Java clients.

**Encryption is only as trustworthy as the safety number you verify.**
Click the 🔑 icon next to your own name or any other user's to see their
safety number, and compare it with them over a channel you actually trust
(in person, a phone call) — this is the only way to be sure the server
isn't quietly substituting keys. If a known contact's key changes
mid-session, you'll see a warning banner and outgoing messages to them are
held until you re-verify.

Full details, including exactly what this does and does not protect against,
are in [docs/CRYPTO.md](docs/CRYPTO.md).

## No-persistence guarantee

**Nothing about your conversations is ever written to disk, logged, or
cached** — no database, no local storage, no log files, no crash dumps
containing message content or key material. All chat state (messages,
channel membership, encryption keys) lives only in memory and disappears
the moment the app closes.

The only things this app ever saves between launches are non-content
preferences: window size, your last-used nickname, and the last host/port
you connected to. That's it — you can verify this yourself by opening
`config.json` inside the app's Electron `userData` folder after a chat
session (in dev mode, that's `%APPDATA%/port-o-chat-electron/config.json`
on Windows — the exact folder name matches whatever `app.getName()`
resolves to, which differs slightly for a packaged build; run the app and
check `app.getPath('userData')` if you want the precise path). It will only
ever contain those four fields.

## Verifying this build yourself

The automated test suite (`npm test`) exercises the networking, protocol,
and crypto layers thoroughly with real TCP sockets — no GUI required. What
it can't cover is the actual UI. To check that by hand:

1. `npm run build:web` once, then `npm run dev` (or run the packaged build
   from `release/`, which already includes the browser build).
2. Open a second instance of the app (`npm run dev` again, or launch the
   packaged exe a second time).
3. In the first window, **Host** on a port of your choice; in the second,
   **Join** at `127.0.0.1` on that same port.
4. Open `http://127.0.0.1:<port>/` in an actual browser tab as a third
   participant — confirm the Launch screen offers Join only (no Host), and
   that it joins correctly alongside the two desktop windows.
5. Create a plaintext channel and an E2E channel side by side; send
   messages in both from all three participants and confirm they show up
   correctly everywhere, with the E2E channel showing the 🔒 badge —
   including from the browser tab, which uses a different crypto library
   under the hood (see CRYPTO.md) to produce compatible ciphertext.
6. Have the browser tab join the E2E channel, then leave it — the
   remaining members should show a rotation happened (their encryption
   badge/key state updates) and messages sent afterward should still
   decrypt correctly for whoever's left.
7. Kill the **hosting** window's process (or just close it) and confirm the
   other window(s)/tab show a clean "disconnected" state rather than
   hanging or crashing.

## Not implemented (by design)

Accounts/registration, message history or replay on join, file transfer,
voice/video, mobile builds, NAT traversal/relaying, TLS/`wss://`,
auto-reconnect, per-message forward secrecy (Double Ratchet), and joining
a different server than the one that served the browser client's page are
all explicit non-goals — see
[docs/PORTING-NOTES.md](docs/PORTING-NOTES.md) for the full reasoning.

## Documentation

- [docs/PROTOCOL.md](docs/PROTOCOL.md) — every message type, field, and the wire framing
- [docs/CRYPTO.md](docs/CRYPTO.md) — key lifecycle, handshakes, rotation, threat model and limitations
- [docs/PORTING-NOTES.md](docs/PORTING-NOTES.md) — what mapped cleanly from the Java app, what changed, what was dropped
