import Feather from '@expo/vector-icons/Feather'
import { useRouter } from 'expo-router'
import { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import type { DisplayItem } from '@/features/transcript/display'
import { useBrowserShows } from '@/stores/display'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

import { ActivityLine } from './ActivityLine'
import { AssistantBubble, TeammateBubble, UserBubble } from './Bubble'
import { PromptCard } from './PromptCard'
import { ReplyActions } from './ReplyActions'
import { RowContext } from './RowContext'
import { ServerPicture } from './ServerPicture'

interface Props {
  entry: DisplayItem
  /** The list this row is in (its name for `useViewableRows`), so what is in it can tell when it is on screen. */
  list: string
  profile: string
  botName: string
  /** The newest row of the chat. */
  latest?: boolean
  /** Drops the latest reply and asks again (passed to every row; only the latest turn's reply shows it). Keep it stable. */
  onRetry?: () => void
}

const sameList = (a?: readonly string[], b?: readonly string[]) => a === b || (!!a && !!b && a.length === b.length && a.every((value, index) => value === b[index]))

/**
 * Whether a row would draw the same. The chat's rows are rebuilt each time the transcript changes (a streaming reply changes it
 * every ~80 ms), but an item that did not change keeps its identity: comparing that, not the row's wrapper, keeps every other
 * row from drawing again for each bit of a reply.
 */
function sameRow(a: Props, b: Props): boolean {
  if (a.list !== b.list || a.profile !== b.profile || a.botName !== b.botName || a.latest !== b.latest || a.onRetry !== b.onRetry) {
    return false
  }

  const x = a.entry
  const y = b.entry

  if (x.kind === 'date' || y.kind === 'date') {
    return x.kind === 'date' && y.kind === 'date' && x.id === y.id && x.label === y.label
  }

  return x.item === y.item && x.carriedOn === y.carriedOn && x.endsTurn === y.endsTurn && x.lastTurn === y.lastTurn && sameList(x.made, y.made) && sameList(x.drawn, y.drawn)
}

/** One row of the chat: a date label, a bubble, a quiet tool line, or a card that needs you. */
export const ChatRow = memo(function ChatRow({ list, ...props }: Props) {
  const row = props.entry.kind === 'date' ? props.entry.id : props.entry.item.id
  const where = useMemo(() => ({ list, row }), [list, row])

  return (
    <RowContext.Provider value={where}>
      <Row {...props} />
    </RowContext.Provider>
  )
}, sameRow)

const Row = memo(function Row({ entry, profile, botName, latest, onRetry }: Omit<Props, 'list'>) {
  const { c } = useTheme()
  const router = useRouter()
  const browserShows = useBrowserShows(profile)

  if (entry.kind === 'date') {
    return (
      <T variant="meta" color="text2" style={styles.date}>
        {entry.label}
      </T>
    )
  }

  const { item } = entry

  switch (item.kind) {
    case 'user':
      return <UserBubble text={item.text} pending={item.pending} attachments={item.attachments} profile={profile} />

    case 'assistant':
      return entry.endsTurn ? (
        <View style={styles.reply}>
          <AssistantBubble text={item.text} interrupted={item.status === 'interrupted'} profile={profile} hide={entry.drawn} />
          <ReplyActions id={item.id} text={item.text} onRetry={entry.lastTurn ? onRetry : undefined} />
        </View>
      ) : (
        <AssistantBubble text={item.text} interrupted={item.status === 'interrupted'} profile={profile} hide={entry.drawn} />
      )

    case 'teammate':
      return <TeammateBubble handle={item.handle} text={item.text} />

    case 'note':
      // A routine that ran in this chat leads with a clock, as one quiet line above the bot's summary of it; a call's start, a phone.
      return (
        <View style={styles.note}>
          {/^(Routine “|A routine ran)/.test(item.text) ? <Feather name="clock" size={14} color={c.text2} /> : /^Call started /.test(item.text) ? <Feather name="phone" size={14} color={c.text2} /> : null}
          <T variant="label" color="text2" numberOfLines={2} style={styles.noteText}>
            {item.text}
          </T>
        </View>
      )

    case 'output':
      return (
        <View style={styles.output}>
          <T variant="meta" color="text2" style={styles.outputCommand}>
            {item.command}
          </T>
          {item.pending ? (
            <View style={styles.running}>
              <Spinner size={12} />
              <T variant="meta" color="text2">
                Running…
              </T>
            </View>
          ) : (
            <View style={[styles.outputBlock, { backgroundColor: c.sheet }]}>
              {item.groups?.map(group => (
                <View key={group.title} style={styles.group}>
                  <T variant="meta" color="text2">
                    {group.title}
                  </T>
                  <View style={styles.names}>
                    {group.names.map(name => (
                      <T key={name} variant="mono">
                        {name}
                      </T>
                    ))}
                  </View>
                </View>
              ))}
              {item.text ? (
                // Under a list of names the text is a sentence, not output: ordinary type, so "/help" is not split at the slash.
                item.groups?.length ? (
                  <T variant="label" color="text2">
                    {item.text}
                  </T>
                ) : (
                  <T variant="mono" selectable>
                    {item.text}
                  </T>
                )
              ) : null}
            </View>
          )}
        </View>
      )

    case 'activity':
      return (
        <View style={styles.activity}>
          <ActivityLine item={item} botName={botName} profile={profile} latest={latest} carriedOn={entry.carriedOn} browserShows={browserShows} onOpenScreen={() => router.push({ pathname: '/screens/[profile]', params: { profile } })} />
          {entry.made?.map(path => (
            <ServerPicture key={path} path={path} name={path.split('/').pop() || 'Picture'} profile={profile} />
          ))}
        </View>
      )

    case 'approval':
    case 'question':
    case 'secret':
    case 'sudo':
      return (
        <View style={styles.card}>
          <PromptCard item={item} profile={profile} botName={botName} />
        </View>
      )

    case 'error':
      return (
        <View style={styles.error}>
          <Feather name="x" size={14} color={c.danger} style={styles.errorIcon} />
          <T variant="label" color="danger" style={styles.flex} selectable>
            {item.message}
          </T>
        </View>
      )

    case 'stopped':
      return (
        <T variant="meta" color="text2" style={styles.stopped}>
          Stopped
        </T>
      )

    case 'thinking':
      return (
        <T variant="secondary" color="text2" style={styles.thinking} selectable>
          {item.text}
        </T>
      )
  }
})

const styles = StyleSheet.create({
  flex: { flex: 1 },
  activity: { gap: 8 },
  reply: { alignSelf: 'stretch', gap: 2 },
  date: { alignSelf: 'center', paddingTop: 6 },
  // A card reaches a little past the column of words on both sides, so its text lines up with theirs.
  card: { alignSelf: 'stretch', marginHorizontal: -4, marginTop: 2 },
  error: { alignSelf: 'flex-start', maxWidth: '92%', flexDirection: 'row', gap: 6, paddingVertical: 4 },
  errorIcon: { marginTop: 2 },
  stopped: { alignSelf: 'flex-start' },
  note: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteText: { flexShrink: 1 },
  output: { alignSelf: 'stretch', gap: 4 },
  outputCommand: {},
  outputBlock: { borderRadius: radius.block, padding: 12, gap: 12 },
  group: { gap: 4 },
  // Whole names that wrap as a row: a name is never split across two lines.
  names: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2 },
  running: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinking: { alignSelf: 'flex-start', maxWidth: '88%', fontStyle: 'italic' },
})
