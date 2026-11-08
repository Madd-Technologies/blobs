import Feather from '@expo/vector-icons/Feather'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { Markdown } from '@/components/chat/Markdown'
import { openAction } from '@/components/dashboard/openAction'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import { SealedHtml } from '@/components/viewer/SealedHtml'
import { shortDigest, type ApprovalState } from '@/features/dashboard/digest'
import { editable, fileLine } from '@/features/dashboard/layout'
import { actionFor, fileCard, formatTyped, historyLine, longLabel, timeLabel, typedOf } from '@/features/dashboard/view'
import type { DashboardRecord, Entry, Field, FileRef, HistoryEntry, TextFormat } from '@/lib/hermes/dashboard'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/**
 * The pieces a record screen is built from: the standard screen uses them in its fixed order, a laid-out record (hermes-dashboard
 * 0.6+) in the order its bot chose. Each draws one thing the Card Stock way; none rises except the question.
 */

const ACTION_ICON = { tel: 'phone', mailto: 'mail', web: 'external-link', viewer: 'file-text' } as const

/** A file card's icon by what the document is: a sheet, a deck, a picture, a web page, or a document. */
export function fileIcon(card: { kind: string; where: string }): 'grid' | 'monitor' | 'image' | 'globe' | 'file-text' {
  if (card.kind === 'Google Sheet') {
    return 'grid'
  }

  if (card.kind === 'Google Slides') {
    return 'monitor'
  }

  if (card.where === 'opens in the browser') {
    return 'globe'
  }

  return /\.(png|jpe?g|gif|webp|heic)$/i.test(card.kind) ? 'image' : 'file-text'
}

/** A quiet section label: 13 px, secondary, sentence case. */
export function SectionLabel({ children }: { children: string }) {
  return (
    <T variant="label" color="text2" style={styles.sectionLabel}>
      {children}
    </T>
  )
}

/** Text in its format: plain words, Markdown, or HTML drawn sealed on its own white paper. */
export function FormattedText({ text, format, fold }: { text: string; format?: TextFormat; fold?: number }) {
  const [open, setOpen] = useState(false)
  const { c } = useTheme()

  if (format === 'html') {
    return <HtmlPaper html={text} />
  }

  if (fold && !open) {
    // Folded: the first lines as plain text, and "More" for the whole of it.
    return (
      <Pressable accessibilityRole="button" accessibilityHint="Shows all of it" onPress={() => setOpen(true)} style={styles.inset}>
        <T variant="secondary" color="text2" numberOfLines={fold}>
          {text.replace(/[#*_`>]/g, '')}
        </T>
        <T variant="label" style={[styles.more, { color: c.text }]}>
          More
        </T>
      </Pressable>
    )
  }

  return <View style={styles.inset}>{format === 'markdown' ? <Markdown text={text} size="reply" /> : <T variant="body">{text}</T>}</View>
}

/** An HTML draft on white paper, sealed, with a full-screen view for a long one. */
export function HtmlPaper({ html }: { html: string }) {
  const [full, setFull] = useState(false)
  const insets = useSafeAreaInsets()
  const { c } = useTheme()

  return (
    <View>
      <View style={styles.paper}>
        <SealedHtml html={html} />
      </View>
      <Press accessibilityRole="button" accessibilityLabel="Show the draft full screen" hitSlop={8} onPress={() => setFull(true)} style={styles.fullLink}>
        <Feather name="maximize-2" size={13} color={c.text2} />
        <T variant="label" color="text2">
          Full screen
        </T>
      </Press>
      <Modal visible={full} animationType="slide" onRequestClose={() => setFull(false)} presentationStyle="fullScreen">
        <View style={[styles.fullScreen, { paddingTop: insets.top, backgroundColor: '#ffffff' }]}>
          <View style={styles.fullHeader}>
            <IconCircle icon="x" label="Close" diameter={40} onPress={() => setFull(false)} />
          </View>
          <SealedHtml html={html} />
        </View>
      </Modal>
    </View>
  )
}

/** Files a record carries (a files field): name, kind and size; a server file opens in the viewer, a web one in its app. */
export function FileList({ files, creator, label }: { files: FileRef[]; creator: string; label?: string }) {
  const { c } = useTheme()

  return (
    <View style={styles.gap}>
      {label ? <SectionLabel>{label}</SectionLabel> : null}
      <View style={[styles.list, { backgroundColor: c.sheet }]}>
        {files.map((file, index) => {
          const ref = file.path ?? file.url ?? ''
          const line = fileLine(file)

          return (
            <View key={`${file.name}:${index}`}>
              {index > 0 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${file.name}${line ? `, ${line}` : ''}`}
                accessibilityHint="Opens it"
                onPress={() => openAction(file.path ? { kind: 'viewer', url: ref, label: 'Open' } : { kind: 'web', url: ref, label: 'Open' }, creator, file.name)}
                style={({ pressed }) => [styles.fileRow, pressed && { backgroundColor: c.tone }]}
              >
                <Feather name={/\.(png|jpe?g|gif|webp|heic)$/i.test(file.name) ? 'image' : 'file-text'} size={18} color={c.text} />
                <View style={styles.flex}>
                  <T variant="body" numberOfLines={1}>
                    {file.name}
                  </T>
                  {line ? (
                    <T variant="label" color="text2" numberOfLines={1}>
                      {line}
                    </T>
                  ) : null}
                </View>
                <Feather name={file.path ? 'download' : 'external-link'} size={16} color={c.text2} />
              </Pressable>
            </View>
          )
        })}
      </View>
    </View>
  )
}

/** Documents linked by link or url fields, as cards near the top. */
export function LinkCards({ items, creator, onEdit }: { items: { field: Field; card: NonNullable<ReturnType<typeof fileCard>>; value: string }[]; creator: string; onEdit: (field: Field) => void }) {
  const { c } = useTheme()

  return (
    <>
      {items.map(({ field, card, value }) => (
        <Pressable
          key={field.key}
          accessibilityRole="button"
          accessibilityLabel={`${field.label}, ${card.kind}, ${card.where}`}
          accessibilityHint={editable(field) ? 'Long press to change the link' : undefined}
          onPress={() => openAction(card.opens === 'viewer' ? { kind: 'viewer', url: value, label: 'Open' } : { kind: 'web', url: value, label: 'Open' }, creator, field.label)}
          onLongPress={editable(field) ? () => onEdit(field) : undefined}
          style={({ pressed }) => [styles.file, { backgroundColor: pressed ? c.tone : c.sheet }]}
        >
          <View style={[styles.fileIcon, { backgroundColor: c.tone }]}>
            <Feather name={fileIcon(card)} size={20} color={c.text} />
          </View>
          <View style={styles.flex}>
            <T variant="bodyMedium" numberOfLines={1}>
              {field.label}
            </T>
            <T variant="label" color="text2" numberOfLines={1}>
              {card.kind} · {card.where}
            </T>
          </View>
          <Feather name={card.opens === 'web' ? 'external-link' : 'chevron-right'} size={16} color={c.text2} />
        </Pressable>
      ))}
    </>
  )
}

/** Fields as rows, label and value; yours open their sheet, the bot's (readonly) only their action (call, mail, open). */
export function FieldRows({ fields, record, nowS, creator, label, onEdit, onToggle }: { fields: Field[]; record: DashboardRecord; nowS: number; creator: string; label?: string; onEdit: (field: Field) => void; onToggle: (field: Field, value: boolean) => void }) {
  const { c } = useTheme()

  return (
    <View style={styles.gap}>
      {label ? <SectionLabel>{label}</SectionLabel> : null}
      <View style={[styles.list, { backgroundColor: c.sheet }]}>
        {fields.map((field, index) => {
          const value = record.values[field.key]
          const typed = Array.isArray(value) ? null : typedOf(field, value)
          const action = typed ? actionFor(typed) : null
          const shown = typed ? (field.type === 'date' || field.type === 'datetime' ? longLabel(typed, nowS) : formatTyped(typed, nowS)) : '–'
          const mine = editable(field)

          return (
            <View key={field.key}>
              {index > 0 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
              {field.type === 'checkbox' && mine ? (
                <View style={styles.field}>
                  <T variant="body" style={styles.flex}>
                    {field.label}
                  </T>
                  <Switch value={value === true} label={field.label} onValueChange={next => onToggle(field, next)} />
                </View>
              ) : (
                <Pressable
                  accessibilityRole={mine || action ? 'button' : undefined}
                  accessibilityLabel={`${field.label}, ${typed ? shown : 'not set'}`}
                  accessibilityHint={action ? (mine ? `${action.label}. Long press to change.` : action.label) : mine ? 'Change it' : undefined}
                  disabled={!mine && !action}
                  onPress={() => (action ? openAction(action, creator, shown) : mine && onEdit(field))}
                  onLongPress={mine ? () => onEdit(field) : undefined}
                  style={({ pressed }) => [styles.field, pressed && { backgroundColor: c.tone }]}
                >
                  <T variant="body" style={styles.fieldLabel} numberOfLines={1}>
                    {field.label}
                  </T>
                  <T variant="body" color={field.type === 'status' ? 'text' : 'text2'} numberOfLines={1} style={styles.fieldValue}>
                    {shown}
                  </T>
                  {action ? <Feather name={ACTION_ICON[action.kind]} size={15} color={c.text2} /> : mine && (field.type === 'status' || field.type === 'choice') ? <Feather name="chevron-right" size={16} color={c.text2} /> : null}
                </Pressable>
              )}
            </View>
          )
        })}
      </View>
    </View>
  )
}

/** Dated lines, newest first, like a task's attempts: a small tone dot, the line, how long or when. */
export function EntryList({ entries, label }: { entries: Entry[]; label?: string }) {
  const { c } = useTheme()

  return (
    <View style={styles.gap}>
      {label ? <SectionLabel>{label}</SectionLabel> : null}
      <View style={[styles.list, { backgroundColor: c.sheet }]}>
        {entries.map((entry, index) => (
          <View key={`${entry.label}:${index}`}>
            {index > 0 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
            <View style={styles.field} accessible accessibilityLabel={`${entry.label}${entry.detail ? `, ${entry.detail}` : ''}`}>
              <View style={[styles.tone, { backgroundColor: entry.tone === 'good' ? c.connected : entry.tone === 'warn' ? c.needsYou : entry.tone === 'bad' ? c.danger : c.track }]} />
              <T variant="body" style={styles.flex} numberOfLines={2}>
                {entry.label}
              </T>
              {entry.detail ? (
                <T variant="label" color="text2">
                  {entry.detail}
                </T>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

/** The notes thread (and, for the standard screen, every change): who said what, when. */
export function HistoryList({ history, fields, botName, nowS }: { history: HistoryEntry[]; fields: Field[]; botName: (profile: string) => string; nowS: number }) {
  const { c } = useTheme()

  return (
    <>
      {history.map((entry, index) => {
        const line = historyLine(entry, fields, botName)

        return (
          <View key={`${entry.at}:${entry.field}:${index}`} style={styles.entry}>
            <View style={[styles.entryDot, { backgroundColor: line.note ? c.text2 : c.track }]} />
            {line.note ? (
              <T variant="secondary" style={styles.flex}>
                <T variant="secondary" style={styles.medium}>
                  {line.who}:
                </T>{' '}
                {line.text}
              </T>
            ) : (
              <T variant="secondary" color="text2" style={styles.flex}>
                {line.text}
              </T>
            )}
            <T variant="meta" color="text2" style={styles.entryTime}>
              {timeLabel(entry.at, nowS)}
            </T>
          </View>
        )
      })}
    </>
  )
}

/**
 * The question a record asks while it needs you, raised: the one thing on the screen that rises. One-tap choices answer it
 * (as a note to the bot); the tray's box takes an answer in your own words.
 */
export function AskCard({ botName, lead, question, choices, busy, onChoose }: { botName: string; lead: React.ReactNode; question: string; choices: string[]; busy: boolean; onChoose: (choice: string) => void }) {
  return (
    <Raised radius={radius.card} rise={question} style={styles.ask}>
      <View style={styles.askHead}>
        {lead}
        <T variant="label" color="text2">
          {botName} asks
        </T>
      </View>
      <Markdown text={question} size="reply" />
      {choices.length ? (
        <View style={styles.choices}>
          {choices.map(choice => (
            <Pill key={choice} label={choice} height={42} wrap disabled={busy} onPress={() => onChoose(choice)} accessibilityLabel={`Answer: ${choice}`} />
          ))}
        </View>
      ) : null}
    </Raised>
  )
}

/** What the draft card says under an approval draft: the digest you approve, and where it stands after. */
export function ApprovalLine({ state, botName, nowS, changed }: { state: ApprovalState; botName: string; nowS: number; changed?: { was: string; now: string } | null }) {
  const { c } = useTheme()

  if (changed) {
    return (
      <View style={styles.approval} accessibilityLiveRegion="polite">
        <T variant="secondary">This changed since you opened it, so it wasn’t sent. Review the new version.</T>
        <T variant="monoSmall" color="text2" style={styles.struck}>
          {shortDigest(changed.was)}
        </T>
        <T variant="monoSmall" color="text2">
          {shortDigest(changed.now)}
        </T>
      </View>
    )
  }

  const line = (icon: 'shield' | 'check' | 'clock', words: string, digest?: string) => (
    <View style={styles.approvalRow} accessible accessibilityLabel={words}>
      <Feather name={icon} size={13} color={c.text2} />
      <T variant="monoSmall" color="text2" style={styles.flex}>
        {digest ? `${words} · ${shortDigest(digest)}` : words}
      </T>
    </View>
  )

  switch (state.kind) {
    case 'waiting':
      return line('shield', 'Approving exactly this version', state.digest)
    case 'approved':
      return line('clock', `Approved ${timeLabel(state.at, nowS)} · ${botName} is sending it`, state.digest)
    case 'sent':
      return line('check', `Sent exactly what you approved · ${timeLabel(state.at, nowS)}`, state.digest)
    case 'stale':
      return line('shield', 'Changed after you approved it. Approve this version to send it', state.digest)
    case 'mismatch':
      return (
        <View style={styles.approvalRow}>
          <AttentionDot size={8} />
          <T variant="label" color="text2" style={styles.flex}>
            This draft didn’t check out on your phone, so it can’t be approved. Pull down to load it again.
          </T>
        </View>
      )
    case 'sentOther':
    case 'refused':
      return (
        <View style={styles.approval}>
          <View style={styles.approvalRow}>
            <AttentionDot size={8} />
            <T variant="secondary" style={styles.flex}>
              {state.kind === 'refused' ? `Nothing was sent${state.detail ? `: ${state.detail}` : '.'}` : 'What went out differs from what you approved.'}
            </T>
          </View>
          <T variant="monoSmall" color="text2">
            {state.kind === 'refused' ? `Approved ${shortDigest(state.digest)}` : `Approved ${shortDigest(state.approved)}${state.sent ? ` · sent ${shortDigest(state.sent)}` : ''}`}
          </T>
        </View>
      )
  }
}

/** A draft on its sheet: who it is for, Edit while it is yours to change, the text in its format, its files and its approval. */
export function DraftCard({ heading, text, format, editableNow, onEdit, files, creator, approval }: { heading: string; text: string; format?: TextFormat; editableNow: boolean; onEdit: () => void; files?: FileRef[]; creator: string; approval?: React.ReactNode }) {
  const { c } = useTheme()

  return (
    <View accessibilityLabel={heading} style={[styles.draft, { backgroundColor: c.sheet }]}>
      <View style={styles.draftHead}>
        <T variant="label" color="text2" numberOfLines={1} style={styles.flex}>
          {heading}
        </T>
        {editableNow ? (
          <Press accessibilityRole="button" accessibilityLabel={`Edit the ${heading.split(' · ')[0]?.toLowerCase()}`} hitSlop={8} onPress={onEdit} style={[styles.edit, { backgroundColor: c.canvas }]}>
            <T variant="label" style={styles.medium}>
              Edit
            </T>
          </Press>
        ) : null}
      </View>
      {format === 'html' ? (
        <HtmlPaper html={text} />
      ) : format === 'markdown' ? (
        <View style={styles.draftText}>
          <Markdown text={text} size="reply" />
        </View>
      ) : (
        <T variant="body" selectable style={styles.draftText}>
          {text}
        </T>
      )}
      {files?.length ? <FileList files={files} creator={creator} label={`Attachments · ${files.length}`} /> : null}
      {approval}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  gap: { gap: 8 },
  sectionLabel: { paddingHorizontal: 4 },
  inset: { paddingHorizontal: 4, gap: 4 },
  more: { fontFamily: fonts.medium },
  list: { borderRadius: radius.card, overflow: 'hidden' },
  separator: { height: 1, marginLeft: 16 },
  field: { minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldLabel: { flexShrink: 0, maxWidth: '45%' },
  fieldValue: { flex: 1, textAlign: 'right' },
  tone: { width: 7, height: 7, borderRadius: 4 },
  fileRow: { minHeight: 56, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  file: { borderRadius: radius.card, paddingLeft: 12, paddingRight: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  fileIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  paper: { height: 420, borderRadius: 14, overflow: 'hidden', backgroundColor: '#ffffff' },
  fullLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingTop: 8, paddingHorizontal: 2 },
  fullScreen: { flex: 1 },
  fullHeader: { paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', justifyContent: 'flex-end' },
  entry: { flexDirection: 'row', gap: 10 },
  entryDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  entryTime: { lineHeight: 20 },
  medium: { fontFamily: fonts.medium },
  ask: { padding: 16, gap: 10 },
  askHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  approval: { gap: 4, paddingTop: 4 },
  approvalRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 },
  struck: { textDecorationLine: 'line-through' },
  draft: { borderRadius: radius.card, paddingLeft: 16, paddingTop: 9, paddingRight: 9, paddingBottom: 16, gap: 8 },
  draftHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  edit: { height: 30, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: 'center' },
  draftText: { lineHeight: 22, paddingRight: 7 },
})
