import Feather from '@expo/vector-icons/Feather'
import { Pressable, StyleSheet, View } from 'react-native'
import Svg, { Polyline, Rect } from 'react-native-svg'

import { T } from '@/components/ui/T'
import { changeLine, chartEnds, figure } from '@/features/dashboard/view'
import type { View as DashboardView } from '@/lib/hermes/dashboard'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

/** A tile's small label, with a chevron when tapping it opens a page of its records. */
export function TileLabel({ text, opens }: { text: string; opens: boolean }) {
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

export function Chart({ view, onOpenPage }: { view: Extract<DashboardView, { kind: 'chart' }>; onOpenPage?: (options: { bucket?: string }) => void }) {
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

const styles = StyleSheet.create({
  tileLabel: { flexDirection: 'row', alignItems: 'flex-start', gap: 2 },
  tileLabelText: { flexShrink: 1 },
  tileChevron: { marginTop: 2 },
  chartTaps: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row' },
  flexOne: { flex: 1 },
  numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '40%', minWidth: 0, borderRadius: radius.chip, paddingVertical: 12, paddingHorizontal: 14, gap: 2 },
  chart: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  chartEnds: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6 },
})
