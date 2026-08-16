/**
 * Manual interop check against a real running Java port-o-chat server (or
 * client). Not part of the automated test suite — this opens a real TCP
 * connection to whatever host:port you point it at.
 *
 * Usage: npx tsx scripts/verify-java-interop.ts [host] [port]
 */
import { ChatSession } from '../src/main/client/session'
import { portochat } from '../src/proto-gen/portochat'

const host = process.argv[2] ?? '127.0.0.1'
const port = Number.parseInt(process.argv[3] ?? '3457', 10)

async function main(): Promise<void> {
  const session = new ChatSession()
  session.on('stateChange', (state: string, err?: Error) => {
    console.log(`[state] ${state}${err ? ' error=' + err.message : ''}`)
  })
  session.on('message', (m: portochat.PortoChatMessage) => {
    console.log(`[recv] ${m.ApplicationMessage}:`, JSON.stringify(m.toJSON()))
  })

  console.log(`Connecting to ${host}:${port} as "electron-tester" (no E2E key, plain interop check)...`)
  await session.connect(host, port, 'electron-tester', null)

  await new Promise((r) => setTimeout(r, 500))
  console.log('Joining #interop-test...')
  session.joinChannel('#interop-test')

  await new Promise((r) => setTimeout(r, 500))
  console.log('Sending a channel message...')
  session.sendChatMessage({
    destinationId: '#interop-test',
    isChannel: true,
    message: 'hello from the Electron client'
  })

  await new Promise((r) => setTimeout(r, 500))
  console.log('Requesting channel list...')
  session.requestChannelList()

  await new Promise((r) => setTimeout(r, 1500))
  console.log('Done. Disconnecting.')
  session.disconnect()
  process.exit(0)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
