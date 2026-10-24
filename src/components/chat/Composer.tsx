import { useEffect, useRef, useState, type ReactNode } from 'react'
import { findNodeHandle, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { GroupedList, Row } from '@/components/ui/GroupedList'
import { IconCircle } from '@/components/ui/IconCircle'
import { Raised } from '@/components/ui/Raised'
import { Sheet } from '@/components/ui/Sheet'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { afterSheetCloses } from '@/lib/afterSheet'
import { appendTranscript, clock } from '@/lib/hermes/audio'
import { refusal, type PendingFile } from '@/lib/hermes/attachments'
import { pickerQuery, rankOptions, type SlashOption } from '@/lib/hermes/slash'
import { inserted, looksLikePastedPicture } from '@/lib/paste'
import { enablePictures, onPastedPicture, type PastedPicture } from '@/lib/pasteReceiver'
import { clipboardHasPicture, pastePicture, pickFiles, pickPhotos, takePhoto } from '@/lib/pickers'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'
import { useVoiceNote } from '@/lib/useVoiceNote'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

import { AttachmentTray } from './AttachmentTray'
import { SlashPicker } from './SlashPicker'

const MIN_FIELD = 44
const MAX_FIELD = 140
/** More than this at once is more than a phone connection should carry in one message. */
const MAX_FILES = 10

interface Props {
  botName: string
  /** A turn is running: the right button becomes Stop (until you type something to say). */
  running: boolean
  /** Words already in the box when it opens (a draft handed over from another screen); the keyboard comes up with them. */
  initialText?: string
  /** Controlled mode: the screen owns the text (so it can add an @mention). Leave out and the box keeps its own. */
  value?: string
  onChangeText?: (text: string) => void
  /** Files waiting to go with the message, and how to change them. Leave out where files cannot be sent (rooms). */
  files?: PendingFile[]
  onFilesChange?: (files: PendingFile[]) => void
  /** Whose speech recognition turns a voice message into words. */
  voiceProfile?: string
  /** The bot takes voice calls: the mic button becomes Call (a call does what a voice message did, and talks back). */
  onCall?: () => void
  /** The commands and skills a slash opens a picker of. Leave out where there are none (rooms). */
  commands?: SlashOption[]
  /** A row inside the tray, above the field (a room's @mention chips, the message you reply to). */
  above?: ReactNode
  /** Bring the keyboard up whenever this changes (you swiped a message to reply to it). */
  focusSignal?: number
  onSend: (text: string) => void
  onStop: () => void
}

/**
 * One raised tray: attach, the message field, and one right-hand button that is the next thing to do: the mic (pressed in)
 * when the field is empty, send (the white primary) when you have typed or attached something, stop (the primary) while the
 * bot works. The mic records a voice message and puts what you said in the field, where you can fix it before sending; for a
 * bot that takes calls it is Call instead.
 */
export function Composer({ botName, running, initialText, value, onChangeText, files, onFilesChange, voiceProfile, onCall, commands, above, focusSignal, onSend, onStop }: Props) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  // With the keyboard up it already covers the home-indicator / nav-bar area, so the inset would only leave a gap.
  const keyboardOpen = useKeyboardHeight() > 0
  const [own, setOwn] = useState(initialText ?? '')
  const text = value ?? own
  const setText = onChangeText ?? setOwn
  const input = useRef<TextInput>(null)

  useEffect(() => {
    if (focusSignal) {
      input.current?.focus()
    }
  }, [focusSignal])
  const attached = files ?? []
  const typed = text.trim().length > 0 || attached.length > 0
  const voice = useVoiceNote(voiceProfile)
  const [menu, setMenu] = useState(false)
  // The clipboard holds a picture: the attach menu offers to paste it (the field itself can't take one).
  const [clipboardPicture, setClipboardPicture] = useState(false)

  function openMenu() {
    setMenu(true)
    void clipboardHasPicture().then(setClipboardPicture)
  }
  // The picker is open while only the command word is typed (`/`, `/wo`), and shows nothing when nothing matches.
  const typedCommand = commands ? pickerQuery(text) : null
  const matches = commands && typedCommand !== null ? rankOptions(commands, typedCommand) : []
  // A controlled multiline input on iOS keeps its old height after the value is cleared. Giving it a
  // fresh key when a message is sent mounts one at its natural single-row height instead.
  const [generation, setGeneration] = useState(0)

  // Pictures the keyboard hands the field (Samsung's clipboard, Gboard): Android offers them only to a field that says it
  // takes images, and the keyboard then grants reading them. A remount after a send is a new field to enable.
  const takesFiles = !!onFilesChange
  const takePicture = useRef<(picture: PastedPicture) => void>(() => undefined)

  useEffect(() => {
    takePicture.current = picture => {
      const { uri, mime, size } = picture
      const pasted = (): Promise<PendingFile[]> => Promise.resolve(uri ? [{ id: `p-${Date.now().toString(36)}`, kind: 'image', name: `Pasted picture.${mime === 'image/jpeg' ? 'jpg' : (mime?.split('/')[1] ?? 'png')}`, mime: mime ?? 'image/png', uri, size }] : [])

      void attach(uri && !picture.error ? pasted : photosInstead)
    }
  })

  useEffect(() => {
    if (!takesFiles) {
      return
    }

    const tag = findNodeHandle(input.current)
    enablePictures(tag)
    const subscription = onPastedPicture(picture => {
      if (picture.viewTag === tag) {
        takePicture.current(picture)
      }
    })

    return () => subscription?.remove()
  }, [generation, takesFiles])

  function send() {
    if (!typed) {
      return
    }

    onSend(text.trim())
    setText('')
    setGeneration(count => count + 1)
  }

  function pickCommand(option: SlashOption) {
    setText(`${option.name} `)
  }

  async function add(pick: () => Promise<PendingFile[]>) {
    setMenu(false)

    // The picker is another screen: let the sheet finish leaving before it opens.
    await new Promise<void>(resolve => afterSheetCloses(resolve))
    await attach(pick)
  }

  /**
   * The field takes only text, so a picture pasted into it arrives as garbage (its bytes read as text) or its address: put
   * the field back as it was and attach the clipboard's picture instead, as if picked.
   */
  function changeText(next: string) {
    if (onFilesChange && looksLikePastedPicture(inserted(text, next))) {
      const before = text

      setText(next)
      // A second change back is what makes the field drop what the paste put in it.
      setTimeout(() => setText(before), 0)
      void attach(clipboardOrPhotos)

      return
    }

    setText(next)
  }

  /**
   * The clipboard's picture, or the photo library when Android won't hand it over: Samsung's clipboard keeps a screenshot as
   * a link into the gallery that other apps may not read. In the library it is the newest picture.
   */
  async function clipboardOrPhotos(): Promise<PendingFile[]> {
    try {
      return await pastePicture()
    } catch {
      return photosInstead()
    }
  }

  function photosInstead(): Promise<PendingFile[]> {
    toast('Android didn’t hand that picture over, so here are your photos: it’s the newest one.')

    return pickPhotos()
  }

  async function attach(pick: () => Promise<PendingFile[]>) {
    try {
      const picked = await pick()
      const room = MAX_FILES - attached.length
      const accepted: PendingFile[] = []

      for (const file of picked.slice(0, Math.max(0, room))) {
        const reason = refusal(file)

        if (reason) {
          toast(reason)
        } else {
          accepted.push(file)
        }
      }

      if (picked.length > room) {
        toast(`You can send up to ${MAX_FILES} files at a time.`)
      }

      if (accepted.length) {
        onFilesChange?.([...attached, ...accepted])
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not open that.')
    }
  }

  async function record() {
    const problem = await voice.start()

    if (problem) {
      toast(problem)
    }
  }

  async function stopRecording() {
    const result = await voice.finish()

    if ('error' in result) {
      toast(result.error)
    } else if (!result.text) {
      toast('Didn’t catch anything. Try again a little louder.')
    } else {
      setText(appendTranscript(text, result.text))
    }
  }

  const recording = voice.state === 'recording'
  const transcribing = voice.state === 'transcribing'

  return (
    <View>
      {matches.length ? <SlashPicker options={matches} onPick={pickCommand} /> : null}

      {onFilesChange ? <AttachmentTray files={attached} onRemove={id => onFilesChange(attached.filter(file => file.id !== id))} /> : null}

      <View style={[styles.footer, { paddingBottom: keyboardOpen ? 8 : Math.max(insets.bottom, 16) }]}>
        {/* One raised tray: the only thing besides a card that rises. Its buttons are pressed into it, concentric with its corners. */}
        <Raised radius={radius.tray} style={above ? styles.stacked : undefined}>
          {above}
          <View style={[styles.tray, above ? styles.trayUnder : null]}>
            {recording ? (
              <IconCircle icon="x" label="Cancel recording" diameter={44} onPress={() => void voice.cancel()} />
            ) : onFilesChange ? (
              <IconCircle icon="plus" label="Attach" diameter={44} disabled={transcribing} onPress={openMenu} />
            ) : null}

            <View style={styles.field}>
              {recording || transcribing ? (
                <View style={styles.recording}>
                  {transcribing ? <Spinner size={14} /> : <View style={[styles.dot, { backgroundColor: c.text }]} />}
                  <T variant="body" color="text2">
                    {transcribing ? 'Writing it out…' : `Recording · ${clock(voice.seconds)}`}
                  </T>
                </View>
              ) : (
                <TextInput
                  key={generation}
                  ref={input}
                  // After a send the new input takes over, so the keyboard stays up for the next message.
                  autoFocus={generation > 0 || !!initialText}
                  value={text}
                  onChangeText={changeText}
                  placeholder={attached.length ? 'Add a message' : `Message ${botName}`}
                  placeholderTextColor={c.text2}
                  accessibilityLabel={`Message ${botName}`}
                  multiline
                  // Room for a pasted plugin install message (three plugins come to ~60,000 characters; Hermes keeps 64,000 of a prompt).
                  maxLength={100000}
                  style={[styles.input, { color: c.text }]}
                  // Return adds a line, like any messenger on a phone; the button sends.
                  blurOnSubmit={false}
                />
              )}
            </View>

            {recording ? (
              <IconCircle icon="check" label="Finish recording" diameter={44} filled onPress={() => void stopRecording()} />
            ) : transcribing ? (
              <IconCircle icon="mic" label="Writing out your message" diameter={44} disabled />
            ) : typed ? (
              <IconCircle icon="arrow-up" label="Send" diameter={44} filled onPress={send} />
            ) : running ? (
              <IconCircle icon="square" label="Stop" diameter={44} filled onPress={onStop} />
            ) : onCall ? (
              <IconCircle icon="phone" label={`Call ${botName}`} diameter={44} onPress={onCall} />
            ) : (
              <IconCircle icon="mic" label="Voice message" diameter={44} onPress={() => void record()} />
            )}
          </View>
        </Raised>
      </View>

      <Sheet visible={menu} onClose={() => setMenu(false)} label="Attach">
        <GroupedList>
          {clipboardPicture ? <Row label="Paste picture" chevron={false} onPress={() => void add(clipboardOrPhotos)} /> : null}
          <Row label="Photo library" chevron={false} onPress={() => void add(pickPhotos)} />
          <Row label="Take a photo" chevron={false} onPress={() => void add(takePhoto)} />
          <Row label="Files" chevron={false} onPress={() => void add(pickFiles)} />
        </GroupedList>
      </Sheet>
    </View>
  )
}

const styles = StyleSheet.create({
  footer: { paddingHorizontal: 12, paddingTop: 8 },
  tray: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, padding: 6 },
  stacked: { flexDirection: 'column' },
  trayUnder: { paddingTop: 0 },
  // overflow hidden: lines that have scrolled out of a full field must not draw outside the tray.
  field: { flex: 1, minWidth: 0, overflow: 'hidden' },
  // The input sizes itself to its text between the two limits and scrolls beyond the larger.
  input: { minHeight: MIN_FIELD, maxHeight: MAX_FIELD, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 12, fontFamily: fonts.regular, fontSize: 16, lineHeight: 20 },
  recording: { height: MIN_FIELD, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
})
