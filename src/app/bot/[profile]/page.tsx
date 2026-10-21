import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { RecordRow } from '@/components/dashboard/ViewBlock'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Raised } from '@/components/ui/Raised'
import { Screen } from '@/components/ui/Screen'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { groupRows, moreLabel, pageCaption } from '@/features/dashboard/page'
import { formatTyped } from '@/features/dashboard/view'
import { describeError } from '@/features/sessions/store'
import { getViewPage, type PageRow, type Typed, type ViewPage, type ViewRow } from '@/lib/hermes/dashboard'
import { useNow } from '@/lib/useNow'
import { useBotView } from '@/stores/bots'
import { useConnection } from '@/stores/connection'
import { useDrafts } from '@/stores/drafts'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

/** A table page's row as a list row: its first cell names it, the next two say what else it holds. */
function asRow(row: PageRow & { cells?: (Typed | null)[] }, nowS: number): ViewRow {
  if (!row.cells) {
    return row
  }

  const [first, ...rest] = row.cells
  const under = rest
    .slice(0, 2)
    .flatMap(cell => (cell ? [formatTyped(cell, nowS)] : []))
    .join(' · ')

  return { id: row.id, done: row.done, needs_you: row.needs_you, ...(first ? { title: first } : {}), ...(under ? { subtitle: { key: '_cells', type: 'text', value: under } } : {}) }
}

/**
 * The page a number, chart or stat opens (hermes-dashboard 0.6+): the records it counts, in their groups, each opening its
 * record. A page holds only records: dashboard, page, record, never deeper.
 */
export default function PanelPage() {
  const { profile, view, bucket, metric } = useLocalSearchParams<{ profile: string; view: string; bucket?: string; metric?: string }>()
  const router = useRouter()
  const { c } = useTheme()
  const bot = useBotView(profile)
  const name = bot?.name ?? profile
  const [page, setPage] = useState<ViewPage | null>(null)
  const [rows, setRows] = useState<PageRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pulling, setPulling] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const clock = useNow(60)
  const options = { ...(bucket ? { bucket } : {}), ...(metric !== undefined ? { metric: Number(metric) } : {}) }

  const load = useCallback(async (offset = 0) => {
    const config = useConnection.getState().config

    if (!config) {
      setError('Not connected to the server.')

      return
    }

    try {
      const answer = await getViewPage(config, profile, view, { ...options, offset })
      setPage(answer)
      setRows(current => (offset ? [...current, ...(answer.rows ?? [])] : (answer.rows ?? [])))
      setError(null)
    } catch (problem) {
      setError(describeError(problem))
    }
    // The page is named by its route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, view, bucket, metric])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function onPull() {
    setPulling(true)
    await load()
    setPulling(false)
  }

  async function more() {
    if (!page?.next) {
      return
    }

    setLoadingMore(true)
    await load(page.next)
    setLoadingMore(false)
  }

  const openRecord = (id: string) => router.push({ pathname: '/bot/[profile]/record', params: { profile, id } })
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/bot/[profile]/dashboard', params: { profile } }))
  const askBot = () => {
    useDrafts.getState().set(profile, `About the “${page?.title ?? 'list'}” list on my dashboard (load skill_view("hermes-dashboard:dashboard") first): `)
    router.push({ pathname: '/bot/[profile]', params: { profile } })
  }

  const nowS = page?.now ?? clock
  const groupField = page?.group_by && page.kind !== 'board' ? page.fields.find(field => field.key === page.group_by) : undefined
  const caption = page ? pageCaption(page) : ''
  const boardColumns = page?.kind === 'board' ? ((page.columns ?? []) as { name: string; count: number; rows: ViewRow[] }[]) : []
  const groups = page?.kind === 'board' ? boardColumns.filter(column => column.count).map(column => ({ key: column.name, label: column.name, rows: column.rows as PageRow[], count: column.count })) : groupRows(rows, groupField, nowS).map(group => ({ ...group, count: group.rows.length }))
  const rest = page && page.kind !== 'board' ? moreLabel(page, rows.length) : ''

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={back} />
          <T variant="heading" numberOfLines={1} style={styles.flex} accessibilityRole="header">
            {page?.title ?? ''}
          </T>
        </View>

        {page ? (
          <ScrollView style={styles.flex} contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onPull()} tintColor={c.text2} />}>
            <View style={styles.count} accessible accessibilityLabel={`${page.count}${caption ? `, ${caption}` : ''}`}>
              <T variant="stat" style={styles.countFigure}>
                {String(page.count)}
              </T>
              {caption ? (
                <T variant="secondary" color="text2">
                  {caption}
                </T>
              ) : null}
              {page.collection_title ? (
                <T variant="label" color="text2">
                  From {page.collection_title}
                  {page.live ? ' · read live' : ''}
                </T>
              ) : null}
            </View>

            {page.count === 0 ? (
              <T variant="secondary" color="text2" style={styles.inset}>
                Nothing here right now.
              </T>
            ) : null}

            {groups.map(group => (
              <View key={group.key || 'all'} style={styles.group}>
                {group.label ? (
                  <T variant="label" color="text2" style={styles.inset}>
                    {group.label} · {group.count}
                  </T>
                ) : null}
                <View style={[styles.sheet, { backgroundColor: c.sheet }]}>
                  {group.rows.map((item, index) => (
                    <View key={item.id}>
                      {index > 0 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
                      <RecordRow row={asRow(item, nowS)} nowS={nowS} onPress={() => openRecord(item.id)} />
                    </View>
                  ))}
                </View>
              </View>
            ))}

            {rest ? <Pill label={rest} height={44} loading={loadingMore} onPress={() => void more()} /> : null}
          </ScrollView>
        ) : (
          <View style={styles.center}>
            {error ? (
              <T variant="secondary" color="text2" style={styles.centered}>
                {error}
              </T>
            ) : (
              <Spinner size={16} />
            )}
          </View>
        )}

        <View style={styles.footer}>
          <Raised radius={32} style={styles.tray}>
            <Pill label={`Ask ${name} about these`} height={48} onPress={askBot} />
          </Raised>
        </View>
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 6 },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 16 },
  count: { gap: 2, paddingHorizontal: 4 },
  countFigure: { fontSize: 40, lineHeight: 44 },
  inset: { paddingHorizontal: 4 },
  group: { gap: 8 },
  sheet: { borderRadius: radius.card, overflow: 'hidden' },
  separator: { height: 1, marginLeft: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
  footer: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  tray: { padding: 8 },
})
