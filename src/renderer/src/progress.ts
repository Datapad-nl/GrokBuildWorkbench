import { useEffect, useState } from 'react'
import type { ActivityEvent } from '../../shared/types'

/** Quiet stretch before the first spoken progress line of a turn. */
export const PROGRESS_FIRST_MS = 8_000
/** Shortest gap between two spoken progress lines. */
export const PROGRESS_REPEAT_MS = 18_000
/** After the step changes, wait this long before speaking the new one. */
export const PROGRESS_STEP_MS = 6_000

export type ProgressNow = {
  label: string
  speech: string
  key: string
}

const IDLE: ProgressNow = {
  label: 'Still working',
  speech: 'I am still working on your request.',
  key: 'idle'
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, max - 1).trim()}…`
}

export function latestRunning(events: ActivityEvent[], chatId: string): ActivityEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.chatId !== chatId) continue
    if (event.kind === 'turn') continue
    if (event.status === 'running') return event
  }
  return null
}

export function progressNow(event: ActivityEvent | null): ProgressNow {
  if (!event) return IDLE
  if (event.kind === 'thought') {
    const bit = clip(event.detail ?? '', 140)
    return {
      label: bit ? `Thinking. ${bit}` : 'Thinking',
      speech: 'I am still thinking this through.',
      key: 'thought'
    }
  }
  if (event.kind === 'goal') {
    const label = clip(event.title?.trim() || 'Working on the goal', 160)
    return {
      label,
      speech: `I am still working. ${label}.`,
      key: `goal:${label}`
    }
  }
  if (event.kind === 'write') {
    return {
      label: 'Writing the reply',
      speech: 'I am writing the reply now.',
      key: 'write'
    }
  }
  if (event.kind === 'permission') {
    const label = clip(event.title?.trim() || 'Waiting for you', 160)
    return {
      label,
      speech: 'I am waiting for you to allow the next step.',
      key: `permission:${event.id}`
    }
  }
  if (event.kind === 'error') {
    const label = clip(event.title?.trim() || 'Something went wrong', 160)
    return {
      label,
      speech: 'Something went wrong.',
      key: `error:${event.id}`
    }
  }
  const title = clip(event.title?.trim() || 'Still working', 160)
  const idle = title.toLowerCase() === 'still working'
  return {
    label: title,
    speech: idle ? IDLE.speech : `I am still working. ${title}.`,
    key: `${event.coalesceKey ?? event.id}:${title}`
  }
}

export function shouldAnnounceProgress(input: {
  now: number
  replyAt: number
  announcedAt: number
  lastKey: string
  key: string
  speaking: boolean
  userBusy: boolean
}): boolean {
  if (input.speaking || input.userBusy) return false
  const sinceReply = input.now - input.replyAt
  const sinceAnnounce = input.now - input.announcedAt
  if (
    (input.key.startsWith('permission:') ||
      input.key.startsWith('error:') ||
      input.key.startsWith('goal:')) &&
    input.key !== input.lastKey
  ) {
    return true
  }
  if (input.key !== input.lastKey && sinceReply >= PROGRESS_STEP_MS && sinceAnnounce >= PROGRESS_STEP_MS) {
    return true
  }
  if (sinceReply >= PROGRESS_FIRST_MS && sinceAnnounce >= PROGRESS_REPEAT_MS) return true
  return false
}

export function useChatProgress(chatId: string | null, streaming: boolean): ProgressNow {
  const scope = chatId && streaming ? chatId : ''
  const [trackedScope, setTrackedScope] = useState(scope)
  const [now, setNow] = useState<ProgressNow>(IDLE)
  if (scope !== trackedScope) {
    setTrackedScope(scope)
    setNow(IDLE)
  }

  useEffect(() => {
    if (!chatId || !streaming) return
    let cancel = false
    let live = false
    void window.grokcode.getActivity().then((snapshot) => {
      if (cancel || live) return
      setNow(progressNow(latestRunning(snapshot.events, chatId)))
    })
    const off = window.grokcode.onActivityEvent((feed) => {
      if (feed.type === 'reset') {
        live = true
        setNow(progressNow(latestRunning(feed.events, chatId)))
        return
      }
      if (feed.event.chatId !== chatId || feed.event.kind === 'turn') return
      live = true
      setNow(progressNow(feed.event))
    })
    return () => {
      cancel = true
      off()
    }
  }, [chatId, streaming])

  return streaming ? now : IDLE
}
