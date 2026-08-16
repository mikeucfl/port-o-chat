/**
 * Manual interop check: runs a bare HostServer (the same class host mode
 * uses) with no Electron/GUI involved, so a real Java client, a raw-TCP
 * tool, or a real browser can all connect to it and we can verify wire
 * compatibility headlessly — including the browser build, if out/web has
 * been built (npm run build:web).
 *
 * Usage: npx tsx --tsconfig tsconfig.node.json scripts/run-headless-server.ts [port]
 */
import { resolve } from 'node:path'
import { HostServer } from '../src/main/net/hostServer'

const port = Number.parseInt(process.argv[2] ?? '3458', 10)
const webRoot = resolve(__dirname, '../out/web')

async function main(): Promise<void> {
  const server = new HostServer({ webRoot })
  const result = await server.listen(port)
  console.log(`Listening on port ${result.port} (web root: ${webRoot})`)

  process.on('SIGINT', () => {
    server.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
