import Feather from '@expo/vector-icons/Feather'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { T } from '@/components/ui/T'
import { buildMembers, MAX_MEMBERS, MIN_MEMBERS, nameList } from '@/lib/hermes/rooms'
import { useBotViews } from '@/stores/bots'
import { makeRoom, useRooms } from '@/stores/rooms'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/** Pick two to six bots and name the room. The server runs it from then on. */
export default function NewRoom() {
  const { c } = useTheme()
  const router = useRouter()
  const views = useBotViews()
  const available = useRooms(state => state.available)
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const chosen = useMemo(() => picked.map(profile => views.find(view => view.profile === profile)).filter((view): view is NonNullable<typeof view> => !!view), [picked, views])
  const ready = chosen.length >= MIN_MEMBERS && chosen.length <= MAX_MEMBERS
  const suggested = chosen.length >= MIN_MEMBERS ? nameList(chosen.map(view => view.name)) : 'Room name'

  function toggle(profile: string) {
    setPicked(current => (current.includes(profile) ? current.filter(entry => entry !== profile) : current.length < MAX_MEMBERS ? [...current, profile] : current))
  }

  async function create() {
    setCreating(true)
    const result = await makeRoom(name.trim() || suggested, buildMembers(chosen.map(view => ({ profile: view.profile, name: view.name }))))
    setCreating(false)

    if ('error' in result) {
      toast(result.error)

      return
    }

    router.replace({ pathname: '/room/[id]', params: { id: result.id } })
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="New room" />

      {available === false ? (
        <View style={styles.center}>
          <T variant="body" style={styles.centered}>
            This server can’t run rooms
          </T>
          <T variant="secondary" color="text2" style={styles.centered}>
            Its room worker isn’t running. Restart Hermes on the server and try again.
          </T>
        </View>
      ) : (
        <>
          <FlatList
            data={views}
            keyExtractor={view => view.profile}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View style={styles.top}>
                <T variant="label" color="text2" style={styles.label}>
                  Name
                </T>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder={suggested}
                  placeholderTextColor={c.text2}
                  accessibilityLabel="Room name"
                  maxLength={80}
                  style={[styles.field, { backgroundColor: c.sheet, color: c.text }]}
                />
                <T variant="label" color="text2" style={styles.label}>
                  Bots · pick {MIN_MEMBERS} to {MAX_MEMBERS}
                </T>
              </View>
            }
            renderItem={({ item }) => {
              const on = picked.includes(item.profile)
              const full = !on && picked.length >= MAX_MEMBERS

              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: full }}
                  accessibilityLabel={item.name}
                  disabled={full}
                  onPress={() => toggle(item.profile)}
                  style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.sheet : 'transparent', opacity: full ? 0.4 : 1 }]}
                >
                  <BotFace name={item.profile} meta={item.meta} size={36} />
                  <T variant="body" style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </T>
                  {on ? <Feather name="check" size={18} color={c.text} /> : <View style={styles.checkSpace} />}
                </Pressable>
              )
            }}
            contentContainerStyle={styles.list}
          />
          <View style={styles.footer}>
            <Pill label="Create room" variant="primary" height={52} loading={creating} disabled={!ready} onPress={() => void create()} style={styles.primary} />
          </View>
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingBottom: 4, gap: 8 },
  label: { paddingHorizontal: 4, paddingTop: 8 },
  field: { height: 48, borderRadius: radius.field, paddingHorizontal: 16, fontFamily: fonts.regular, fontSize: 16 },
  list: { paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8, minHeight: 56 },
  rowName: { flex: 1 },
  checkSpace: { width: 18 },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  primary: { alignSelf: 'stretch' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
})
