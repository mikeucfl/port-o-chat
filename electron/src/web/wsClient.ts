import { WS_PATH } from '@shared/constants'
import type { ChatTransport, ChatTransportEvents, ConnectionState } from '@core/transport'
import { decodeFrame, encodeFrame } from '@core/codec'
import { FrameStreamParser } from '@core/framing'
import type { portochat } from '@proto/portochat'

type Listener = (...args: unknown[]) => void

/**
 * ChatTransport implementation for the browser build, over the native
 * WebSocket global — no `ws` package needed here, real browsers have this
 * built in (unlike Electron's bundled Node, see main/net/wsClient.ts).
 * Connects to HostServer's WS_PATH endpoint on the same host:port the page
 * itself was served from (or wherever the Join screen points it at).
 */
export class BrowserWsClient implements ChatTransport {
  private socket: WebSocket | null = null
  private parser = new FrameStreamParser()
  private state: ConnectionState = 'disconnected'
  private listeners = new Map<string, Set<Listener>>()

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState('connecting')
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${host}:${port}${WS_PATH}`)
      socket.binaryType = 'arraybuffer'
      this.socket = socket

      const onInitialError = (): void => {
        this.socket = null
        const err = new Error('WebSocket connection failed')
        this.setState('disconnected', err)
        reject(err)
      }

      socket.addEventListener('error', onInitialError, { once: true })
      socket.addEventListener(
        'open',
        () => {
          socket.removeEventListener('error', onInitialError)
          this.wireSocket(socket)
          this.setState('connected')
          resolve()
        },
        { once: true }
      )
    })
  }

  private wireSocket(socket: WebSocket): void {
    socket.addEventListener('message', (event: MessageEvent<ArrayBuffer>) => {
      let frames: Buffer[]
      try {
        frames = this.parser.push(Buffer.from(event.data))
      } catch (err) {
        this.disconnectDueToError(err as Error)
        return
      }

      for (const frame of frames) {
        try {
          const message = decodeFrame(frame)
          this.emit('message', message)
        } catch (err) {
          this.disconnectDueToError(err as Error)
          return
        }
      }
    })

    socket.addEventListener('close', () => {
      if (this.state !== 'disconnected') this.setState('disconnected')
    })

    // 'close' always follows 'error' for a WebSocket too; cleanup happens there.
    socket.addEventListener('error', () => {})
  }

  private disconnectDueToError(err: Error): void {
    this.socket?.close()
    this.socket = null
    this.setState('disconnected', err)
  }

  send(message: portochat.IPortoChatMessage): void {
    if (this.state !== 'connected' || !this.socket) return
    this.socket.send(encodeFrame(message))
  }

  disconnect(): void {
    this.socket?.close()
    this.socket = null
    this.setState('disconnected')
  }

  getState(): ConnectionState {
    return this.state
  }

  private setState(state: ConnectionState, error?: Error): void {
    this.state = state
    this.emit('stateChange', state, error)
  }

  on<K extends keyof ChatTransportEvents>(
    event: K,
    listener: (...args: ChatTransportEvents[K]) => void
  ): void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener)
  }

  private emit<K extends keyof ChatTransportEvents>(event: K, ...args: ChatTransportEvents[K]): void {
    this.listeners.get(event)?.forEach((l) => l(...args))
  }
}
