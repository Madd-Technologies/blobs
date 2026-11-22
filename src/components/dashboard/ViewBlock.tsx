import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Markdown } from '@/components/chat/Markdown'
import { Chart, NumbersBlock, TileLabel } from '@/components/dashboard/PanelCharts'
import { Header, RecordRow, RowMark, Rows, SignalDot } from '@/components/dashboard/PanelParts'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { formatTyped, staleNote, tableRowWords } from '@/features/dashboard/view'
import type { Typed, View as DashboardView, ViewRow } from '@/lib/hermes/dashboard'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

export { NumbersBlock } from '@/components/dashboard/PanelCharts'
export { RecordRow } from '@/components/dashboard/PanelParts'

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
  flex: { flex: 1 },
  block: { borderRadius: radius.group, overflow: 'hidden', paddingTop: 6, paddingBottom: 6 },
  raisedBlock: { borderRadius: radius.card, overflow: 'hidden', paddingTop: 6, paddingBottom: 6 },
  bareBlock: { paddingTop: 6, borderRadius: 0 },
  emptyBlock: { paddingTop: 4, paddingBottom: 6 },
  muted: { opacity: 0.45 },
  tableMark: { width: 14, justifyContent: 'center' },
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
  summary: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, rowGap: 12 },
})
