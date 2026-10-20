import type { Href } from 'expo-router'
import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { IconCircle } from '@/components/ui/IconCircle'
import { T } from '@/components/ui/T'
import { useBotView } from '@/stores/bots'

/** A phone screen's header, on the bot's paper: back, the bot's face, a title and a status line. */
export function PhoneHeader({ profile, title, status, fallback }: { profile: string; title: string; status?: ReactNode; fallback: Href }) {
  const router = useRouter()
  const view = useBotView(profile)

  return (
    <View style={styles.header}>
      <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))} />
      <BotFace name={profile} meta={view?.meta} size={30} />
      <View style={styles.titles}>
        <T variant="heading" numberOfLines={1}>
          {title}
        </T>
        {status ? (
          <T variant="status" color="text2" numberOfLines={1}>
            {status}
          </T>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 10 },
  titles: { flex: 1, minWidth: 0 },
})
