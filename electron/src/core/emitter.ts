type Listener = (...args: unknown[]) => void

/**
 * Minimal typed event emitter standing in for node:events, so files in this
 * directory stay importable from the browser build too. Only covers what
 * this app actually uses: on() + a protected emit() — no off/once/wildcard
 * support, since nothing here needs it (each session is used once and
 * discarded rather than having listeners detached mid-life).
 */
export class TypedEmitter<Events extends Record<string, unknown[]>> {
  private listeners = new Map<keyof Events, Set<Listener>>()

  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener)
    return this
  }

  protected emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) (listener as (...args: Events[K]) => void)(...args)
  }
}
