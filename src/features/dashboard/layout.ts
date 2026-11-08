/**
 * A record laid out from its collection's blocks (hermes-dashboard 0.6+): which blocks have something to show, the notes
 * thread without the bot's bookkeeping, and what the action tray holds. The bot picks the structure; the app draws it in
 * its own design. Pure.
 */

import type { Entry, Field, FileRef, HistoryEntry, LayoutBlock, RecordDetail, RecordValue } from '../../lib/hermes/dashboard.ts'

/** History entries the notes thread keeps: what people and bots said, and what was decided. Field changes are bookkeeping. */
const THREAD = new Set(['_note', '_action', '_approved', '_sent', '_refused', '_closed', '_reopened'])

export function threadOf(history: HistoryEntry[], mode: 'notes' | 'all'): HistoryEntry[] {
  return mode === 'all' ? history : history.filter(entry => THREAD.has(entry.field))
}

export const listOf = (value: RecordValue | undefined): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [])

export const entriesOf = (value: RecordValue | undefined): Entry[] => (Array.isArray(value) ? value.filter((item): item is Entry => !!item && typeof item === 'object' && typeof (item as Entry).label === 'string') : [])

export const filesOf = (value: RecordValue | undefined): FileRef[] => (Array.isArray(value) ? value.filter((item): item is FileRef => !!item && typeof item === 'object' && typeof (item as FileRef).name === 'string' && !!((item as FileRef).path || (item as FileRef).url)) : [])

const textOf = (value: RecordValue | undefined): string => (typeof value === 'string' ? value.trim() : '')

/**
 * The blocks with something to show, in order. A question shows only while it is up (`show.ask`), a text, list or files
 * block only when its field holds something; the header and notes always show.
 */
export function shownBlocks(detail: Pick<RecordDetail, 'record' | 'collection' | 'show'>): LayoutBlock[] {
  const layout = detail.collection.layout
  const values = detail.record.values

  if (!layout) {
    return []
  }

  return layout.blocks.filter(block => {
    switch (block.block) {
      case 'ask':
        return !!detail.show?.ask && !!textOf(values[block.field])
      case 'text':
      case 'draft':
        return !!textOf(values[block.field])
      case 'entries':
        return entriesOf(values[block.field]).length > 0
      case 'files':
        return filesOf(values[block.field]).length > 0 || !!textOf(values[block.field])
      case 'fields':
        return block.fields.some(key => values[key] !== null && values[key] !== undefined && values[key] !== '')
      default:
        return true
    }
  })
}

export type TrayButton = { kind: 'action'; id: string; label: string } | { kind: 'next'; stage: string } | { kind: 'ask' } | { kind: 'done'; closed: boolean }

export interface Tray {
  /** A box at the bottom that adds a note (and answers the question while it is up). */
  composer: { placeholder: string } | null
  /** The white pill. */
  primary: TrayButton | null
  secondary: TrayButton[]
}

/**
 * What the action tray holds for a laid-out record. Buttons come only from those the record offers now (`show.actions`);
 * while a pressed button's job is under way there are none, and the composer stays so a note can still be added.
 */
export function trayOf(detail: Pick<RecordDetail, 'record' | 'collection' | 'show'>, botName: string, next: string | null): Tray {
  const spec = detail.collection.layout?.tray ?? {}
  const offered = detail.show?.running ? [] : (detail.show?.actions ?? [])
  const action = (id: string): TrayButton | null => {
    const found = offered.find(item => item.id === id)

    return found ? { kind: 'action', id: found.id, label: found.label } : null
  }

  const asking = !!detail.show?.ask
  const composer = spec.composer ? { placeholder: spec.placeholder || (asking ? 'Or answer in your own words' : `Add a note for ${botName}`) } : null
  const primary = spec.primary === 'next_stage' ? (next && !detail.record.closed_at ? ({ kind: 'next', stage: next } as const) : null) : spec.primary ? action(spec.primary) : null
  const secondary = (spec.secondary ?? []).flatMap((name): TrayButton[] => {
    if (name === 'ask') {
      return [{ kind: 'ask' }]
    }

    if (name === 'done') {
      return [{ kind: 'done', closed: !!detail.record.closed_at }]
    }

    const found = action(name)

    return found ? [found] : []
  })

  return { composer, primary, secondary }
}

/** The bot a byline names, when it is one of yours: "asked by Juniper". */
export function bylineOf(field: string | undefined, values: Record<string, RecordValue>, botName: (profile: string) => string | null): string | null {
  const who = field ? textOf(values[field]) : ''
  const name = who ? botName(who) : null

  return name ? `asked by ${name}` : null
}

/** A file's line under its name: its kind and size ("PDF · 182 KB"). */
export function fileLine(file: FileRef): string {
  const kind = file.mime ? (file.mime.split('/')[1] ?? file.mime).replace(/^vnd\.[^.]+\./, '').toUpperCase().slice(0, 12) : (/\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1] ?? '').toUpperCase()

  return [kind, typeof file.size === 'number' ? sizeLabel(file.size) : ''].filter(Boolean).join(' · ')
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1000) {
    return `${bytes} B`
  }

  if (bytes < 1_000_000) {
    return `${Math.round(bytes / 1000)} KB`
  }

  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`
}

/** Fields a person may change in the app: not the bot's own (readonly), not a draft or a list. */
export const editable = (field: Field): boolean => !field.readonly && !field.retired && !['draft', 'list', 'entries', 'files'].includes(field.type)
