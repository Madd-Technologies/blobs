/**
 * Slash commands from the phone: every command and skill the bot's server lists, ranked for typing. Hermes has well over
 * a hundred commands (and a skill per installed skill), so the picker narrows as you type. Pure: no React Native imports.
 */

import type { CommandDispatch, CommandsCatalog } from './protocol.ts'

export interface SlashOption {
  /** `/work`: what the picker shows and what goes in the box. */
  name: string
  /** One plain sentence: the server's text without its "(usage: …)" tail. */
  description: string
  /** The arguments it takes (`[level]`, `<prompt>`), from that tail; empty when it takes none. */
  hint: string
  /**
   * Hermes Desktop keeps this one out of its own list (it is for a terminal, a settings page or the messaging gateways). It is
   * still here and still runs, but is listed after the rest.
   */
  secondary: boolean
  kind: 'skill' | 'command'
  /**
   * How the server runs it. `exec`: a built-in command, which the server's own runner handles (and falls back to
   * `command.dispatch` for the few it hands over). `dispatch`: a skill, or the bot's own quick or plugin command, which only
   * `command.dispatch` knows.
   */
  run: 'exec' | 'dispatch'
  /** Times used, for ranking skills (more used first). */
  usage: number
}

/** `/name rest of the line`; null when the text is not shaped like a command (a path such as `/home/orion` is not one). */
export function parseSlash(text: string): { name: string; arg: string } | null {
  const match = /^\/([A-Za-z0-9][\w.:-]*)(?:\s+([\s\S]*))?$/.exec(text.trim())

  return match ? { name: match[1]!.toLowerCase(), arg: (match[2] ?? '').trim() } : null
}

/** Skill keys use hyphens; people type underscores too (the server maps them the same way). */
const key = (name: string) => name.toLowerCase().replace(/_/g, '-')

/** `Show things (usage: /thing [on|off])` -> the sentence and the `[on|off]`. */
export function splitUsage(text: string): { description: string; hint: string } {
  const match = /^([\s\S]*?)\s*\(usage:\s*\/\S+\s*([\s\S]*?)\)\s*$/.exec(text)

  return match ? { description: (match[1] ?? '').trim(), hint: (match[2] ?? '').trim() } : { description: text.trim(), hint: '' }
}

/** What a terminal prints for colour and cursor movement: never wanted in a chat. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g, '')
}

/**
 * Commands that do nothing useful from a phone chat, so the picker and `/help` leave them out. Typing one still runs it (or is
 * answered by the app, for `/clear` and `/quit`): this is only about what is offered.
 *
 * - the terminal's own screen and keys: redraw, statusbar, battery, timestamps, verbose, indicator, skin, footer, palette, copy, paste,
 *   image, prompt (opens $EDITOR), history (the chat is the history), clear and quit (the app has New chat and Back)
 * - the machine the terminal runs on: wake and voice (its microphone), browser (its Chromium), worktree, handoff, journey, pets
 * - Nous account pages and messaging platforms: login, subscription, topup, platforms
 * - profile and state archives written to files on the server: export, import, snapshot
 *
 * The TUI category (`/density`, `/logs`, `/mouse`) is left out as a whole.
 */
export const HIDDEN_COMMANDS: ReadonlySet<string> = new Set([
  'redraw', 'statusbar', 'sb', 'battery', 'timestamps', 'ts', 'verbose', 'indicator', 'skin', 'footer', 'palette', 'copy', 'paste', 'image', 'prompt', 'compose', 'history', 'clear', 'quit', 'exit',
  'wake', 'voice', 'browser', 'worktree', 'handoff', 'journey', 'pet', 'hatch', 'generate-pet',
  'login', 'subscription', 'topup', 'platforms',
  'export', 'import', 'snapshot', 'snap',
])

/** The commands the picker lists for this bot: every command the server offers, then its skills. */
export function slashOptions(catalog: CommandsCatalog): SlashOption[] {
  const options = new Map<string, SlashOption>()
  const skills = catalog.skills ?? {}
  const own = new Set<string>()

  for (const category of catalog.categories ?? []) {
    if (category.name === 'User commands' || category.name === 'Plugin commands') {
      category.pairs.forEach(([name]) => own.add(key(name.replace(/^\//, ''))))
    }
  }

  const skillIds = new Set(Object.keys(skills).map(name => key(name.replace(/^\//, ''))))
  const tui = new Set((catalog.categories ?? []).filter(category => category.name === 'TUI').flatMap(category => category.pairs.map(([name]) => key(name.replace(/^\//, '')))))

  // `pairs` lists the built-in commands, the bot's own, then the skills: the first two kinds in the order the server gives.
  for (const [name, description] of catalog.pairs ?? []) {
    const id = key(name.replace(/^\//, ''))

    if (options.has(id)) {
      continue
    }

    // Left out of the list: a command for the terminal or for the machine it runs on. The bot's own command or skill that shares
    // one of these names is not that command, so it stays.
    const isSkill = skillIds.has(id) && !catalog.canon?.[`/${id}`]

    if ((HIDDEN_COMMANDS.has(id) || tui.has(id)) && !own.has(id) && !isSkill) {
      continue
    }

    const { description: sentence, hint } = splitUsage(description)

    if (own.has(id)) {
      options.set(id, { name: `/${id}`, description: sentence, hint, secondary: false, kind: 'command', run: 'dispatch', usage: 0 })
    } else if (isSkill) {
      options.set(id, { name: `/${id}`, description: sentence, hint: '', secondary: false, kind: 'skill', run: 'dispatch', usage: skills[name]?.usage ?? skills[`/${id}`]?.usage ?? 0 })
    } else {
      options.set(id, { name: `/${id}`, description: sentence, hint, secondary: !!catalog.commands?.[`/${id}`]?.desktop, kind: 'command', run: 'exec', usage: 0 })
    }
  }

  // A skill the pairs left out (an older server) still counts.
  for (const [name, info] of Object.entries(skills)) {
    const id = key(name.replace(/^\//, ''))

    if (!options.has(id)) {
      options.set(id, { name: `/${id}`, description: 'Skill', hint: '', secondary: false, kind: 'skill', run: 'dispatch', usage: info.usage ?? 0 })
    }
  }

  return [...options.values()]
}

/** Scores a match: lower is better; null is no match. */
function score(option: SlashOption, query: string): number | null {
  const name = option.name.slice(1).toLowerCase()

  if (name === query) {
    return 0
  }

  if (name.startsWith(query)) {
    return 1
  }

  if (name.split('-').some(word => word.startsWith(query))) {
    return 2
  }

  if (name.includes(query)) {
    return 3
  }

  return option.description.toLowerCase().split(/[^a-z0-9]+/).some(word => word.startsWith(query)) ? 4 : null
}

/**
 * What the picker shows for what is typed after the slash. Nothing typed: the commands in the server's order, then skills by
 * use, then the commands that are for a terminal. Typing: names that start with it, then names with it in a word, then in the description; the more used first within each.
 */
export function rankOptions(options: SlashOption[], typed: string, limit = 300): SlashOption[] {
  const query = key(typed.replace(/^\//, '').trim())

  if (!query) {
    const commands = options.filter(option => option.kind === 'command' && !option.secondary)
    const skills = options.filter(option => option.kind === 'skill').sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name))
    const aside = options.filter(option => option.secondary)

    return [...commands, ...skills, ...aside].slice(0, limit)
  }

  return options
    .map(option => ({ option, rank: score(option, query) }))
    .filter((entry): entry is { option: SlashOption; rank: number } => entry.rank !== null)
    // Among equal matches the ones Desktop lists come first, then the more used.
    .sort((a, b) => a.rank - b.rank || Number(a.option.secondary) - Number(b.option.secondary) || b.option.usage - a.option.usage || a.option.name.localeCompare(b.option.name))
    .slice(0, limit)
    .map(entry => entry.option)
}

/** Whether the box holds just the command word, so the picker should be open: `/`, `/wo`, but not `/work fix`. */
export function pickerQuery(text: string): string | null {
  return /^\/[\w.:-]*$/.test(text) ? text.slice(1) : null
}

/**
 * Commands the app answers itself, because on a phone they are a screen rather than text (a new chat, the list of chats, leaving
 * the chat), or because it already holds the answer: `/help` lists what the catalog says, without waiting for the server's worker
 * process (which has up to 45 seconds to start). Everything else goes to the server.
 */
export type LocalSlash = 'new' | 'chats' | 'leave' | 'help'

const LOCAL: Record<string, LocalSlash> = { new: 'new', reset: 'new', clear: 'new', resume: 'chats', sessions: 'chats', quit: 'leave', exit: 'leave', help: 'help' }

export type SlashAction =
  /** Not a command: send it as a message. */
  | { kind: 'text' }
  /** A command to run on the server. `known` is false when the catalog has never heard of it (it may be a bundle). */
  | { kind: 'run'; name: string; arg: string; run: 'exec' | 'dispatch'; known: boolean }
  /** A command the app answers with one of its own screens. */
  | { kind: 'local'; name: string; arg: string; local: LocalSlash }

export function classify(text: string, options: SlashOption[], catalog: CommandsCatalog | undefined): SlashAction {
  const parsed = parseSlash(text)

  if (!parsed || !catalog) {
    return { kind: 'text' }
  }

  const id = key(parsed.name)
  const option = options.find(entry => entry.name === `/${id}`)
  // Aliases of a built-in resolve to it (`/q` is `/queue`, `/v` is `/version`).
  const canonical = catalog.canon?.[`/${id}`]?.slice(1) ?? (option?.kind === 'command' ? id : undefined)
  const local = LOCAL[canonical ?? id]

  // A skill, or a command of the bot's own, that shares one of these names is that command, not the app's screen.
  if (local && (!option || option.run === 'exec')) {
    return { kind: 'local', name: canonical ?? id, arg: parsed.arg, local }
  }

  if (option) {
    return { kind: 'run', name: id, arg: parsed.arg, run: option.run, known: true }
  }

  if (canonical) {
    return { kind: 'run', name: canonical, arg: parsed.arg, run: 'exec', known: true }
  }

  // Built-ins the picker does not list (the server hides a few, such as /approve) are still the server's to run.
  if (catalog.commands?.[`/${id}`]) {
    return { kind: 'run', name: id, arg: parsed.arg, run: 'exec', known: true }
  }

  return { kind: 'run', name: id, arg: parsed.arg, run: 'dispatch', known: false }
}

const isString = (value: unknown): value is string => typeof value === 'string'

/** A `command.dispatch` (or `slash.exec`) answer, checked; null when it is not one the app understands. */
export function dispatchOf(raw: unknown): CommandDispatch | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const value = raw as Record<string, unknown>
  const notice = isString(value.notice) && value.notice.trim() ? value.notice.trim() : undefined

  switch (value.type) {
    case 'exec':
    case 'plugin':
      return { type: value.type, output: isString(value.output) ? value.output : '' }

    case 'alias':
      return isString(value.target) && value.target ? { type: 'alias', target: value.target } : null

    case 'send':
    case 'skill':
      return isString(value.message)
        ? { type: value.type, message: value.message, ...(notice ? { notice } : {}), ...(isString(value.display) && value.display.trim() ? { display: value.display.trim() } : {}), ...(isString(value.name) ? { name: value.name } : {}) }
        : null

    case 'prefill':
      return isString(value.message) ? { type: 'prefill', message: value.message, ...(notice ? { notice } : {}) } : null

    default:
      return null
  }
}

/** Commands that change what the server remembers of the chat (they rewind or compact it), so the chat is read again after them. */
export const REWRITES_CHAT = new Set(['undo', 'retry', 'rollback', 'compress', 'compact'])

/**
 * `/help`: the commands the server offers, by category, names only so it reads as a short list rather than a wall; `/help skills`
 * lists the skills; `/help <word>` gives each command or skill that mentions the word, with its arguments and what it does.
 */
export function helpText(catalog: CommandsCatalog, arg = ''): string {
  const want = arg.trim().toLowerCase()
  const options = slashOptions(catalog)
  const describe = (option: SlashOption) => `${option.name}${option.hint ? ` ${option.hint}` : ''}\n    ${option.description}`

  if (want === 'skills') {
    const skills = options.filter(option => option.kind === 'skill').sort((a, b) => a.name.localeCompare(b.name))

    return skills.length ? [`Skills (${skills.length}):`, ...skills.map(option => `${option.name}  ${option.description}`)].join('\n') : 'No skills.'
  }

  if (want) {
    const word = key(want.replace(/^\//, ''))
    const found = options.filter(option => score(option, word) !== null).sort((a, b) => (score(a, word) ?? 9) - (score(b, word) ?? 9))

    return found.length ? found.slice(0, 40).map(describe).join('\n\n') : `Nothing mentions “${arg.trim()}”.`
  }

  const { groups, footer } = helpGroups(catalog)

  return [...groups.flatMap(group => [`${group.title}:`, group.names.join('  '), '']), footer].join('\n')
}

/** The base `/help`: the command names by category (for a wrapping layout), and the line that says where to find the rest. */
export function helpGroups(catalog: CommandsCatalog): { groups: { title: string; names: string[] }[]; footer: string } {
  const options = slashOptions(catalog)
  const mine = new Set(options.filter(option => option.kind === 'command').map(option => option.name))
  const groups = (catalog.categories ?? [])
    .map(category => ({ title: category.name, names: category.pairs.map(([name]) => `/${key(name.replace(/^\//, ''))}`).filter(name => mine.has(name)) }))
    .filter(group => group.names.length)
  const skillCount = options.filter(option => option.kind === 'skill').length

  return { groups, footer: `Type / and part of a name to see what each does. /help <word> searches, and /help skills lists the ${skillCount} skills.` }
}
