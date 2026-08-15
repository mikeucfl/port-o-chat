import { networkInterfaces } from 'node:os'

/** Non-internal IPv4 addresses, for the "here's how to reach this host on your LAN" display. */
export function getLanIPv4Addresses(): string[] {
  const addresses: string[] = []
  const interfaces = networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address)
      }
    }
  }
  return addresses
}
