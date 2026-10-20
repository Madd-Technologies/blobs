import Feather from '@expo/vector-icons/Feather'
import { StyleSheet, View } from 'react-native'

import { Press } from '@/components/ui/Press'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import type { FeatherName } from '@/components/ui/Pill'
import type { CallLine, LineIcon } from '@/features/phone/view'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts } from '@/theme/tokens'

const ICONS: Record<Exclude<LineIcon, 'spinner'>, FeatherName> = {
  wait: 'circle',
  live: 'bar-chart-2',
  hold: 'pause',
  ask: 'help-circle',
  check: 'check',
  callback: 'phone-incoming',
  x: 'x',
  voicemail: 'voicemail',
  slash: 'slash',
  hangup: 'phone-off',
}

/** A call line's mark: what the call is doing or came to. */
export function LineMark({ icon, live, size = 16 }: { icon: LineIcon; live?: boolean; size?: number }) {
  const { c } = useTheme()

  if (icon === 'spinner') {
    return <Spinner size={size - 4} />
  }

  return <Feather name={ICONS[icon]} size={icon === 'wait' ? size - 3 : size} color={live ? c.text : c.text2} />
}

/** The one amber "needs you" accent: a dot, never a fill. */
export function NeedsDot({ size = 6 }: { size?: number }) {
  const { c } = useTheme()

  return <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.needsYou }} />
}

/** What the other party hears first: the fixed disclosure in the quieter color, then the bot's own words. */
export function OpeningBlock({ label, fixed, own, fill, note }: { label: string; fixed: string; own: string; fill: string; note?: boolean }) {
  return (
    <View style={styles.opening}>
      <T variant="label" color="text2">
        {label}
      </T>
      <View style={[styles.openingText, { backgroundColor: fill }]}>
        <T variant="body" style={styles.openingLine}>
          <T variant="body" color="text2" style={styles.openingLine}>
            {fixed}
          </T>{' '}
          {own}
        </T>
      </View>
      {note ? (
        <T variant="meta" color="text2">
          The first sentences are always the same: your name and the disclosure.
        </T>
      ) : null}
    </View>
  )
}

/** A 1 px separator inside a box, inset from the left. */
export function Sep({ inset = 14 }: { inset?: number }) {
  const { c } = useTheme()

  return <View aria-hidden style={{ height: 1, marginLeft: inset, backgroundColor: c.separator }} />
}

/** The minute a live call holds a question for you, as a thin bar that empties. */
export function QuestionTrack({ left, of = 60 }: { left: number; of?: number }) {
  const { c } = useTheme()

  return (
    <View accessibilityLabel={`${left} seconds left`} style={[styles.track, { backgroundColor: c.track }]}>
      <View style={[styles.track, { width: `${Math.round((100 * Math.max(0, Math.min(of, left))) / of)}%`, backgroundColor: c.text }]} />
    </View>
  )
}

/** One call in an errand: its mark, its name, and what it is doing or came to. */
export function CallLineRow({ name, line, onPress }: { name: string; line: CallLine; onPress?: () => void }) {
  const body = (
    <View style={styles.line}>
      <View style={styles.lineMark}>
        <LineMark icon={line.icon} live={line.live} />
      </View>
      <T variant="secondary" style={styles.flex}>
        <T variant="secondary" style={line.live ? styles.liveName : undefined}>
          {name}
        </T>
        <T variant="secondary" color="text2" style={styles.tabular}>
          {' · '}
          {line.status}
        </T>
      </T>
    </View>
  )

  return onPress ? (
    <Press accessibilityRole="button" accessibilityLabel={`${name}, ${line.status}`} onPress={onPress}>
      {body}
    </Press>
  ) : (
    body
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  opening: { gap: 6 },
  openingText: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  openingLine: { lineHeight: 22 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, minHeight: 24 },
  lineMark: { width: 18, height: 20, alignItems: 'center', justifyContent: 'center' },
  liveName: { fontFamily: fonts.medium },
  tabular: { fontVariant: ['tabular-nums'] },
})
