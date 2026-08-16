import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Plain Vite (not electron-vite) — builds the browser-servable client into
// out/web, which HostServer's static file server (main/net/httpStatic.ts)
// serves alongside the raw-TCP/WebSocket listeners on the same port. Not
// wired into `npm run dev` (electron-vite dev doesn't build this target);
// run `npm run dev:web` separately, or `npm run build:web` once and let
// hostStart serve the built output.
export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      '@proto': resolve(__dirname, 'src/proto-gen')
    }
  },
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true
  },
  base: './'
})
