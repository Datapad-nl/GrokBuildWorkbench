import { contextBridge, ipcRenderer } from 'electron'
import type { ThemeFile, ThemeSummary } from '../shared/theme'
import type {
  ActivityFeed,
  ActivitySnapshot,
  ChatEvent,
  CreateProjectInput,
  IndexEvent,
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
    attachments?: Array<{ id: string; mimeType: string; data: string }>
  ) => ipcRenderer.invoke('chat:send', { chatId, content, attachments }),
  stopChat: (chatId: string) => ipcRenderer.invoke('chat:stop', chatId),
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
  }
}

export type GrokCodeApi = typeof api

contextBridge.exposeInMainWorld('grokcode', api)
