import { ScrollView, StyleSheet } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { Press } from '@/components/ui/Press'
import { T } from '@/components/ui/T'
import type { BotMeta } from '@/lib/hermes/identity'
import type { RoomMember } from '@/lib/hermes/protocol'
import { useTheme } from '@/theme/ThemeProvider'

interface Props {
  members: RoomMember[]
  metas: Record<string, BotMeta | undefined>
  onMention: (handle: string) => void
}

/** `@hermes @forge @scout` along the top of the room's tray: one tap puts that bot's @name in your message, so it knows the reply is for it. */
export function MentionChips({ members, metas, onMention }: Props) {
  const { c } = useTheme()

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={styles.scroll} contentContainerStyle={styles.chips}>
      {members.map(member => (
        <Press key={member.member_id} accessibilityRole="button" accessibilityLabel={`Mention ${member.display_name || member.handle}`} onPress={() => onMention(member.handle)} style={[styles.chip, { backgroundColor: c.pressedIn }]}>
          <BotFace name={member.profile} meta={metas[member.profile]} size={22} />
          <T variant="secondary">@{member.handle}</T>
        </Press>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  chips: { gap: 6, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4 },
  chip: { height: 36, paddingLeft: 7, paddingRight: 13, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6 },
})
