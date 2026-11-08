/**
 * The page a number, chart or stat opens (hermes-dashboard 0.6+): its rows in groups (days, stages, choices) and the line under
 * its count. A page holds only records, so nothing here opens another page. Pure.
 */

import type { Field, PageRow, ViewPage } from '../../lib/hermes/dashboard.ts'
import { dateLabel } from './view.ts'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const localDate = (epochS: number): string => {
  const at = new Date(epochS * 1000)

  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

/** "Mon Oct 19", from YYYY-MM-DD. */
export function dayName(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)

  if (!match) {
    return value
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))

  return `${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}`
}

export interface PageGroup {
  key: string
  label: string
  rows: PageRow[]
}

/**
 * Rows in their groups, in the order they came (the server sorts by the group first): days as "Today", "Tomorrow", "Wed";
 * a time grouped by its day; a stage or choice by its name. Without a group, one group with no label.
 */
export function groupRows(rows: PageRow[], field: Field | undefined, nowS: number): PageGroup[] {
  if (!field) {
    return [{ key: '', label: '', rows }]
  }

  const groups: PageGroup[] = []

  for (const row of rows) {
    const value = row.group
    let key: string
    let label: string

    if (value === null || value === undefined || value === '') {
      key = ''
      label = field.type === 'date' || field.type === 'datetime' ? 'No date' : `No ${field.label.toLowerCase()}`
    } else if (field.type === 'datetime' && typeof value === 'number') {
      key = localDate(value)
      label = dateLabel(key, nowS)
    } else if (field.type === 'date') {
      key = String(value)
      label = dateLabel(key, nowS)
    } else {
      key = String(value)
      label = key
    }

    const last = groups[groups.length - 1]

    if (last && last.key === key) {
      last.rows.push(row)
    } else {
      groups.push({ key, label, rows: [row] })
    }
  }

  return groups
}

/** The line under the page's count: the panel's period or bar ("Mon Oct 19 to Sun Oct 25"), or the metric it stands for. */
export function pageCaption(page: Pick<ViewPage, 'start' | 'end' | 'period' | 'metric'>): string {
  if (page.metric) {
    return page.metric
  }

  if (page.start && page.end) {
    return page.start === page.end ? dayName(page.start) : `${dayName(page.start)} to ${dayName(page.end)}`
  }

  return ''
}

/** "Show 11 more", when there are more rows than shown. */
export function moreLabel(page: Pick<ViewPage, 'count'>, shown: number): string {
  const left = page.count - shown

  return left > 0 ? `Show ${left} more` : ''
}
