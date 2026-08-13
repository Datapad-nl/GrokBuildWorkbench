import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { startBrowserAgentServer } from './browserAgent'
import { attachBrowser, navigateBrowser, prepareBrowser, sanitizeUrl } from './browser'
import { augmentPath } from './codegraph'
import { loadDotEnv } from './env'
import { registerIpc } from './ipc'
import { ensureStore, syncGrokSessions } from './store'
import { applyWindowChrome, getThemeState } from './themes'
import { loadWindowState, trackWindowState } from './windowState'

if (is.dev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9333')
}

function createWindow(): void {
  const state = loadWindowState()
  const mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x != null && state.y != null ? { x: state.x, y: state.y } : {}),
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#141414',
    title: 'GrokCode',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  trackWindowState(mainWindow)

  mainWindow.on('ready-to-show', () => {
    if (state.isMaximized) mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const url = sanitizeUrl(details.url)
    if (url) {
      void navigateBrowser(url)
    } else {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  attachBrowser(mainWindow)
}

app.whenReady().then(async () => {
  loadDotEnv()
  augmentPath()
  electronApp.setAppUserModelId('com.datapad.grokcode')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  await ensureStore()
  await syncGrokSessions()
  await prepareBrowser()
  await startBrowserAgentServer()
  registerIpc()
  createWindow()
  const { active } = await getThemeState()
  applyWindowChrome(active)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
