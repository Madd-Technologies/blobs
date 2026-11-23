import Feather from '@expo/vector-icons/Feather'
import { useState, type ReactElement } from 'react'
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { BotFace } from '@/components/bots/BotFace'
import { Markdown } from '@/components/chat/Markdown'
import { ApprovalLine, DraftCard, EntryList, FieldRows, FileList, HistoryList, LinkCards } from '@/components/dashboard/RecordBlocks'
import { approvalDraftOf, settled, type Approvals } from '@/components/dashboard/useApprovals'
import { Pill } from '@/components/ui/Pill'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { askAboutRecord, fileCard, longLabel, recordDrafts, recordHeading, timeLabel, untilLabel } from '@/features/dashboard/view'
import { entriesOf, filesOf, listOf } from '@/features/dashboard/layout'
import type { BotMeta } from '@/lib/hermes/identity'
import type { Field, RecordDetail } from '@/lib/hermes/dashboard'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts } from '@/theme/tokens'

type RecordAction = { id: string; label: string }

interface Props {
  detail: RecordDetail
  nowS: number
  botName: (who: string) => string
  profileName: string
  ownerMeta?: BotMeta
  approvals: Approvals
  busy: 'next' | 'close' | 'note' | 'press' | null
  next: string | null
  nextCloses: boolean
  refreshControl: ReactElement<React.ComponentProps<typeof RefreshControl>>
  onEdit: (field: Field) => void
  onToggle: (field: Field, value: boolean) => void
  onNote: (text: string) => Promise<boolean>
  onPress: (action: RecordAction) => void
  onApprove: (action: RecordAction, draft: string) => void
  onAsk: (prompt: string) => void
  onOpenJob: () => void
  onSetClosed: () => void
  onNext: (statusField: Field, stage: string) => void
}

export function DefaultRecord({
  detail,
  nowS,
  botName,
  profileName,
  ownerMeta,
  approvals,
  busy,
  next,
  nextCloses,
  refreshControl,
  onEdit,
  onToggle,
  onNote,
  onPress,
  onAsk,
  onOpenJob,
  onSetClosed,
  onNext,
}: Props) {
  const { c } = useTheme()
  const [note, setNote] = useState('')
  const { record, collection, history } = detail
  const heading = recordHeading(detail)
  const status = collection.fields.find(field => field.type === 'status' && !field.retired)
  const drafts = recordDrafts(detail)
  const buttons = detail.show?.actions ?? []
  const running = detail.show?.running ?? null
  const firstButton = running ? null : (buttons[0] ?? null)
  const button = firstButton && !settled(approvals, approvalDraftOf(detail, firstButton.id)) ? firstButton : null
  const primary = !running && !button && heading.needsYou && next ? next : null
  const files = collection.fields.flatMap(field => {
    const card = field.retired ? null : fileCard(field.type, record.values[field.key])

    return card ? [{ field, card, value: String(record.values[field.key]).trim() }] : []
  })
  const attached = new Set(collection.fields.flatMap(field => (field.attachments ? [field.attachments] : [])))
  const structured = collection.fields.filter(field => !field.retired && ['list', 'entries', 'files'].includes(field.type) && !attached.has(field.key))
  const fields = collection.fields.filter(field => !field.retired && field.type !== 'draft' && !structured.includes(field) && !attached.has(field.key) && !heading.shown.includes(field.key) && !files.some(file => file.field.key === field.key))
  const second = button ? (buttons[1] ?? null) : null
  const creator = record.created_by
  const mutedUntil = record.muted_until && record.muted_until > nowS ? record.muted_until : null

  async function submitNote(typed: string = note) {
    const text = typed.trim()

    if (!text) {
      return
    }

    if (await onNote(text)) {
      setNote('')
    }
  }

  return (
    <>
      <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
        <View style={styles.who}>
          <BotFace name={creator} meta={ownerMeta} size={28} />
          <T variant="rowTitle" numberOfLines={1} style={styles.flex}>
            {botName(creator)}
          </T>
          <T variant="meta" color="text2">
            {longLabel({ type: 'datetime', value: record.created_at }, nowS)}
          </T>
        </View>

        <View style={styles.titleBlock}>
          <T variant="stat" color={record.closed_at ? 'text2' : 'text'} style={record.closed_at ? styles.struck : undefined}>
            {heading.title}
          </T>
          {record.closed_at ? (
            <T variant="secondary" color="text2">
              Done {timeLabel(record.closed_at, nowS)}
            </T>
          ) : mutedUntil ? (
            <View style={styles.metaLine} accessible accessibilityLabel={`Muted until ${untilLabel(mutedUntil, nowS)}`}>
              <Feather name="bell-off" size={14} color={c.text2} />
              <T variant="secondary" color="text2">
                Muted until {untilLabel(mutedUntil, nowS)}
              </T>
            </View>
          ) : heading.meta ? (
            <View style={styles.metaLine}>
              {heading.needsYou ? <AttentionDot size={8} /> : null}
              <T variant="secondary" color={heading.needsYou ? 'needsYouText' : 'text2'}>
                {heading.meta}
              </T>
            </View>
          ) : null}
        </View>

        {heading.body ? (
          <View style={styles.inset}>
            <Markdown text={heading.body} size="reply" />
          </View>
        ) : null}

        {drafts.map(draft => (
          <DraftCard
            key={draft.field.key}
            heading={draft.heading}
            text={draft.text}
            format={draft.field.format}
            editableNow={!running && !draft.field.readonly}
            onEdit={() => onEdit(draft.field)}
            files={draft.field.attachments ? filesOf(record.values[draft.field.attachments]) : undefined}
            creator={creator}
            approval={draft.field.approve && approvals.states[draft.field.key] ? <ApprovalLine state={approvals.states[draft.field.key]!} botName={profileName} nowS={nowS} changed={approvals.changed[draft.field.key] ?? null} /> : null}
          />
        ))}

        <LinkCards items={files} creator={creator} onEdit={onEdit} />

        {structured.map(field =>
          field.type === 'files' ? (
            <FileList key={field.key} files={filesOf(record.values[field.key])} creator={creator} label={field.label} />
          ) : (
            <EntryList key={field.key} label={field.label} entries={field.type === 'entries' ? entriesOf(record.values[field.key]) : listOf(record.values[field.key]).map(label => ({ label }))} />
          ),
        )}

        {fields.length ? <FieldRows fields={fields} record={record} nowS={nowS} creator={creator} onEdit={onEdit} onToggle={onToggle} /> : null}

        <View style={styles.history}>
          <T variant="label" color="text2">
            Notes and history
          </T>
          <View style={[styles.noteField, { backgroundColor: c.sheet }]}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={`Add a note for ${botName(creator)}`}
              placeholderTextColor={c.text2}
              accessibilityLabel={`Add a note for ${botName(creator)}`}
              returnKeyType="send"
              submitBehavior="blurAndSubmit"
              editable={busy !== 'note'}
              onSubmitEditing={event => void submitNote(event.nativeEvent.text)}
              style={[styles.noteInput, { color: c.text }]}
            />
          </View>
          <HistoryList history={history} fields={collection.fields} botName={botName} nowS={nowS} />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {running ? (
          <View style={styles.onIt} accessibilityLiveRegion="polite">
            <View style={[styles.onItDot, { backgroundColor: c.text }]} />
            <T variant="secondary" color="text2" numberOfLines={1}>
              {profileName} is on it
            </T>
          </View>
        ) : null}
        <Raised radius={32} style={styles.actions}>
          {button ? <Pill label={button.label} variant="primary" height={48} loading={busy === 'press'} onPress={() => onPress(button)} /> : null}
          {primary ? <Pill label={`Mark ${primary.toLowerCase()}`} variant="primary" height={48} loading={busy === 'next'} onPress={() => status && onNext(status, primary)} /> : null}
          <View style={styles.footerRow}>
            {second ? <Pill label={second.label} height={48} flex disabled={busy === 'press'} onPress={() => onPress(second)} /> : null}
            {running?.session ? (
              <Pill label="Open side chat" height={48} flex onPress={onOpenJob} />
            ) : (
              <Pill label={`Ask ${profileName}`} height={48} flex onPress={() => onAsk(askAboutRecord(heading.title, collection.title, record.id))} />
            )}
            {second || (primary && nextCloses) ? null : (
              <Pill
                label={record.closed_at ? 'Reopen' : 'Mark done'}
                height={48}
                flex
                disabled={busy === 'close'}
                onPress={onSetClosed}
              />
            )}
          </View>
        </Raised>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 14 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  titleBlock: { gap: 6, paddingHorizontal: 4 },
  struck: { textDecorationLine: 'line-through' },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inset: { paddingHorizontal: 4 },
  onIt: { height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  onItDot: { width: 6, height: 6, borderRadius: 3, opacity: 0.5 },
  history: { gap: 10, paddingHorizontal: 4 },
  noteField: { height: 44, borderRadius: 999, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  noteInput: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  footer: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, gap: 8 },
  actions: { padding: 8, gap: 8 },
  footerRow: { flexDirection: 'row', gap: 8 },
})
