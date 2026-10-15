import { useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, StyleSheet, TextInput, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import { uniqueSkills, withSkill } from '@/lib/hermes/profiles'
import { useConnection } from '@/stores/connection'
import { saveSkills, useProfileDetail } from '@/stores/profiles'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/** Which skills a bot can use. Off ones are hidden from the bot; it takes effect on its next message. */
export default function BotSkills() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const { c } = useTheme()
  const online = useConnection(state => state.status === 'online')
  const detail = useProfileDetail(state => state.byBot[profile]?.detail ?? null)
  const [query, setQuery] = useState('')
  // Switches show at once; this holds them until the server's answer comes back (or is refused and they go back).
  const [pending, setPending] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (online) {
      void useProfileDetail.getState().load(profile)
    }
  }, [online, profile])

  const skills = useMemo(() => uniqueSkills(detail?.skills ?? []).map(skill => (skill.name in pending ? { ...skill, enabled: pending[skill.name] ?? skill.enabled } : skill)), [detail, pending])
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return needle ? skills.filter(skill => skill.name.toLowerCase().includes(needle)) : skills
  }, [skills, query])
  const on = skills.filter(skill => skill.enabled).length

  async function toggle(name: string, enabled: boolean) {
    const before = skills
    setPending(current => ({ ...current, [name]: enabled }))
    const error = await saveSkills(profile, withSkill(before, name, enabled))
    setPending(current => {
      const { [name]: _settled, ...rest } = current

      return rest
    })

    if (error) {
      toast(error)
    }
  }

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title="Skills" />
        <View style={styles.search}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={detail ? `Search ${skills.length} skills` : 'Search skills'}
            placeholderTextColor={c.text2}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search skills"
            style={[styles.field, { backgroundColor: c.sheet, color: c.text }]}
          />
          {detail ? (
            <T variant="label" color="text2" style={styles.count}>
              {on} of {skills.length} on
            </T>
          ) : null}
        </View>

        {!detail ? (
          <View style={styles.center}>
            <Spinner size={16} />
          </View>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={skill => skill.name}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <T variant="secondary" color="text2" style={styles.empty}>
                {skills.length ? 'No skills match.' : 'This bot has no skills.'}
              </T>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <T variant="body" numberOfLines={1} style={styles.name}>
                  {item.name}
                </T>
                <Switch value={item.enabled} onValueChange={value => void toggle(item.name, value)} label={item.name} />
              </View>
            )}
          />
        )}
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  field: { height: 44, borderRadius: radius.field, paddingHorizontal: 16, fontFamily: fonts.regular, fontSize: 15 },
  count: { paddingHorizontal: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', paddingTop: 80 },
  empty: { textAlign: 'center', paddingTop: 40 },
  row: { minHeight: 52, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { flex: 1 },
})
