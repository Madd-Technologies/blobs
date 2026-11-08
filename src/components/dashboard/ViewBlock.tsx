import Feather from '@expo/vector-icons/Feather'
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Polyline, Rect } from 'react-native-svg'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { Markdown } from '@/components/chat/Markdown'
import { SwipeRow } from '@/components/dashboard/SwipeRow'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { openAction } from '@/components/dashboard/openAction'
import { actionFor, changeLine, chartEnds, figure, formatTyped, isPast, mutedShort, rowText, staleNote, tableRowWords } from '@/features/dashboard/view'
import type { RowSignal, Typed, View as DashboardView, ViewRow } from '@/lib/hermes/dashboard'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

interface Props {
  view: DashboardView
  /** The server's clock (epoch seconds), for dates. */
  nowS: number
  onOpenRecord: (id: string) => void
  onToggle: (id: string, done: boolean) => void
  onMenu: () => void
  onOpenFull: () => void
  /** Swiped left: mute (or unmute) a row. Without it, rows don't swipe. */
  onMute?: (row: ViewRow) => void
  /** On the full view: no header (the screen's header names the panel), and every row. */
  bare?: boolean
  /** The panel that needs you: raised over the paper (one per dashboard). */
  raised?: boolean
  /** A chart's bar or a stat's metric that opens a page of its records (hermes-dashboard 0.6+). */
  onOpenPage?: (options: { bucket?: string; metric?: number }) => void
}

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
function Header({ view, note, onMenu, onFull }: { view: DashboardView; note?: string; onMenu: () => void; onFull?: () => void }) {
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
function SignalDot({ tone, style }: { tone: RowSignal; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()

  return <View style={[styles.signal, { backgroundColor: signalColor(tone, c) }, style]} />
}

/** A row's leading mark, one accent per row: its signal when the bot gave it one (a red row that needs you shows red), else the amber dot. */
function RowMark({ row, style, space }: { row: Pick<ViewRow, 'signal' | 'needs_you'>; style?: StyleProp<ViewStyle>; space?: boolean }) {
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

function Rows({ rows, nowS, checklist, fill, onOpenRecord, onToggle, onMute }: { rows: ViewRow[]; nowS: number; checklist: boolean; fill: string; onOpenRecord: (id: string) => void; onToggle: (id: string, done: boolean) => void; onMute?: (row: ViewRow) => void }) {

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

/** A tile's small label, with a chevron when tapping it opens a page of its records. */
function TileLabel({ text, opens }: { text: string; opens: boolean }) {
  const { c } = useTheme()

  return (
    <View style={styles.tileLabel}>
      <T variant="meta" color="text2" numberOfLines={2} style={styles.tileLabelText}>
        {text}
      </T>
      {opens ? <Feather name="chevron-right" size={12} color={c.text2} style={styles.tileChevron} /> : null}
    </View>
  )
}

/**
 * The figures of one or more number views as tiles, two to a row (an odd last tile takes the row). A tile that opens a page of
 * the records it counts goes there on a tap; its panel menu is a long press. Any other tile opens its menu.
 */
export function NumbersBlock({ views, onMenu, onOpenPage }: { views: DashboardView[]; onMenu: (view: DashboardView) => void; onOpenPage?: (view: DashboardView) => void }) {
  const { c } = useTheme()

  return (
    <View style={styles.numbers}>
      {views.map(view => {
        if (view.kind !== 'number') {
          return null
        }

        const change = changeLine(view.value, view.previous, view.period, view.unit)
        const value = figure(view.value, view.unit)
        const opens = !!view.opens && !!onOpenPage

        return (
          <Pressable
            key={view.id}
            accessibilityRole="button"
            accessibilityLabel={`${view.title}: ${value}${change ? `, ${change}` : ''}`}
            accessibilityHint={opens ? 'Opens the list. Long press for the panel’s options.' : undefined}
            onLongPress={() => onMenu(view)}
            onPress={() => (opens ? onOpenPage(view) : onMenu(view))}
            style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? c.tone : c.sheet }]}
          >
            <T variant="stat" color={(view.needs_you ?? 0) > 0 ? 'needsYou' : 'text'} numberOfLines={1} adjustsFontSizeToFit>
              {value}
            </T>
            <TileLabel text={change ? `${view.title}, ${change}` : view.title} opens={opens} />
          </Pressable>
        )
      })}
    </View>
  )
}

function Chart({ view, onOpenPage }: { view: Extract<DashboardView, { kind: 'chart' }>; onOpenPage?: (options: { bucket?: string }) => void }) {
  const { c } = useTheme()
  const width = 340
  const height = 88
  const max = Math.max(1, ...view.points.map(point => point.value))
  const gap = view.points.length > 12 ? 4 : 12
  const bar = Math.max(4, (width - gap * (view.points.length - 1)) / view.points.length)
  const [first, last] = chartEnds(view.points, view.bucket)
  const label = `${view.title}: ${view.points.map(point => figure(point.value, view.unit)).join(', ')}`

  return (
    <View style={styles.chart}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} accessibilityLabel={label}>
        {view.style === 'line' ? (
          <Polyline
            points={view.points.map((point, index) => `${(index / Math.max(1, view.points.length - 1)) * width},${height - 4 - (point.value / max) * (height - 8)}`).join(' ')}
            fill="none"
            stroke={c.text}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ) : (
          view.points.map((point, index) => {
            const barHeight = Math.max(2, (point.value / max) * height)

            return <Rect key={point.start} x={index * (bar + gap)} y={height - barHeight} width={bar} height={barHeight} rx={5} fill={index === view.points.length - 1 ? c.text : c.text2} opacity={index === view.points.length - 1 ? 1 : 0.3} />
          })
        )}
      </Svg>
      {view.opens && onOpenPage ? (
        // Each bar opens the records in it: a row of tap targets over the bars.
        <View style={[styles.chartTaps, { height }]}>
          {view.points.map(point => (
            <Pressable key={point.start} accessibilityRole="button" accessibilityLabel={`${point.start}: ${figure(point.value, view.unit)}. Opens its records`} onPress={() => onOpenPage({ bucket: point.start })} style={styles.flexOne} />
          ))}
        </View>
      ) : null}
      <View style={styles.chartEnds}>
        <T variant="meta" color="text2">
          {first}
        </T>
        <T variant="meta" color="text2">
          {last}
        </T>
      </View>
    </View>
  )
}

/**
 * A table on the dashboard, as rows a phone can read: the name on the left, the amount on the right, the other columns in one
 * quiet line. The full view keeps the columns, for comparing side by side.
 */
function TableRows({ view, nowS, fill, onOpenRecord }: { view: Extract<DashboardView, { kind: 'table' }>; nowS: number; fill: string; onOpenRecord: (id: string) => void }) {
  return (
    <>
      {view.rows.map(row => {
        const words = tableRowWords(view.columns, row.cells, nowS)

        return (
          <RecordRow
            key={row.id}
            row={{ id: row.id, done: row.done, needs_you: row.needs_you, signal: row.signal, muted_until: row.muted_until, title: { key: 'title', type: 'text', value: words.title }, subtitle: words.line ? { key: 'line', type: 'text', value: words.line } : undefined }}
            amount={words.figure}
            nowS={nowS}
            fill={fill}
            onPress={() => onOpenRecord(row.id)}
          />
        )
      })}
    </>
  )
}

function cell(typed: Typed | null, nowS: number): string {
  return typed ? formatTyped(typed, nowS) : '–'
}

/** One panel of a bot's dashboard (number views are drawn together by `NumbersBlock`). */
export function ViewBlock({ view, nowS, onOpenRecord, onToggle, onMenu, onOpenFull, onMute, bare, raised, onOpenPage }: Props) {
  const { c } = useTheme()

  if (view.kind === 'number') {
    return <NumbersBlock views={[view]} onMenu={() => onMenu()} />
  }

  // A live panel's header says nothing while it is fresh and "Couldn’t read · as of 9:42 AM" when its latest read failed.
  const note = view.kept?.how === 'live' ? staleNote(view, nowS) : ''
  // The full view adds rows (and a board's every column) to these; a chart, summary or stat shows all it has already.
  const full = view.kind === 'board' || view.kind === 'table' || view.kind === 'list' || view.kind === 'checklist'

  // A list, checklist or table with nothing in it is one line on the dashboard: its title, and "Nothing right now".
  const empty = !bare && (view.kind === 'list' || view.kind === 'checklist' || view.kind === 'table') && view.rows.length === 0

  if (empty) {
    return (
      <View style={[styles.block, styles.emptyBlock, { backgroundColor: c.sheet }]} accessibilityLabel={`${view.title}, ${view.kind === 'checklist' ? 'nothing to do' : 'nothing right now'}`}>
        <Header view={view} note={note || (view.kind === 'checklist' ? 'Nothing to do' : 'Nothing right now')} onMenu={onMenu} />
      </View>
    )
  }

  const lift = raised && !bare
  const fill = lift ? c.raised : bare ? c.canvas : c.sheet
  const body = (
    <>
      {bare ? null : <Header view={view} note={note} onMenu={onMenu} onFull={full ? onOpenFull : undefined} />}

      {view.kind === 'list' || view.kind === 'checklist' ? <Rows rows={view.rows} nowS={nowS} checklist={view.kind === 'checklist'} fill={fill} onOpenRecord={onOpenRecord} onToggle={onToggle} onMute={onMute} /> : null}

      {view.kind === 'board' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.boardRow}>
          {view.columns.map(column => (
            <View key={column.name} style={styles.boardColumnWrap}>
              <View style={[styles.boardColumn, { backgroundColor: c.tone }]}>
                <T variant="status" color="text2" numberOfLines={1}>
                  {column.name} · {column.count}
                </T>
                {column.rows.slice(0, 3).map(row => (
                  <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={row.title ? formatTyped(row.title, nowS) : 'Untitled'} onPress={() => onOpenRecord(row.id)} style={[styles.boardItem, row.muted_until ? styles.muted : null]}>
                    <RowMark row={row} style={styles.boardDot} />
                    <T variant="secondary" color={row.done ? 'text2' : 'text'} numberOfLines={2} style={styles.flex}>
                      {row.title ? formatTyped(row.title, nowS) : 'Untitled'}
                    </T>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {view.kind === 'table' && !bare ? <TableRows view={view} nowS={nowS} fill={fill} onOpenRecord={onOpenRecord} /> : null}

      {view.kind === 'table' && bare ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.table}>
          <View>
            <View style={styles.tableRow}>
              {view.rows.some(row => row.signal) ? <View style={styles.tableMark} /> : null}
              {view.columns.map(column => (
                <T key={column.key} variant="label" color="text2" numberOfLines={1} style={styles.tableCell}>
                  {column.label}
                </T>
              ))}
            </View>
            {view.rows.map(row => (
              // A live panel's row isn't a record (and a table has no link slot), so it opens nothing, like a live list row without a link.
              <Pressable key={row.id} accessibilityRole={row.id.startsWith('live:') ? undefined : 'button'} disabled={row.id.startsWith('live:')} onPress={() => onOpenRecord(row.id)} style={[styles.tableRow, { borderTopColor: c.separator }, styles.tableRule, row.muted_until ? styles.muted : null]}>
                {view.rows.some(entry => entry.signal) ? <View style={styles.tableMark}>{row.signal ? <SignalDot tone={row.signal} /> : null}</View> : null}
                {row.cells.map((value, index) => (
                  <T key={view.columns[index]?.key ?? index} variant="secondary" color={index === 0 && row.needs_you && !row.signal ? 'needsYouText' : 'text'} numberOfLines={1} style={styles.tableCell}>
                    {cell(value, nowS)}
                  </T>
                ))}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {view.kind === 'chart' ? <Chart view={view} onOpenPage={onOpenPage} /> : null}

      {view.kind === 'summary' ? (
        <View style={styles.summary}>
          <Markdown text={view.text} />
        </View>
      ) : null}

      {view.kind === 'stat' ? (
        <View style={styles.stats}>
          {view.metrics.map((metric, index) =>
            metric.opens && onOpenPage ? (
              <Press key={metric.label} accessibilityRole="button" accessibilityLabel={`${metric.label}: ${metric.value}${metric.change ? `, ${metric.change}` : ''}`} accessibilityHint="Opens the list" onPress={() => onOpenPage({ metric: index })} style={styles.number}>
                <T variant="stat" numberOfLines={1} adjustsFontSizeToFit>
                  {metric.value}
                </T>
                <TileLabel text={metric.change ? `${metric.label}, ${metric.change}` : metric.label} opens />
              </Press>
            ) : (
              <View key={metric.label} style={styles.number} accessible accessibilityLabel={`${metric.label}: ${metric.value}${metric.change ? `, ${metric.change}` : ''}`}>
                <T variant="stat" numberOfLines={1} adjustsFontSizeToFit>
                  {metric.value}
                </T>
                <TileLabel text={metric.change ? `${metric.label}, ${metric.change}` : metric.label} opens={false} />
              </View>
            ),
          )}
        </View>
      ) : null}
    </>
  )

  if (lift) {
    return (
      <Raised radius={radius.card} accessibilityLabel={`${view.title}, needs you`}>
        {/* The card itself can't clip (that would cut off its shadow), so the rows are clipped to its corners in here. */}
        <View style={styles.raisedBlock}>{body}</View>
      </Raised>
    )
  }

  return (
    <View style={[styles.block, bare && styles.bareBlock, { backgroundColor: fill }]} accessibilityLabel={view.title}>
      {body}
    </View>
  )
}

const styles = StyleSheet.create({
  tileLabel: { flexDirection: 'row', alignItems: 'flex-start', gap: 2 },
  tileLabelText: { flexShrink: 1 },
  tileChevron: { marginTop: 2 },
  chartTaps: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row' },
  flexOne: { flex: 1 },
  flex: { flex: 1 },
  block: { borderRadius: radius.group, overflow: 'hidden', paddingTop: 6, paddingBottom: 6 },
  raisedBlock: { borderRadius: radius.card, overflow: 'hidden', paddingTop: 6, paddingBottom: 6 },
  bareBlock: { paddingTop: 6, borderRadius: 0 },
  emptyBlock: { paddingTop: 4, paddingBottom: 6 },
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
  tableMark: { width: 14, justifyContent: 'center' },
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
  numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '40%', minWidth: 0, borderRadius: radius.chip, paddingVertical: 12, paddingHorizontal: 14, gap: 2 },
  number: { flex: 1, gap: 2 },
  boardRow: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 2, gap: 8 },
  boardColumnWrap: { flexDirection: 'row' },
  boardColumn: { width: 150, borderRadius: radius.thumb, paddingTop: 10, paddingHorizontal: 12, paddingBottom: 12, gap: 6 },
  boardItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  boardDot: { marginTop: 6 },
  table: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  tableRow: { flexDirection: 'row', minHeight: 40, alignItems: 'center' },
  tableRule: { borderTopWidth: StyleSheet.hairlineWidth },
  tableCell: { width: 120, paddingRight: 12 },
  chart: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  chartEnds: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6 },
  summary: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, rowGap: 12 },
})
