import { afterEach, describe, expect, it } from 'vitest'
import { portochat } from '@proto/portochat'
import { HostServer } from './hostServer'
import { WsClient } from './wsClient'

const RequestType = portochat.Request.RequestType

/**
 * Real end-to-end test of this app's own client transport: a real WsClient
 * (net/wsClient.ts, what SessionController now injects into ChatSession for
 * both JOIN mode and the host's own loopback connection) against a real
 * HostServer over a real loopback socket — not the hand-rolled `ws` test
 * client used in hostServer.integration.test.ts, which only proves the
 * server side of the WS path.
 */

function waitForMessage(
  client: WsClient,
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

describe('WsClient + HostServer (real sockets)', () => {
  const servers: HostServer[] = []
  const clients: WsClient[] = []

  afterEach(() => {
    for (const c of clients) c.disconnect()
    for (const s of servers) s.close()
    clients.length = 0
    servers.length = 0
  })

  it('connects, registers a username, and exchanges a channel message with a second WsClient', async () => {
    const server = new HostServer({ webRoot: '/nonexistent-web-root-for-tests' })
    servers.push(server)
    const { port } = await server.listen(0, '127.0.0.1')

    const alice = new WsClient()
    const bob = new WsClient()
    clients.push(alice, bob)
    expect(alice.getState()).toBe('disconnected')

    await alice.connect('127.0.0.1', port)
    expect(alice.getState()).toBe('connected')
    await bob.connect('127.0.0.1', port)

    const aliceNamed = waitForMessage(alice, (m) => !!m.notification?.userNameSet)
    alice.send({ request: { requestType: RequestType.SetUserName, stringRequestData: { value: 'alice' } } })
    await aliceNamed

    const bobNamed = waitForMessage(bob, (m) => !!m.notification?.userNameSet)
    bob.send({ request: { requestType: RequestType.SetUserName, stringRequestData: { value: 'bob' } } })
    await bobNamed

    alice.send({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
    bob.send({ request: { requestType: RequestType.ChannelJoin, stringRequestData: { value: '#general' } } })
    await new Promise((r) => setTimeout(r, 50))

    const bobReceived = waitForMessage(bob, (m) => !!m.chatMessage)
    alice.send({
      chatMessage: { destinationId: '#general', isChannel: true, message: 'hello over WsClient' }
    })
    const received = await bobReceived
    expect(received.chatMessage?.message).toBe('hello over WsClient')
  })

  it('rejects connecting to a port nothing is listening on', async () => {
    const client = new WsClient()
    clients.push(client)
    await expect(client.connect('127.0.0.1', 1)).rejects.toThrow()
    expect(client.getState()).toBe('disconnected')
  })
})
