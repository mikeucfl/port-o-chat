import { contextBridge } from 'electron'

// Populated incrementally as the IPC contract (see docs/PROTOCOL.md) is wired up.
// This file must stay a thin pass-through: no networking, no crypto, no state.
const api = {
  ping: (): string => 'pong'
}

contextBridge.exposeInMainWorld('portochat', api)

export type PortochatApi = typeof api
