import Feather from '@expo/vector-icons/Feather'
import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams } from 'expo-router'
import { Fragment, useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Sheet } from '@/components/ui/Sheet'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { afterSheetCloses } from '@/lib/afterSheet'
import { EnvError, isEnvName, linkHost, matchKeys, removeEnvKey, saveEnvKey, setKeys, typedName, XAI_KEY, type EnvKey } from '@/lib/hermes/env'
import { useBotView } from '@/stores/bots'
import { useConnection } from '@/stores/connection'
import { useKeys } from '@/stores/keys'
import { reloadEnv } from '@/stores/profiles'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/** What the key sheet shows: the names to add, or the value for one name. */
type Editing = { kind: 'add' } | { kind: 'value'; name: string; row: EnvKey | null }

/** How long a linked key waits before its sheet rises: the page's own push has to finish first. */
const LINKED_KEY_MS = 400

/**
 * A bot's keys: what is in its own `.env` on the server, added, changed and removed through Hermes's own dashboard routes, so no
 * model is in the loop. Values are only ever typed or pasted in, sent once and forgotten; the list shows the server's preview.
 */
export default function BotKeys() {
  // `key`: a screen that needs one (a voice call paying with the bot's own xAI key) links here to have it added.
  const { profile, key } = useLocalSearchParams<{ profile: string; key?: string }>()
  const online = useConnection(state => state.status === 'online')
  const name = useBotView(profile)?.name ?? profile
  const { c } = useTheme()
  const rows = useKeys(state => state.byBot[profile]?.rows ?? null)
  const error = useKeys(state => state.byBot[profile]?.error ?? null)
  const [showOther, setShowOther] = useState(false)
  // Which sheet is up. What it shows stays put while it slides away, so it doesn't change under the finger.
  const [open, setOpen] = useState<'options' | 'key' | 'remove' | null>(null)
  const [chosen, setChosen] = useState<EnvKey | null>(null)
  const [editing, setEditing] = useState<Editing>({ kind: 'add' })
  // A fresh value field each time the key sheet opens.
  const [opening, setOpening] = useState(0)

  useEffect(() => {
    if (online) {
      void useKeys.getState().load(profile)
    }
  }, [online, profile])

  // Opened for one key: straight to its value, once the page has slid in (its description joins when the list arrives).
  useEffect(() => {
    if (!key || !isEnvName(key)) {
      return
    }

    const timer = setTimeout(() => {
      setEditing({ kind: 'value', name: key, row: null })
      setOpening(count => count + 1)
      setOpen('key')
    }, LINKED_KEY_MS)

    return () => clearTimeout(timer)
  }, [key])

  function openKey(next: Editing) {
    setEditing(next)
    setOpening(count => count + 1)
    setOpen('key')
  }

  async function changed(message: string) {
    toast(message)
    await useKeys.getState().load(profile)
    // Other bots read their .env each turn, but the server's own keeps the environment it started with once it hosts more than one:
    // this re-reads it, as Details → Reload settings does.
    void reloadEnv()
  }

  async function remove(row: EnvKey) {
    const config = useConnection.getState().config

    if (!config) {
      toast('Not connected to the server.')

      return
    }

    try {
      const found = await removeEnvKey(config, profile, row.name)

      await changed(found ? `Removed ${row.name}` : `${row.name} was already gone`)
    } catch (problem) {
      toast(problem instanceof EnvError ? problem.message : 'Couldn’t remove the key.')
    }
  }

  const { keys, other } = setKeys(rows ?? [])
  // The server's row for the key being given a value, as soon as the list has it (a linked key opens before it does).
  const editRow = editing.kind === 'value' ? (rows?.find(row => row.name === editing.name) ?? editing.row) : null
  const choose = (row: EnvKey) => {
    setChosen(row)
    setOpen('options')
  }

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title="Keys" subtitle={name} />

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {!rows ? (
            <View style={styles.center}>
              {error ? (
                <T variant="secondary" color="text2" style={styles.centered}>
                  {error}
                </T>
              ) : (
                <Spinner size={16} />
              )}
            </View>
          ) : !keys.length && !other.length ? (
            <View style={styles.center}>
              <T variant="body" style={styles.centered}>
                No keys yet
              </T>
              <T variant="secondary" color="text2" style={styles.centered}>
                A key you add goes straight into {name}’s .env on the server. The model never sees it.
              </T>
            </View>
          ) : (
            <>
              <T variant="label" color={error ? 'danger' : 'text2'} style={styles.count}>
                {error ?? (keys.length ? `${keys.length} ${keys.length === 1 ? 'key' : 'keys'} in ${name}’s .env on the server. The model never sees them.` : `No keys in ${name}’s .env yet.`)}
              </T>
              {keys.length ? (
                <View style={[styles.list, { backgroundColor: c.sheet }]}>
                  <KeyRows rows={keys} onPress={choose} />
                </View>
              ) : null}
              {other.length ? (
                <View style={[styles.list, { backgroundColor: c.sheet }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showOther }}
                    accessibilityLabel={`${other.length} other settings`}
                    onPress={() => setShowOther(shown => !shown)}
                    style={({ pressed }) => [styles.toggle, pressed && { backgroundColor: c.tone }]}
                  >
                    <T variant="body" style={styles.fill}>
                      Other settings
                    </T>
                    <T variant="body" color="text2">
                      {other.length}
                    </T>
                    <Feather name={showOther ? 'chevron-up' : 'chevron-down'} size={16} color={c.text2} />
                  </Pressable>
                  {showOther ? (
                    <>
                      <View style={[styles.separator, { backgroundColor: c.separator }]} />
                      <KeyRows rows={other} onPress={choose} />
                    </>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pill label="Add key" variant="primary" height={52} disabled={!rows} onPress={() => openKey({ kind: 'add' })} style={styles.primary} />
          <T variant="meta" color="text2" style={styles.centered}>
            Once {name} has {XAI_KEY}, Hermes’s own xAI text-to-speech and x_search use it for {name}, and xAI bills it.
          </T>
        </View>

        <Sheet visible={open === 'options'} onClose={() => setOpen(null)} label={chosen?.name ?? 'Key'}>
          <View style={styles.sheet}>
            <View style={styles.title}>
              <T variant="heading" numberOfLines={1}>
                {chosen?.name}
              </T>
              <T variant="label" color="text2" numberOfLines={2}>
                {[chosen?.description, chosen?.preview].filter(Boolean).join(' · ')}
              </T>
            </View>
            <GroupedList>
              <Row
                label="Change"
                onPress={() => {
                  setOpen(null)
                  // iOS drops a sheet presented while another is still going away.
                  afterSheetCloses(() => chosen && openKey({ kind: 'value', name: chosen.name, row: chosen }))
                }}
              />
              <Row
                label="Remove"
                destructive
                onPress={() => {
                  setOpen(null)
                  afterSheetCloses(() => setOpen('remove'))
                }}
              />
            </GroupedList>
          </View>
        </Sheet>

        <Sheet visible={open === 'key'} onClose={() => setOpen(null)} label={editing.kind === 'value' ? editing.name : 'Add a key'} avoidKeyboard>
          {editing.kind === 'add' ? (
            <PickStep key={opening} rows={rows ?? []} onPick={(picked, row) => setEditing({ kind: 'value', name: picked, row })} />
          ) : (
            <ValueStep
              key={`${opening}:${editing.name}`}
              name={editing.name}
              row={editRow}
              botName={name}
              profile={profile}
              onSaved={(saved, replaced) => {
                setOpen(null)
                void changed(replaced ? `Changed ${saved}` : `Saved ${saved}`)
              }}
            />
          )}
        </Sheet>

        <ConfirmSheet
          visible={open === 'remove'}
          title={`Remove ${chosen?.name ?? 'this key'}?`}
          message={`It’s deleted from ${name}’s .env on the server, and whatever uses it stops working until you add it again.`}
          confirmLabel="Remove"
          destructive
          onClose={() => setOpen(null)}
          onConfirm={() => chosen && void remove(chosen)}
        />
      </Screen>
    </BotPaper>
  )
}

/** Set keys on the paper: the name with the server's preview beside it, and what it is for below. */
function KeyRows({ rows, onPress }: { rows: EnvKey[]; onPress: (row: EnvKey) => void }) {
  const { c } = useTheme()

  return rows.map((row, index) => (
    <Fragment key={row.name}>
      {index > 0 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.description ? `${row.name}, ${row.description}` : row.name}
        onPress={() => onPress(row)}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.tone }]}
      >
        <View style={styles.rowText}>
          <View style={styles.rowTop}>
            <T variant="bodySemibold" numberOfLines={1} style={styles.shrink}>
              {row.name}
            </T>
            {row.preview ? (
              <T variant="secondary" color="text2" numberOfLines={1}>
                {row.preview}
              </T>
            ) : null}
          </View>
          {row.description ? (
            <T variant="secondary" color="text2" numberOfLines={1}>
              {row.description}
            </T>
          ) : null}
        </View>
        <Feather name="chevron-right" size={16} color={c.text2} />
      </Pressable>
    </Fragment>
  ))
}

/** Add key, first step: find a name the server knows by what it is for, or type one of your own. */
function PickStep({ rows, onPick }: { rows: EnvKey[]; onPick: (name: string, row: EnvKey | null) => void }) {
  const { c } = useTheme()
  const [query, setQuery] = useState('')
  const matches = matchKeys(rows, query)
  const typed = typedName(rows, query, matches)
  const choices = [
    ...matches.map(row => ({ name: row.name, row, note: row.description })),
    ...(typed ? [{ name: typed.name, row: typed.row, note: typed.row?.isSet ? 'Already set: change it' : typed.row?.description || 'A new key of your own' }] : []),
  ]

  return (
    <View style={styles.sheet}>
      <View style={styles.title}>
        <T variant="heading">Add a key</T>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        placeholder="What it’s for, or its name"
        placeholderTextColor={c.text2}
        returnKeyType="next"
        onSubmitEditing={() => choices[0] && onPick(choices[0].name, choices[0].row)}
        accessibilityLabel="Find a key"
        style={[styles.input, { backgroundColor: c.pressedIn, color: c.text }]}
      />
      <View style={styles.choices}>
        {choices.map((choice, index) => (
          <Fragment key={choice.name}>
            {index > 0 ? <View style={[styles.choiceSeparator, { backgroundColor: c.separator }]} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${choice.name}, ${choice.note}`}
              onPress={() => onPick(choice.name, choice.row)}
              style={({ pressed }) => [styles.choice, pressed && { backgroundColor: c.pressedIn }]}
            >
              <T variant="bodySemibold" numberOfLines={1}>
                {choice.name}
              </T>
              <T variant="label" color="text2" numberOfLines={1}>
                {choice.note}
              </T>
            </Pressable>
          </Fragment>
        ))}
      </View>
      {!choices.length ? (
        <T variant="label" color="text2" style={styles.note}>
          {query.trim() ? 'Nothing by that name. A name of your own is capitals, digits and _, like MY_SERVICE_KEY.' : 'Type what it’s for or part of its name, like xai or speech.'}
        </T>
      ) : null}
    </View>
  )
}

/**
 * The value for one key, in a field that never shows it. It is sent once and dropped with the sheet: nothing keeps it, and on a
 * refusal only the server's reason is shown.
 */
function ValueStep({ name, row, botName, profile, onSaved }: { name: string; row: EnvKey | null; botName: string; profile: string; onSaved: (name: string, replaced: boolean) => void }) {
  const { c } = useTheme()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const replacing = row?.isSet ? row.preview : null
  const about = [row?.description, replacing ? `Replaces ${replacing}` : ''].filter(Boolean).join(' · ')

  async function paste() {
    const text = await Clipboard.getStringAsync().catch(() => '')

    if (text) {
      setValue(text)
      setError(null)
    } else {
      setError('The clipboard is empty.')
    }
  }

  async function save() {
    const config = useConnection.getState().config

    if (!config) {
      setError('Not connected to the server.')

      return
    }

    setSaving(true)
    setError(null)

    try {
      await saveEnvKey(config, profile, name, value)
      setValue('')
      onSaved(name, !!row?.isSet)
    } catch (problem) {
      setSaving(false)
      setError(problem instanceof EnvError ? problem.message : 'Couldn’t save the key.')
    }
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.title}>
        <T variant="heading" numberOfLines={1}>
          {name}
        </T>
        {about ? (
          <T variant="label" color="text2" numberOfLines={2}>
            {about}
          </T>
        ) : null}
        {row?.url ? (
          <Pressable accessibilityRole="link" accessibilityLabel={`Get one at ${linkHost(row.url)}`} onPress={() => row.url && void Linking.openURL(row.url)} hitSlop={8} style={styles.link}>
            <T variant="label">Get one at {linkHost(row.url)}</T>
            <Feather name="arrow-up-right" size={13} color={c.text} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.form}>
        <View style={styles.field}>
          <TextInput
            value={value}
            onChangeText={text => {
              setValue(text)
              setError(null)
            }}
            autoFocus
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            importantForAutofill="no"
            // Not a password: stops iOS offering to save it to the keychain.
            textContentType="oneTimeCode"
            placeholder="Paste the key"
            placeholderTextColor={c.text2}
            returnKeyType="done"
            onSubmitEditing={() => value.trim() && !saving && void save()}
            accessibilityLabel={`Value for ${name}`}
            style={[styles.input, styles.fill, { backgroundColor: c.pressedIn, color: c.text }]}
          />
          <Pill label="Paste" icon="clipboard" height={52} onPress={() => void paste()} />
        </View>
        <Pill label="Save" variant="primary" height={52} loading={saving} disabled={!value.trim()} onPress={() => void save()} />
      </View>
      {error ? (
        <T variant="label" color="danger" style={styles.note}>
          {error}
        </T>
      ) : null}
      <T variant="label" color="text2" style={styles.note}>
        {name === XAI_KEY
          ? `Once ${botName} has it, Hermes’s own xAI text-to-speech and x_search use it for ${botName}, and xAI bills it.`
          : `It goes straight into ${botName}’s .env on the server. The model never sees it.`}
      </T>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 12, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 80, paddingHorizontal: 24 },
  centered: { textAlign: 'center' },
  count: { paddingHorizontal: 4 },
  list: { borderRadius: radius.group, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  row: { minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 10, justifyContent: 'space-between' },
  toggle: { minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  footer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 10 },
  primary: { alignSelf: 'stretch' },
  sheet: { paddingBottom: 8 },
  title: { marginHorizontal: 4, marginTop: 6, marginBottom: 12, gap: 2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingTop: 4 },
  form: { gap: 12 },
  field: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { minHeight: 52, borderRadius: radius.field, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.regular, fontSize: 16 },
  choices: { paddingTop: 8 },
  choice: { minHeight: 56, paddingHorizontal: 4, justifyContent: 'center', gap: 1, borderRadius: 8 },
  choiceSeparator: { height: 1, marginLeft: 4 },
  note: { marginHorizontal: 4, marginTop: 10 },
})
