/**
 * What a pinned bot's tile on Home says about its dashboard (never its chat): what waits on you there when something does,
 * else the dashboard's own headline figure (its first number, or first stat), else how much is open, else when it changed.
 */

import type { BotDashboard } from '../../lib/hermes/dashboard.ts'
import { updatedLine } from './view.ts'

export interface Headline {
  /** The big figure ("2", "10.83"); empty when the dashboard has none to give. */
  figure: string
  /** What the figure is, in a few words. */
  caption: string
  /** Something on the dashboard waits on you. */
  needsYou: boolean
}

export function dashboardHeadline(dashboard: BotDashboard | null | undefined, needsYou: number, nowS: number): Headline {
  const views = dashboard?.views ?? []

  if (needsYou > 0) {
    const flagged = views.filter(view => (view.needs_you ?? 0) > 0)

    return { figure: String(needsYou), caption: flagged.length === 1 && flagged[0] ? flagged[0].title : needsYou === 1 ? 'needs you' : 'need you', needsYou: true }
  }

  for (const view of views) {
    if (view.kind === 'number' && view.value !== null && view.value !== undefined) {
      return { figure: view.value.toLocaleString('en-US'), caption: view.title, needsYou: false }
    }

    if (view.kind === 'stat' && view.metrics[0]) {
      return { figure: view.metrics[0].value, caption: view.metrics[0].label, needsYou: false }
    }
  }

  const open = views.find(view => (view.kind === 'list' || view.kind === 'checklist' || view.kind === 'board' || view.kind === 'table') && (view.open ?? 0) > 0)

  if (open) {
    return { figure: String(open.open), caption: `open · ${open.title}`, needsYou: false }
  }

  if (!dashboard) {
    return { figure: '', caption: '', needsYou: false }
  }

  return { figure: '', caption: views.length ? updatedLine(views, nowS) || 'All clear' : 'Nothing here yet', needsYou: false }
}
