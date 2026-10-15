import { useState } from 'react'

import { MuteSheet } from '@/components/dashboard/MuteSheet'
import { formatTyped, untilLabel } from '@/features/dashboard/view'
import type { ViewRow } from '@/lib/hermes/dashboard'
import { useDashboards } from '@/stores/dashboards'
import { toast } from '@/stores/toast'

/**
 * What a swipe on a record's row does, the same on a dashboard, a full view and Needs you (which lists several bots, so each
 * call names the bot): right marks it done (with Undo) or opens it again; left asks until when to mute it, or unmutes a muted
 * one at once. Render `sheet` once on the screen.
 */
export function useRowActions(nowS: number, botName: (profile: string) => string) {
  const [muting, setMuting] = useState<{ profile: string; id: string; title: string } | null>(null)

  async function setDone(profile: string, id: string, done: boolean) {
    const error = await useDashboards.getState().setClosed(profile, id, done)

    if (error) {
      toast(error)
    } else if (done) {
      toast('Marked done', { label: 'Undo', run: () => void setDone(profile, id, false) })
    }
  }

  async function setMute(profile: string, id: string, until: number | null) {
    const error = await useDashboards.getState().mute(profile, id, until)

    if (error) {
      toast(error)
    } else if (until === null) {
      toast('Unmuted')
    } else {
      toast(`Muted until ${untilLabel(until, nowS)}`, { label: 'Undo', run: () => void setMute(profile, id, null) })
    }
  }

  const mute = (profile: string, row: Pick<ViewRow, 'id' | 'title' | 'muted_until'>) => {
    if (row.muted_until) {
      void setMute(profile, row.id, null)
    } else {
      setMuting({ profile, id: row.id, title: row.title ? formatTyped(row.title, nowS) : 'This record' })
    }
  }

  const sheet = (
    <MuteSheet
      title={muting?.title ?? null}
      botName={muting ? botName(muting.profile) : ''}
      nowS={nowS}
      onClose={() => setMuting(null)}
      onPick={until => {
        const target = muting
        setMuting(null)

        if (target) {
          void setMute(target.profile, target.id, until)
        }
      }}
    />
  )

  return { toggle: (profile: string, id: string, done: boolean) => void setDone(profile, id, done), mute, setMute, sheet }
}
