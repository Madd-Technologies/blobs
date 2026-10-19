import Feather from '@expo/vector-icons/Feather'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { UserBubble } from '@/components/chat/Bubble'
import { NumbersBlock, ViewBlock } from '@/components/dashboard/ViewBlock'
import { Raised, RiseIn } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import type { FaceMotion } from '@/features/face/motion'
import { crowdColor } from '@/features/tour/crowd'
import type { View as DashboardView, ViewRow } from '@/lib/hermes/dashboard'
import { haptic } from '@/lib/haptics'
import { BotTint, useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

import { Arrive, CrowdFace, PanelHead, PanelPaper, Peek, Settle, useBeats } from './kit'

/** You start asking, the ask is sent, the new panel arrives. */
const BEATS = [1000, 2700, 4300] as const
/** What you ask Scribe to track, typed out a letter at a time. */
const ASK = 'Add a dashboard panel for refunds to answer'
const TYPE_MS = 32
const FACE = 80

const NUMBERS: DashboardView[] = [
  { id: 'tour-orders', title: 'Orders today', kind: 'number', collection: null, value: 38 },
  { id: 'tour-sales', title: 'Sales this week', kind: 'number', collection: null, value: 1480, unit: { type: 'money', currency: 'USD' } },
  { id: 'tour-reviews', title: 'New reviews', kind: 'number', collection: null, value: 6 },
]

/** A date `days` after `nowS`, the way a record stores one. */
function dayFrom(nowS: number, days: number): string {
  const date = new Date(nowS * 1000)
  date.setDate(date.getDate() + days)

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The panel Scribe builds for you: one refund that waits on your reply, and one that doesn't yet. */
function refunds(done: Record<string, boolean>, nowS: number): Extract<DashboardView, { kind: 'list' | 'checklist' }> {
  const rows: ViewRow[] = [
    { id: 'tour-refund-alex', done: !!done['tour-refund-alex'], needs_you: true, title: { key: 'title', type: 'text', value: 'Reply to Alex about a refund' }, subtitle: { key: 'note', type: 'text', value: 'Asked again this morning' }, meta: { key: 'due', type: 'date', value: dayFrom(nowS, 0) } },
    { id: 'tour-refund-label', done: !!done['tour-refund-label'], needs_you: false, title: { key: 'title', type: 'text', value: 'Send a return label' }, meta: { key: 'due', type: 'date', value: dayFrom(nowS, 1) } },
  ]

  return { id: 'tour-refunds', title: 'Refunds to answer', kind: 'checklist', collection: 'scribe/refunds', rows, open: rows.filter(row => !row.done).length, needs_you: rows.filter(row => row.needs_you && !row.done).length }
}

/** The dashboard's message tray, typing out what you ask for. */
function Tray({ text }: { text: string }) {
  const { c } = useTheme()

  return (
    <Raised radius={radius.tray} style={styles.tray}>
      <View style={[styles.trayButton, { backgroundColor: c.pressedIn }]}>
        <Feather name="plus" size={20} color={c.text} />
      </View>
      <T variant="body" color={text ? 'text' : 'text2'} numberOfLines={1} style={styles.trayText}>
        {text || 'Message Scribe'}
      </T>
      <View style={[styles.trayButton, { backgroundColor: c.pressedIn }]}>
        <Feather name={text ? 'arrow-up' : 'mic'} size={20} color={c.text} />
      </View>
    </Raised>
  )
}

/**
 * A dashboard Scribe keeps: its numbers, and a message tray. You ask it to track something new, your ask goes out, and it
 * turns into the new panel, which rises in with a refund that needs you. Tick it off and Scribe settles down again.
 */
export function Dashboard({ active }: { active: boolean }) {
  const { beat } = useBeats(active, BEATS)
  const [typed, setTyped] = useState(0)
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [poke, setPoke] = useState(0)
  const [was, setWas] = useState(active)
  // The scene's clock, for the panel's dates ("Today", "Tomorrow").
  const [nowS] = useState(() => Date.now() / 1000)

  if (was !== active) {
    setWas(active)
    setTyped(0)
    setDone({})
  }

  // Your ask types itself out between the first beat and the second.
  useEffect(() => {
    if (beat !== 1) {
      return
    }

    const timer = setInterval(() => setTyped(count => Math.min(ASK.length, count + 1)), TYPE_MS)

    return () => clearInterval(timer)
  }, [beat])

  function toggle(id: string, next: boolean) {
    haptic('tick')
    setDone(current => ({ ...current, [id]: next }))

    if (next) {
      setPoke(count => count + 1)
    }
  }

  const panel = refunds(done, nowS)
  const waiting = beat >= 3 && (panel.needs_you ?? 0) > 0
  const building = beat === 2
  const motion: FaceMotion = building ? 'work' : waiting ? 'needs' : 'idle'
  const status = building ? 'Adding a panel…' : waiting ? 'Needs you' : beat >= 3 ? 'Updated just now' : 'Updated this morning'
  const block = <ViewBlock view={panel} nowS={nowS} raised={waiting} onOpenRecord={id => toggle(id, !done[id])} onToggle={toggle} onMenu={() => undefined} onOpenFull={() => undefined} />

  return (
    <View style={styles.fill}>
      <BotTint color={crowdColor('scribe')}>
        <Peek size={FACE}>
          <CrowdFace id="scribe" size={FACE} motion={motion} poke={poke} />
        </Peek>
        <Settle>
          <PanelPaper>
            <PanelHead title="Scribe’s dashboard" status={status} waiting={waiting} />
          </PanelPaper>
        </Settle>
        <Settle style={styles.space}>
          <NumbersBlock views={NUMBERS} onMenu={() => undefined} />
        </Settle>
        {building ? (
          <Arrive style={styles.space}>
            <UserBubble text={ASK} />
          </Arrive>
        ) : null}
        {/* Your ask becomes the new panel: it rises in (with its haptic) while it needs you, and sits back down once it doesn't. */}
        {beat >= 3 ? (
          waiting ? (
            <RiseIn key="raised" style={styles.space}>
              {block}
            </RiseIn>
          ) : (
            <Settle key="flat" style={styles.space}>
              {block}
            </Settle>
          )
        ) : null}
        <Settle style={styles.space}>
          <Tray text={beat === 1 ? ASK.slice(0, typed) : ''} />
        </Settle>
      </BotTint>
    </View>
  )
}

const styles = StyleSheet.create({
  // It grows upward from just above the words. The clip reaches the page's edges, so the raised panel's shadow isn't cut square.
  fill: { flex: 1, justifyContent: 'flex-end', overflow: 'hidden', marginHorizontal: -24, paddingHorizontal: 24, marginBottom: -12, paddingBottom: 12 },
  space: { marginTop: 10 },
  tray: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  trayButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  trayText: { flex: 1, paddingHorizontal: 10, fontSize: 16 },
})
