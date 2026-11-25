import Feather from '@expo/vector-icons/Feather'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Pill } from '@/components/ui/Pill'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { useStation } from '@/stores/station'
import { toast } from '@/stores/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

/**
 * Shown at the top of Home only when the user has globally paused the fleet.
 */
export function FleetBanner() {
  const { c } = useTheme()
  const fleet = useStation(state => state.fleet)
  const resumeFleet = useStation(state => state.resumeFleet)
  const [busy, setBusy] = useState(false)

  if (!fleet?.paused) {
    return null
  }

  async function onResume() {
    setBusy(true)
    const error = await resumeFleet()
    setBusy(false)

    if (error) {
      toast(error)
    } else {
      toast('Fleet resumed')
    }
  }

  return (
    <View style={styles.wrap}>
      <Raised radius={radius.group} style={styles.banner} accessibilityLabel="Fleet is paused">
        <Feather name="pause-circle" size={18} color={c.danger} />
        <View style={styles.text}>
          <T variant="rowTitle">Fleet paused</T>
          {fleet.reason ? (
            <T variant="label" color="text2" numberOfLines={1}>
              {fleet.reason}
            </T>
          ) : null}
        </View>
        <Pill label="Resume" variant="primary" height={36} loading={busy} onPress={() => void onResume()} />
      </Raised>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  text: { flex: 1, minWidth: 0, gap: 2 },
})
