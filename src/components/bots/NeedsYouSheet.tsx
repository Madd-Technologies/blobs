import Feather from '@expo/vector-icons/Feather'
import { Pressable, StyleSheet, View } from 'react-native'

import { cardAge, cardLine, cardName, type DeckContext } from '@/components/inbox/Deck'
import { Pill } from '@/components/ui/Pill'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { deckSummary, filterDeck, type DeckCard } from '@/features/inbox/deck'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

import { RoomFaces } from '../rooms/RoomFaces'
import { AttentionDot } from './AttentionDot'
import { BotFace } from './BotFace'

/** At most this many waiting things are listed on Home; the rest are counted. */
const SHOWN = 3

interface Props {
  /** Everything waiting, dashboard records not loaded yet included. */
  count: number
  /** What is waiting, in the deck's order. */
  cards: DeckCard[]
  context: DeckContext
  /** Who, for when nothing is listed yet (dashboard records still loading). */
  names: string
  /** Needs you, from the top. */
  onReview: () => void
  /** Needs you, opened directly into a filtered bucket. */
  onReviewBucket?: (bucket: 'blocked' | 'review') => void
  /** Needs you, on this card. */
  onOpen: (card: DeckCard) => void
  /** The roster has loaded, so "nothing needs you" is true and not just early. */
  loaded: boolean
}

/**
 * Home's first thing: what blocks your bots right now comes first on one raised sheet, while high-volume dashboard items
 * stay grouped in a quiet footer row so 60+ items never overwhelm Home.
 */
export function NeedsYouSheet({ count, cards, context, names, onReview, onReviewBucket, onOpen, loaded }: Props) {
  const { c } = useTheme()

  if (count < 1) {
    return loaded ? (
      <View style={styles.quiet} accessibilityRole="text">
        <Feather name="check" size={16} color={c.text2} />
        <T variant="secondary" color="text2">
          Nothing needs you right now
        </T>
      </View>
    ) : null
  }

  const pendingBoard = Math.max(0, count - cards.length)
  const summary = deckSummary(cards, pendingBoard)
  const hasBlocked = summary.blockedCount > 0
  const label = hasBlocked
    ? `${summary.blockedCount} ${summary.blockedCount === 1 ? 'thing waiting' : 'things waiting'} on you`
    : `${summary.reviewCount} ${summary.reviewCount === 1 ? 'item' : 'items'} to review`
  const shown = (hasBlocked ? filterDeck(cards, { urgency: 'blocked' }) : cards).slice(0, SHOWN)
  const more = (hasBlocked ? summary.blockedCount : summary.reviewCount) - shown.length
  const reviewAction = () => (onReviewBucket ? onReviewBucket('review') : onReview())

  return (
    <Raised radius={radius.card} style={styles.sheet} accessibilityLabel={label}>
      <View style={styles.head}>
        <AttentionDot size={8} />
        <T variant="heading" style={styles.flex} accessibilityRole="header" numberOfLines={1}>
          {label}
        </T>
        <Pill label="Review all" variant="primary" height={36} onPress={hasBlocked ? onReview : reviewAction} />
      </View>
      {shown.map(card => (
        <Pressable
          key={card.key}
          accessibilityRole="button"
          accessibilityLabel={`${cardName(card, context)}: ${cardLine(card)}`}
          onPress={() => onOpen(card)}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.tone }]}
        >
          {card.kind === 'room' ? (
            <RoomFaces members={card.view.data.room.members.slice(0, 2)} metas={context.metas} variant="header" ring={c.raised} />
          ) : (
            <BotFace name={card.profile} meta={context.metas[card.profile]} size={28} />
          )}
          <View style={styles.flex}>
            <View style={styles.who}>
              <T variant="rowTitle" numberOfLines={1} style={styles.flex}>
                {cardName(card, context)}
              </T>
              <T variant="meta" color="text2">
                {cardAge(card, context)}
              </T>
            </View>
            <Ask card={card} />
          </View>
        </Pressable>
      ))}
      {!shown.length && names ? (
        <T variant="secondary" color="text2" numberOfLines={1} style={styles.names}>
          {names}
        </T>
      ) : null}
      {shown.length > 0 && more > 0 ? (
        <T variant="label" color="text2" style={styles.more}>
          and {more} more{hasBlocked ? ' waiting' : ''}
        </T>
      ) : null}
      {hasBlocked && summary.reviewCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${summary.reviewCount} dashboard ${summary.reviewCount === 1 ? 'item' : 'items'} to review`}
          onPress={reviewAction}
          style={({ pressed }) => [styles.footerRow, pressed && { backgroundColor: c.tone }]}
        >
          <T variant="secondary" color="text2" style={styles.flex}>
            {summary.reviewCount} dashboard {summary.reviewCount === 1 ? 'item' : 'items'} to review
          </T>
          <Feather name="chevron-right" size={15} color={c.text2} />
        </Pressable>
      ) : null}
    </Raised>
  )
}

/** What the card asks, in one line: a command to approve is shown as the command. */
function Ask({ card }: { card: DeckCard }) {
  if (card.kind === 'entry' && card.entry.kind === 'approval' && card.entry.command) {
    return (
      <T variant="secondary" numberOfLines={1}>
        Run <T style={styles.command}>{card.entry.command.replace(/\s+/g, ' ')}</T>?
      </T>
    )
  }

  return (
    <T variant="secondary" numberOfLines={1}>
      {cardLine(card)}
    </T>
  )
}

const styles = StyleSheet.create({
  sheet: { marginHorizontal: 16, marginTop: 8, paddingTop: 6, paddingBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 8, paddingTop: 8, paddingBottom: 6 },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  who: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  command: { fontFamily: fonts.mono, fontSize: 13 },
  names: { paddingHorizontal: 16, paddingBottom: 6 },
  more: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.list },
  quiet: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 10 },
})
