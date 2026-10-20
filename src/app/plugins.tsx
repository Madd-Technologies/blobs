import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { T } from '@/components/ui/T'
import { installMessage } from '@/features/plugins/catalog'
import { useBotViews } from '@/stores/bots'
import { pluginView } from '@/features/plugins/view'
import { useConnection } from '@/stores/connection'
import { useRestart } from '@/stores/restart'
import { SERVER_PLUGINS, useServerPlugins, type ServerPlugin } from '@/stores/serverPlugins'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

/** The pinned bots: a per-bot plugin (Dashboards) is installed for each of them too. */
function usePinnedProfiles(): string[] {
  const views = useBotViews()

  return views.filter(view => view.pinned).map(view => view.profile)
}

function copySetup(plugin: ServerPlugin, bots: string[]) {
  void Clipboard.setStringAsync(installMessage([plugin.name], undefined, bots))
  toast('Copied. Paste it to your Hermes bot, then restart Hermes when it’s done.')
}

/** One plugin: its name and state, what it does, what to do about it. */
function PluginBlock({ plugin }: { plugin: ServerPlugin }) {
  const bots = usePinnedProfiles()
  const { c } = useTheme()
  const router = useRouter()
  const check = useServerPlugins(state => state.byName[plugin.name])
  const checking = useServerPlugins(state => state.checking)
  const view = pluginView(plugin.name, check, plugin.version, checking)
  const ready = check?.state.kind === 'ready'
  // Installed but not loaded: one restart loads it, when this Hermes can restart itself from here.
  const canRestart = useRestart(state => !!state.status?.supported)
  const restartToLoad = check?.state.kind === 'restart' && canRestart

  return (
    <View style={[styles.block, { backgroundColor: c.sheet }]} accessible={false}>
      <View style={styles.head}>
        <T variant="rowTitle" style={styles.flex} numberOfLines={1}>
          {plugin.title}
        </T>
        <T variant="secondary" color="text2" numberOfLines={1}>
          {view.status}
        </T>
      </View>
      <T variant="secondary" color="text2">
        {plugin.about}
      </T>
      {view.lines.map(line => (
        <T key={line} variant="secondary">
          {line}
        </T>
      ))}
      {view.action || restartToLoad || (ready && plugin.name === 'hermes-bot-mobile' && Platform.OS === 'android') ? (
        <View style={styles.actions}>
          {restartToLoad ? <Pill label="Restart Hermes" icon="rotate-cw" variant="secondary" height={40} onPress={() => useRestart.getState().open('both')} /> : null}
          {view.action ? <Pill label={view.action === 'update' ? 'Copy update message' : 'Copy setup message'} icon="copy" variant="secondary" height={40} onPress={() => copySetup(plugin, bots)} /> : null}
          {ready && plugin.name === 'hermes-bot-mobile' && Platform.OS === 'android' ? <Pill label="Notification settings" variant="ghost" height={40} onPress={() => router.push('/notifications')} /> : null}
        </View>
      ) : null}
    </View>
  )
}

/** The Hermes plugins parts of the app run on: which the server has, and the message that has its bot install or update one. */
export default function ServerPlugins() {
  const { c } = useTheme()
  const host = useConnection(state => state.config?.baseUrl.replace(/^https?:\/\//i, '') ?? '')
  const online = useConnection(state => state.status === 'online')
  // The spinner is for a pull only: the check on opening fills the rows in quietly.
  const [pulling, setPulling] = useState(false)
  const byName = useServerPlugins(state => state.byName)
  const bots = usePinnedProfiles()
  // Several to install or update: one message for the bot does them all, with one restart after.
  // An optional plugin that is not there yet is offered on its own row only.
  const due = SERVER_PLUGINS.filter(plugin => {
    const action = pluginView(plugin.name, byName[plugin.name], plugin.version, false).action

    return action && !(plugin.optional && action === 'install')
  }).map(plugin => plugin.name)

  useEffect(() => {
    if (online) {
      void useServerPlugins.getState().check()
    }
  }, [online])

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Server plugins" subtitle={host} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true)
              void useServerPlugins.getState().check().finally(() => setPulling(false))
            }}
            tintColor={c.text2}
          />
        }
      >
        <T variant="secondary" color="text2" style={styles.note}>
          Parts of HermesBot that run on your Hermes server. Each is a Hermes plugin your bot can install for you.
        </T>
        {SERVER_PLUGINS.map(plugin => (
          <PluginBlock key={plugin.name} plugin={plugin} />
        ))}
        {due.length > 1 ? (
          <Pill
            label={`Copy one message for all ${due.length}`}
            icon="copy"
            variant="primary"
            height={52}
            onPress={() => {
              void Clipboard.setStringAsync(installMessage(due, undefined, bots))
              toast('Copied. Paste it to your Hermes bot, then restart Hermes when it’s done.')
            }}
          />
        ) : null}
        <T variant="label" color="text2" style={styles.note}>
          Plugins load when Hermes starts. Once your bot has installed or updated one, restart Hermes here (Settings → Restart Hermes); bots in the middle of something can finish first.
        </T>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 16 },
  note: { paddingHorizontal: 4 },
  block: { borderRadius: radius.group, padding: 16, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 },
})
