import { existsSync, realpathSync, statSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, normalize, sep } from 'path'
import { fileURLToPath } from 'url'
import { mediaExtension } from '../shared/media'

function inside(root: string, target: string): boolean {
  const base = root.endsWith(sep) ? root : root + sep
  return target === root || target.startsWith(base)
}

function real(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function candidatesFor(roots: string[], src: string): string[] {
  if (src.startsWith('file:')) {
    try {
      return [fileURLToPath(src)]
    } catch {
      return []
    }
  }
  if (src === '~' || src.startsWith('~/')) {
    return [join(homedir(), src.slice(2))]
  }
  if (isAbsolute(src)) return [src]
  const rel = src.replace(/^\.\//, '')
  return roots.map((root) => join(root, rel))
}

export function resolveMediaFile(roots: string[], rawSrc: string): string | null {
  const src = rawSrc.trim()
  if (!src || src.length > 4096 || /^(https?:|data:|blob:)/i.test(src)) return null
  const realRoots = roots.map((root) => real(root)).filter((root): root is string => Boolean(root))
  if (realRoots.length === 0) return null
  for (const candidate of candidatesFor(realRoots, src)) {
    const normalized = normalize(candidate)
    if (!existsSync(normalized)) continue
    try {
      if (!statSync(normalized).isFile()) continue
    } catch {
      continue
    }
    const target = real(normalized)
    if (!target || !mediaExtension(target)) continue
    if (!realRoots.some((root) => inside(root, target))) continue
    return target
  }
  return null
}
