import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
// protobufjs-cli ships no types; its programmatic API takes an argv array
// and a (err, output) callback, mirroring its own bin/pbjs and bin/pbts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pbjsMain = require('protobufjs-cli/pbjs').main as (
  args: string[],
  cb: (err: Error | null, output?: string) => void
) => void
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pbtsMain = require('protobufjs-cli/pbts').main as (
  args: string[],
  cb: (err: Error | null, output?: string) => void
) => void

// Generates a static protobufjs module (+ .d.ts) from proto/portochat.proto
// into src/proto-gen/, imported via the `@proto` alias by both the main
// process and the isomorphic src/core layer (and, transitively, the browser
// build). The renderer must still never link protobuf runtime code directly
// — only plain DTO types from src/shared.

const root = resolve(__dirname, '..')
const protoFile = resolve(root, 'proto/portochat.proto')
const outDir = resolve(root, 'src/proto-gen')
const jsOut = resolve(outDir, 'portochat.js')
const dtsOut = resolve(outDir, 'portochat.d.ts')

mkdirSync(outDir, { recursive: true })

function run(
  main: (args: string[], cb: (err: Error | null, output?: string) => void) => void,
  args: string[]
): Promise<string> {
  return new Promise((res, rej) => {
    main(args, (err, output) => {
      if (err) rej(err)
      else res(output ?? '')
    })
  })
}

async function build(): Promise<void> {
  const jsOutput = await run(pbjsMain, [
    '-t',
    'static-module',
    '-w',
    'es6',
    '--no-verify',
    protoFile
  ])
  writeFileSync(jsOut, jsOutput)

  const dtsOutput = await run(pbtsMain, [jsOut])
  writeFileSync(dtsOut, dtsOutput)

  console.log(`Generated ${jsOut} and ${dtsOut}`)
}

build().catch((err) => {
  console.error(err)
  process.exit(1)
})
