import { EventEmitter } from 'node:events'
import net from 'node:net'
import type { portochat } from '../proto-gen/portochat'
import { decodeFrame, encodeFrame } from './codec'
import { FrameStreamParser } from './framing'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

/**
 * Client-side TCP socket wrapper sharing the same framing/codec as
 * TcpChatServer. Used identically for a normal JOIN-mode connection and for
 * the host's own loopback connection to its own server — there is no
 * separate in-memory shortcut for host mode anywhere in this app.
 *
 * Emits:
 *   'message'    (message: portochat.PortoChatMessage)
 *   'stateChange' (state: ConnectionState, error?: Error)
 */
export class TcpClient extends EventEmitter {
  private socket: net.Socket | null = null
  private parser = new FrameStreamParser()
  private state: ConnectionState = 'disconnected'

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState('connecting')
      const socket = new net.Socket()
      this.socket = socket

      const onInitialError = (err: Error): void => {
        this.socket = null
        this.setState('disconnected', err)
        reject(err)
      }

      socket.once('error', onInitialError)
      socket.connect(port, host, () => {
        socket.off('error', onInitialError)
        socket.setNoDelay(true)
        this.wireSocket(socket)
        this.setState('connected')
        resolve()
      })
    })
  }

  private wireSocket(socket: net.Socket): void {
    socket.on('data', (chunk: Buffer) => {
      let frames: Buffer[]
      try {
        frames = this.parser.push(chunk)
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

    // 'close' always follows 'error' for a socket; cleanup happens there.
    socket.on('error', () => {})
  }

  private disconnectDueToError(err: Error): void {
    this.socket?.destroy()
    this.socket = null
    this.setState('disconnected', err)
  }

  send(message: portochat.IPortoChatMessage): void {
    if (this.state !== 'connected' || !this.socket) return
    this.socket.write(encodeFrame(message))
  }

  disconnect(): void {
    this.socket?.destroy()
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
