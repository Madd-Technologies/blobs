/**
 * A unified diff (what a bot's `patch` step returns as `diff`) as lines to draw: which file, what was removed and added, and the
 * line numbers on each side. Pure.
 */

export type DiffLine =
  | { kind: 'file'; text: string }
  | { kind: 'hunk'; text: string }
  | { kind: 'context' | 'add' | 'remove'; text: string; old?: number; new?: number }

/** The file a diff header names, without git's `a/` and `b/` prefixes; `/dev/null` (a file made or deleted) is not one. */
function headerPath(line: string): string | null {
  const path = line.slice(4).split('\t')[0]?.trim() ?? ''

  return !path || path === '/dev/null' ? null : path.replace(/^[ab]\//, '')
}

export function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let from: string | null = null

  for (const raw of diff.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')) {
    if (raw.startsWith('--- ')) {
      from = headerPath(raw)
      continue
    }

    if (raw.startsWith('+++ ')) {
      lines.push({ kind: 'file', text: headerPath(raw) ?? from ?? 'file' })
      continue
    }

    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)

    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      lines.push({ kind: 'hunk', text: hunk[3]?.trim() ?? '' })
      continue
    }

    if (raw.startsWith('\\')) {
      continue
    }

    if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw.slice(1), new: newLine++ })
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'remove', text: raw.slice(1), old: oldLine++ })
    } else if (raw.startsWith('diff ') || raw.startsWith('index ')) {
      continue
    } else {
      lines.push({ kind: 'context', text: raw.startsWith(' ') ? raw.slice(1) : raw, old: oldLine++, new: newLine++ })
    }
  }

  return lines
}

/** "+12 −3": how much a diff adds and removes. */
export function diffStat(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter(line => line.kind === 'add').length,
    removed: lines.filter(line => line.kind === 'remove').length,
  }
}
