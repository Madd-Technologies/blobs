import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { IconCircle } from '@/components/ui/IconCircle'
import { Press } from '@/components/ui/Press'
import { T } from '@/components/ui/T'
import { motionFor } from '@/features/face/motion'
import type { BotView } from '@/features/roster/view'
import { useDashboards } from '@/stores/dashboards'
import { useRoster } from '@/stores/roster'
import { useTheme } from '@/theme/ThemeProvider'

interface Props {
  profile: string
  view: BotView | undefined
  /** The quiet line under the name. */
  status: string
  /** It is your turn (a prompt waits): a small amber dot leads the status line. */
  waiting?: boolean
  /** The bot is mid-turn: taller eyes, and the face works (glances, breathes). */
  working?: boolean
}

export function ChatHeader({ profile, view, status, waiting, working }: Props) {
  const router = useRouter()
  const { c } = useTheme()
  // The dashboard is a tap away from any bot's chat once the server has the plugin; amber when something on it needs you.
  const dashboards = useDashboards(state => state.available === true)
  const needsYou = useDashboards(state => state.summary[profile]?.needs_you ?? 0)
  // Until the roster arrives the bot's real name is unknown: show nothing rather than a raw slug.
  const known = useRoster(state => state.loaded)
  const name = view?.name ?? profile
  // The face squishes as you press it (on the way to the bot's details).
  const [poke, setPoke] = useState(0)

  return (
    <View style={styles.header}>
      <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <Press
        scale={0.98}
        accessibilityRole="button"
        accessibilityLabel={`${name}'s details`}
        onPress={() => router.push({ pathname: '/bot/[profile]/details', params: { profile } })}
        onPressIn={() => setPoke(count => count + 1)}
        style={styles.identity}
      >
        <BotFace name={profile} meta={view?.meta} size={30} mood={working ? 'work' : 'idle'} motion={motionFor({ needsYou: view?.attention.state === 'needsYou', working })} poke={poke} />
        <View style={styles.title}>
          <T variant="heading" numberOfLines={1}>
            {view || known ? name : ' '}
          </T>
          {status ? (
            <View style={styles.status}>
              {waiting ? <View style={[styles.dot, { backgroundColor: c.needsYou }]} /> : null}
              <T variant="status" color="text2" numberOfLines={1} style={styles.statusText}>
                {status}
              </T>
            </View>
          ) : null}
        </View>
      </Press>
      {dashboards ? (
        <IconCircle
          icon="layout"
          label={needsYou ? `${name}'s dashboard, ${needsYou} ${needsYou === 1 ? 'thing needs' : 'things need'} you` : `${name}'s dashboard`}
          dot={needsYou ? c.needsYou : undefined}
          dotAt="top"
          onPress={() => router.push({ pathname: '/bot/[profile]/dashboard', params: { profile } })}
        />
      ) : null}
      <IconCircle icon="message-square" label={`${name}'s chats`} onPress={() => router.push({ pathname: '/bot/[profile]/chats', params: { profile } })} />
      <IconCircle icon="monitor" label={`Open ${name}'s screen`} onPress={() => router.push({ pathname: '/screens/[profile]', params: { profile } })} />
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 10 },
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, minWidth: 0 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
})
