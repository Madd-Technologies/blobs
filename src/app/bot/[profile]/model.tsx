import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { modelSections } from '@/lib/hermes/profiles'
import { useConnection } from '@/stores/connection'
import { saveModel, useModelOptions } from '@/stores/profiles'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

type Item =
  | { kind: 'header'; key: string; name: string; warning?: string }
  | { kind: 'model'; key: string; slug: string; model: string; current: boolean }
  | { kind: 'more'; key: string; slug: string; count: number }

/** Which model a bot uses. It writes the bot's own config, so it applies from the bot's next message. */
export default function BotModel() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const router = useRouter()
  const { c } = useTheme()
  const online = useConnection(state => state.status === 'online')
  const loaded = useModelOptions(state => state.byBot[profile])
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState<{ model: string; provider: string; message: string } | null>(null)

  useEffect(() => {
    if (online) {
      void useModelOptions.getState().load(profile)
    }
  }, [online, profile])

  const options = loaded?.options ?? null
  const items = useMemo<Item[]>(() => {
    if (!options) {
      return []
    }

    return modelSections(options, query, expanded).flatMap<Item>(section => [
      { kind: 'header', key: `h-${section.slug}`, name: section.name, warning: section.warning },
      ...section.models.map<Item>(model => ({ kind: 'model', key: `m-${section.slug}-${model}`, slug: section.slug, model, current: section.slug === options.provider && model === options.model })),
      ...(section.hidden > 0 ? [{ kind: 'more' as const, key: `x-${section.slug}`, slug: section.slug, count: section.hidden }] : []),
    ])
  }, [options, query, expanded])

  async function choose(model: string, provider: string, confirmed = false) {
    setBusy(`${provider}/${model}`)
    const result = await saveModel(profile, model, provider, confirmed)
    setBusy(null)

    if (result.kind === 'confirm') {
      setAsking({ model, provider, message: result.message })

      return
    }

    if (result.kind === 'done') {
      toast('Model changed')
      router.back()

      return
    }

    toast(result.kind === 'error' ? result.message : 'The server did not change the model.')
  }

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title="Model" />
        <View style={styles.search}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search models"
            placeholderTextColor={c.text2}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search models"
            style={[styles.field, { backgroundColor: c.sheet, color: c.text }]}
          />
        </View>

        {!options ? (
          <View style={styles.center}>{loaded?.error ? <T variant="secondary" color="text2" style={styles.centered}>{loaded.error}</T> : <Spinner size={16} />}</View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={item => item.key}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <T variant="secondary" color="text2" style={styles.centered}>
                No models match.
              </T>
            }
            renderItem={({ item }) => {
              if (item.kind === 'header') {
                return (
                  <View style={styles.header}>
                    <T variant="meta" color="text2">
                      {item.name}
                    </T>
                    {item.warning ? (
                      <T variant="label" color="text2">
                        {item.warning}
                      </T>
                    ) : null}
                  </View>
                )
              }

              if (item.kind === 'more') {
                return (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Show ${item.count} more`} onPress={() => setExpanded(current => new Set([...current, item.slug]))} style={styles.row}>
                    <T variant="secondary" color="text2">
                      Show {item.count} more
                    </T>
                  </Pressable>
                )
              }

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.model}
                  accessibilityState={{ selected: item.current }}
                  disabled={busy !== null}
                  onPress={() => (item.current ? router.back() : void choose(item.model, item.slug))}
                  style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.sheet : 'transparent', opacity: busy !== null && busy !== `${item.slug}/${item.model}` ? 0.5 : 1 }]}
                >
                  <T variant="body" numberOfLines={1} style={[styles.model, { fontFamily: item.current ? fonts.monoMedium : fonts.mono }]}>
                    {item.model}
                  </T>
                  {busy === `${item.slug}/${item.model}` ? <Spinner size={14} /> : item.current ? <T variant="meta">In use</T> : null}
                </Pressable>
              )
            }}
          />
        )}

        <ConfirmSheet
          visible={asking !== null}
          title="Use this model?"
          message={asking?.message}
          confirmLabel="Use it"
          onClose={() => setAsking(null)}
          onConfirm={() => asking && void choose(asking.model, asking.provider, true)}
        />
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: 16, paddingBottom: 8 },
  field: { height: 44, borderRadius: radius.field, paddingHorizontal: 16, fontFamily: fonts.regular, fontSize: 15 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 },
  centered: { textAlign: 'center', paddingTop: 40 },
  header: { paddingTop: 20, paddingBottom: 6, paddingHorizontal: 4, gap: 2 },
  row: { minHeight: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12 },
  model: { flex: 1, fontSize: 14 },
})
