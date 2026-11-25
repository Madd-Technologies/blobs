import Feather from '@expo/vector-icons/Feather'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { RoomFaces } from '@/components/rooms/RoomFaces'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import { buildStationCommands, filterStationCommands, type StationCommand } from '@/features/station/commands'
import { useNow } from '@/lib/useNow'
import { useBotMetas, useBotViews } from '@/stores/bots'
import { useRoomViews } from '@/stores/rooms'
import { useStation } from '@/stores/station'
import { toast } from '@/stores/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

export function CommandPalette({
  visible,
  onClose,
  dashboardsReady,
}: {
  visible: boolean
  onClose: () => void
  dashboardsReady: boolean
}) {
  return (
    <Sheet visible={visible} onClose={onClose} label="Command palette" avoidKeyboard>
      {visible ? <PaletteBody onClose={onClose} dashboardsReady={dashboardsReady} /> : null}
    </Sheet>
  )
}

function PaletteBody({ onClose, dashboardsReady }: { onClose: () => void; dashboardsReady: boolean }) {
  const { c } = useTheme()
  const router = useRouter()
  const views = useBotViews({ includeHidden: true })
  const rooms = useRoomViews()
  const metas = useBotMetas()
  const fleetPaused = useStation(state => Boolean(state.fleet?.paused))
  const quiet = useStation(state => state.quiet)
  const pauseFleet = useStation(state => state.pauseFleet)
  const resumeFleet = useStation(state => state.resumeFleet)
  const silenceFor = useStation(state => state.silenceFor)
  const nowS = useNow(60)
  const [query, setQuery] = useState('')

  const quietActive = Boolean(quiet && ((quiet.muted_until ?? 0) > nowS))

  const allCommands = useMemo(
    () => buildStationCommands({ views, rooms, fleetPaused, quietActive, dashboardsReady }),
    [views, rooms, fleetPaused, quietActive, dashboardsReady],
  )
  const shown = useMemo(() => filterStationCommands(allCommands, query), [allCommands, query])

  async function execute(cmd: StationCommand) {
    onClose()

    if (cmd.kind === 'route') {
      router.push(cmd.pathname)
      return
    }

    if (cmd.kind === 'bot') {
      router.push({
        pathname: cmd.mode === 'dashboard' ? '/bot/[profile]/dashboard' : '/bot/[profile]',
        params: { profile: cmd.profile },
      })
      return
    }

    if (cmd.kind === 'room') {
      router.push({ pathname: '/room/[id]', params: { id: cmd.roomId } })
      return
    }

    if (cmd.action === 'toggleFleetPause') {
      const error = fleetPaused ? await resumeFleet() : await pauseFleet('Paused from command palette')
      toast(error ?? (fleetPaused ? 'Fleet resumed' : 'Fleet paused'))
      return
    }

    const error = quietActive ? await silenceFor(0) : await silenceFor(3600)
    toast(error ?? (quietActive ? 'Notifications unsilenced' : 'Notifications silenced for 1 hour'))
  }

  return (
    <View style={styles.body}>
      <View style={[styles.searchBox, { backgroundColor: c.tone }]}>
        <Feather name="command" size={16} color={c.text2} />
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Jump to a bot, screen, or action"
          placeholderTextColor={c.text2}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          style={[styles.input, { color: c.text }]}
          onSubmitEditing={() => {
            if (shown[0]) {
              void execute(shown[0])
            }
          }}
        />
      </View>

      <FlatList
        data={shown}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.separator }]} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => void execute(item)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.tone }]}
          >
            {item.kind === 'bot' ? (
              <BotFace name={item.profile} meta={metas[item.profile]} size={28} />
            ) : item.kind === 'room' ? (
              <RoomFaces members={(rooms.find(r => r.id === item.roomId)?.data.room.members ?? []).slice(0, 2)} metas={metas} variant="header" ring={c.sheet} />
            ) : (
              <View style={[styles.iconWrap, { backgroundColor: c.tone }]}>
                <Feather name={item.icon} size={16} color={c.text} />
              </View>
            )}
            <View style={styles.rowText}>
              <T variant="rowTitle" numberOfLines={1}>
                {item.title}
              </T>
              <T variant="label" color="text2" numberOfLines={1}>
                {item.subtitle}
              </T>
            </View>
            <Feather name="chevron-right" size={16} color={c.text2} />
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <T variant="secondary" color="text2">
              No matching commands
            </T>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: 12, maxHeight: 440 },
  searchBox: { height: 44, borderRadius: radius.field, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, padding: 0, fontFamily: fonts.regular, fontSize: 15 },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 6, borderRadius: radius.list },
  iconWrap: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 1 },
  sep: { height: 1, marginLeft: 46 },
  empty: { paddingVertical: 28, alignItems: 'center' },
})
