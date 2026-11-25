import { StyleSheet, TextInput, View } from 'react-native'

import { RunsOnKeySection } from '@/components/bots/RunsOnKeySection'
import { T } from '@/components/ui/T'
import type { RunsOnKey } from '@/lib/hermes/runsOn'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

interface Props {
  name: string
  host: string
  user: string
  port: string
  keyPath: string
  keyInfo: RunsOnKey | null | undefined
  ownKey: boolean
  onHost: (host: string) => void
  onUser: (user: string) => void
  onPort: (port: string) => void
  onSplitAddress: (address: string) => void
  onKeyPath: (path: string) => void
  onUseOwnKey: () => void
}

export function RunsOnSshForm({ name, host, user, port, keyPath, keyInfo, ownKey, onHost, onUser, onPort, onSplitAddress, onKeyPath, onUseOwnKey }: Props) {
  const { c } = useTheme()
  const field = [styles.field, styles.mono, { backgroundColor: c.sheet, color: c.text }]

  return (
    <View style={styles.section}>
      <View style={styles.group}>
        <T variant="label" color="text2">
          Address
        </T>
        <TextInput
          value={host}
          onChangeText={next => (next.length - host.length > 1 ? onSplitAddress(next) : onHost(next))}
          onEndEditing={() => onSplitAddress(host)}
          placeholder="vps-1.example.net"
          placeholderTextColor={c.text2}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Address"
          style={field}
        />
      </View>
      <View style={styles.pair}>
        <View style={[styles.group, styles.fill]}>
          <T variant="label" color="text2">
            User
          </T>
          <TextInput
            value={user}
            onChangeText={onUser}
            placeholder="ubuntu"
            placeholderTextColor={c.text2}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="User"
            style={field}
          />
        </View>
        <View style={[styles.group, styles.port]}>
          <T variant="label" color="text2">
            Port
          </T>
          <TextInput
            value={port}
            onChangeText={next => onPort(next.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={5}
            accessibilityLabel="Port"
            style={field}
          />
        </View>
      </View>

      <RunsOnKeySection
        name={name}
        host={host}
        user={user}
        keyInfo={keyInfo}
        ownKey={ownKey}
        keyPath={keyPath}
        onKeyPath={onKeyPath}
        onUseOwnKey={onUseOwnKey}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  section: { gap: 14 },
  group: { gap: 6 },
  pair: { flexDirection: 'row', gap: 10 },
  port: { width: 96 },
  field: { borderRadius: radius.field, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.regular, fontSize: 16 },
  mono: { fontFamily: fonts.mono, fontSize: 15 },
})
