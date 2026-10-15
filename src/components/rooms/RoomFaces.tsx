import { StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import type { BotMeta } from '@/lib/hermes/identity'
import type { RoomMember } from '@/lib/hermes/protocol'
import { useTheme } from '@/theme/ThemeProvider'

interface Props {
  members: RoomMember[]
  metas: Record<string, BotMeta | undefined>
  /** `row` is two faces on a diagonal in a 44 box (Home); `header` is up to three overlapping in a line. */
  variant: 'row' | 'header'
  /** The paper behind the faces, which their rings are cut from (the canvas by default). */
  ring?: string
}

/** A room's members as faces, each ringed in the page color so overlapping ones read as separate. */
export function RoomFaces({ members, metas, variant, ring }: Props) {
  const { c } = useTheme()
  const paper = ring ?? c.canvas

  if (variant === 'row') {
    const [first, second] = members

    return (
      <View style={styles.row}>
        {first ? (
          <View style={[styles.ring, styles.topLeft, { backgroundColor: paper }]}>
            <BotFace name={first.profile} meta={metas[first.profile]} size={28} />
          </View>
        ) : null}
        {second ? (
          <View style={[styles.ring, styles.bottomRight, { backgroundColor: paper }]}>
            <BotFace name={second.profile} meta={metas[second.profile]} size={28} />
          </View>
        ) : null}
      </View>
    )
  }

  const shown = members.slice(0, 3)

  return (
    <View style={[styles.header, { width: 24 + (shown.length - 1) * 10 + 4 }]}>
      {shown.map((member, index) => (
        <View key={member.member_id} style={[styles.ring, { backgroundColor: paper, position: 'absolute', left: index * 10, top: 1 }]}>
          <BotFace name={member.profile} meta={metas[member.profile]} size={24} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { width: 44, height: 44 },
  ring: { borderRadius: 999, padding: 1.5 },
  topLeft: { position: 'absolute', left: 0, top: 0 },
  bottomRight: { position: 'absolute', right: 0, bottom: 0 },
  header: { height: 30 },
})
