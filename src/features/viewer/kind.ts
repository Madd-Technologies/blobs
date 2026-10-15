/**
 * Which viewer a file opens in, and the files and server links a bot's reply points at. Pure: no React Native imports.
 */

export type ViewerKind = 'pdf' | 'image' | 'markdown' | 'html' | 'json' | 'code' | 'text' | 'other'

const BY_EXTENSION: Record<string, ViewerKind> = {
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  json: 'json',
  txt: 'text',
  log: 'text',
  csv: 'text',
  tsv: 'text',
  ...Object.fromEntries(
    ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'sh', 'bash', 'zsh', 'rs', 'go', 'java', 'kt', 'swift', 'rb', 'php', 'c', 'h', 'cpp', 'hpp', 'cs', 'css', 'scss', 'sql', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'xml', 'svg', 'diff', 'patch', 'lua', 'nix', 'dockerfile', 'service'].map(
      extension => [extension, 'code' as ViewerKind],
    ),
  ),
}

export const extensionOf = (path: string): string => /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''

export const fileName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/** The viewer for a file, from its extension, or its type when the server says (a `Content-Type` or `mimeType`). */
export function viewerKind(path: string, mime?: string | null): ViewerKind {
  const known = BY_EXTENSION[extensionOf(path)]

  if (known) {
    return known
  }

  const type = (mime ?? '').toLowerCase()

  if (type.includes('pdf')) {
    return 'pdf'
  }

  if (type.startsWith('image/')) {
    return 'image'
  }

  if (type.includes('html')) {
    return 'html'
  }

  if (type.includes('json')) {
    return 'json'
  }

  if (type.includes('markdown')) {
    return 'markdown'
  }

  return type.startsWith('text/') ? 'text' : 'other'
}

/** Files worth a tile under a reply: documents and code, not pictures (those are drawn in the chat already). */
const DOCUMENT_EXT = 'pdf|md|markdown|txt|log|csv|tsv|json|html?|ya?ml|toml|py|sh|ts|tsx|js|mjs|diff|patch|sql|conf|ini|xml'
/**
 * An absolute path to a document, written out in a reply (`/home/orion/reports/q3.pdf`): not part of a longer word or a URL, no
 * spaces, possibly in backticks, quotes or a link.
 */
const STATED_DOCUMENT = new RegExp(String.raw`(?<![\w:/.~-])(/(?:[^\s\`"'<>()\[\]{}*]+/)*[^\s\`"'<>()\[\]{}*/]+\.(?:${DOCUMENT_EXT}))(?![\w/-])`, 'gi')

/** The most document tiles drawn under one reply. */
const MAX_DOCUMENTS = 4

const FENCE = /^\s*(```|~~~)/

/** The text with fenced code blocks blanked out: a path in shown code is part of the code, not a file being shared. */
function outsideCode(text: string): string {
  let fenced = false

  return text
    .split('\n')
    .map(line => {
      const fence = FENCE.test(line)
      const blank = fenced || fence

      if (fence) {
        fenced = !fenced
      }

      return blank ? '' : line
    })
    .join('\n')
}

/** The documents a reply names by absolute path (outside code blocks), in order, each once. */
export function documentPaths(text: string): string[] {
  const found: string[] = []

  for (const match of outsideCode(text).matchAll(STATED_DOCUMENT)) {
    const path = match[1] as string

    if (!found.includes(path) && found.length < MAX_DOCUMENTS) {
      found.push(path)
    }
  }

  return found
}

export type ServerTarget = { kind: 'file'; path: string } | { kind: 'route'; href: string }

/**
 * Where a link in a reply points on the Hermes server, if anywhere: an absolute file path (`/home/orion/a.pdf`, or a `file://` URL)
 * is a file to view; a plugin route (`/api/plugins/<name>/...`) is something a server plugin serves, such as a Paperless document,
 * read with your sign-in. Anything else (a web address, another API path) is not opened in the viewer.
 */
export function serverTarget(href: string): ServerTarget | null {
  const link = href.trim()

  if (/^\/api\/plugins\/[A-Za-z0-9_-]+\/\S+$/.test(link)) {
    return { kind: 'route', href: link }
  }

  const path = link.startsWith('file://') ? decodeURIComponent(link.slice('file://'.length)) : link

  return /^\/(?!api\/)[^\n]*[^/\s]$/.test(path) && extensionOf(path) ? { kind: 'file', path } : null
}

const ROUTE_LINK = /\[([^\]\n]+)\]\((\/api\/plugins\/[A-Za-z0-9_-]+\/[^)\s]+)\)/g

/** Markdown links in a reply to something a server plugin serves (`[Voucher](/api/plugins/hermes-paperless/documents/15/preview)`). */
export function routeLinks(text: string): { label: string; href: string }[] {
  const found: { label: string; href: string }[] = []

  for (const match of text.matchAll(ROUTE_LINK)) {
    const [, label, href] = match as unknown as [string, string, string]

    if (!found.some(link => link.href === href) && found.length < MAX_DOCUMENTS) {
      found.push({ label: label.trim(), href })
    }
  }

  return found
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A reply's words without the file paths that are shown as chips under it. A line that only gives a path (with a short label such
 * as "PDF:" or "Saved to", a bullet, backticks) goes; a path inside a sentence becomes the file's name, so the sentence still reads.
 * Code blocks and link targets (`[receipt](/home/a.pdf)`) are left as they are.
 */
export function hidePaths(text: string, paths: string[]): string {
  if (!paths.length) {
    return text
  }

  const quote = '[`"\']?'
  const patterns = paths.map(path => ({ name: fileName(path), pattern: new RegExp(`(?<!\\]\\()${quote}${escapeRegExp(path)}${quote}`, 'g') }))
  const out: string[] = []
  let fenced = false
  let dropped = false

  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced
      out.push(line)
      continue
    }

    const hits = fenced ? [] : patterns.filter(({ pattern }) => line.search(pattern) >= 0)

    if (!hits.length) {
      out.push(line)
      continue
    }

    const rest = hits.reduce((left, { pattern }) => left.replace(pattern, ''), line)
    const label = rest
      .replace(/[`*_]/g, '')
      .replace(/^\s*[-*•]\s*/, '')
      .replace(/[\s.,;:–—-]+$/, '')
      .trim()

    // Only a label was left: the chip says it all.
    if (label.length <= 32 && !/[.!?]/.test(label)) {
      dropped = true
      continue
    }

    out.push(hits.reduce((kept, { pattern, name }) => kept.replace(pattern, name), line))
  }

  const shown = out.join('\n')

  return dropped ? shown.replace(/\n{3,}/g, '\n\n').trim() : shown
}
