/// <reference types="vite/client" />
import type { PortochatApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    portochat: PortochatApi
  }
}
