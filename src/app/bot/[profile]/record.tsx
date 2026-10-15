import Feather from '@expo/vector-icons/Feather'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { AttentionDot } from '@/components/bots/AttentionDot'
import { BotFace } from '@/components/bots/BotFace'
import { Markdown } from '@/components/chat/Markdown'
import { FieldSheet } from '@/components/dashboard/FieldSheet'
import { openAction } from '@/components/dashboard/openAction'
import { useRowActions } from '@/components/dashboard/useRowActions'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { Screen } from '@/components/ui/Screen'
import { Sheet } from '@/components/ui/Sheet'
import { Spinner } from '@/components/ui/Spinner'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import { actionFor, askAboutRecord, fileCard, formatTyped, historyLine, longLabel, nextStage, recordDrafts, recordHeading, timeLabel, typedOf, untilLabel } from '@/features/dashboard/view'
import type { Field } from '@/lib/hermes/dashboard'
import { useNow } from '@/lib/useNow'
import { useBotView, useBotViews } from '@/stores/bots'
import { useDashboards } from '@/stores/dashboards'
import { useDrafts } from '@/stores/drafts'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

const ACTION_ICON = { tel: 'phone', mailto: 'mail', web: 'external-link', viewer: 'file-text' } as const

/** A file card's icon by what the document is: a sheet, a deck, a picture, a web page, or a document. */
function fileIcon(card: { kind: string; where: string }): 'grid' | 'monitor' | 'image' | 'globe' | 'file-text' {
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


/** One record a bot keeps for you: its fields (yours to change), notes and history, and what to do next. */
export default function DashboardRecord() {
  const { profile, id } = useLocalSearchParams<{ profile: string; id: string }>()
  const router = useRouter()
  const { c } = useTheme()
  const detail = useDashboards(state => state.records[id])
  const bots = useBotViews({ includeHidden: true })
  const owner = useBotView(detail?.record.created_by ?? profile)
  const [error, setError] = useState<string | null>(null)
  const [pulling, setPulling] = useState(false)
  const [editing, setEditing] = useState<Field | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'next' | 'close' | 'note' | 'press' | null>(null)
  const [more, setMore] = useState(false)

  const botName = (who: string) => bots.find(bot => bot.profile === who)?.name ?? who
  const name = botName(profile)
  const clock = useNow(60)
  const rows = useRowActions(detail?.now ?? clock, botName)

  useFocusEffect(
    useCallback(() => {
      void useDashboards
        .getState()
        .loadRecord(id)
        .then(problem => setError(problem))
    }, [id]),
  )

  async function onPull() {
    setPulling(true)
    setError(await useDashboards.getState().loadRecord(id))
    setPulling(false)
  }

  async function run(kind: 'next' | 'close' | 'note' | 'press', call: () => Promise<string | null>) {
    setBusy(kind)
    const problem = await call()
    setBusy(null)

    if (problem) {
      toast(problem)
    }

    return problem
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/bot/[profile]/dashboard', params: { profile } }))

  if (!detail) {
    return (
      <BotPaper profile={profile}>
        <Screen edges={['top', 'bottom']}>
          <View style={styles.header}>
            <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={back} />
            <View style={styles.flex} />
            <View style={styles.spacer} />
          </View>
          <View style={styles.center}>
            {error ? (
              <T variant="secondary" color="text2" style={styles.centered}>
                {error}
              </T>
            ) : (
              <Spinner size={16} />
            )}
          </View>
        </Screen>
      </BotPaper>
    )
  }

  const { record, collection, history } = detail
  const nowS = detail.now
  const heading = recordHeading(detail)
  const status = collection.fields.find(field => field.type === 'status' && !field.retired)
  const next = record.closed_at ? null : nextStage(status, status ? record.values[status.key] : undefined)
  const nextCloses = !!next && !!status?.stages?.find(stage => stage.name === next)?.done
  const drafts = recordDrafts(detail)
  // The bot's buttons this record offers now (the first is the white pill, the rest under ⋯), and the pressed one under way.
  const buttons = detail.show?.actions ?? []
  const running = detail.show?.running ?? null
  const button = running ? null : (buttons[0] ?? null)
  const primary = !running && !button && heading.needsYou && next ? next : null
  // Documents the record links to are file cards near the top; everything else is a row in the field list.
  const files = collection.fields.flatMap(field => {
    const card = field.retired ? null : fileCard(field.type, record.values[field.key])

    return card ? [{ field, card, value: String(record.values[field.key]).trim() }] : []
  })
  const fields = collection.fields.filter(field => !field.retired && field.type !== 'draft' && !heading.shown.includes(field.key) && !files.some(file => file.field.key === field.key))
  // The bot's second button gets its own pill beside Ask; any more are under ⋯.
  const second = button ? (buttons[1] ?? null) : null
  const creator = record.created_by
  const mutedUntil = record.muted_until && record.muted_until > nowS ? record.muted_until : null

  const change = (field: Field, value: unknown) => useDashboards.getState().change(profile, id, { [field.key]: value })

  const askBot = () => {
    useDrafts.getState().set(profile, askAboutRecord(heading.title, collection.title, record.id))
    router.push({ pathname: '/bot/[profile]', params: { profile } })
  }

  /** A button: the bot gets the job in a fresh side chat, which is where the person goes to watch it and answer approvals. */
  async function press(action: { id: string; label: string }) {
    setMore(false)

    if (!(await run('press', () => useDashboards.getState().press(profile, id, action.id)))) {
      router.push({ pathname: '/bot/[profile]', params: { profile } })
    }
  }

  const openJob = () => running?.session && router.push({ pathname: '/bot/[profile]', params: { profile, chat: running.session } })

  /** Takes the text from the field itself when the keyboard sends it: the typed state can lag a fast typist. */
  async function addNote(typed: string = note) {
    const text = typed.trim()

    if (!text) {
      return
    }

    if (!(await run('note', () => useDashboards.getState().note(profile, id, text)))) {
      setNote('')
    }
  }

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={back} />
          <T variant="heading" numberOfLines={1} style={styles.flex} accessibilityRole="header">
            {collection.title}
          </T>
          <View style={styles.headerRight}>
            {!running && buttons.length > 2 ? <IconCircle icon="more-horizontal" label="More buttons" onPress={() => setMore(true)} /> : null}
            {record.closed_at ? (
              <View style={styles.spacer} />
            ) : (
              <IconCircle
                icon={mutedUntil ? 'bell' : 'bell-off'}
                label={mutedUntil ? 'Unmute' : 'Mute'}
                onPress={() => rows.mute(profile, { id: record.id, title: { key: 'title', type: 'text', value: heading.title }, muted_until: mutedUntil ?? undefined })}
              />
            )}
          </View>
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onPull()} tintColor={c.text2} />}>
            <View style={styles.who}>
              <BotFace name={creator} meta={owner?.meta} size={28} />
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
              <View key={draft.field.key} accessibilityLabel={draft.heading} style={[styles.draft, { backgroundColor: c.sheet }]}>
                <View style={styles.draftHead}>
                  <T variant="label" color="text2" numberOfLines={1} style={styles.flex}>
                    {draft.heading}
                  </T>
                  {running ? null : (
                    <Press accessibilityRole="button" accessibilityLabel={`Edit the ${draft.field.label.toLowerCase()}`} hitSlop={8} onPress={() => setEditing(draft.field)} style={[styles.edit, { backgroundColor: c.canvas }]}>
                      <T variant="label" style={styles.medium}>
                        Edit
                      </T>
                    </Press>
                  )}
                </View>
                <T variant="body" selectable style={styles.draftText}>
                  {draft.text}
                </T>
              </View>
            ))}

            {files.map(({ field, card, value }) => (
              <Pressable
                key={field.key}
                accessibilityRole="button"
                accessibilityLabel={`${field.label}, ${card.kind}, ${card.where}`}
                accessibilityHint="Long press to change the link"
                onPress={() => openAction(card.opens === 'viewer' ? { kind: 'viewer', url: value, label: 'Open' } : { kind: 'web', url: value, label: 'Open' }, creator, field.label)}
                onLongPress={() => setEditing(field)}
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

            {fields.length ? (
              <View style={[styles.list, { backgroundColor: c.sheet }]}>
                {fields.map((field, index) => {
                  const value = record.values[field.key]
                  const typed = typedOf(field, value)
                  const action = typed ? actionFor(typed) : null
                  const shown = typed ? (field.type === 'date' || field.type === 'datetime' ? longLabel(typed, nowS) : formatTyped(typed, nowS)) : '–'
                  const label = `${field.label}, ${typed ? shown : 'not set'}`

                  return (
                    <View key={field.key}>
                      {index > 0 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
                      {field.type === 'checkbox' ? (
                        <View style={styles.field}>
                          <T variant="body" style={styles.flex}>
                            {field.label}
                          </T>
                          <Switch value={value === true} label={field.label} onValueChange={next => void change(field, next).then(problem => problem && toast(problem))} />
                        </View>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={label}
                          accessibilityHint={action ? `${action.label}. Long press to change.` : 'Change it'}
                          accessibilityActions={action ? [{ name: 'activate' }, { name: 'longpress', label: 'Change' }] : undefined}
                          onAccessibilityAction={event => (event.nativeEvent.actionName === 'longpress' ? setEditing(field) : action && openAction(action, creator, shown))}
                          onPress={() => (action ? openAction(action, creator, shown) : setEditing(field))}
                          onLongPress={() => setEditing(field)}
                          style={({ pressed }) => [styles.field, pressed && { backgroundColor: c.tone }]}
                        >
                          <T variant="body" style={styles.fieldLabel} numberOfLines={1}>
                            {field.label}
                          </T>
                          <T variant="body" color={field.type === 'status' ? 'text' : 'text2'} numberOfLines={1} style={styles.fieldValue}>
                            {shown}
                          </T>
                          {action ? <Feather name={ACTION_ICON[action.kind]} size={15} color={c.text2} /> : field.type === 'status' || field.type === 'choice' ? <Feather name="chevron-right" size={16} color={c.text2} /> : null}
                        </Pressable>
                      )}
                    </View>
                  )
                })}
              </View>
            ) : null}

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
                  onSubmitEditing={event => void addNote(event.nativeEvent.text)}
                  style={[styles.noteInput, { color: c.text }]}
                />
              </View>
              {history.map((entry, index) => {
                const line = historyLine(entry, collection.fields, botName)

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
            </View>
          </ScrollView>

          <View style={styles.footer}>
            {running ? (
              <View style={styles.onIt} accessibilityLiveRegion="polite">
                <View style={[styles.onItDot, { backgroundColor: c.text }]} />
                <T variant="secondary" color="text2" numberOfLines={1}>
                  {name} is on it
                </T>
              </View>
            ) : null}
            {/* What to do next, raised: the bot's button (or the next stage) as the white pill, the rest pressed in below it. */}
            <Raised radius={32} style={styles.actions}>
              {button ? <Pill label={button.label} variant="primary" height={48} loading={busy === 'press'} onPress={() => void press(button)} /> : null}
              {primary ? <Pill label={`Mark ${primary.toLowerCase()}`} variant="primary" height={48} loading={busy === 'next'} onPress={() => status && void run('next', () => change(status, primary))} /> : null}
              <View style={styles.footerRow}>
                {second ? <Pill label={second.label} height={48} flex disabled={busy === 'press'} onPress={() => void press(second)} /> : null}
                {running?.session ? <Pill label="Open side chat" height={48} flex onPress={openJob} /> : <Pill label={`Ask ${name}`} height={48} flex onPress={askBot} />}
                {second || (primary && nextCloses) ? null : (
                  <Pill
                    label={record.closed_at ? 'Reopen' : 'Mark done'}
                    height={48}
                    flex
                    disabled={busy === 'close'}
                    onPress={() => void run('close', () => useDashboards.getState().setClosed(profile, id, !record.closed_at))}
                  />
                )}
              </View>
            </Raised>
          </View>
        </KeyboardAvoidingView>

        <FieldSheet
          field={editing}
          value={editing ? record.values[editing.key] : null}
          subtitle={editing?.to && record.values[editing.to] ? `To ${String(record.values[editing.to])}` : undefined}
          nowS={nowS}
          botName={botName(creator)}
          onClose={() => setEditing(null)}
          onSave={value => (editing ? change(editing, value) : Promise.resolve(null))}
        />

        {rows.sheet}

        <Sheet visible={more} onClose={() => setMore(false)} label="More buttons">
          <View style={styles.sheet}>
            {buttons.slice(2).map((action, index) => (
              <View key={action.id}>
                {index > 0 ? <View style={[styles.sheetRule, { backgroundColor: c.separator }]} /> : null}
                <Pressable accessibilityRole="button" onPress={() => void press(action)} style={({ pressed }) => [styles.sheetRow, pressed && { backgroundColor: c.pressedIn }]}>
                  <T variant="body">{action.label}</T>
                </Pressable>
              </View>
            ))}
            <T variant="label" color="text2" style={styles.sheetNote}>
              Each opens a side chat with {name} to do it.
            </T>
          </View>
        </Sheet>
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 6 },
  spacer: { width: 40 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 14 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  titleBlock: { gap: 6, paddingHorizontal: 4 },
  struck: { textDecorationLine: 'line-through' },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inset: { paddingHorizontal: 4 },
  list: { borderRadius: radius.card, overflow: 'hidden' },
  separator: { height: 1, marginLeft: 16 },
  field: { minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldLabel: { flexShrink: 0, maxWidth: '45%' },
  fieldValue: { flex: 1, textAlign: 'right' },
  draft: { borderRadius: radius.card, paddingLeft: 16, paddingTop: 9, paddingRight: 9, paddingBottom: 16, gap: 6 },
  edit: { height: 30, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: 'center' },
  file: { borderRadius: radius.card, paddingLeft: 12, paddingRight: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  fileIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  draftHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  draftText: { lineHeight: 22, paddingRight: 7 },
  onIt: { height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  onItDot: { width: 6, height: 6, borderRadius: 3, opacity: 0.5 },
  sheet: { paddingBottom: 8 },
  sheetRow: { minHeight: 52, paddingHorizontal: 4, justifyContent: 'center', borderRadius: 8 },
  sheetRule: { height: 1, marginLeft: 4 },
  sheetNote: { marginHorizontal: 4, marginTop: 10 },
  history: { gap: 10, paddingHorizontal: 4 },
  noteField: { height: 44, borderRadius: 999, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  noteInput: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  entry: { flexDirection: 'row', gap: 10 },
  entryDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  medium: { fontFamily: fonts.medium },
  entryTime: { lineHeight: 20 },
  footer: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, gap: 8 },
  actions: { padding: 8, gap: 8 },
  footerRow: { flexDirection: 'row', gap: 8 },
})
