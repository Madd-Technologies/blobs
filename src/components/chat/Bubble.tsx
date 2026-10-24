import Feather from '@expo/vector-icons/Feather'
import { memo, useEffect } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { T } from '@/components/ui/T'
import { dashboardButton, profileOfHandle } from '@/features/transcript/injected'
import { splitReply } from '@/features/transcript/reply'
import { documentPaths, fileName, hidePaths, routeLinks } from '@/features/viewer/kind'
import type { AttachmentChip } from '@/lib/hermes/attachments'
import { isPicture, splitMedia, type MediaRef } from '@/lib/hermes/media'
import { openDocument, openFile } from '@/stores/documents'
import { pictureKey, usePictures } from '@/stores/pictures'
import { useViewer } from '@/stores/viewer'
import { useBotViews } from '@/stores/bots'
import { Press } from '@/components/ui/Press'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

import { Markdown } from './Markdown'
import { useRowVisible } from './RowContext'
import { ServerPicture } from './ServerPicture'

/** The edge of a tile for something you sent. */
const TILE = 64

/** `.txt` from `notes.txt`: what a file tile says, since a name does not fit in it. Nothing for a name with no extension. */
const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.')

  return dot > 0 && name.length - dot <= 6 ? name.slice(dot).toLowerCase() : ''
}

/**
 * One thing you sent, as a small square: the picture itself for a photo (the file on this phone while it is fresh, the server's copy
 * after a reload), an icon and its extension for any other file. A photo opens full screen when tapped.
 */
function Tile({ chip, profile, dim }: { chip: AttachmentChip; profile?: string; dim?: boolean }) {
  const { c } = useTheme()
  const open = useViewer(state => state.open)
  const isImage = chip.kind === 'image'
  const remote = isImage && !chip.uri && !!chip.path
  const entry = usePictures(state => (remote && chip.path ? state.byKey[pictureKey(profile, chip.path)] : undefined))

  // Fetched only while its row is on screen.
  const visible = useRowVisible()

  useEffect(() => {
    if (remote && visible && chip.path) {
      const path = chip.path

      usePictures.getState().ensure(profile, path)

      return () => usePictures.getState().release(profile, path)
    }
  }, [remote, visible, chip.path, profile])

  const url = isImage && chip.uri ? chip.uri : entry?.status === 'ready' ? entry.url : null
  // A photo opens full screen; any other file you sent opens in the viewer, read from the server's copy.
  const viewable = isImage ? !!(chip.uri || chip.path) : !!chip.path
  const extension = extensionOf(chip.name)

  return (
    <Pressable
      accessibilityRole={viewable ? (isImage ? 'imagebutton' : 'button') : 'text'}
      accessibilityLabel={viewable ? `Open ${chip.name}` : chip.name}
      disabled={!viewable}
      onPress={() => (isImage ? open({ name: chip.name, uri: chip.uri, path: chip.path, profile }) : chip.path && openFile(chip.path, profile, chip.name))}
      style={[styles.tile, { backgroundColor: c.tone, opacity: dim ? 0.6 : 1 }]}
    >
      {url ? (
        <Image source={{ uri: url }} style={styles.tileImage} resizeMode="cover" />
      ) : (
        <>
          <Feather name={isImage ? 'image' : chip.kind === 'pdf' ? 'file-text' : 'file'} size={20} color={c.text2} />
          {extension ? (
            <T variant="meta" color="text2" numberOfLines={1}>
              {extension}
            </T>
          ) : null}
        </>
      )}
    </Pressable>
  )
}

/** Everything you sent with a message, as a row of square tiles above it on the right, wrapping when there are many. */
function Attachments({ chips, profile, dim }: { chips: AttachmentChip[]; profile?: string; dim?: boolean }) {
  return (
    <View style={styles.tiles}>
      {chips.map((chip, index) => (
        <Tile key={`${chip.name}-${index}`} chip={chip} profile={profile} dim={dim} />
      ))}
    </View>
  )
}

/**
 * You: a compact bubble in the tone of the paper (the bot's replies have none). The corner at the speaker is the small one. Files
 * you sent are their own tiles above it (and the only thing there is when you sent a file with no words).
 */
export const UserBubble = memo(function UserBubble({ text, pending, attachments, profile }: { text: string; pending?: boolean; attachments?: AttachmentChip[]; profile?: string }) {
  const { c } = useTheme()
  const button = dashboardButton(text)

  if (button) {
    // A dashboard button's job: the button, the record and the draft's first line, not the instructions written for the bot.
    return (
      <View style={styles.userGroup}>
        <View style={[styles.base, styles.user, styles.button, { backgroundColor: c.userBubble, opacity: pending ? 0.6 : 1 }]} accessibilityLabel={`${button.label}, ${button.title}, from your dashboard`}>
          <T variant="bodySemibold" color="userBubbleText">
            {button.label}
          </T>
          <T variant="body" color="userBubbleText">
            {button.title}
          </T>
          {button.draft ? (
            <T variant="label" color="userBubbleText" numberOfLines={1} style={styles.buttonDraft}>
              “{button.draft}”
            </T>
          ) : null}
        </View>
        <T variant="meta" color="text2">
          From your dashboard
        </T>
      </View>
    )
  }

  // A reply carries the line it answers: drawn quietly above your words, not as markdown.
  const { quote, body } = splitReply(text)

  return (
    <View style={styles.userGroup}>
      {attachments?.length ? <Attachments chips={attachments} profile={profile} dim={pending} /> : null}
      {text ? (
        <View style={[styles.base, styles.user, { backgroundColor: c.userBubble, opacity: pending ? 0.6 : 1 }]}>
          {quote ? (
            <View style={styles.quote} accessibilityLabel={`Replying to: ${quote}`}>
              <Feather name="corner-up-left" size={12} color={c.text2} style={styles.quoteIcon} />
              <T variant="label" color="text2" numberOfLines={2} style={styles.quoteText}>
                {quote}
              </T>
            </View>
          ) : null}
          <T variant="body" color="userBubbleText" selectable>
            {body}
          </T>
        </View>
      ) : null}
    </View>
  )
})

/** A file on the server (or a document a plugin serves) as a named chip that opens it in the viewer. */
function FileChip({ path, href, name, profile }: { path?: string; href?: string; name: string; profile?: string }) {
  const { c } = useTheme()

  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}`}
      onPress={() => (href ? openDocument({ kind: 'route', href, name }) : path && openFile(path, profile, name))}
      style={[styles.mediaChip, { backgroundColor: c.tone }]}
    >
      <Feather name={href || /\.pdf$/i.test(name) ? 'file-text' : 'file'} size={14} color={c.text2} />
      <T variant="label" numberOfLines={1} style={styles.fileName}>
        {name}
      </T>
    </Press>
  )
}

/**
 * Files a bot made or names, lifted out of its reply: a picture is drawn in the chat, anything else is a chip that opens in the
 * viewer. A document named by path in the words keeps its place in the sentence and gets a chip too.
 */
function MediaFiles({ media, documents, links, profile }: { media: MediaRef[]; documents: string[]; links: { label: string; href: string }[]; profile?: string }) {
  return (
    <View style={styles.media}>
      {media.map(item =>
        isPicture(item.path) ? (
          <ServerPicture key={item.path} path={item.path} name={item.name} profile={profile} quiet={item.stated} />
        ) : (
          <FileChip key={item.path} path={item.path} name={item.name} profile={profile} />
        ),
      )}
      {documents.map(path => (
        <FileChip key={path} path={path} name={fileName(path)} profile={profile} />
      ))}
      {links.map(link => (
        <FileChip key={link.href} href={link.href} name={link.label} />
      ))}
    </View>
  )
}

/** The bot: its words straight on the paper, 16/25 with no bubble, in markdown. A reply you stopped says so quietly underneath. */
export const AssistantBubble = memo(function AssistantBubble({ text, interrupted, profile, hide }: { text: string; interrupted?: boolean; profile?: string; /** Pictures already drawn by a tool in this turn. */ hide?: readonly string[] }) {
  const { text: words, media } = splitMedia(text, hide?.length ? new Set(hide) : undefined)
  const documents = documentPaths(words).filter(path => !media.some(item => item.path === path))
  const links = routeLinks(words)
  // The files are chips under the reply: their paths are not repeated in its words.
  const shown = hidePaths(words, [...documents, ...media.filter(item => item.stated).map(item => item.path)])

  return (
    <View style={styles.assistantWrap}>
      {shown ? <Markdown text={shown} size="reply" /> : null}
      {media.length || documents.length || links.length ? <MediaFiles media={media} documents={documents} links={links} profile={profile} /> : null}
      {interrupted ? (
        <T variant="meta" color="text2" style={styles.stopped}>
          Stopped
        </T>
      ) : null}
    </View>
  )
})

/**
 * Another bot's message to this one (it used `message_agent`): drawn from the sender with its face and name, never as
 * something you wrote. Falls back to the handle when the bot is no longer on the roster.
 */
export const TeammateBubble = memo(function TeammateBubble({ handle, text }: { handle: string; text: string }) {
  const profile = profileOfHandle(handle)
  const sender = useBotViews({ includeHidden: true }).find(view => view.profile === profile)

  return (
    <View style={styles.teammateRow}>
      <BotFace name={profile} meta={sender?.meta} size={22} />
      <View style={styles.teammateColumn}>
        <T variant="label" color="text2">
          {sender?.name ?? `@${handle}`}
        </T>
        <Markdown text={text} size="reply" />
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  media: { gap: 6, paddingLeft: 2 },
  mediaChip: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.chip },
  // Your words and the files you sent with them: one column on the right, a few points apart.
  userGroup: { alignSelf: 'flex-end', maxWidth: '78%', alignItems: 'flex-end', gap: 6 },
  button: { gap: 2 },
  buttonDraft: { opacity: 0.6 },
  tiles: { maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 },
  tile: { width: TILE, height: TILE, borderRadius: radius.thumb, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 2 },
  tileImage: { width: TILE, height: TILE },
  fileName: { flexShrink: 1 },
  teammateRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  teammateColumn: { flex: 1, minWidth: 0, gap: 2 },
  base: { paddingHorizontal: 14, paddingVertical: 10 },
  quote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  quoteIcon: { marginTop: 3 },
  quoteText: { flexShrink: 1 },
  user: { borderTopLeftRadius: radius.bubble, borderTopRightRadius: radius.bubble, borderBottomLeftRadius: radius.bubble, borderBottomRightRadius: radius.tail },
  assistantWrap: { alignSelf: 'stretch', gap: 6 },
  stopped: {},
})
