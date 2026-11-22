import { ScrollView, StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { RoomFaces } from '@/components/rooms/RoomFaces'
import { Press } from '@/components/ui/Press'
import { T } from '@/components/ui/T'
import type { InFlightItem } from '@/features/roster/inflight'
import { faceColor } from '@/lib/hermes/faceColor'
import type { BotMeta } from '@/lib/hermes/identity'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius, tintLevel } from '@/theme/tokens'

interface Props {
  items: InFlightItem[]
  metas: Record<string, BotMeta | undefined>
  onOpen: (item: InFlightItem) => void
}

const TILE = 156

/**
 * Live base-station strip on Home: active phone errands, working bots, replying rooms, and background helpers.
 * Renders nothing when everything is idle so Home stays calm.
 */
export function InFlightStrip({ items, metas, onOpen }: Props) {
  const { c, scheme } = useTheme()

  if (!items.length) {
    return null
  }

  return (
    <View>
      <T variant="rowTitle" color="text2" style={styles.title} accessibilityRole="header">
        In flight
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} accessibilityLabel="In flight">
        {items.map(item => {
          const fill =
            item.kind === 'room'
              ? c.sheet
              : tintLevel(scheme, 'sheet', faceColor(item.profile, item.meta ?? metas[item.profile]))

          return (
            <Press
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}: ${item.subtitle}`}
              onPress={() => onOpen(item)}
              style={[styles.tile, { backgroundColor: fill }]}
            >
              <View style={styles.top}>
                {item.kind === 'room' ? (
                  <RoomFaces members={item.members.slice(0, 2)} metas={metas} variant="header" ring={fill} />
                ) : (
                  <BotFace name={item.profile} meta={item.meta ?? metas[item.profile]} size={22} mood="work" />
                )}
                <T variant="label" numberOfLines={1} style={styles.name}>
                  {item.title}
                </T>
                <View style={[styles.liveDot, { backgroundColor: c.connected }]} />
              </View>
              <T variant="meta" color="text2" numberOfLines={2}>
                {item.subtitle}
              </T>
            </Press>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10 },
  strip: { gap: 10, paddingHorizontal: 16 },
  tile: {
    width: TILE,
    minHeight: 82,
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderRadius: radius.list,
    justifyContent: 'space-between',
    gap: 8,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, minWidth: 0, fontFamily: fonts.semibold },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
})
