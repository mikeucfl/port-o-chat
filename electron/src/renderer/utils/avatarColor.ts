/** Deterministic per-user color (hash of their id -> hue), so avatars are visually distinguishable at a glance instead of all sharing one flat accent color. */
export function avatarColorForUserId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0 // keep it a 32-bit int
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 60%, 45%)`
}

export function initials(name: string): string {
  return name.slice(0, 2).toUpperCase() || '?'
}
