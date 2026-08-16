import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@core': resolve(__dirname, 'src/core'),
      '@proto': resolve(__dirname, 'src/proto-gen')
    }
  },
  test: {
    include: ['src/**/*.test.ts']
  }
})
