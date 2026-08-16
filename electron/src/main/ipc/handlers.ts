import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron'
import { IPC_INVOKE, IPC_EVENT } from '@shared/ipc-contract'
import type { AppConfig, HostStartResult, SendMessageParams } from '@shared/protocolTypes'
import { ChatController } from '@core/chatController'
import { NodeCryptoProvider } from '../crypto/nodeCryptoProvider'
import { loadConfig, saveConfigPatch } from '../config/settings'
import { getLanIPv4Addresses } from '../net/lanAddresses'
import { TcpClient } from '../net/tcpClient'
import { TcpChatServer } from '../net/tcpServer'
import { solidCircleDot } from '../util/badgeIcon'

/**
 * Thin Electron-specific adapter: the BrowserWindow/IPC bridge, the
 * host-mode TCP server, and OS integration (taskbar badge, external link
 * opening). All chat/E2E policy lives in ChatController (src/core), shared
 * with the future browser build — this class just wires it to IPC instead
 * of an in-page event bus, and injects a Node-crypto-backed CryptoProvider
 * and TcpClient transport (see PORTING-NOTES.md; the client transport is
 * switching to WebSocket in a later stage of this work).
 */
export class SessionController {
  private window: BrowserWindow | null = null
  private hostServer: TcpChatServer | null = null
  private overlayIconCache = new Map<number, Electron.NativeImage>()

  private readonly chat = new ChatController({
    crypto: new NodeCryptoProvider(),
    createTransport: () => new TcpClient(),
    emit: (channel, payload) => this.send(channel, payload)
  })

  attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  shutdown(): void {
    this.chat.disconnect()
    this.hostServer?.close()
  }

  private send<T>(channel: string, payload: T): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send(channel, payload)
  }

  // ---- config -------------------------------------------------------------

  getConfig(): AppConfig {
    return loadConfig()
  }

  setConfig(patch: Partial<AppConfig>): void {
    saveConfigPatch(patch)
  }

  // ---- host -----------------------------------------------------------------

  async hostStart(port: number): Promise<HostStartResult> {
    if (this.hostServer) {
      throw new Error('A server is already running in this app instance')
    }
    const server = new TcpChatServer()
    const { port: boundPort } = await server.listen(port)
    this.hostServer = server
    return { port: boundPort, lanAddresses: getLanIPv4Addresses() }
  }

  hostStop(): void {
    this.hostServer?.close()
    this.hostServer = null
  }

  // ---- client ---------------------------------------------------------------

  async clientConnect(host: string, port: number, nickname: string): Promise<void> {
    await this.chat.connect(host, port, nickname)
  }

  clientDisconnect(): void {
    this.chat.disconnect()
    this.hostServer?.close()
    this.hostServer = null
  }

  sendMessage(params: SendMessageParams): void {
    this.chat.sendMessage(params)
  }

  joinChannel(name: string, e2e: boolean): void {
    this.chat.joinChannel(name, e2e)
  }

  partChannel(name: string): void {
    this.chat.partChannel(name)
  }

  requestChannelList(): void {
    this.chat.requestChannelList()
  }

  setNickname(name: string): void {
    this.chat.setNickname(name)
  }

  setChannelTopic(channel: string, topic: string): void {
    this.chat.setChannelTopic(channel, topic)
  }

  getFingerprint(userId: string): string | null {
    return this.chat.getFingerprint(userId)
  }

  getMyFingerprint(): string {
    return this.chat.getMyFingerprint()
  }

  trustPeerKey(userId: string): void {
    this.chat.trustPeerKey(userId)
  }

  // ---- window/OS integration ------------------------------------------------

  openExternalLink(url: string): void {
    // The renderer has already shown its own "open this link?" confirmation
    // before ever calling this — this is just the mechanism, not the
    // decision. Still validated here regardless, since this is the one
    // deliberate escape hatch in an otherwise fully locked-down renderer
    // (see main/index.ts's setWindowOpenHandler/will-navigate): only
    // http(s), never file:/javascript:/anything else a malicious peer
    // could try to smuggle into a message as a "link."
    if (!/^https?:\/\//i.test(url)) return
    void shell.openExternal(url)
  }

  setUnreadBadge(count: number): void {
    // macOS dock / some Linux DEs: a real numeric badge.
    app.setBadgeCount(count)

    // Windows has no equivalent OS-level API — draw a small taskbar overlay
    // dot instead (not the exact count; just "you have something unread").
    if (process.platform === 'win32' && this.window && !this.window.isDestroyed()) {
      if (count > 0) {
        let icon = this.overlayIconCache.get(1)
        if (!icon) {
          icon = nativeImage.createFromBuffer(solidCircleDot(16, 218, 55, 60))
          this.overlayIconCache.set(1, icon)
        }
        this.window.setOverlayIcon(icon, `${count} unread`)
      } else {
        this.window.setOverlayIcon(null, '')
      }
    }
  }
}

export function registerIpcHandlers(controller: SessionController): void {
  ipcMain.handle(IPC_INVOKE.getConfig, () => controller.getConfig())
  ipcMain.handle(IPC_INVOKE.setConfig, (_e, patch: AppConfig) => controller.setConfig(patch))

  ipcMain.handle(IPC_INVOKE.hostStart, (_e, port: number) => controller.hostStart(port))
  ipcMain.handle(IPC_INVOKE.hostStop, () => controller.hostStop())

  ipcMain.handle(IPC_INVOKE.clientConnect, (_e, host: string, port: number, nickname: string) =>
    controller.clientConnect(host, port, nickname)
  )
  ipcMain.handle(IPC_INVOKE.clientDisconnect, () => controller.clientDisconnect())

  ipcMain.handle(IPC_INVOKE.sendMessage, (_e, params: SendMessageParams) =>
    controller.sendMessage(params)
  )
  ipcMain.handle(IPC_INVOKE.joinChannel, (_e, name: string, e2e: boolean) =>
    controller.joinChannel(name, e2e)
  )
  ipcMain.handle(IPC_INVOKE.partChannel, (_e, name: string) => controller.partChannel(name))
  ipcMain.handle(IPC_INVOKE.requestChannelList, () => controller.requestChannelList())
  ipcMain.handle(IPC_INVOKE.setNickname, (_e, name: string) => controller.setNickname(name))
  ipcMain.handle(IPC_INVOKE.setChannelTopic, (_e, channel: string, topic: string) =>
    controller.setChannelTopic(channel, topic)
  )

  ipcMain.handle(IPC_INVOKE.getFingerprint, (_e, userId: string) => controller.getFingerprint(userId))
  ipcMain.handle(IPC_INVOKE.getMyFingerprint, () => controller.getMyFingerprint())
  ipcMain.handle(IPC_INVOKE.trustPeerKey, (_e, userId: string) => controller.trustPeerKey(userId))

  ipcMain.handle(IPC_INVOKE.setUnreadBadge, (_e, count: number) => controller.setUnreadBadge(count))
  ipcMain.handle(IPC_INVOKE.openExternalLink, (_e, url: string) => controller.openExternalLink(url))
}
