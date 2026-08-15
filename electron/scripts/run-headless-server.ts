/**
 * Manual interop check: runs a bare TcpChatServer (the same class host mode
 * uses) with no Electron/GUI involved, so a real Java client can connect to
 * it and we can verify wire compatibility headlessly.
 *
 * Usage: npx tsx --tsconfig tsconfig.node.json scripts/run-headless-server.ts [port]
 */
import { TcpChatServer } from '../src/main/net/tcpServer'

const port = Number.parseInt(process.argv[2] ?? '3458', 10)

async function main(): Promise<void> {
  const server = new TcpChatServer()
  const result = await server.listen(port)
  console.log(`Listening on port ${result.port}`)

  process.on('SIGINT', () => {
    server.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
