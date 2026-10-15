/**
 * What a stored user message really says. Hermes stores the message the model saw: your words, then (after a
 * `--- Attached Context ---` line) the contents of every file you referenced and an `@image:` line per picture. The
 * chat shows your words and a chip per attachment, as Hermes Desktop does. Pure.
 */

import { kindOf, type AttachmentChip } from '../../lib/hermes/attachments.ts'

const ATTACHED_CONTEXT = /(?:^|\n)--- Attached Context ---\s*\n/
const CONTEXT_WARNINGS = /(?:^|\n)--- Context Warnings ---[\s\S]*$/
const REF_SOURCE = String.raw`@(file|folder|url|image|tool|terminal):(?:"[^"\n]+"|'[^'\n]+'|\`[^\`\n]+\`|\S+)`
const REF = new RegExp(REF_SOURCE, 'g')
/** What the server writes for a message sent with no words: "[User attached image: upload_1.png]". */
const HINT = /^\[User attached (image|PDF): (.+?)(?: \((\d+) page\(s\)\))?\]$/

const unquote = (value: string) => value.replace(/^(["'`])(.*)\1$/, '$2')
const basename = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

interface Ref {
  kind: string
  value: string
}

function refsIn(text: string): Ref[] {
  return Array.from(text.matchAll(REF), match => ({ kind: match[1] as string, value: unquote(match[0].slice(match[1]!.length + 2)) }))
}

function chipOf(ref: Ref): AttachmentChip | null {
  const name = basename(ref.value)

  if (ref.kind === 'image') {
    return { kind: 'image', name, path: ref.value }
  }

  if (ref.kind === 'file') {
    return { kind: kindOf(name), name, path: ref.value }
  }

  return null
}

export interface UserContent {
  /** Your words. */
  text: string
  chips: AttachmentChip[]
}

// ── skills ───────────────────────────────────────────────────────────────────────────────────────
// A `/skill` turn is stored expanded: a line announcing the skill, the whole skill, and your words at the end. Hermes
// writes these markers (`agent/skill_commands.py`) and the chat shows what you typed instead (`/work fix the leak`).

const SKILL_PREFIX = '[IMPORTANT: The user has invoked the '
const SKILL_NAME = /^\[IMPORTANT: The user has invoked the "([^"]*)"/
const SINGLE_MARKER = 'The full skill content is loaded below.]'
const SINGLE_INSTRUCTION = 'The user has provided the following instruction alongside the skill invocation: '
const RUNTIME_NOTE = '\n\n[Runtime note:'
const BUNDLE_MARKER = ' skill bundle,'
const BUNDLE_INSTRUCTION = '\nUser instruction: '
const BUNDLE_FIRST_BLOCK = '\n\n[Loaded as part of the '
/** Where a preview of a long message joins its head and its tail. */
const EXCERPT_JOINT = '\x1e'

/** The text after `marker` (found by `find`) up to `stop`, trimmed; null when absent or empty. */
function cutAfter(message: string, marker: string, stop: string, last: boolean): string | null {
  const at = last ? message.lastIndexOf(marker) : message.indexOf(marker)

  if (at < 0) {
    return null
  }

  return message.slice(at + marker.length).split(stop)[0]!.trim() || null
}

/** What you typed to start a skill turn: `/work fix the leak`, or `/work` alone. Null when the text is not a skill turn. */
export function skillInvocation(content: string): string | null {
  if (!content.startsWith(SKILL_PREFIX)) {
    return null
  }

  const name = (SKILL_NAME.exec(content)?.[1] ?? '').trim()
  // A bundle's header already carries what was typed ("/a /b"); a single skill is a bare name.
  const label = name.startsWith('/') ? name : `/${name}`
  const instruction = content.includes(BUNDLE_MARKER)
    ? cutAfter(content, BUNDLE_INSTRUCTION, BUNDLE_FIRST_BLOCK, false)
    : content.includes(SINGLE_MARKER)
      ? cutAfter(content, SINGLE_INSTRUCTION, RUNTIME_NOTE, true)
      : null
  const words = instruction ? instruction.split(EXCERPT_JOINT)[0]!.split(/\s+/).filter(Boolean).join(' ') : ''

  if (words) {
    return name ? `${label} ${words}` : words
  }

  return name ? label : null
}

export function splitUserContent(raw: string): UserContent {
  const invoked = skillInvocation(raw)

  if (invoked) {
    return { text: invoked, chips: [] }
  }

  const withoutWarnings = raw.replace(CONTEXT_WARNINGS, '')
  const marker = ATTACHED_CONTEXT.exec(withoutWarnings)
  const visible = marker ? withoutWarnings.slice(0, marker.index) : withoutWarnings
  const context = marker ? withoutWarnings.slice(marker.index + marker[0].length) : ''
  const refs: Ref[] = refsIn(context)
  const lines = visible.split('\n')
  // A picture sent with words is stored as the words, then a line `@image:/path` and a line `[screenshot]`, with no "Attached Context"
  // above them: the trailing lines that are only references (or that marker) are attachments, not words.
  const trailing: Ref[] = []

  while (lines.length) {
    const last = (lines.at(-1) as string).trim()

    if (!last || /^\[(?:screenshot|image|picture)\]$/i.test(last)) {
      lines.pop()
    } else if (!last.replace(REF, '').trim()) {
      trailing.unshift(...refsIn(last))
      lines.pop()
    } else {
      break
    }
  }

  refs.push(...trailing)

  const kept: string[] = []
  const pdfs: AttachmentChip[] = []
  let leading = true

  for (const line of lines) {
    const trimmed = line.trim()

    // The file references the app puts at the top of a message are chips, not words: a line of nothing else.
    if (leading && trimmed && !trimmed.replace(REF, '').trim()) {
      refs.push(...refsIn(trimmed))

      continue
    }

    leading = leading && !trimmed

    const hint = HINT.exec(trimmed)

    if (hint) {
      if (hint[1] === 'PDF') {
        pdfs.push({ kind: 'pdf', name: hint[2] as string })
      }

      continue
    }

    kept.push(line)
  }

  const seen = new Set<string>()
  const chips: AttachmentChip[] = [...pdfs]

  for (const ref of refs) {
    const key = `${ref.kind}:${ref.value}`
    const chip = chipOf(ref)

    // A PDF is shown once, by name; its rendered pages are an implementation detail.
    if (!chip || seen.has(key) || (pdfs.length && chip.kind === 'image' && /(^|[_-])pdf_p\d/i.test(chip.name))) {
      continue
    }

    seen.add(key)
    chips.push(chip)
  }

  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), chips }
}
