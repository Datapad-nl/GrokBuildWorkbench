import { contextBridge, ipcRenderer } from 'electron'
import type { ThemeFile, ThemeSummary } from '../shared/theme'
import type {
  ActivityFeed,
  ActivitySnapshot,
  BrowserBounds,
  BrowserState,
  ChatEvent,
  CreateProjectInput,
  FileHit,
  FileMention,
  IndexEvent,
  PermissionMode,
  UpdateProjectInput
} from '../shared/types'

const api = {
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke('project:create', input),
  updateProject: (input: UpdateProjectInput) => ipcRenderer.invoke('project:update', input),
  deleteProject: (projectId: string) => ipcRenderer.invoke('project:delete', projectId),
  indexProject: (projectId: string) => ipcRenderer.invoke('project:index', projectId),
  getOrientation: (projectId: string) => ipcRenderer.invoke('project:orientation', projectId),
  pickFolder: () => ipcRenderer.invoke('project:pickFolder'),
  createChat: (projectId: string) => ipcRenderer.invoke('chat:create', projectId),
  getChat: (chatId: string) => ipcRenderer.invoke('chat:get', chatId),
  deleteChat: (chatId: string) => ipcRenderer.invoke('chat:delete', chatId),
  renameChat: (id: string, title: string) => ipcRenderer.invoke('chat:rename', { id, title }),
  sendMessage: (
    chatId: string,
    content: string,
    attachments?: Array<{ id: string; mimeType: string; data: string }>,
    mentions?: FileMention[]
  ) => ipcRenderer.invoke('chat:send', { chatId, content, attachments, mentions }),
  searchFiles: (projectId: string, query: string) =>
    ipcRenderer.invoke('project:searchFiles', { projectId, query }) as Promise<FileHit[]>,
  stopChat: (chatId: string) => ipcRenderer.invoke('chat:stop', chatId),
  setChatMode: (chatId: string, mode: PermissionMode) =>
    ipcRenderer.invoke('chat:setMode', { chatId, mode }),
  resolvePermission: (requestId: string, decision: 'allow' | 'deny') =>
    ipcRenderer.invoke('chat:resolvePermission', { requestId, decision }),
  rewindChat: (chatId: string, checkpointId: string) =>
    ipcRenderer.invoke('chat:rewind', { chatId, checkpointId }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (input: { apiKey?: string; model?: string }) =>
    ipcRenderer.invoke('settings:set', input),
  getThemeState: (): Promise<{ active: ThemeFile; themes: ThemeSummary[]; activeId: string }> =>
    ipcRenderer.invoke('theme:state'),
  activateTheme: (id: string): Promise<{ active: ThemeFile; themes: ThemeSummary[]; activeId: string }> =>
    ipcRenderer.invoke('theme:activate', id),
  saveTheme: (theme: ThemeFile): Promise<{ active: ThemeFile; themes: ThemeSummary[]; activeId: string }> =>
    ipcRenderer.invoke('theme:save', theme),
  deleteTheme: (id: string): Promise<{ active: ThemeFile; themes: ThemeSummary[]; activeId: string }> =>
    ipcRenderer.invoke('theme:delete', id),
  importTheme: (): Promise<{ active: ThemeFile; themes: ThemeSummary[]; activeId: string } | null> =>
    ipcRenderer.invoke('theme:import'),
  exportTheme: (id: string): Promise<boolean> => ipcRenderer.invoke('theme:export', id),
  onChatEvent: (listener: (event: ChatEvent) => void) => {
    const wrapped = (_event: unknown, payload: ChatEvent): void => listener(payload)
    ipcRenderer.on('chat:event', wrapped)
    return () => {
      ipcRenderer.removeListener('chat:event', wrapped)
    }
  },
  onIndexEvent: (listener: (event: IndexEvent) => void) => {
    const wrapped = (_event: unknown, payload: IndexEvent): void => listener(payload)
    ipcRenderer.on('index:event', wrapped)
    return () => {
      ipcRenderer.removeListener('index:event', wrapped)
    }
  },
  getActivity: () => ipcRenderer.invoke('activity:get') as Promise<ActivitySnapshot>,
  clearActivity: () => ipcRenderer.invoke('activity:clear') as Promise<ActivitySnapshot>,
  onActivityEvent: (listener: (event: ActivityFeed) => void) => {
    const wrapped = (_event: unknown, payload: ActivityFeed): void => listener(payload)
    ipcRenderer.on('activity:event', wrapped)
    return () => {
      ipcRenderer.removeListener('activity:event', wrapped)
    }
  },
  getBrowserState: () => ipcRenderer.invoke('browser:getState') as Promise<BrowserState>,
  setBrowserVisible: (visible: boolean) =>
    ipcRenderer.invoke('browser:setVisible', visible) as Promise<BrowserState>,
  setBrowserBounds: (bounds: BrowserBounds) =>
    ipcRenderer.invoke('browser:setBounds', bounds) as Promise<BrowserState>,
  navigateBrowser: (url: string) =>
    ipcRenderer.invoke('browser:navigate', url) as Promise<BrowserState>,
  browserBack: () => ipcRenderer.invoke('browser:back') as Promise<BrowserState>,
  browserForward: () => ipcRenderer.invoke('browser:forward') as Promise<BrowserState>,
  reloadBrowser: () => ipcRenderer.invoke('browser:reload') as Promise<BrowserState>,
  stopBrowser: () => ipcRenderer.invoke('browser:stop') as Promise<BrowserState>,
  clearBrowserData: () => ipcRenderer.invoke('browser:clearData') as Promise<BrowserState>,
  onBrowserState: (listener: (state: BrowserState) => void) => {
    const wrapped = (_event: unknown, payload: BrowserState): void => listener(payload)
    ipcRenderer.on('browser:state', wrapped)
    return () => {
      ipcRenderer.removeListener('browser:state', wrapped)
    }
  },
  onBrowserRequestShow: (listener: () => void) => {
    const wrapped = (): void => listener()
    ipcRenderer.on('browser:requestShow', wrapped)
    return () => {
      ipcRenderer.removeListener('browser:requestShow', wrapped)
    }
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url) as Promise<boolean>,
  quitApp: () => ipcRenderer.invoke('app:quit') as Promise<boolean>
}

export type GrokCodeApi = typeof api

contextBridge.exposeInMainWorld('grokcode', api)
