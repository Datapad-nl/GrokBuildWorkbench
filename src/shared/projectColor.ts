export const PROJECT_COLORS = [
  '#7C9CFF',
  '#F472B6',
  '#34D399',
  '#FBBF24',
  '#A78BFA',
  '#38BDF8',
  '#FB7185',
  '#F97316',
  '#22D3EE',
  '#A3E635'
] as const

const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/

export function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null
  const hex = value.trim()
  if (!HEX.test(hex)) return null
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toUpperCase()
  }
  return hex.toUpperCase()
}

function hashIndex(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return hash % PROJECT_COLORS.length
}

export function resolveProjectColor(project: { id: string; color?: string | null }): string {
  return normalizeHexColor(project.color) ?? PROJECT_COLORS[hashIndex(project.id)]
}

export function pickProjectColor(taken: Array<string | null | undefined>): string {
  const used = new Set(
    taken.map((color) => normalizeHexColor(color)).filter((color): color is string => Boolean(color))
  )
  return PROJECT_COLORS.find((color) => !used.has(color)) ?? PROJECT_COLORS[used.size % PROJECT_COLORS.length]
}
