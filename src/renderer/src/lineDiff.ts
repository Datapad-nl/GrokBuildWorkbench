export type DiffCell = {
  text: string
  kind: 'same' | 'del' | 'add'
}

export type DiffRow = {
  left: DiffCell | null
  right: DiffCell | null
}

function linesOf(text: string): string[] {
  if (text === '') return []
  return text.split('\n')
}

export function sideBySideDiff(oldText: string, newText: string): DiffRow[] {
  const previous = linesOf(oldText)
  const next = linesOf(newText)
  const n = previous.length
  const m = next.length
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        previous[i] === next[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: Array<{ type: 'same' | 'del' | 'add'; text: string }> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (previous[i] === next[j]) {
      ops.push({ type: 'same', text: previous[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: previous[i] })
      i += 1
    } else {
      ops.push({ type: 'add', text: next[j] })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: previous[i] })
    i += 1
  }
  while (j < m) {
    ops.push({ type: 'add', text: next[j] })
    j += 1
  }

  const rows: DiffRow[] = []
  let index = 0
  while (index < ops.length) {
    const op = ops[index]
    if (op.type === 'same') {
      rows.push({
        left: { text: op.text, kind: 'same' },
        right: { text: op.text, kind: 'same' }
      })
      index += 1
      continue
    }
    const removed: string[] = []
    const added: string[] = []
    while (index < ops.length && ops[index].type === 'del') {
      removed.push(ops[index].text)
      index += 1
    }
    while (index < ops.length && ops[index].type === 'add') {
      added.push(ops[index].text)
      index += 1
    }
    const count = Math.max(removed.length, added.length)
    for (let row = 0; row < count; row++) {
      rows.push({
        left: removed[row] !== undefined ? { text: removed[row], kind: 'del' } : null,
        right: added[row] !== undefined ? { text: added[row], kind: 'add' } : null
      })
    }
  }
  return rows
}
