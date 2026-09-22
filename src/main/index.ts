import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { startBrowserAgentServer } from './browserAgent'
import { attachBrowser, navigateBrowser, prepareBrowser, sanitizeUrl } from './browser'
import { augmentPath, killOrphanCodegraphInits, stopCodegraphJobs } from './codegraph'
import { loadDotEnv } from './env'
import { stopGitWatchers } from './git'
import { stopKnowledgeWatchers } from './knowledge'
import {
  startWorktreeReaper,
  stopWorktreeReaper,
  sweepWorktreeProcesses,
  sweepWorktreeProcessesSync
} from './worktreeProcs'
import { registerIpc } from './ipc'
import { ensureStore, purgeUnsafeProjects, syncGrokSessions } from './store'
import { applyWindowChrome, getThemeState } from './themes'
import { attachMediaProtocol } from './media'
import { attachVoiceProtocol, ensureMicAccess, getMicAccess, registerVoiceScheme } from './voice'
import { loadWindowState, trackWindowState } from './windowState'

registerVoiceScheme()

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
    title: 'Grok Build Workbench',
    icon,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  function isMicPermission(permission: string): boolean {
    return permission === 'media' || permission === 'audioCapture' || permission === 'microphone'
  }

  mainWindow.webContents.session.setPermissionCheckHandler((_contents, permission) => {
    return isMicPermission(permission)
  })
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    const mic = isMicPermission(permission)
    callback(mic)
    if (mic && getMicAccess() !== 'granted') void ensureMicAccess()
  })

  trackWindowState(mainWindow)

  mainWindow.on('ready-to-show', () => {
    if (state.isMaximized) mainWindow.maximize()
    mainWindow.show()
  })

  function isAppUrl(url: string): boolean {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      return url.startsWith(process.env['ELECTRON_RENDERER_URL'])
    }
    try {
      return new URL(url).protocol === 'file:'
    } catch {
      return false
    }
  }

  function openInAppBrowser(url: string): void {
    const clean = sanitizeUrl(url)
    if (clean) {
      void navigateBrowser(clean)
      return
    }
    void shell.openExternal(url)
  }

  // Same-window <a> clicks replace the renderer unless we cancel them.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    openInAppBrowser(url)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openInAppBrowser(details.url)
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
  app.setName('Grok Build Workbench')
  electronApp.setAppUserModelId('com.datapad.grokcode')
  if (process.platform === 'darwin') {
    app.dock?.setIcon(icon)
  }
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  await ensureStore()
  await purgeUnsafeProjects()
  await syncGrokSessions()
  attachVoiceProtocol()
  attachMediaProtocol()
  void ensureMicAccess()
  await prepareBrowser()
  await startBrowserAgentServer()
  registerIpc()
  killOrphanCodegraphInits()
  void sweepWorktreeProcesses()
  startWorktreeReaper()
  createWindow()
  const { active } = await getThemeState()
  applyWindowChrome(active)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopWorktreeReaper()
  stopCodegraphJobs()
  killOrphanCodegraphInits()
  stopGitWatchers()
  stopKnowledgeWatchers()
  sweepWorktreeProcessesSync()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
