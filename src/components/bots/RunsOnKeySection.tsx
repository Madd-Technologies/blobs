import * as Clipboard from 'expo-clipboard'
import { StyleSheet, TextInput, View } from 'react-native'

import { GroupedList, Row } from '@/components/ui/GroupedList'
import { Pill } from '@/components/ui/Pill'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import type { RunsOnKey } from '@/lib/hermes/runsOn'
import { toast } from '@/stores/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

interface Props {
  name: string
  host: string
  user: string
  keyInfo: RunsOnKey | null | undefined
  ownKey: boolean
  keyPath: string
  onKeyPath: (path: string) => void
  onUseOwnKey: () => void
}

export function RunsOnKeySection({ name, host, user, keyInfo, ownKey, keyPath, onKeyPath, onUseOwnKey }: Props) {
  const { c } = useTheme()

  if (keyInfo === undefined) {
    return <Spinner size={14} />
  }

  if (keyInfo === null) {
    return (
      <View style={styles.group}>
        <T variant="label" color="text2">
          Key file on the server
        </T>
        <TextInput
          value={keyPath}
          onChangeText={onKeyPath}
          placeholder="/home/you/.ssh/id_ed25519"
          placeholderTextColor={c.text2}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Key file on the server"
          style={[styles.field, styles.mono, { backgroundColor: c.sheet, color: c.text }]}
        />
        <T variant="label" color="text2">
          Empty uses the server’s own SSH setup. With the optional Blobs plugin (Settings → Server plugins), the app can also make a key here and check the connection.
        </T>
      </View>
    )
  }

  if (!ownKey) {
    return (
      <View style={styles.group}>
        <T variant="label" color="text2">
          Uses the key at {keyPath} on the server.
        </T>
        <GroupedList radius={20}>
          <Row label={`Make a key for ${name}`} onPress={onUseOwnKey} />
        </GroupedList>
      </View>
    )
  }

  return (
    <View style={styles.group}>
      <T variant="label" color="text2">
        Add this key on {host.trim() || 'that computer'}
      </T>
      {keyInfo.public ? (
        <>
          <View style={[styles.key, { backgroundColor: c.sheet }]}>
            <T variant="monoSmall" color="text2" numberOfLines={3} selectable style={styles.keyText}>
              {keyInfo.public}
            </T>
            <Pill
              label="Copy"
              icon="copy"
              height={36}
              accessibilityLabel="Copy the key"
              onPress={() => {
                void Clipboard.setStringAsync(keyInfo.public ?? '')
                toast('Key copied')
              }}
            />
          </View>
          <T variant="label" color="text2">
            As a new line in ~/.ssh/authorized_keys for {user.trim() || 'that user'}. The private key stays on your server.
          </T>
        </>
      ) : (
        <View style={styles.making}>
          <Spinner size={14} />
          <T variant="label" color="text2">
            Making a key for {name}…
          </T>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  field: { borderRadius: radius.field, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.regular, fontSize: 16 },
  mono: { fontFamily: fonts.mono, fontSize: 15 },
  key: { borderRadius: radius.field, paddingLeft: 14, paddingRight: 8, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  keyText: { flex: 1 },
  making: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
})
