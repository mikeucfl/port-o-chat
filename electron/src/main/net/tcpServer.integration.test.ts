import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { portochat } from '@proto/portochat'
import { AddressInUseError, TcpChatServer } from './tcpServer'
import { TcpClient } from './tcpClient'
import { wrapFrame } from './framing'

const RequestType = portochat.Request.RequestType

/**
 * Real end-to-end networking test: an actual TcpChatServer listening on a
 * real loopback TCP port, with real TcpClient sockets connecting to it —
 * exactly the host-loopback path host mode uses, just without the Electron
 * shell around it. This is runnable headlessly (pure Node `net`), unlike
 * anything that requires a real BrowserWindow.
 */

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

describe('TcpChatServer + TcpClient (real sockets)', () => {
  const servers: TcpChatServer[] = []
  const clients: TcpClient[] = []

  afterEach(() => {
    for (const c of clients) c.disconnect()
    for (const s of servers) s.close()
    clients.length = 0
    servers.length = 0
  })

  it('two clients exchange a channel message and a DM over real loopback sockets', async () => {
    const server = new TcpChatServer()
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

  it('rejects a second server bound to the same port with AddressInUseError', async () => {
    const server1 = new TcpChatServer()
    servers.push(server1)
    const { port } = await server1.listen(0, '127.0.0.1')

    const server2 = new TcpChatServer()
    await expect(server2.listen(port, '127.0.0.1')).rejects.toBeInstanceOf(AddressInUseError)
  })

  it('closes a connection that sends a malformed frame, without crashing the server', async () => {
    const server = new TcpChatServer()
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

  it('handles a connection that closes mid-frame, without crashing the server', async () => {
    const server = new TcpChatServer()
    servers.push(server)
    const { port } = await server.listen(0, '127.0.0.1')

    const raw = net.connect(port, '127.0.0.1')
    await new Promise((resolve) => raw.once('connect', resolve))
    const closed = new Promise<void>((resolve) => raw.once('close', () => resolve()))
    // Declares a full-size (65535-byte, the MAX_FRAME_SIZE ceiling) frame,
    // then disconnects before sending any of the promised payload. The
    // parser should just buffer waiting for more data (no throw), and the
    // eventual close should clean up that half-registered connection
    // without affecting the server or other clients.
    raw.write(Buffer.from([0xff, 0xff]))
    raw.end()
    await closed

    const client = new TcpClient()
    clients.push(client)
    await client.connect('127.0.0.1', port)
    await setUsername(client, 'still-works-2')
  })
})
