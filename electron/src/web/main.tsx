// Must run before anything in @core/@renderer executes — those files are
// written against Node's ambient Buffer global (see global.d.ts), which a
// real browser has no native equivalent for.
import { Buffer } from 'buffer'
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@renderer/App'
import { StoreProvider } from '@renderer/state/store'
import '@renderer/styles/global.css'
import { createBrowserApi } from './api'

// The only real difference from the Electron renderer's own bootstrap
// (src/renderer/main.tsx): window.portochat is installed directly here
// instead of via Electron's contextBridge/preload. Every screen and
// component below this point is the exact same, unmodified code.
;(window as unknown as { portochat: ReturnType<typeof createBrowserApi> }).portochat = createBrowserApi()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>
)
