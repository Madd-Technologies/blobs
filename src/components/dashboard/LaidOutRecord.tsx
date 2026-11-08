import Feather from '@expo/vector-icons/Feather'
import { useState, type ReactElement } from 'react'
import { ScrollView, StyleSheet, TextInput, View, type RefreshControlProps } from 'react-native'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { BotFace } from '@/components/bots/BotFace'
import { ApprovalLine, AskCard, DraftCard, EntryList, FieldRows, FileList, FormattedText, HistoryList, LinkCards, SectionLabel } from '@/components/dashboard/RecordBlocks'
import { approvalDraftOf, settled, type Approvals } from '@/components/dashboard/useApprovals'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { bylineOf, entriesOf, filesOf, listOf, shownBlocks, threadOf, trayOf, type TrayButton } from '@/features/dashboard/layout'
import { fileCard, formatTyped, longLabel, recordHeading, timeLabel, typedOf, untilLabel } from '@/features/dashboard/view'
import type { BotMeta } from '@/lib/hermes/identity'
import type { Field, RecordDetail } from '@/lib/hermes/dashboard'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts } from '@/theme/tokens'

interface Props {
  detail: RecordDetail
  nowS: number
  /** A bot's name by profile, or null when it is not one of yours. */
  nameOf: (profile: string) => string | null
  ownerMeta?: BotMeta
  approvals: Approvals
  busy: string | null
  refreshControl: ReactElement<RefreshControlProps>
  next: string | null
  onEdit: (field: Field) => void
  onToggle: (field: Field, value: boolean) => void
  onChange: (field: Field, value: unknown) => Promise<string | null>
  /** Adds a note (which answers the question while it is up); resolves to an error to show, or null. */
  onNote: (text: string) => Promise<string | null>
  onPress: (action: { id: string; label: string }) => void
  onApprove: (action: { id: string; label: string }, draft: string) => void
  onAsk: () => void
  onOpenJob: () => void
  onSetClosed: () => void
  onNext: (stage: string) => void
}

/**
 * A record its bot laid out from blocks (hermes-dashboard 0.6+), drawn in Card Stock: only the question rises, plus the tray.
 * The bot changes the structure; every block here is the app's own.
 */
export function LaidOutRecord({ detail, nowS, nameOf, ownerMeta, approvals, busy, refreshControl, next, onEdit, onToggle, onChange, onNote, onPress, onApprove, onAsk, onOpenJob, onSetClosed, onNext }: Props) {
  const { c } = useTheme()
  const [note, setNote] = useState('')
  const { record, collection, history } = detail
  const values = record.values
  const byKey = new Map(collection.fields.map(field => [field.key, field]))
  const creator = record.created_by
  const botName = nameOf(creator) ?? creator
  const heading = recordHeading(detail)
  const running = detail.show?.running ?? null
  const blocks = shownBlocks(detail)
  // A button whose approval is done with (approved and on its way, or sent) leaves the tray.
  const offered = trayOf(detail, botName, next)
  const done = (button: TrayButton | null) => !!button && button.kind === 'action' && settled(approvals, approvalDraftOf(detail, button.id))
  const tray = { ...offered, primary: done(offered.primary) ? null : offered.primary, secondary: offered.secondary.filter(button => !done(button)) }
  const mutedUntil = record.muted_until && record.muted_until > nowS ? record.muted_until : null
  const lead = <BotFace name={creator} meta={ownerMeta} size={22} />

  async function send(typed: string = note) {
    const text = typed.trim()

    if (text && !(await onNote(text))) {
      setNote('')
    }
  }

  function answer(block: Extract<NonNullable<RecordDetail['collection']['layout']>['blocks'][number], { block: 'ask' }>, choice: string) {
    const field = block.answer !== 'note' ? byKey.get(block.answer) : undefined

    void (field ? onChange(field, choice) : onNote(choice))
  }

  function draftApproval(key: string) {
    const state = approvals.states[key]

    return state ? <ApprovalLine state={state} botName={botName} nowS={nowS} changed={approvals.changed[key] ?? null} /> : null
  }

  function pressButton(button: TrayButton) {
    if (button.kind === 'ask') {
      onAsk()
    } else if (button.kind === 'done') {
      onSetClosed()
    } else if (button.kind === 'next') {
      onNext(button.stage)
    } else {
      const draft = approvalDraftOf(detail, button.id)

      if (draft && approvals.changed[draft]) {
        approvals.reviewed(draft)
      } else if (draft) {
        onApprove(button, draft)
      } else {
        onPress(button)
      }
    }
  }

  /** A button's label and whether it can be pressed now: an approval waits until the draft checks out on the phone. */
  function buttonView(button: TrayButton): { label: string; disabled: boolean } {
    if (button.kind === 'ask') {
      return { label: `Ask ${botName}`, disabled: false }
    }

    if (button.kind === 'done') {
      return { label: button.closed ? 'Reopen' : 'Mark done', disabled: busy === 'close' }
    }

    if (button.kind === 'next') {
      return { label: `Mark ${button.stage.toLowerCase()}`, disabled: busy === 'next' }
    }

    const draft = approvalDraftOf(detail, button.id)

    if (draft && approvals.changed[draft]) {
      return { label: 'Review the new version', disabled: false }
    }

    const state = draft ? approvals.states[draft] : undefined

    return { label: button.label, disabled: busy === 'press' || (!!draft && (!state || (state.kind !== 'waiting' && state.kind !== 'stale'))) }
  }

  const header = (block: { meta?: string; byline?: string }) => {
    const byline = bylineOf(block.byline, values, nameOf)
    const metaField = block.meta ? byKey.get(block.meta) : undefined
    const metaTyped = metaField && !Array.isArray(values[metaField.key]) ? typedOf(metaField, values[metaField.key]) : null
    const meta = metaTyped ? formatTyped(metaTyped, nowS) : heading.meta
    const needsYou = !!detail.show?.ask || heading.needsYou

    return (
      <View key="header" style={styles.headerBlock}>
        <View style={styles.who}>
          <BotFace name={creator} meta={ownerMeta} size={28} />
          <T variant="rowTitle" numberOfLines={1} style={styles.flexShrink}>
            {botName}
          </T>
          {byline ? (
            <T variant="secondary" color="text2" numberOfLines={1} style={styles.flex}>
              {byline}
            </T>
          ) : (
            <View style={styles.flex} />
          )}
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
            <View style={styles.metaLine}>
              <Feather name="bell-off" size={14} color={c.text2} />
              <T variant="secondary" color="text2">
                Muted until {untilLabel(mutedUntil, nowS)}
              </T>
            </View>
          ) : meta ? (
            <View style={styles.metaLine}>
              {needsYou ? <AttentionDot size={8} /> : null}
              <T variant="secondary" color={needsYou ? 'needsYouText' : 'text2'}>
                {needsYou && detail.show?.ask ? `${meta} · waiting on your answer` : meta}
              </T>
            </View>
          ) : null}
        </View>
      </View>
    )
  }

  return (
    <>
      <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
        {blocks.map((block, index) => {
          switch (block.block) {
            case 'header':
              return header(block)

            case 'ask':
              return <AskCard key="ask" botName={botName} lead={lead} question={String(values[block.field] ?? '')} choices={block.choices ? listOf(values[block.choices]) : []} busy={busy === 'note'} onChoose={choice => answer(block, choice)} />

            case 'text': {
              const field = byKey.get(block.field)

              return (
                <View key={`text:${block.field}`} style={styles.section}>
                  {block.label ? <SectionLabel>{block.label}</SectionLabel> : null}
                  <FormattedText text={String(values[block.field] ?? '')} format={block.format ?? field?.format} fold={block.fold} />
                </View>
              )
            }

            case 'fields': {
              const fields = block.fields.flatMap(key => (byKey.get(key) && !byKey.get(key)?.retired ? [byKey.get(key)!] : []))

              return <FieldRows key={`fields:${index}`} label={block.label} fields={fields} record={record} nowS={nowS} creator={creator} onEdit={onEdit} onToggle={onToggle} />
            }

            case 'files': {
              const field = byKey.get(block.field)

              if (field?.type === 'files') {
                return <FileList key={`files:${block.field}`} files={filesOf(values[block.field])} creator={creator} label={block.label ?? field.label} />
              }

              const card = field ? fileCard(field.type, values[field.key]) : null

              return field && card ? <LinkCards key={`files:${block.field}`} items={[{ field, card, value: String(values[field.key]).trim() }]} creator={creator} onEdit={onEdit} /> : null
            }

            case 'draft': {
              const field = byKey.get(block.field)

              if (!field) {
                return null
              }

              const to = field.to ? values[field.to] : null

              return (
                <DraftCard
                  key={`draft:${block.field}`}
                  heading={to ? `${field.label} · to ${String(to)}` : field.label}
                  text={String(values[block.field] ?? '')}
                  format={field.format}
                  editableNow={!running && !field.readonly}
                  onEdit={() => onEdit(field)}
                  files={field.attachments ? filesOf(values[field.attachments]) : undefined}
                  creator={creator}
                  approval={field.approve ? draftApproval(field.key) : null}
                />
              )
            }

            case 'entries':
              return <EntryList key={`entries:${block.field}`} entries={entriesOf(values[block.field])} label={block.label} />

            case 'notes':
              return (
                <View key="notes" style={styles.notes}>
                  <SectionLabel>{block.label ?? 'Notes'}</SectionLabel>
                  {tray.composer ? null : (
                    <View style={[styles.noteField, { backgroundColor: c.sheet }]}>
                      <TextInput
                        value={note}
                        onChangeText={setNote}
                        placeholder={`Add a note for ${botName}`}
                        placeholderTextColor={c.text2}
                        accessibilityLabel={`Add a note for ${botName}`}
                        returnKeyType="send"
                        submitBehavior="blurAndSubmit"
                        editable={busy !== 'note'}
                        onSubmitEditing={event => void send(event.nativeEvent.text)}
                        style={[styles.noteInput, { color: c.text }]}
                      />
                    </View>
                  )}
                  <HistoryList history={threadOf(history, block.history)} fields={collection.fields} botName={who => nameOf(who) ?? who} nowS={nowS} />
                </View>
              )
          }
        })}
      </ScrollView>

      <View style={styles.footer}>
        {running ? (
          <View style={styles.onIt} accessibilityLiveRegion="polite">
            <View style={[styles.onItDot, { backgroundColor: c.text }]} />
            <T variant="secondary" color="text2" numberOfLines={1}>
              {botName} is on it
            </T>
          </View>
        ) : null}

        {tray.composer ? (
          <Raised radius={28} style={styles.composer}>
            {tray.secondary.some(button => button.kind === 'ask') ? <IconCircle icon={running?.session ? 'message-circle' : 'message-square'} label={running?.session ? 'Open side chat' : `Ask ${botName}`} diameter={44} onPress={running?.session ? onOpenJob : onAsk} /> : null}
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={tray.composer.placeholder}
              placeholderTextColor={c.text2}
              accessibilityLabel={tray.composer.placeholder}
              multiline
              editable={busy !== 'note'}
              style={[styles.composerInput, { color: c.text }]}
            />
            <IconCircle icon="arrow-up" label="Send" diameter={44} filled disabled={!note.trim() || busy === 'note'} onPress={() => void send()} />
          </Raised>
        ) : tray.primary || tray.secondary.length ? (
          <Raised radius={32} style={styles.actions}>
            {tray.primary ? <Pill label={buttonView(tray.primary).label} variant="primary" height={48} loading={busy === 'press'} disabled={buttonView(tray.primary).disabled} onPress={() => pressButton(tray.primary!)} /> : null}
            {tray.secondary.length ? (
              <View style={styles.footerRow}>
                {tray.secondary.map(button => {
                  const view = button.kind === 'ask' && running?.session ? { label: 'Open side chat', disabled: false } : buttonView(button)

                  return <Pill key={button.kind === 'action' ? button.id : button.kind} label={view.label} height={48} flex disabled={view.disabled} onPress={() => (button.kind === 'ask' && running?.session ? onOpenJob() : pressButton(button))} />
                })}
              </View>
            ) : null}
          </Raised>
        ) : null}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 16 },
  headerBlock: { gap: 14 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  titleBlock: { gap: 6, paddingHorizontal: 4 },
  struck: { textDecorationLine: 'line-through' },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  section: { gap: 8 },
  notes: { gap: 10, paddingHorizontal: 4 },
  noteField: { height: 44, borderRadius: 999, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  noteInput: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  footer: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, gap: 8 },
  onIt: { height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  onItDot: { width: 6, height: 6, borderRadius: 3, opacity: 0.5 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, padding: 6 },
  composerInput: { flex: 1, minWidth: 0, minHeight: 44, maxHeight: 120, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 12, fontFamily: fonts.regular, fontSize: 16 },
  actions: { padding: 8, gap: 8 },
  footerRow: { flexDirection: 'row', gap: 8 },
})
