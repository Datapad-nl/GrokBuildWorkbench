import { app, BrowserWindow, WebContentsView, session } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { BrowserBounds, BrowserState } from '../shared/types'

const PARTITION = 'persist:grokcode-browser'

let host: BrowserWindow | null = null
let view: WebContentsView | null = null
let visible = false
let lastError: string | null = null
let lastUrl = ''
let lastBounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
let persistReady: Promise<void> | null = null

function persistPath(): string {
  return join(app.getPath('userData'), 'grokcode', 'browser.json')
}

export function sanitizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const raw = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

function guestSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION)
  const current = ses.getUserAgent()
  const stripped = current.replace(/\sElectron\/\S+/, '')
  if (stripped !== current) ses.setUserAgent(stripped)
  return ses
}

function contents(): Electron.WebContents | null {
  if (!view || view.webContents.isDestroyed()) return null
  return view.webContents
}

function emit(): void {
  const state = getBrowserState()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('browser:state', state)
  }
}

export function requestShowBrowser(): void {
  setBrowserVisible(true)
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('browser:requestShow')
  }
}

async function loadPersisted(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(persistPath(), 'utf8')) as { url?: unknown }
    if (typeof raw.url === 'string') {
      lastUrl = sanitizeUrl(raw.url) ?? ''
    }
  } catch {
    lastUrl = ''
  }
}

async function savePersisted(url: string): Promise<void> {
  const clean = sanitizeUrl(url) ?? ''
  lastUrl = clean
  await mkdir(join(app.getPath('userData'), 'grokcode'), { recursive: true })
  await writeFile(persistPath(), JSON.stringify({ url: clean }), 'utf8')
}

function applyBounds(): void {
  if (!view) return
  const { x, y, width, height } = lastBounds
  const show = visible && width >= 2 && height >= 2
  view.setVisible(show)
  if (show) view.setBounds({ x, y, width, height })
}

function wireContents(wc: Electron.WebContents): void {
  wc.setWindowOpenHandler((details) => {
    const url = sanitizeUrl(details.url)
    if (url) void navigateBrowser(url)
    return { action: 'deny' }
  })

  wc.on('will-navigate', (event, url) => {
    if (!sanitizeUrl(url)) event.preventDefault()
  })

  wc.on('will-redirect', (event, url) => {
    if (!sanitizeUrl(url)) event.preventDefault()
  })

  const onChange = (): void => {
    const url = wc.getURL()
    if (sanitizeUrl(url)) void savePersisted(url)
    emit()
  }

  wc.on('did-navigate', onChange)
  wc.on('did-navigate-in-page', onChange)
  wc.on('page-title-updated', onChange)
  wc.on('did-start-loading', () => {
    lastError = null
    emit()
  })
  wc.on('did-stop-loading', onChange)
  wc.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    lastError = errorDescription || 'Failed to load'
    emit()
  })
}

function ensureView(): WebContentsView {
  if (view && !view.webContents.isDestroyed()) return view

  view = new WebContentsView({
    webPreferences: {
      session: guestSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false
    }
  })
  view.setBackgroundColor('#141414')
  view.setVisible(false)
  wireContents(view.webContents)

  if (host && !host.isDestroyed()) {
    host.contentView.addChildView(view)
  }

  return view
}

export async function prepareBrowser(): Promise<void> {
  persistReady ??= loadPersisted()
  await persistReady
}

function layoutHost(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  const [width, height] = window.getContentSize()
  for (const child of window.contentView.children) {
    if (child === view) continue
    child.setBounds({ x: 0, y: 0, width, height })
  }
  applyBounds()
}

export function attachBrowser(window: BrowserWindow): void {
  host = window
  const current = ensureView()
  if (!window.contentView.children.includes(current)) {
    window.contentView.addChildView(current)
  }
  if (lastUrl && !sanitizeUrl(current.webContents.getURL())) {
    void current.webContents.loadURL(lastUrl)
  }
  layoutHost(window)

  const relayout = (): void => layoutHost(window)
  window.on('resize', relayout)
  window.on('show', relayout)
  window.on('ready-to-show', relayout)
  window.on('enter-full-screen', relayout)
  window.on('leave-full-screen', relayout)

  window.on('closed', () => {
    if (host !== window) return
    if (view && !view.webContents.isDestroyed()) {
      try {
        window.contentView.removeChildView(view)
      } catch {
        // window already tearing down
      }
    }
    view = null
    host = null
    visible = false
  })
}

export function getBrowserState(): BrowserState {
  const wc = contents()
  const url = wc?.getURL() ?? ''
  return {
    url: sanitizeUrl(url) ?? lastUrl,
    title: wc?.getTitle() ?? '',
    canGoBack: wc?.navigationHistory.canGoBack() ?? false,
    canGoForward: wc?.navigationHistory.canGoForward() ?? false,
    loading: wc?.isLoading() ?? false,
    visible,
    error: lastError
  }
}

export function setBrowserVisible(next: boolean): BrowserState {
  visible = next
  if (next) ensureView()
  applyBounds()
  emit()
  return getBrowserState()
}

export function setBrowserBounds(bounds: BrowserBounds): BrowserState {
  lastBounds = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height))
  }
  applyBounds()
  return getBrowserState()
}

export async function navigateBrowser(input: string): Promise<BrowserState> {
  const url = sanitizeUrl(input)
  if (!url) {
    lastError = 'Enter an http(s) address'
    emit()
    return getBrowserState()
  }
  lastError = null
  requestShowBrowser()
  await savePersisted(url)
  const wc = ensureView().webContents
  try {
    await wc.loadURL(url)
  } catch {
    // aborted or superseded navigations reject
  }
  return getBrowserState()
}

export function goBack(): BrowserState {
  const wc = contents()
  if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  return getBrowserState()
}

export function goForward(): BrowserState {
  const wc = contents()
  if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  return getBrowserState()
}

export function reloadBrowser(): BrowserState {
  contents()?.reload()
  return getBrowserState()
}

export function stopBrowser(): BrowserState {
  contents()?.stop()
  return getBrowserState()
}

export async function clearBrowserData(): Promise<BrowserState> {
  const ses = guestSession()
  await ses.clearStorageData()
  await ses.clearCache()
  lastUrl = ''
  lastError = null
  await savePersisted('')
  const wc = contents()
  if (wc) {
    try {
      await wc.loadURL('about:blank')
    } catch {
      // ignored
    }
  }
  emit()
  return getBrowserState()
}
