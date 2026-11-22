import Feather from '@expo/vector-icons/Feather'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { openAction } from '@/components/dashboard/openAction'
import { SwipeRow } from '@/components/dashboard/SwipeRow'
import { T } from '@/components/ui/T'
import { actionFor, formatTyped, isPast, mutedShort, rowText } from '@/features/dashboard/view'
import type { RowSignal, View as DashboardView, ViewRow } from '@/lib/hermes/dashboard'
import { useTheme } from '@/theme/ThemeProvider'

/** A meta value that is a deadline today or past, on a row that needs you, reads in amber (for example "By 11 AM"). */
function urgent(row: ViewRow, nowS: number): boolean {
  const meta = row.meta

  if (!row.needs_you || !meta) {
    return false
  }

  if (meta.type === 'date') {
    return isPast(String(meta.value), nowS + 86_400)
  }

  return meta.type === 'datetime' && Number(meta.value) <= nowS + 86_400
}

/** A muted row's quiet note in place of its meta: the bell and when it speaks up again. */
function MutedNote({ row, nowS }: { row: ViewRow; nowS: number }) {
  const { c } = useTheme()
  const when = row.muted_until ? mutedShort(row.muted_until, nowS) : ''

  return (
    <View style={styles.mutedNote} accessible accessibilityLabel={when ? `Muted until ${when}` : 'Muted'}>
      <Feather name="bell-off" size={12} color={c.text2} />
      {when ? (
        <T variant="meta" color="text2">
          {when}
        </T>
      ) : null}
    </View>
  )
}

/**
 * A panel's title and nothing else: no count, no ⋯ on every panel. Tapping it opens the full view, whose header has the
 * options, or the options themselves for a panel the full view can't add to; a long press opens the options anywhere. A live
 * panel whose latest read failed says so on the right.
 */
export function Header({ view, note, onMenu, onFull }: { view: DashboardView; note?: string; onMenu: () => void; onFull?: () => void }) {
  const { c } = useTheme()

  return (
    <View style={styles.head}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={onFull ? `${view.title}, full view` : `${view.title} options`}
        accessibilityActions={onFull ? [{ name: 'longpress', label: 'Panel options' }] : undefined}
        onAccessibilityAction={event => (event.nativeEvent.actionName === 'longpress' ? onMenu() : undefined)}
        onPress={onFull ?? onMenu}
        onLongPress={onMenu}
        hitSlop={{ top: 6, bottom: 6 }}
        style={({ pressed }) => [styles.title, pressed && styles.pressed]}
      >
        <T variant="heading" numberOfLines={1} style={styles.titleText}>
          {view.title}
        </T>
        {onFull ? <Feather name="chevron-right" size={15} color={c.text2} style={styles.titleChevron} /> : null}
      </Pressable>
      {note ? (
        <T variant="status" color="text2" numberOfLines={1} style={styles.note}>
          {note}
        </T>
      ) : null}
    </View>
  )
}

/** What a screen reader says for a row's signal. */
const SIGNAL_WORDS: Record<RowSignal, string> = { good: 'on track', warn: 'worth a look', bad: 'a problem' }

/** A signal's color: amber means only "needs you", so a bot's "warn" is a quiet grey dot between green and red. */
function signalColor(tone: RowSignal | undefined, c: ReturnType<typeof useTheme>['c']): string | undefined {
  return tone === 'good' ? c.connected : tone === 'bad' ? c.danger : tone === 'warn' ? c.text2 : undefined
}

/** A row signal's dot: green, grey or red. The one narrow exception to color coming only from faces, for rows a bot marks. */
export function SignalDot({ tone, style }: { tone: RowSignal; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()

  return <View style={[styles.signal, { backgroundColor: signalColor(tone, c) }, style]} />
}

/** A row's leading mark, one accent per row: its signal when the bot gave it one (a red row that needs you shows red), else the amber dot. */
export function RowMark({ row, style, space }: { row: Pick<ViewRow, 'signal' | 'needs_you'>; style?: StyleProp<ViewStyle>; space?: boolean }) {
  if (row.signal) {
    return <SignalDot tone={row.signal} style={style} />
  }

  if (row.needs_you) {
    return <AttentionDot size={8} style={style} />
  }

  return space ? <View style={styles.dotSpace} /> : null
}

/** A record's row: its signal or the amber dot when it needs you, title and subtitle, and a meta that turns amber when it is due. */
export function RecordRow({ row, nowS, onPress, fill, amount }: { row: ViewRow; nowS: number; onPress: () => void; /** The panel's paper (rows are solid so a swipe's action never shows through). */ fill?: string; /** A table row's amount, drawn on the right at reading size in place of the meta. */ amount?: string }) {
  const { c } = useTheme()
  const paper = fill ?? c.sheet
  const waiting = row.needs_you && !row.muted_until && !row.done
  // A live panel's row isn't a record: it opens its link (a ticket page, a file) or nothing.
  const link = row.link ? actionFor(row.link) : null
  const live = row.id.startsWith('live:')
  const press = () => (link ? openAction(link, '', row.title ? formatTyped(row.title, nowS) : 'Link') : live ? undefined : onPress())
  const meta = row.meta ? rowText(row.meta, nowS) : ''
  const title = row.title ? rowText(row.title, nowS) : 'Untitled'
  const subtitle = row.subtitle ? rowText(row.subtitle, nowS) : ''

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, amount, subtitle, row.signal ? SIGNAL_WORDS[row.signal] : '', row.needs_you ? 'needs you' : '', row.muted_until ? 'muted' : amount ? '' : meta].filter(Boolean).join(', ')}
      onPress={press}
      disabled={live && !link}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.tone : paper }]}
    >
      {/* Dimmed inside a solid row, so a swipe's action never shows through a muted one. */}
      <View style={[styles.rowInner, row.muted_until ? styles.muted : null]}>
        <RowMark row={row} style={styles.rowDot} space />
        <View style={styles.text}>
          <T variant="bodyMedium" color={row.done ? 'text2' : 'text'} numberOfLines={1} style={row.done ? styles.struck : undefined}>
            {title}
          </T>
          {subtitle ? (
            <T variant="secondary" color={waiting ? 'text' : 'text2'} numberOfLines={1}>
              {subtitle}
            </T>
          ) : null}
        </View>
        {row.muted_until ? (
          <MutedNote row={row} nowS={nowS} />
        ) : amount ? (
          <T variant="bodyMedium" numberOfLines={1} style={styles.amount}>
            {amount}
          </T>
        ) : meta ? (
          <T variant="meta" color={!row.signal && (waiting || urgent(row, nowS)) ? 'needsYouText' : 'text2'} style={styles.rowMeta}>
            {meta}
          </T>
        ) : null}
        {link ? <Feather name="external-link" size={13} color={c.text2} /> : null}
      </View>
    </Pressable>
  )
}

/** A checklist row: the ring closes it; the words open its record, or its link the way a list row's does. */
function CheckRow({ row, nowS, onOpen, onToggle, fill }: { row: ViewRow; nowS: number; onOpen: () => void; onToggle: () => void; fill?: string }) {
  const { c } = useTheme()
  const meta = row.meta ? rowText(row.meta, nowS) : ''
  const title = row.title ? rowText(row.title, nowS) : 'Untitled'
  const subtitle = row.subtitle ? rowText(row.subtitle, nowS) : ''
  const link = row.link ? actionFor(row.link) : null
  const waiting = row.needs_you && !row.muted_until && !row.done

  return (
    <View style={[styles.checkRow, { backgroundColor: fill ?? c.sheet }]}>
      <View style={[styles.rowInner, styles.checkInner, row.muted_until ? styles.muted : null]}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: row.done }} accessibilityLabel={title} hitSlop={6} onPress={onToggle} style={styles.tick}>
          {row.done ? (
            <View style={[styles.circle, { backgroundColor: c.tone }]}>
              <Feather name="check" size={13} color={c.text2} />
            </View>
          ) : (
            <View style={[styles.circle, styles.ring, { borderColor: signalColor(row.signal, c) ?? (row.needs_you ? c.needsYou : c.text2) }]} />
          )}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={[title, subtitle, meta].filter(Boolean).join(', ')} onPress={link ? () => openAction(link, '', title) : onOpen} style={styles.checkText}>
          <View style={[styles.text, subtitle ? styles.checkWords : null]}>
            <T variant="body" color={row.done ? 'text2' : 'text'} numberOfLines={2} style={row.done ? styles.struck : undefined}>
              {title}
            </T>
            {subtitle ? (
              <T variant="secondary" color={waiting ? 'text' : 'text2'} numberOfLines={1}>
                {subtitle}
              </T>
            ) : null}
          </View>
          {row.muted_until && !row.done ? (
            <MutedNote row={row} nowS={nowS} />
          ) : meta ? (
            <T variant="meta" color={!row.done && urgent(row, nowS) ? 'needsYouText' : 'text2'}>
              {row.done ? 'Done' : meta}
            </T>
          ) : null}
          {link ? <Feather name="external-link" size={13} color={c.text2} /> : null}
        </Pressable>
      </View>
    </View>
  )
}

export function Rows({ rows, nowS, checklist, fill, onOpenRecord, onToggle, onMute }: { rows: ViewRow[]; nowS: number; checklist: boolean; fill: string; onOpenRecord: (id: string) => void; onToggle: (id: string, done: boolean) => void; onMute?: (row: ViewRow) => void }) {
  if (!rows.length) {
    return (
      <T variant="secondary" color="text2" style={styles.empty}>
        {checklist ? 'Nothing to do.' : 'Nothing here right now.'}
      </T>
    )
  }

  return (
    <>
      {rows.map(row => (
        <View key={row.id}>
          {onMute ? (
            <SwipeRow done={row.done} muted={!!row.muted_until} onDone={() => onToggle(row.id, !row.done)} onMute={() => onMute(row)}>
              {checklist ? <CheckRow row={row} nowS={nowS} fill={fill} onOpen={() => onOpenRecord(row.id)} onToggle={() => onToggle(row.id, !row.done)} /> : <RecordRow row={row} nowS={nowS} fill={fill} onPress={() => onOpenRecord(row.id)} />}
            </SwipeRow>
          ) : checklist ? (
            <CheckRow row={row} nowS={nowS} fill={fill} onOpen={() => onOpenRecord(row.id)} onToggle={() => onToggle(row.id, !row.done)} />
          ) : (
            <RecordRow row={row} nowS={nowS} fill={fill} onPress={() => onOpenRecord(row.id)} />
          )}
        </View>
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 2 },
  title: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  titleText: { flexShrink: 1 },
  titleChevron: { marginTop: 1 },
  pressed: { opacity: 0.6 },
  note: { marginLeft: 'auto' },
  amount: { lineHeight: 21, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 16, paddingVertical: 10 },
  rowDot: { marginTop: 7 },
  rowMeta: { lineHeight: 21 },
  dotSpace: { width: 8 },
  signal: { width: 8, height: 8, borderRadius: 4 },
  text: { flex: 1, minWidth: 0 },
  struck: { textDecorationLine: 'line-through' },
  muted: { opacity: 0.45 },
  rowInner: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkInner: { gap: 10 },
  mutedNote: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingLeft: 10, paddingRight: 16 },
  tick: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 1.8 },
  checkText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  checkWords: { paddingVertical: 8 },
  empty: { paddingHorizontal: 16, paddingVertical: 10 },
})
