import Feather from '@expo/vector-icons/Feather'
import { memo } from 'react'
import { StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { Stamped, SwipeToReply } from '@/components/chat/Gestures'
import { Markdown } from '@/components/chat/Markdown'
import { T } from '@/components/ui/T'
import { formatStamp, timeOfDay } from '@/features/transcript/display'
import { splitReply } from '@/features/transcript/reply'
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
  /** A message was swiped right: reply to it (who wrote it, its words, and which member, to mention them). Keep it stable. */
  onReply?: (target: { who: string; text: string; memberId?: string }) => void
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
export const RoomMessage = memo(function RoomMessage({ item, handles, metas, now, onReply }: Props) {
  const { c } = useTheme()

  switch (item.kind) {
    case 'time':
      return (
        <T variant="meta" color="text2" style={styles.time}>
          {formatStamp(item.ts * 1000, now)}
        </T>
      )

    case 'user': {
      // A reply carries the line it answers: drawn quietly above your words.
      const { quote, body } = splitReply(item.text)

      return (
        <Stamped time={timeOfDay(item.ts * 1000)} top={12}>
          <SwipeToReply label="Reply" onReply={onReply ? () => onReply({ who: 'yourself', text: body }) : undefined}>
            <View style={[styles.base, styles.user, { backgroundColor: c.userBubble }]}>
              {quote ? (
                <View style={styles.quote} accessibilityLabel={`Replying to: ${quote}`}>
                  <Feather name="corner-up-left" size={12} color={c.text2} style={styles.quoteIcon} />
                  <T variant="label" color="text2" numberOfLines={2} style={styles.quoteText}>
                    {quote}
                  </T>
                </View>
              ) : null}
              <MentionText text={body} handles={handles} own />
            </View>
          </SwipeToReply>
        </Stamped>
      )
    }

    case 'member':
      return (
        <Stamped time={timeOfDay(item.ts * 1000)} top={2}>
          <SwipeToReply label="Reply" onReply={onReply ? () => onReply({ who: item.name, text: item.text, memberId: item.memberId }) : undefined}>
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
          </SwipeToReply>
        </Stamped>
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
  quote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  quoteIcon: { marginTop: 3 },
  quoteText: { flexShrink: 1 },
  time: { alignSelf: 'center', paddingTop: 6 },
  base: { paddingHorizontal: 14, paddingVertical: 10 },
  user: { alignSelf: 'flex-end', maxWidth: '78%', borderTopLeftRadius: radius.bubble, borderTopRightRadius: radius.bubble, borderBottomLeftRadius: radius.bubble, borderBottomRightRadius: radius.tail },
  member: { alignSelf: 'stretch', gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontFamily: fonts.semibold, flexShrink: 1 },
  note: { gap: 2 },
})
