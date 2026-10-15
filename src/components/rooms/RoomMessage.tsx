import { memo } from 'react'
import { StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { Markdown } from '@/components/chat/Markdown'
import { T } from '@/components/ui/T'
import { formatStamp } from '@/features/transcript/display'
import type { BotMeta } from '@/lib/hermes/identity'
import { splitMentions, type TimelineItem } from '@/lib/hermes/rooms'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

interface Props {
  item: TimelineItem
  handles: string[]
  metas: Record<string, BotMeta | undefined>
  /** Milliseconds, for "Today 8:15 AM". */
  now: number
}

/** A message with its `@mentions` drawn apart: you in amber, a bot in bold. */
function MentionText({ text, handles, own }: { text: string; handles: string[]; own?: boolean }) {
  return (
    <T variant={own ? 'body' : 'reply'} color={own ? 'userBubbleText' : 'text'} selectable>
      {splitMentions(text, handles).map((part, index) =>
        part.mention ? (
          <T key={index} variant="bodySemibold" color={part.mention === 'you' && !own ? 'needsYouText' : own ? 'userBubbleText' : 'text'}>
            {part.text}
          </T>
        ) : (
          part.text
        ),
      )}
    </T>
  )
}

/** One row of a room: a time label, your message (a tonal bubble), a bot's (its face, name and time over words with no bubble), or a quiet note. */
export const RoomMessage = memo(function RoomMessage({ item, handles, metas, now }: Props) {
  const { c } = useTheme()

  switch (item.kind) {
    case 'time':
      return (
        <T variant="meta" color="text2" style={styles.time}>
          {formatStamp(item.ts * 1000, now)}
        </T>
      )

    case 'user':
      return (
        <View style={[styles.base, styles.user, { backgroundColor: c.userBubble }]}>
          <MentionText text={item.text} handles={handles} own />
        </View>
      )

    case 'member':
      return (
        <View style={styles.member}>
          <View style={styles.head}>
            <BotFace name={item.profile} meta={metas[item.profile]} size={20} />
            <T variant="label" style={styles.name} numberOfLines={1}>
              {item.name}
            </T>
            <T variant="meta" color="text2">
              {clockOf(item.ts)}
            </T>
          </View>
          {item.atYou ? <MentionText text={item.text} handles={handles} /> : <Markdown text={item.text} size="reply" />}
        </View>
      )

    case 'note':
      return (
        <View style={styles.note}>
          <T variant="label" color={item.tone === 'danger' ? 'danger' : 'text2'}>
            {item.text}
          </T>
          {item.detail ? (
            <T variant="meta" color="text2" numberOfLines={2}>
              {item.detail}
            </T>
          ) : null}
        </View>
      )
  }
})

/** "8:15" for a message's head (the time labels between messages carry the day). */
function clockOf(ts: number): string {
  return ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '') : ''
}

const styles = StyleSheet.create({
  time: { alignSelf: 'center', paddingTop: 6 },
  base: { paddingHorizontal: 14, paddingVertical: 10 },
  user: { alignSelf: 'flex-end', maxWidth: '78%', borderTopLeftRadius: radius.bubble, borderTopRightRadius: radius.bubble, borderBottomLeftRadius: radius.bubble, borderBottomRightRadius: radius.tail },
  member: { alignSelf: 'stretch', gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontFamily: fonts.semibold, flexShrink: 1 },
  note: { gap: 2 },
})
