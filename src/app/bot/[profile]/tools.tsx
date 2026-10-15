import { useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import { toolsetDetail, toolsetsLine } from '@/lib/hermes/toolsets'
import { useConnection } from '@/stores/connection'
import { useToolsets } from '@/stores/toolsets'
import { toast } from '@/stores/toast'

/** Which groups of tools a bot can use. It is that bot's own setting; the change reaches it on its next message. */
export default function BotTools() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const online = useConnection(state => state.status === 'online')
  const entry = useToolsets(state => state.byBot[profile])

  useEffect(() => {
    if (online) {
      void useToolsets.getState().load(profile)
    }
  }, [online, profile])

  async function toggle(name: string, enabled: boolean) {
    const error = await useToolsets.getState().toggle(profile, name, enabled)

    if (error) {
      toast(error)
    }
  }

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title="Tools" />
        {!entry ? (
          <View style={styles.center}>
            <Spinner size={16} />
          </View>
        ) : entry.error && !entry.rows.length ? (
          <View style={styles.center}>
            <T variant="secondary" color="text2" style={styles.message} selectable>
              {entry.error}
            </T>
          </View>
        ) : (
          <FlatList
            data={entry.rows}
            keyExtractor={row => row.name}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <T variant="label" color="text2" style={styles.count}>
                {toolsetsLine(entry.rows)}
              </T>
            }
            ListEmptyComponent={
              <T variant="secondary" color="text2" style={styles.message}>
                This bot has no toolsets to switch.
              </T>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={styles.text}>
                  <T variant="body" numberOfLines={1}>
                    {item.label}
                  </T>
                  <T variant="label" color="text2" numberOfLines={2}>
                    {toolsetDetail(item)}
                  </T>
                  {!item.configured ? (
                    <T variant="label" color="text2">
                      Needs setup on the server before it works
                    </T>
                  ) : null}
                </View>
                <Switch value={item.enabled} onValueChange={value => void toggle(item.name, value)} label={item.label} />
              </View>
            )}
          />
        )}
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  count: { paddingHorizontal: 4, paddingBottom: 8 },
  center: { flex: 1, alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  message: { textAlign: 'center', paddingTop: 40 },
  row: { minHeight: 60, paddingVertical: 8, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 2 },
})
