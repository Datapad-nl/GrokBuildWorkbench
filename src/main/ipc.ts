import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename } from 'path'
import type { ChatEvent, CreateProjectInput, IndexEvent, UpdateProjectInput } from '../shared/types'
import { clearActivity, getActivitySnapshot, startActivityBridge } from './activity'
import { buildOrientation, collectIndexes, onIndexChange, queueIndex } from './codegraph'
import { appendUserMessage, isStreaming, streamAssistant, stopStream } from './grok'
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

  ipcMain.handle('workspace:get', async () => {
    const current = await snapshot()
    return { ...current, indexes: await collectIndexes(current.projects) }
  })

  ipcMain.handle('project:create', async (_event, input: CreateProjectInput) => {
    const name = input.name?.trim() || (input.path ? basename(input.path) : 'Untitled project')
    const project = await createProject(name, input.path ?? null)
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
      }
    ) => {
    if (isStreaming(input.chatId)) {
      throw new Error('This chat is already generating')
    }
    const chat = await appendUserMessage(input.chatId, input.content, input.attachments ?? [])
    const projects = await listProjects()
    const project = projects.find((item) => item.id === chat.projectId)

    void streamAssistant(chat, project, (text) => {
      emit({ type: 'delta', chatId: input.chatId, text })
    })
      .then((done) => {
        emit({ type: 'done', chatId: input.chatId, chat: done })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Grok request failed'
        emit({ type: 'error', chatId: input.chatId, error: message })
      })

    return chat
  })

  ipcMain.handle('chat:stop', async (_event, chatId: string) => {
    stopStream(chatId)
    return true
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
}
