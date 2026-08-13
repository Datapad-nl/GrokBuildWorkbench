import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename } from 'path'
import type {
  BrowserBounds,
  ChatEvent,
  CreateProjectInput,
  FileMention,
  IndexEvent,
  PermissionMode,
  UpdateProjectInput
} from '../shared/types'
import { normalizePermissionMode } from '../shared/types'
import {
  clearActivity,
  emitPermissionActivity,
  getActivitySnapshot,
  startActivityBridge
} from './activity'
import {
  clearBrowserData,
  getBrowserState,
  goBack,
  goForward,
  navigateBrowser,
  reloadBrowser,
  sanitizeUrl,
  setBrowserBounds,
  setBrowserVisible,
  stopBrowser
} from './browser'
import { buildOrientation, collectIndexes, onIndexChange, queueIndex } from './codegraph'
import { searchProjectFiles } from './files'
import { deleteAllCheckpoints } from './checkpoints'
import {
  appendUserMessage,
  isStreaming,
  onChatLive,
  rewindChat,
  setChatMode,
  streamAssistant,
  stopStream
} from './grok'
import {
  onPermissionDenied,
  onPermissionPrompt,
  onPermissionSettled,
  resolvePermission
} from './permissions'
import {
  createChat,
  createProject,
  deleteChat,
  deleteProject,
  getChat,
  listProjects,
  renameChat,
  snapshot,
  updateProject,
  updateSettings
} from './store'
import {
  activateTheme,
  deleteUserTheme,
  exportThemeFile,
  getThemeState,
  importThemeFile,
  saveUserTheme
} from './themes'

function emit(event: ChatEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('chat:event', event)
  }
}

function emitIndex(event: IndexEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('index:event', event)
  }
}

export function registerIpc(): void {
  startActivityBridge()
  onIndexChange((index) => {
    emitIndex({ type: 'status', projectId: index.projectId, index })
  })
  onChatLive((event) => emit(event))
  onPermissionPrompt((request) => {
    emit({ type: 'permission', chatId: request.chatId, request })
    emitPermissionActivity({
      chatId: request.chatId,
      sessionId: null,
      title: request.title,
      detail: request.detail,
      status: 'running',
      requestId: request.requestId
    })
  })
  onPermissionSettled((request) => {
    emit({ type: 'permission-clear', chatId: request.chatId, requestId: request.requestId })
    emitPermissionActivity({
      chatId: request.chatId,
      sessionId: null,
      title: request.title,
      detail: request.detail,
      status: 'done',
      requestId: request.requestId
    })
  })
  onPermissionDenied((request) => {
    emitPermissionActivity({
      chatId: request.chatId,
      sessionId: null,
      title: request.title,
      detail: request.detail,
      status: 'done',
      requestId: request.requestId
    })
  })

  ipcMain.handle('workspace:get', async () => {
    const current = await snapshot()
    return { ...current, indexes: await collectIndexes(current.projects) }
  })

  ipcMain.handle('project:create', async (_event, input: CreateProjectInput) => {
    const name = input.name?.trim() || (input.path ? basename(input.path) : 'Untitled project')
    const project = await createProject(name, input.path ?? null, input.color)
    const chat = await createChat(project.id)
    return { project, chat }
  })

  ipcMain.handle('project:update', async (_event, input: UpdateProjectInput) => {
    return updateProject(input)
  })

  ipcMain.handle('project:delete', async (_event, projectId: string) => {
    await deleteProject(projectId)
    return snapshot()
  })

  ipcMain.handle('project:index', async (_event, projectId: string) => {
    const projects = await listProjects()
    const project = projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Project not found')
    if (!project.path) throw new Error('Attach a folder before indexing')
    queueIndex(project.id, project.path)
    return true
  })

  ipcMain.handle('project:orientation', async (_event, projectId: string) => {
    const projects = await listProjects()
    const project = projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Project not found')
    return buildOrientation(project)
  })

  ipcMain.handle('project:searchFiles', async (_event, input: { projectId: string; query: string }) => {
    return searchProjectFiles(input.projectId, String(input.query ?? ''))
  })

  ipcMain.handle('project:pickFolder', async () => {
    const window = BrowserWindow.getFocusedWindow()
    const options = {
      title: 'Choose project folder',
      properties: ['openDirectory' as const]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('chat:create', async (_event, projectId: string) => {
    return createChat(projectId)
  })

  ipcMain.handle('chat:get', async (_event, chatId: string) => {
    return getChat(chatId)
  })

  ipcMain.handle('chat:delete', async (_event, chatId: string) => {
    stopStream(chatId)
    const chat = await getChat(chatId).catch(() => null)
    const projects = await listProjects()
    const project = chat ? projects.find((item) => item.id === chat.projectId) : null
    await deleteAllCheckpoints(chatId, project?.path ?? null)
    await deleteChat(chatId)
    return snapshot()
  })

  ipcMain.handle('chat:rename', async (_event, input: { id: string; title: string }) => {
    return renameChat(input.id, input.title)
  })

  ipcMain.handle(
    'chat:send',
    async (
      _event,
      input: {
        chatId: string
        content: string
        attachments?: Array<{ id: string; mimeType: string; data: string }>
        mentions?: FileMention[]
      }
    ) => {
    if (isStreaming(input.chatId)) {
      stopStream(input.chatId)
    }
    const chat = await appendUserMessage(
      input.chatId,
      input.content,
      input.attachments ?? [],
      input.mentions ?? []
    )
    const projects = await listProjects()
    const project = projects.find((item) => item.id === chat.projectId)

    void streamAssistant(chat, project, (text) => {
      emit({ type: 'delta', chatId: input.chatId, text })
    })
      .then((done) => {
        if (!done) return
        emit({ type: 'done', chatId: input.chatId, chat: done })
      })
      .catch((error: unknown) => {
        if (!isStreaming(input.chatId)) {
          const message = error instanceof Error ? error.message : 'Grok request failed'
          emit({ type: 'error', chatId: input.chatId, error: message })
        }
      })

    return chat
  })

  ipcMain.handle('chat:stop', async (_event, chatId: string) => {
    stopStream(chatId)
    return true
  })

  ipcMain.handle('chat:setMode', async (_event, input: { chatId: string; mode: PermissionMode }) => {
    return setChatMode(input.chatId, normalizePermissionMode(input.mode))
  })

  ipcMain.handle(
    'chat:resolvePermission',
    async (_event, input: { requestId: string; decision: 'allow' | 'deny' }) => {
      const decision = input.decision === 'deny' ? 'deny' : 'allow'
      return resolvePermission(input.requestId, decision)
    }
  )

  ipcMain.handle('chat:rewind', async (_event, input: { chatId: string; checkpointId: string }) => {
    const chat = await getChat(input.chatId)
    const projects = await listProjects()
    const project = projects.find((item) => item.id === chat.projectId)
    return rewindChat(input.chatId, input.checkpointId, project?.path ?? null)
  })

  ipcMain.handle('settings:get', async () => {
    const { settings } = await snapshot()
    return settings
  })

  ipcMain.handle('settings:set', async (_event, input: { apiKey?: string; model?: string }) => {
    return updateSettings(input)
  })

  ipcMain.handle('theme:state', async () => {
    return getThemeState()
  })

  ipcMain.handle('theme:activate', async (_event, id: string) => {
    return activateTheme(id)
  })

  ipcMain.handle('theme:save', async (_event, theme: unknown) => {
    return saveUserTheme(theme)
  })

  ipcMain.handle('theme:delete', async (_event, id: string) => {
    return deleteUserTheme(id)
  })

  ipcMain.handle('theme:import', async () => {
    return importThemeFile()
  })

  ipcMain.handle('theme:export', async (_event, id: string) => {
    return exportThemeFile(id)
  })

  ipcMain.handle('activity:get', async () => {
    return getActivitySnapshot()
  })

  ipcMain.handle('activity:clear', async () => {
    return clearActivity()
  })

  ipcMain.handle('browser:getState', () => getBrowserState())
  ipcMain.handle('browser:setVisible', (_event, next: boolean) => setBrowserVisible(Boolean(next)))
  ipcMain.handle('browser:setBounds', (_event, bounds: BrowserBounds) => setBrowserBounds(bounds))
  ipcMain.handle('browser:navigate', (_event, url: string) => navigateBrowser(String(url ?? '')))
  ipcMain.handle('browser:back', () => goBack())
  ipcMain.handle('browser:forward', () => goForward())
  ipcMain.handle('browser:reload', () => reloadBrowser())
  ipcMain.handle('browser:stop', () => stopBrowser())
  ipcMain.handle('browser:clearData', () => clearBrowserData())

  ipcMain.handle('app:quit', () => {
    app.quit()
    return true
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    const clean = sanitizeUrl(String(url ?? ''))
    if (!clean) return false
    await shell.openExternal(clean)
    return true
  })
}
