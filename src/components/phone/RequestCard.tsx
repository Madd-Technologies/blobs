import Feather from '@expo/vector-icons/Feather'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { ageLabel } from '@/features/roster/derive'
import { askLine, callsLeft, canApprove, approveEdits, factMarks, formatNumber, gateLine, hourLabel, modeLine, NO_CHOICES, spokenOpening, toggle, type Choices } from '@/features/phone/view'
import { haptic } from '@/lib/haptics'
import type { BotMeta } from '@/lib/hermes/identity'
import type { Errand, PhoneSettings } from '@/lib/hermes/phone'
import { usePhone } from '@/stores/phone'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

import { EditSheet } from './EditSheet'
import { NeedsDot, OpeningBlock, Sep } from './parts'

interface Props {
  errand: Errand
  botName: string
  meta: BotMeta | undefined
  settings: PhoneSettings | null
  nowS: number
}

/**
 * The call request, raised where the bot asked: everything the voice on the calls will know, each fact and call strikable,
 * flagged facts held until you tick or strike them, and the bot's research notes (yours only). Approve is the only way an
 * errand gets dialed; Edit sends the bot your note to redraft it.
 */
export function RequestCard({ errand, botName, meta, settings, nowS }: Props) {
  const { c } = useTheme()
  const [choices, setChoices] = useState<Choices>(NO_CHOICES)
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState<{ asks: boolean; notes: boolean }>({ asks: false, notes: false })
  const { brief } = errand
  const left = callsLeft(errand, choices)
  const ready = canApprove(errand, choices)
  const gate = gateLine(errand, choices)
  const opening = spokenOpening(brief, settings?.name ?? '', settings?.transcripts ?? true)
  const flagged = new Map(errand.flags.map(flag => [flag.fact, flag]))
  const age = ageLabel(errand.created, nowS) || 'now'

  async function approve() {
    setBusy('approve')
    const error = await usePhone.getState().approve(errand.id, approveEdits(errand, choices))
    setBusy(null)

    if (error) {
      toast(error)
    } else {
      haptic('confirm')
    }
  }

  async function decline() {
    setBusy('decline')
    const error = await usePhone.getState().decline(errand.id)
    setBusy(null)

    if (error) {
      toast(error)
    }
  }

  return (
    <Raised radius={radius.card} rise={`errand-${errand.id}`} style={styles.card} accessibilityLabel="Call request">
      <View style={styles.who}>
        <BotFace name={errand.profile} meta={meta} size={22} />
        <T variant="heading" style={styles.flex}>
          {askLine(left)}
        </T>
        <T variant="meta" color="text2">
          {age}
        </T>
      </View>

      <View style={styles.titles}>
        <T variant="display">{brief.title}</T>
        <T variant="secondary" color="text2">
          {modeLine(brief)}
        </T>
      </View>

      {brief.goal ? (
        <T variant="body" style={styles.loose}>
          {brief.goal}
        </T>
      ) : null}

      <OpeningBlock label="They hear first, word for word" fixed={opening.fixed} own={opening.own} fill={c.canvas} note />

      <View style={styles.section}>
        <T variant="label" color="text2">
          What they may hear · {brief.facts.length}
        </T>
        {brief.facts.length ? (
          <View style={[styles.box, { backgroundColor: c.pressedIn }]}>
            {brief.facts.map((fact, index) => {
              const flag = flagged.get(index)
              const struck = choices.struckFacts.includes(index)
              const ticked = choices.ticked.includes(index)
              const marks = factMarks(fact)

              return (
                <View key={`${index}-${fact.label}`}>
                  {index ? <Sep /> : null}
                  <View style={styles.boxRow}>
                    <View style={[styles.flex, styles.factText, struck && styles.struck]}>
                      <View style={styles.factLabel}>
                        {flag && !ticked && !struck ? <NeedsDot /> : null}
                        <T variant="label" color="text2" style={styles.flex}>
                          {fact.label}
                          {marks.length ? ` · ${marks.join(' · ')}` : ''}
                        </T>
                      </View>
                      <T variant="body" style={struck ? styles.lineThrough : undefined}>
                        {fact.value}
                      </T>
                      {flag && !struck ? (
                        <>
                          <T variant="label" color="text2">
                            {flag.why.slice(0, 1).toUpperCase()}
                            {flag.why.slice(1)}
                            {/[.!?]$/.test(flag.why) ? '' : '.'}
                          </T>
                          <Tickbox on={ticked} label="Share it on these calls" onPress={() => setChoices(now => ({ ...now, ticked: toggle(now.ticked, index) }))} />
                        </>
                      ) : null}
                    </View>
                    <StrikeButton struck={struck} label={fact.label} onPress={() => setChoices(now => ({ ...now, struckFacts: toggle(now.struckFacts, index) }))} />
                  </View>
                </View>
              )
            })}
          </View>
        ) : null}
        {settings?.name ? (
          <T variant="meta" color="text2">
            Also your first name, {settings.name}.
          </T>
        ) : null}
      </View>

      <View style={styles.section}>
        <T variant="label" color="text2">
          Called one at a time · {left === brief.calls.length ? brief.calls.length : `${left} of ${brief.calls.length}`}
        </T>
        <View style={[styles.box, { backgroundColor: c.pressedIn }]}>
          {brief.calls.map((call, index) => {
            const struck = choices.struckCalls.includes(index)

            return (
              <View key={`${index}-${call.number}`}>
                {index ? <Sep /> : null}
                <View style={styles.boxRow}>
                  <View style={[styles.flex, styles.callText, struck && styles.struck]}>
                    <T variant="rowTitle" style={struck ? styles.lineThrough : undefined}>
                      {call.name}
                    </T>
                    <T variant="label" color="text2" style={styles.tabular}>
                      {formatNumber(call.number)}
                      {call.source ? ` · ${call.source}` : ''}
                    </T>
                    {call.why ? (
                      <T variant="label" color="text2">
                        {call.why}
                      </T>
                    ) : null}
                  </View>
                  <StrikeButton struck={struck} label={call.name} onPress={() => setChoices(now => ({ ...now, struckCalls: toggle(now.struckCalls, index) }))} />
                </View>
              </View>
            )
          })}
        </View>
      </View>

      <View style={[styles.box, { backgroundColor: c.pressedIn }]}>
        <Fold title="What it asks" sub={`${brief.questions.length} ${brief.questions.length === 1 ? 'question' : 'questions'} · the same answers from each`} open={open.asks} onToggle={() => setOpen(now => ({ ...now, asks: !now.asks }))}>
          {brief.questions.map((question, index) => (
            <View key={index} style={styles.numbered}>
              <T variant="secondary" color="text2" style={styles.number}>
                {index + 1}.
              </T>
              <T variant="secondary" style={styles.flex}>
                {question}
              </T>
            </View>
          ))}
          {brief.record.length ? (
            <View style={styles.tight}>
              <T variant="label" color="text2">
                Writes down, the same for each call
              </T>
              <T variant="secondary">{brief.record.map(field => field.label).join(', ')}</T>
            </View>
          ) : null}
        </Fold>
        {brief.notes ? (
          <>
            <Sep />
            <Fold title={`${botName}’s research notes`} sub="Shown to you only, never sent to a call" open={open.notes} onToggle={() => setOpen(now => ({ ...now, notes: !now.notes }))}>
              <T variant="secondary" style={styles.notes}>
                {brief.notes}
              </T>
            </Fold>
          </>
        ) : null}
      </View>

      {gate ? (
        <View style={styles.gate}>
          {gate.needsYou ? <NeedsDot /> : <Feather name="x" size={14} color={c.text2} />}
          <T variant="label" color="text2" style={styles.flex}>
            {gate.text}
          </T>
        </View>
      ) : null}

      {errand.problem ? (
        <T variant="label" color="text2">
          {errand.problem}
        </T>
      ) : null}

      <View style={styles.buttons}>
        <Pill label={`Approve ${left} ${left === 1 ? 'call' : 'calls'}`} variant="primary" height={44} flex disabled={!ready || busy !== null} loading={busy === 'approve'} onPress={() => void approve()} />
        <Pill label="Decline" height={44} disabled={busy !== null} loading={busy === 'decline'} onPress={() => void decline()} />
        <Pill label="Edit" height={44} disabled={busy !== null} onPress={() => setEditing(true)} />
      </View>
      <T variant="meta" color="text2" style={styles.centered}>
        {settings ? `One at a time, ${hourLabel(settings.hours[0])} to ${hourLabel(settings.hours[1])}, ${settings.max_minutes} min at most each. ` : 'One at a time. '}
        Undecided requests expire in 24 hours.
      </T>

      <EditSheet errand={errand} botName={botName} visible={editing} onClose={() => setEditing(false)} />
    </Raised>
  )
}

function StrikeButton({ struck, label, onPress }: { struck: boolean; label: string; onPress: () => void }) {
  const { c } = useTheme()

  return (
    <Press accessibilityRole="button" accessibilityLabel={`${struck ? 'Keep' : 'Strike'} ${label}`} hitSlop={4} onPress={onPress} style={styles.strike}>
      <Feather name={struck ? 'rotate-ccw' : 'x'} size={16} color={c.text2} />
    </Press>
  )
}

export function Tickbox({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const { c } = useTheme()

  return (
    <Press accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress} style={styles.tick}>
      <View style={[styles.tickMark, on ? { backgroundColor: c.primary } : { borderWidth: 1.8, borderColor: c.text2 }]}>{on ? <Feather name="check" size={13} color={c.onPrimary} /> : null}</View>
      <T variant="secondary">{label}</T>
    </Press>
  )
}

function Fold({ title, sub, open, onToggle, children }: { title: string; sub: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { c } = useTheme()

  return (
    <View>
      <Press accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={title} onPress={onToggle} style={styles.foldHead}>
        <View style={styles.flex}>
          <T variant="bodyMedium">{title}</T>
          <T variant="label" color="text2">
            {sub}
          </T>
        </View>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.text2} />
      </Press>
      {open ? <View style={styles.foldBody}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: -4, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 16, gap: 16 },
  flex: { flex: 1, minWidth: 0 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titles: { gap: 4 },
  loose: { lineHeight: 22 },
  section: { gap: 6 },
  box: { borderRadius: radius.list, overflow: 'hidden' },
  boxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 10, paddingLeft: 14, paddingRight: 6 },
  factText: { gap: 2 },
  factLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  callText: { gap: 1 },
  struck: { opacity: 0.45 },
  lineThrough: { textDecorationLine: 'line-through' },
  tabular: { fontVariant: ['tabular-nums'] },
  strike: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tick: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  tickMark: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingVertical: 10, paddingLeft: 14, paddingRight: 12 },
  foldBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  numbered: { flexDirection: 'row', gap: 6 },
  number: { minWidth: 18, fontFamily: fonts.regular },
  tight: { gap: 2 },
  notes: { lineHeight: 21 },
  gate: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttons: { flexDirection: 'row', gap: 8 },
  centered: { textAlign: 'center' },
})
