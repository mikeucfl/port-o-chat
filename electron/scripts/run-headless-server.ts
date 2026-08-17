/**
 * Runs a bare HostServer (the same class host mode uses) with no Electron/
 * GUI involved — this is the real way to host on a GUI-less/headless
 * machine, not just an interop-testing tool: a real Java client, a raw-TCP
 * tool, this app's own desktop/browser clients can all connect to it, and
 * it supports the same optional join password hostStart(port, password)
 * does in the GUI app — there's just no settings cogwheel here, so
 * changing it means restarting this process with a new argument.
 *
 * Usage: npx tsx --tsconfig tsconfig.node.json scripts/run-headless-server.ts [port] [password]
 */
import { resolve } from 'node:path'
import { HostServer } from '../src/main/net/hostServer'

const port = Number.parseInt(process.argv[2] ?? '3458', 10)
const password = process.argv[3]
const webRoot = resolve(__dirname, '../out/web')

async function main(): Promise<void> {
  const server = new HostServer({ webRoot, password })
  const result = await server.listen(port)
  console.log(
    `Listening on port ${result.port} (web root: ${webRoot}, password: ${password ? 'set' : 'none'})`
  )

  process.on('SIGINT', () => {
    server.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
