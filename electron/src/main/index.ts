import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { loadConfig, saveConfigPatch } from './config/settings'
import { destroyIdentity } from './crypto/identity'
import { registerIpcHandlers, SessionController } from './ipc/handlers'

let mainWindow: BrowserWindow | null = null
const controller = new SessionController()

const isDev = !app.isPackaged

function createWindow(): void {
  const config = loadConfig()

  mainWindow = new BrowserWindow({
    width: config.windowWidth ?? 1180,
    height: config.windowHeight ?? 760,
    minWidth: 820,
    minHeight: 520,
    show: false,
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  controller.attachWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  let resizeSaveTimer: ReturnType<typeof setTimeout> | null = null
  mainWindow.on('resize', () => {
    if (resizeSaveTimer) clearTimeout(resizeSaveTimer)
    resizeSaveTimer = setTimeout(() => {
      if (!mainWindow) return
      const [windowWidth, windowHeight] = mainWindow.getSize()
      saveConfigPatch({ windowWidth, windowHeight })
    }, 500)
  })

  // Never let the renderer navigate to or open arbitrary external content —
  // this is a LAN chat app, not a browser.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers(controller)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Zero-persistence guarantee: tear down the server/session and drop the
  // in-memory identity keys before exit. Nothing here touches disk.
  controller.shutdown()
  destroyIdentity()
})
