import { EventEmitter } from 'node:events'
import { WebSocket, type RawData } from 'ws'
import { WS_PATH } from '@shared/constants'
import { decodeFrame, encodeFrame } from '@core/codec'
import { FrameStreamParser } from '@core/framing'
import type { portochat } from '@proto/portochat'
import type { ConnectionState } from '@core/transport'

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

/**
 * ChatTransport implementation for the Electron main process, over the
 * `ws` package — Electron's bundled Node has no stable global WebSocket,
 * unlike a real browser. Connects to HostServer's WS_PATH endpoint on the
 * same port raw-TCP clients use (see hostServer.ts's demux); this is now
 * this app's own client transport for both JOIN mode and the host's own
 * loopback connection to its own server, in place of the raw TCP it used
 * to speak (see net/tcpClient.ts, kept only for legacy-interop tooling).
 *
 * Emits:
 *   'message'    (message: portochat.PortoChatMessage)
 *   'stateChange' (state: ConnectionState, error?: Error)
 */
export class WsClient extends EventEmitter {
  private socket: WebSocket | null = null
  private parser = new FrameStreamParser()
  private state: ConnectionState = 'disconnected'

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState('connecting')
      const socket = new WebSocket(`ws://${host}:${port}${WS_PATH}`)
      this.socket = socket

      const onInitialError = (err: Error): void => {
        this.socket = null
        this.setState('disconnected', err)
        reject(err)
      }

      socket.once('error', onInitialError)
      socket.once('open', () => {
        socket.off('error', onInitialError)
        this.wireSocket(socket)
        this.setState('connected')
        resolve()
      })
    })
  }

  private wireSocket(socket: WebSocket): void {
    socket.on('message', (data: RawData) => {
      let frames: Buffer[]
      try {
        frames = this.parser.push(toBuffer(data))
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

    socket.on('close', () => {
      if (this.state !== 'disconnected') this.setState('disconnected')
    })

    // 'close' always follows 'error' for a WebSocket too; cleanup happens there.
    socket.on('error', () => {})
  }

  private disconnectDueToError(err: Error): void {
    this.socket?.terminate()
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
}
