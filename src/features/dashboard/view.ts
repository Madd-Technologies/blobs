/**
 * How a bot's dashboard reads: values formatted by their field type, a record's history in words, the next status stage,
 * numbers against the last period, and which routines keep a dashboard. Pure: no React Native imports.
 */

import { describeSchedule, jobState, type CronJob } from '../../lib/hermes/cron.ts'
import type { Field, FieldType, HistoryEntry, RecordDetail, Typed, ValueUnit, View } from '../../lib/hermes/dashboard.ts'

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function clock(date: Date): string {
  const hours = date.getHours() % 12 || 12

  return `${hours}:${pad(date.getMinutes())} ${date.getHours() < 12 ? 'AM' : 'PM'}`
}

/** Whole days from `from`'s calendar day to `to`'s, in local time. */
function daysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()

  return Math.round((end - start) / 86_400_000)
}

/** "9:14 AM" today, "Yesterday", "Mon" this week, "Oct 3" before that; a time ahead reads "Fri 9 AM" style via dueLabel. */
export function timeLabel(atS: number, nowS: number): string {
  const at = new Date(atS * 1000)
  const ago = daysBetween(at, new Date(nowS * 1000))

  if (ago < 0) {
    return ago === -1 ? `Tomorrow ${clock(at)}` : `${DAYS[at.getDay()]} ${clock(at)}`
  }

  if (ago === 0) {
    return clock(at)
  }

  if (ago === 1) {
    return 'Yesterday'
  }

  return ago < 7 ? (DAYS[at.getDay()] as string) : `${MONTHS[at.getMonth()]} ${at.getDate()}`
}

/** A date (`YYYY-MM-DD`): "Today", "Tomorrow", "Yesterday", "Fri" within a week either way, "Oct 31" further out. */
export function dateLabel(value: string, nowS: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)

  if (!match) {
    return value
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const ahead = daysBetween(new Date(nowS * 1000), date)

  if (ahead === 0) {
    return 'Today'
  }

  if (ahead === 1) {
    return 'Tomorrow'
  }

  if (ahead === -1) {
    return 'Yesterday'
  }

  return Math.abs(ahead) < 7 ? (DAYS[date.getDay()] as string) : `${MONTHS[date.getMonth()]} ${date.getDate()}`
}

/** Bot-written text with a plain date in it ("Due 2026-11-15") reads the way a date field does on a row ("Due Nov 15"). */
export function friendlyDates(text: string, nowS: number): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b(?![T:\d])/g, date => dateLabel(date, nowS))
}

/** A value on a dashboard row: formatted by type, with plain dates in written text read as dates. */
export function rowText(typed: Pick<Typed, 'type' | 'value' | 'currency'>, nowS: number): string {
  const text = formatTyped(typed, nowS)

  return typed.type === 'text' || typed.type === 'choice' || typed.type === 'status' ? friendlyDates(text, nowS) : text
}

/** The record screen's fuller dates: "Fri, Oct 16" for a date, "Today, 8:12 AM" or "Oct 2, 9:00 AM" for a time. */
export function longLabel(typed: Pick<Typed, 'type' | 'value'>, nowS: number): string {
  const now = new Date(nowS * 1000)
  const word = (date: Date) => {
    const ahead = daysBetween(now, date)

    return ahead === 0 ? 'Today' : ahead === 1 ? 'Tomorrow' : ahead === -1 ? 'Yesterday' : Math.abs(ahead) < 7 ? (DAYS[date.getDay()] as string) : null
  }

  if (typed.type === 'datetime') {
    const at = new Date(Number(typed.value) * 1000)

    return `${word(at) ?? `${MONTHS[at.getMonth()]} ${at.getDate()}`}, ${clock(at)}`
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(typed.value))

  if (typed.type !== 'date' || !match) {
    return formatTyped(typed, nowS)
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))

  return `${word(date) ?? DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`
}

/** A date without relative words, for a quick pick's note beside "Tomorrow": "Wed, Oct 14", or "Oct 14, 9:00 AM" with a time. */
export function calendarLabel(typed: Pick<Typed, 'type' | 'value'>): string {
  if (typed.type === 'datetime') {
    const at = new Date(Number(typed.value) * 1000)

    return `${MONTHS[at.getMonth()]} ${at.getDate()}, ${clock(at)}`
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(typed.value))
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null

  return date ? `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}` : String(typed.value)
}

/** Whether a date is before today (an overdue "reply by"). */
export function isPast(value: string, nowS: number): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)

  return !!match && daysBetween(new Date(nowS * 1000), new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) < 0
}

const CURRENCY: Record<string, string> = { USD: '$', CAD: '$', AUD: '$', EUR: '€', GBP: '£', JPY: '¥' }

function plain(number: number): string {
  return Number.isInteger(number) ? number.toLocaleString('en-US') : number.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** A value as words, by its field type. */
export function formatTyped(typed: Pick<Typed, 'type' | 'value' | 'currency'>, nowS: number): string {
  const { type, value } = typed

  switch (type) {
    case 'date':
      return dateLabel(String(value), nowS)
    case 'datetime':
      return timeLabel(Number(value), nowS)
    case 'money': {
      const symbol = CURRENCY[typed.currency ?? 'USD']
      const amount = Number(value).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2, maximumFractionDigits: 2 })

      return symbol ? `${symbol}${amount}` : `${amount} ${typed.currency}`
    }
    case 'percent':
      return `${plain(Number(value))}%`
    case 'number':
      return plain(Number(value))
    case 'checkbox':
      return value ? 'Yes' : 'No'
    case 'rating':
      return `${value} of 5`
    case 'url':
      return /^https:\/\/([^/]+)/.exec(String(value))?.[1]?.replace(/^www\./, '') ?? String(value)
    case 'link':
      return String(value).split('/').filter(Boolean).at(-1) ?? String(value)
    default:
      return String(value)
  }
}

/** What tapping a value does: call, mail, open a page, or open the server file in the viewer. */
export function actionFor(typed: Pick<Typed, 'type' | 'value'>): { kind: 'tel' | 'mailto' | 'web' | 'viewer'; url: string; label: string } | null {
  const value = String(typed.value)

  switch (typed.type) {
    case 'phone':
      return { kind: 'tel', url: `tel:${value.replace(/[^\d+]/g, '')}`, label: 'Call' }
    case 'email':
      return { kind: 'mailto', url: `mailto:${value}`, label: 'Email' }
    case 'url':
      return value.startsWith('https://') ? { kind: 'web', url: value, label: 'Open' } : null
    case 'link':
      return value.startsWith('https://') ? { kind: 'web', url: value, label: 'Open' } : { kind: 'viewer', url: value, label: 'Open' }
    default:
      return null
  }
}

/** The stage after this one, for the record's one white pill ("Mark replied"). Null at the last stage. */
export function nextStage(field: Field | undefined, current: unknown): string | null {
  const stages = field?.stages ?? []
  const index = stages.findIndex(stage => stage.name === current)

  return index >= 0 && index < stages.length - 1 ? (stages[index + 1]?.name ?? null) : null
}

/** A field's value with its type, or null when it is empty. */
export function typedOf(field: Field, value: unknown): Pick<Typed, 'type' | 'value' | 'currency'> | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  return { type: field.type, value: value as Typed['value'], currency: field.currency }
}

/** How the record screen heads a record: its title, the meta line ("Reply by 11:00 AM"), the body, and whether it needs you. */
export function recordHeading(detail: RecordDetail): { title: string; meta: string; body: string; needsYou: boolean; shown: string[] } {
  const { record, collection, show } = detail
  const byKey = new Map(collection.fields.map(field => [field.key, field]))
  const typed = (key: string | null | undefined) => {
    const field = key ? byKey.get(key) : undefined

    return field ? typedOf(field, record.values[field.key]) : null
  }

  const titleKey = show?.title ?? collection.fields.find(field => field.type === 'text' && !field.retired)?.key
  const title = typed(titleKey)
  const metaField = show?.meta ? byKey.get(show.meta) : undefined
  const meta = typed(show?.meta)
  const body = show?.body ? record.values[show.body] : null

  return {
    title: title ? formatTyped(title, detail.now) : 'Untitled',
    meta: meta && metaField ? `${metaField.label} ${formatTyped(meta, detail.now)}` : '',
    body: typeof body === 'string' ? body : '',
    needsYou: !!show?.needs_you && !record.closed_at,
    // Shown in the heading, so left out of the field list below it.
    shown: [titleKey, show?.body].filter((key): key is string => !!key),
  }
}

/** The record's filled drafts, in field order, with who each is for ("Draft reply · to Sam Lee"). */
export function recordDrafts(detail: RecordDetail): { field: Field; text: string; heading: string }[] {
  const { record, collection } = detail

  return collection.fields
    .filter(field => field.type === 'draft' && !field.retired && typeof record.values[field.key] === 'string' && String(record.values[field.key]).trim())
    .map(field => {
      const to = field.to ? record.values[field.to] : null

      return { field, text: String(record.values[field.key]), heading: to ? `${field.label} · to ${String(to)}` : field.label }
    })
}

const GOOGLE_FILE: [RegExp, string, string][] = [
  [/^https:\/\/docs\.google\.com\/document\//i, 'Google Doc', 'opens in Docs'],
  [/^https:\/\/docs\.google\.com\/spreadsheets\//i, 'Google Sheet', 'opens in Sheets'],
  [/^https:\/\/docs\.google\.com\/presentation\//i, 'Google Slides', 'opens in Slides'],
  [/^https:\/\/docs\.google\.com\/forms\//i, 'Google Form', 'opens in Forms'],
  [/^https:\/\/(drive|docs|sheets|slides)\.google\.com\//i, 'Drive file', 'opens in Drive'],
]

/**
 * A document a record links to, as its file card says it: what it is, and whether it opens in Google's apps or the browser (`web`)
 * or in the app's viewer. Every `link` field is a document; a `url` field only when it is a Google file. Null for anything else,
 * which stays an ordinary field row.
 */
export function fileCard(type: Field['type'], value: unknown): { kind: string; where: string; opens: 'web' | 'viewer' } | null {
  const text = typeof value === 'string' ? value.trim() : ''

  if (!text || (type !== 'link' && type !== 'url')) {
    return null
  }

  const google = GOOGLE_FILE.find(([pattern]) => pattern.test(text))

  if (google) {
    return { kind: google[1], where: google[2], opens: 'web' }
  }

  if (type !== 'link') {
    return null
  }

  if (text.startsWith('/api/plugins/')) {
    const kind = text.startsWith('/api/plugins/hermes-drive/') ? 'Drive file' : text.startsWith('/api/plugins/hermes-paperless/') ? 'Paperless document' : 'Document'

    return { kind, where: 'opens here', opens: 'viewer' }
  }

  if (text.startsWith('/') || text.startsWith('file:///')) {
    return { kind: text.split('/').filter(Boolean).at(-1) ?? 'File', where: 'opens here', opens: 'viewer' }
  }

  const host = /^https:\/\/([^/]+)/.exec(text)?.[1]?.replace(/^www\./, '')

  return host ? { kind: host, where: 'opens in the browser', opens: 'web' } : null
}

/** "Until I unmute": the plugin's mute that never lifts by itself (year 3000). */
export const MUTE_FOREVER = 32_503_680_000

/** When a mute lifts, in words: "6:00 PM" today, "tomorrow 9:00 AM", "Mon 9:00 AM" this week, "Oct 20, 9:00 AM" further out. */
export function untilLabel(untilS: number, nowS: number): string {
  if (untilS >= MUTE_FOREVER) {
    return 'you unmute'
  }

  const at = new Date(untilS * 1000)
  const ahead = daysBetween(new Date(nowS * 1000), at)

  if (ahead <= 0) {
    return clock(at)
  }

  if (ahead === 1) {
    return `tomorrow ${clock(at)}`
  }

  return ahead < 7 ? `${DAYS[at.getDay()]} ${clock(at)}` : `${MONTHS[at.getMonth()]} ${at.getDate()}, ${clock(at)}`
}

/** A muted row's short note beside its bell: the time today, "Tomorrow", the weekday, a date, or nothing for "until I unmute". */
export function mutedShort(untilS: number, nowS: number): string {
  if (untilS >= MUTE_FOREVER) {
    return ''
  }

  const at = new Date(untilS * 1000)
  const ahead = daysBetween(new Date(nowS * 1000), at)

  return ahead <= 0 ? clock(at) : ahead === 1 ? 'Tomorrow' : ahead < 7 ? (DAYS[at.getDay()] as string) : `${MONTHS[at.getMonth()]} ${at.getDate()}`
}

/** The mute sheet's timeframes. "This evening" is left out once the evening has begun. */
export function mutePicks(nowS: number): { label: string; until: number; note: string }[] {
  const now = new Date(nowS * 1000)
  const at = (days: number, hour: number) => Math.round(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0).getTime() / 1000)
  const toMonday = ((8 - now.getDay()) % 7) || 7
  const hour = Math.round(nowS / 60) * 60 + 3600
  const picks = [{ label: 'In 1 hour', until: hour, note: untilLabel(hour, nowS) }]

  if (now.getHours() < 17) {
    picks.push({ label: 'This evening', until: at(0, 18), note: untilLabel(at(0, 18), nowS) })
  }

  picks.push(
    { label: 'Tomorrow morning', until: at(1, 9), note: `${DAYS[new Date(at(1, 9) * 1000).getDay()]} ${clock(new Date(at(1, 9) * 1000))}` },
    { label: 'Next week', until: at(toMonday, 9), note: untilLabel(at(toMonday, 9), nowS) },
    { label: 'Until I unmute', until: MUTE_FOREVER, note: '' },
  )

  return picks
}

/** A local calendar day as the server stores dates (YYYY-MM-DD). */
export function dateValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The date sheet's quick picks: today, tomorrow, and next Monday. */
export function datePicks(nowS: number): { label: string; value: string }[] {
  const today = new Date(nowS * 1000)
  const day = (offset: number) => dateValue(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset))
  const toMonday = ((8 - today.getDay()) % 7) || 7

  return [
    { label: 'Today', value: day(0) },
    { label: 'Tomorrow', value: day(1) },
    { label: 'Next week', value: day(toMonday) },
  ]
}

/** What you typed into a field's sheet, as the value it stores; the server checks the rest by type. */
export function parseDraft(field: Field, text: string): { value: string | number | null } | { error: string } {
  const trimmed = text.trim()

  if (!trimmed) {
    return field.required ? { error: `${field.label} can’t be empty.` } : { value: null }
  }

  if (field.type === 'number' || field.type === 'money' || field.type === 'percent') {
    const number = Number(trimmed.replace(/[\s,$€£¥%]/g, ''))

    return Number.isFinite(number) ? { value: number } : { error: 'That isn’t a number.' }
  }

  if (field.type === 'url' && !/^https:\/\//i.test(trimmed)) {
    return { error: 'Links start with https://' }
  }

  return { value: trimmed }
}

/** An amount (money) or a share (percent) reads like its cell; counts and other sums stay plain. */
const unitOf = (unit: ValueUnit | undefined) => (unit?.type === 'money' || unit?.type === 'percent' ? unit : undefined)

/** A number panel's figure: "1,240", "$1,240", "96%", or "–" when there is nothing to add up. */
export function figure(value: number | null | undefined, unit?: ValueUnit): string {
  if (value === null || value === undefined) {
    return '–'
  }

  const typed = unitOf(unit)

  return typed ? formatTyped({ type: typed.type, value, currency: typed.currency }, 0) : plain(value)
}

/** "3 more" / "2 fewer" / "$40 less" / "same as last week" against the previous period. */
export function changeLine(value: number | null, previous: number | null | undefined, period?: string, unit?: ValueUnit): string {
  if (value === null || previous === null || previous === undefined) {
    return ''
  }

  const difference = Math.round((value - previous) * 100) / 100

  if (difference === 0) {
    return `same as last ${period ?? 'time'}`
  }

  // Money and shares aren't counted things: "$40 less", not "$40 fewer".
  const fewer = unitOf(unit) ? 'less' : 'fewer'

  return difference > 0 ? `${figure(difference, unit)} more` : `${figure(-difference, unit)} ${fewer}`
}

/** Consecutive number panels share one block on the dashboard, two tiles to a row, up to four (two rows of two). */
export function groupNumbers(views: View[]): (View | View[])[] {
  const grouped: (View | View[])[] = []

  for (const view of views) {
    const last = grouped.at(-1)

    if (view.kind === 'number' && Array.isArray(last) && last.length < 4) {
      last.push(view)
    } else {
      grouped.push(view.kind === 'number' ? [view] : view)
    }
  }

  return grouped
}

/** Cell types a phone row reads as its figure, on the right. */
const FIGURE_TYPES: readonly FieldType[] = ['money', 'number', 'percent']
/** Cell types a phone row leaves out: they don't fit on one line (the record shows them). */
const LONG_TYPES: readonly FieldType[] = ['list', 'entries', 'files', 'draft', 'longtext']
/** Cell types whose value doesn't explain itself, so the row says its column's name first ("Due Tue", "Limit $10,000"). */
const NAMED_TYPES: readonly FieldType[] = ['number', 'money', 'percent', 'date', 'datetime', 'rating']

/**
 * A table's row the way a phone draws it on the dashboard, instead of columns cut off at the screen's edge: the first cell is
 * the title, the first amount after it is the figure on the right, and the other cells make one quiet line
 * ("Interest seen · Due Tue"). A ticked box reads as its column's name and an unticked or empty cell says nothing.
 */
export function tableRowWords(columns: readonly { label: string; type: FieldType }[], cells: readonly (Typed | null)[], nowS: number): { title: string; figure: string; line: string } {
  const figureAt = columns.findIndex((column, index) => index > 0 && FIGURE_TYPES.includes(column.type) && cells[index] !== null && cells[index] !== undefined)
  const words: string[] = []

  cells.forEach((cell, index) => {
    const column = columns[index]

    if (index === 0 || index === figureAt || !cell || !column || LONG_TYPES.includes(cell.type) || cell.value === '') {
      return
    }

    if (cell.type === 'checkbox') {
      if (cell.value) {
        words.push(column.label)
      }

      return
    }

    const value = rowText(cell, nowS)

    words.push(NAMED_TYPES.includes(cell.type) && column.label ? `${column.label} ${value}` : value)
  })

  return {
    title: cells[0] ? rowText(cells[0], nowS) : 'Untitled',
    figure: figureAt > 0 && cells[figureAt] ? formatTyped(cells[figureAt], nowS) : '',
    line: words.join(' · '),
  }
}

/** A chart's first and last labels: "Aug 24" … "This week". */
export function chartEnds(points: { start: string }[], bucket: 'day' | 'week' | 'month'): [string, string] {
  const first = points[0]?.start

  if (!first) {
    return ['', '']
  }

  const [, month, day] = first.split('-').map(Number)
  const label = bucket === 'month' ? (MONTHS[(month ?? 1) - 1] as string) : `${MONTHS[(month ?? 1) - 1]} ${day}`

  return [label, bucket === 'day' ? 'Today' : `This ${bucket}`]
}

/** "Updated 8:02 AM": from the newest view. Empty when there are none. */
export function updatedLine(views: View[], nowS: number): string {
  const newest = Math.max(0, ...views.map(view => view.updated || 0))

  if (!newest) {
    return ''
  }

  const label = timeLabel(newest, nowS)

  return `Updated ${label === 'Yesterday' ? 'yesterday' : label}`
}

/** One entry of a record's history in words: who, and what. */
export function historyLine(entry: HistoryEntry, fields: Field[], botName: (profile: string) => string): { who: string; text: string; note: boolean } {
  const who = entry.by_kind === 'person' ? 'You' : botName(entry.by)
  const field = fields.find(candidate => candidate.key === entry.field)

  switch (entry.field) {
    case '_created':
      return { who, text: `${who} added this`, note: false }
    case '_note':
      return { who, text: String(entry.new ?? ''), note: true }
    case '_closed':
      return { who, text: `${who} marked it done`, note: false }
    case '_reopened':
      return { who, text: `${who} opened it again`, note: false }
    case '_action':
      return { who, text: `${who} pressed ${String(entry.new ?? 'a button')}`, note: false }
    case '_muted':
      return { who, text: typeof entry.new === 'number' ? `${who} muted it until ${untilLabel(entry.new, entry.at)}` : `${who} unmuted it`, note: false }
    case '_approved':
      return { who, text: `${who} approved exactly this version`, note: false }
    case '_sent':
      return { who, text: entry.new ? `Sent: ${String(entry.new)}` : 'Sent', note: false }
    case '_refused':
      return { who, text: entry.new ? `Not sent: ${String(entry.new)}` : 'Not sent', note: false }
    default: {
      const label = (field?.label ?? entry.field).toLowerCase()

      if (entry.new === null || entry.new === undefined || entry.new === '') {
        return { who, text: `${who} cleared ${label}`, note: false }
      }

      // A draft is long: the history says it changed, the record shows it.
      if (field?.type === 'draft') {
        return { who, text: entry.old ? `${who} edited the ${label}` : `${who} wrote a ${label}`, note: false }
      }

      const value = field ? formatTyped({ type: field.type, value: entry.new as string, currency: field.currency }, entry.at) : String(entry.new)

      return { who, text: `${who} set ${label} to ${value}`, note: false }
    }
  }
}

/** What "Ask <bot>" puts in the chat's box: the panel or record it is about, for you to finish. */
export function askAboutPanel(view: Pick<View, 'title' | 'collection'>): string {
  return `About the “${view.title}” panel on my dashboard (dashboard_view; load skill_view("hermes-dashboard:dashboard") first): `
}

export function askAboutRecord(title: string, collection: string, recordId: string): string {
  return `About “${title}” in ${collection} (record ${recordId}): `
}

/** Only these open outside the app: a call, a text, an email, a web page. */
export function safeActionUrl(url: string): string | null {
  const trimmed = url.trim()

  return /^(tel:[+\d][\d\s().-]*|sms:[+\d][\d\s().-]*|mailto:[^\s]+|https:\/\/[^\s]+)$/i.test(trimmed) ? trimmed : null
}

/** A routine that keeps a dashboard: it loads the dashboard skill, or its prompt writes records or panels. */
export function feedsDashboard(job: CronJob): boolean {
  const skills = [...(job.skills ?? []), job.skill ?? ''].map(skill => skill.trim().toLowerCase())

  return skills.includes('hermes-dashboard:dashboard') || /\bdashboard_(record|view|set_panel|update_items)\b|hermes-dashboard/i.test(job.prompt ?? '')
}

/** The routines "Check now" runs: those that keep the dashboard, and are on (running a paused one would resume it). */
export function dashboardRoutines(jobs: CronJob[]): CronJob[] {
  return jobs.filter(job => feedsDashboard(job) && jobState(job) !== 'paused')
}

/** An interval as a bot wrote it ("5m", "1h", "2h", "1d") in words: "5 min", "hour", "2 hours", "day". */
export function everyWords(every: string): string {
  const match = /^\s*(\d+)\s*(m|min|minutes?|h|hours?|d|days?)\s*$/i.exec(every)

  if (!match) {
    return every.trim()
  }

  const count = Number(match[1])
  const unit = (match[2] ?? '').toLowerCase()

  if (unit.startsWith('m')) {
    return `${count} min`
  }

  const word = unit.startsWith('h') ? 'hour' : 'day'

  return count === 1 ? word : `${count} ${word}s`
}

const SOURCE_WORDS: Record<string, string> = { ics: 'your calendar', sqlite: 'its database', json: 'a web address', script: 'a script' }

/**
 * The line under a panel's title in its menu: how it stays fresh. "Updates itself from your calendar · read 9:58 AM",
 * "7 open · a script checks every 5 min; Scout writes only when something changes", "Written by Orion". Falls back
 * to the routines that keep the dashboard (`kept`) when the bot didn't record a feed.
 */
export function keptLine(view: Pick<View, 'kept' | 'live' | 'open'>, botName: string, nowS: number, routines = ''): string {
  const kept = view.kept
  const open = view.open !== undefined ? `${view.open} open` : ''
  const join = (...parts: string[]) => parts.filter(Boolean).join(' · ')

  if (kept?.how === 'live') {
    const asOf = view.live?.as_of ? timeLabel(view.live.as_of, nowS) : ''
    const error = view.live?.error ? readError(view.live.error) : ''
    // A failed read keeps the last good rows, so the time it names is the last read that worked.
    const read = error ? (asOf ? `couldn’t read it since ${asOf}: ${error}` : `couldn’t read it: ${error}`) : asOf ? `read ${asOf}` : ''

    return join(`Updates itself from ${SOURCE_WORDS[kept.kind] ?? 'its source'}`, read)
  }

  if (kept?.how === 'written') {
    return `Written by ${botName}`
  }

  const feed = kept?.how === 'computed' ? kept.feed : undefined

  if (!feed) {
    return join(open, routines)
  }

  const every = feed.every ? ` every ${everyWords(feed.every)}` : ''
  const how = feed.how === 'script' ? `a script checks${every}` : feed.how === 'model_on_change' ? `${botName} checks only when something new needs it` : `${botName} checks${every}`

  return join(open, feed.note ? `${how}; ${feed.note}` : how)
}

/**
 * A live source's error in a few words. The plugin hands over a script's last 300 characters of stderr, so a traceback
 * keeps its lead ("the script failed:") and its last line, the exception itself.
 */
export function readError(error: string): string {
  const lines = error.split('\n').map(line => line.trim()).filter(Boolean)
  const first = lines[0] ?? ''
  const last = lines.at(-1) ?? ''

  if (lines.length < 2) {
    return first
  }

  const lead = /^[^:]{1,40}:/.exec(first)?.[0]

  return lead ? `${lead} ${last}` : last
}

/** A live panel whose latest read failed says so quietly, and when its rows are from: "Couldn’t read · as of 9:42 AM". */
export function staleNote(view: Pick<View, 'live'>, nowS: number): string {
  if (!view.live?.error) {
    return ''
  }

  return view.live.as_of ? `Couldn’t read · as of ${timeLabel(view.live.as_of, nowS)}` : 'Couldn’t read'
}

/** The panel menu's "kept by “Feed watch”, every 15 minutes". Empty when no routine keeps the dashboard. */
export function keptBy(routines: CronJob[], now: Date = new Date()): string {
  const first = routines[0]

  if (!first) {
    return ''
  }

  const schedule = describeSchedule(first, now)
  const when = schedule === 'No schedule' ? '' : `, ${schedule.charAt(0).toLowerCase()}${schedule.slice(1)}`

  return routines.length > 1 ? `kept by “${first.name}” and ${routines.length - 1} more` : `kept by “${first.name}”${when}`
}

/** Whether the dashboard has news since a check began (server seconds). */
export function refreshedSince(views: View[], sinceS: number): boolean {
  return views.some(view => (view.updated || 0) >= sinceS)
}
