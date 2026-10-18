import Feather from '@expo/vector-icons/Feather'
import { Fragment } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import { keptBy, keptLine } from '@/features/dashboard/view'
import { useNow } from '@/lib/useNow'
import type { View as DashboardView } from '@/lib/hermes/dashboard'
import { useDashboards } from '@/stores/dashboards'
import { useRoster } from '@/stores/roster'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

interface Props {
  /** The panel the menu is for; null keeps it closed. */
  view: DashboardView | null
  profile: string
  botName: string
  onClose: () => void
  onAsk: (view: DashboardView) => void
  /** "Refresh now" for a live panel, "Check now" otherwise. */
  onCheck: (view: DashboardView) => void
  /** Omitted on the full view itself. */
  onOpenFull?: (view: DashboardView) => void
}

/** A panel's ⋯: ask the bot about it, run the routine that keeps it, open it full screen. The bot decides what it shows. */
export function PanelMenu({ view, profile, botName, onClose, onAsk, onCheck, onOpenFull }: Props) {
  const { c } = useTheme()
  const meta = useRoster(state => state.rows.find(row => row.name === profile)?.ui_meta?.['hermes-bots'])
  const keepers = useDashboards(state => state.keepers[profile])
  const serverNow = useDashboards(state => state.byBot[profile]?.dashboard?.now)
  const clock = useNow(60)
  const routines = keepers ? keptBy(keepers) : ''
  const line = view ? keptLine(view, botName, serverNow || clock, routines) : ''
  const live = view?.kept?.how === 'live'
  const feedJob = view?.kept?.how === 'computed' ? view.kept.feed : undefined
  const full = view && onOpenFull && (view.kind === 'list' || view.kind === 'board' || view.kind === 'table') ? onOpenFull : null

  const rows: { label: string; value?: string; chevron: boolean; onPress: () => void }[] = view
    ? [
        { label: `Ask ${botName} about this panel`, chevron: true, onPress: () => onAsk(view) },
        // A live panel reads its source again; a panel kept by a recorded job runs it; otherwise Check now is offered until
        // the routines are read, then only when one keeps the dashboard.
        ...(live
          ? [{ label: 'Refresh now', value: 'Reads it now', chevron: false, onPress: () => onCheck(view) }]
          : feedJob?.job
            ? [{ label: 'Check now', value: feedJob.how === 'script' ? 'Runs the script' : 'Runs the routine', chevron: false, onPress: () => onCheck(view) }]
            : keepers === undefined || keepers.length
              ? [{ label: 'Check now', value: 'Runs the routine', chevron: false, onPress: () => onCheck(view) }]
              : []),
        ...(full ? [{ label: 'Open full view', chevron: true, onPress: () => full(view) }] : []),
      ]
    : []

  return (
    <Sheet visible={!!view} onClose={onClose} label={view ? `${view.title} options` : 'Panel options'}>
      {view ? (
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={styles.face}>
              <BotFace name={profile} meta={meta} size={28} />
            </View>
            <View style={styles.titles}>
              <T variant="sheetTitle">{view.title}</T>
              {line ? (
                // A live read's error can be a script's stderr: four lines say enough, and Ask can go further.
                <T variant="label" color="text2" numberOfLines={4}>
                  {line}
                </T>
              ) : null}
            </View>
          </View>
          <View style={[styles.group, { backgroundColor: c.sheet }]}>
            {rows.map((row, index) => (
              <Fragment key={row.label}>
                {index > 0 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={row.value ? `${row.label}, ${row.value}` : row.label} onPress={row.onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.tone }]}>
                  <T variant="body" style={styles.flex} numberOfLines={1}>
                    {row.label}
                  </T>
                  {row.value ? (
                    <T variant="label" color="text2">
                      {row.value}
                    </T>
                  ) : null}
                  {row.chevron ? <Feather name="chevron-right" size={16} color={c.text2} /> : null}
                </Pressable>
              </Fragment>
            ))}
          </View>
          <T variant="label" color="text2" style={styles.note}>
            {botName} decides what this panel shows. Ask it to split, chart or track something new.
          </T>
        </View>
      ) : null}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { paddingBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginHorizontal: 4, marginBottom: 14 },
  face: { marginTop: -3 },
  titles: { flex: 1, minWidth: 0, gap: 2 },
  group: { borderRadius: radius.list, overflow: 'hidden' },
  row: { minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  separator: { height: 1, marginLeft: 16 },
  note: { marginHorizontal: 4, marginTop: 12 },
})
