import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket as WsTestClient, type RawData } from 'ws'
import { WS_PATH } from '@shared/constants'
import { decodeFrame, encodeFrame } from '@core/codec'
import { FrameStreamParser, wrapFrame } from '@core/framing'
import { portochat } from '@proto/portochat'
import { AddressInUseError, HostServer } from './hostServer'
import { TcpClient } from './tcpClient'

const RequestType = portochat.Request.RequestType

/**
 * Real end-to-end networking test: an actual HostServer listening on a real
 * loopback port, with real TcpClient sockets and real `ws` WebSocket
 * sockets connecting to it — exactly the paths a legacy Java client, this
 * app's own (WebSocket) client, and a browser client each take, just
 * without the Electron/browser shell around them. Runnable headlessly.
 *
 * A nonexistent webRoot is used throughout — these tests exercise the chat
 * protocol, not static file serving (see httpStatic.ts for that), and a
 * missing webRoot is a supported, non-fatal state (serveStatic's
 * "not built yet" placeholder).
 */

const WEB_ROOT = '/nonexistent-web-root-for-tests'

function waitForMessage(
  client: TcpClient,
  predicate: (m: portochat.PortoChatMessage) => boolean,
  timeoutMs = 2000
): Promise<portochat.PortoChatMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('message', onMessage)
      reject(new Error('timed out waiting for message'))
    }, timeoutMs)
    const onMessage = (m: portochat.PortoChatMessage): void => {
      if (predicate(m)) {
        clearTimeout(timer)
        client.off('message', onMessage)
        resolve(m)
      }
    }
    client.on('message', onMessage)
  })
}

async function setUsername(client: TcpClient, name: string): Promise<string> {
  const received = waitForMessage(client, (m) => !!m.notification?.userNameSet)
  client.send({ request: { requestType: RequestType.SetUserName, stringRequestData: { value: name } } })
  await received
  return name
}

async function joinChannel(client: TcpClient, channel: string): Promise<void> {
  client.send({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: channel } } })
  // No reliable single ack message to await generically here; give the
  // server a tick to process the join before proceeding.
  await new Promise((r) => setTimeout(r, 50))
}

function connectWs(port: number): Promise<WsTestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WsTestClient(`ws://127.0.0.1:${port}${WS_PATH}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

function wsSend(ws: WsTestClient, message: portochat.IPortoChatMessage): void {
  ws.send(encodeFrame(message))
}

function waitForWsMessage(
  ws: WsTestClient,
  predicate: (m: portochat.PortoChatMessage) => boolean,
  timeoutMs = 2000
): Promise<portochat.PortoChatMessage> {
  const parser = new FrameStreamParser()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onData)
      reject(new Error('timed out waiting for ws message'))
    }, timeoutMs)
    const onData = (data: RawData): void => {
      for (const frame of parser.push(toBuffer(data))) {
        const m = decodeFrame(frame)
        if (predicate(m)) {
          clearTimeout(timer)
          ws.off('message', onData)
          resolve(m)
        }
      }
    }
    ws.on('message', onData)
  })
}

async function setUsernameWs(ws: WsTestClient, name: string): Promise<void> {
  const received = waitForWsMessage(ws, (m) => !!m.notification?.userNameSet)
  wsSend(ws, { request: { requestType: RequestType.SetUserName, stringRequestData: { value: name } } })
  await received
}

async function joinChannelWs(ws: WsTestClient, channel: string): Promise<void> {
  wsSend(ws, { request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: channel } } })
  await new Promise((r) => setTimeout(r, 50))
}

describe('HostServer (real sockets: raw TCP, WebSocket, and HTTP demuxed on one port)', () => {
  const servers: HostServer[] = []
  const clients: TcpClient[] = []
  const wsClients: WsTestClient[] = []

  afterEach(() => {
    for (const c of clients) c.disconnect()
    for (const w of wsClients) w.close()
    for (const s of servers) s.close()
    clients.length = 0
    wsClients.length = 0
    servers.length = 0
  })

  it('two TCP clients exchange a channel message and a DM over real loopback sockets', async () => {
    const server = new HostServer({ webRoot: WEB_ROOT })
    servers.push(server)
    const { port } = await server.listen(0, '127.0.0.1')

    const alice = new TcpClient()
    const bob = new TcpClient()
    clients.push(alice, bob)
    await alice.connect('127.0.0.1', port)
    await bob.connect('127.0.0.1', port)

    await setUsername(alice, 'alice')
    await setUsername(bob, 'bob')

    await joinChannel(alice, '#general')
    await joinChannel(bob, '#general')

    const bobReceived = waitForMessage(bob, (m) => !!m.chatMessage)
    alice.send({
      chatMessage: {
        senderId: 'ignored-should-be-overridden',
        destinationId: '#general',
        isChannel: true,
        message: 'hello channel'
      }
    })
    const channelMsg = await bobReceived
    expect(channelMsg.chatMessage?.message).toBe('hello channel')
    expect(channelMsg.chatMessage?.senderId).not.toBe('ignored-should-be-overridden')

    // DM: bob needs alice's server-assigned id, obtained from the userList.
    const userListReceived = waitForMessage(bob, (m) => !!m.userList)
    bob.send({ request: { requestType: RequestType.UserList } })
    const userList = await userListReceived
    const aliceId = userList.userList?.users?.find((u) => u.name === 'alice')?.id
    expect(aliceId).toBeTruthy()

    const aliceReceivedDm = waitForMessage(alice, (m) => !!m.chatMessage && !m.chatMessage.isChannel)
    bob.send({
      chatMessage: { destinationId: aliceId as string, isChannel: false, message: 'hi alice' }
    })
    const dm = await aliceReceivedDm
    expect(dm.chatMessage?.message).toBe('hi alice')
  })

  it('two WebSocket clients exchange a channel message over the same demuxed port', async () => {
    const server = new HostServer({ webRoot: WEB_ROOT })
    servers.push(server)
    const { port } = await server.listen(0, '127.0.0.1')

    const alice = await connectWs(port)
    const bob = await connectWs(port)
    wsClients.push(alice, bob)

    await setUsernameWs(alice, 'alice-ws')
    await setUsernameWs(bob, 'bob-ws')
    await joinChannelWs(alice, '#general')
    await joinChannelWs(bob, '#general')

    const bobReceived = waitForWsMessage(bob, (m) => !!m.chatMessage)
    wsSend(alice, {
      chatMessage: { destinationId: '#general', isChannel: true, message: 'hello over ws' }
    })
    const channelMsg = await bobReceived
    expect(channelMsg.chatMessage?.message).toBe('hello over ws')
  })

  it('a raw-TCP client and a WebSocket client share the same chat world (same channel, see each other)', async () => {
    const server = new HostServer({ webRoot: WEB_ROOT })
    servers.push(server)
    const { port } = await server.listen(0, '127.0.0.1')

    const tcpAlice = new TcpClient()
    clients.push(tcpAlice)
    await tcpAlice.connect('127.0.0.1', port)
    await setUsername(tcpAlice, 'tcp-alice')
    await joinChannel(tcpAlice, '#mixed')

    const wsBob = await connectWs(port)
    wsClients.push(wsBob)
    await setUsernameWs(wsBob, 'ws-bob')
    await joinChannelWs(wsBob, '#mixed')

    // Proof the two transports share one ChatCore: a message sent by the
    // TCP client reaches the WS client, and vice versa, in the same channel.
    const bobReceivesFromTcp = waitForWsMessage(wsBob, (m) => !!m.chatMessage)
    tcpAlice.send({
      chatMessage: { destinationId: '#mixed', isChannel: true, message: 'hi from tcp' }
    })
    expect((await bobReceivesFromTcp).chatMessage?.message).toBe('hi from tcp')

    const aliceReceivesFromWs = waitForMessage(tcpAlice, (m) => !!m.chatMessage)
    wsSend(wsBob, { chatMessage: { destinationId: '#mixed', isChannel: true, message: 'hi from ws' } })
    expect((await aliceReceivesFromWs).chatMessage?.message).toBe('hi from ws')
  })

  it('rejects a second server bound to the same port with AddressInUseError', async () => {
    const server1 = new HostServer({ webRoot: WEB_ROOT })
    servers.push(server1)
    const { port } = await server1.listen(0, '127.0.0.1')

    const server2 = new HostServer({ webRoot: WEB_ROOT })
    await expect(server2.listen(port, '127.0.0.1')).rejects.toBeInstanceOf(AddressInUseError)
  })

  it('closes a TCP connection that sends a malformed frame, without crashing the server', async () => {
    const server = new HostServer({ webRoot: WEB_ROOT })
    servers.push(server)
    const { port } = await server.listen(0, '127.0.0.1')

    const raw = net.connect(port, '127.0.0.1')
    await new Promise((resolve) => raw.once('connect', resolve))

    const closed = new Promise<void>((resolve) => raw.once('close', () => resolve()))
    raw.write(wrapFrame(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff])))
    await closed

    // Server should still accept and serve a legitimate client afterwards.
    const client = new TcpClient()
    clients.push(client)
    await client.connect('127.0.0.1', port)
    await setUsername(client, 'still-works')
  })

  it('handles a TCP connection that closes mid-frame, without crashing the server', async () => {
    const server = new HostServer({ webRoot: WEB_ROOT })
    servers.push(server)
    const { port } = await server.listen(0, '127.0.0.1')

    const raw = net.connect(port, '127.0.0.1')
    await new Promise((resolve) => raw.once('connect', resolve))
    const closed = new Promise<void>((resolve) => raw.once('close', () => resolve()))
    // Declares a 255-byte frame (the largest length whose high byte is
    // still 0x00, so HostServer's demux still routes it to the TCP path —
    // see hostServer.ts), then disconnects before sending any of the
    // promised payload. The parser should just buffer waiting for more
    // data (no throw), and the eventual close should clean up that
    // half-registered connection without affecting the server or other
    // clients.
    raw.write(Buffer.from([0x00, 0xff]))
    raw.end()
    await closed

    const client = new TcpClient()
    clients.push(client)
    await client.connect('127.0.0.1', port)
    await setUsername(client, 'still-works-2')
  })

  it('serves the "not built yet" placeholder over plain HTTP when webRoot does not exist', async () => {
    const server = new HostServer({ webRoot: WEB_ROOT })
    servers.push(server)
    const { port } = await server.listen(0, '127.0.0.1')

    const response = await fetch(`http://127.0.0.1:${port}/`)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('build:web')
  })
})
