import Feather from '@expo/vector-icons/Feather'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { Fragment, useState } from 'react'
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'

import { Pill } from '@/components/ui/Pill'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import { calendarLabel, dateValue, datePicks, parseDraft } from '@/features/dashboard/view'
import type { Field } from '@/lib/hermes/dashboard'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

interface Props {
  /** The field being changed; null keeps the sheet closed. */
  field: Field | null
  value: unknown
  /** A line under the title ("To Sam Lee" for a draft). */
  subtitle?: string
  nowS: number
  botName: string
  onClose: () => void
  /** Saves the new value (null clears it). Returns an error to show, or null. */
  onSave: (value: string | number | boolean | null) => Promise<string | null>
}

interface Choice {
  label: string
  note?: string
  value: string | number | null
  selected: boolean
  /** "Pick a day": opens the system picker instead of saving. */
  pick?: boolean
}

const TYPED_KEYBOARD: Partial<Record<Field['type'], 'decimal-pad' | 'phone-pad' | 'email-address' | 'url'>> = { number: 'decimal-pad', money: 'decimal-pad', percent: 'decimal-pad', phone: 'phone-pad', email: 'email-address', url: 'url', link: 'url' }

/** A date field's value as a Date (dates at local midnight, datetimes from epoch seconds), or now. */
function asDate(field: Field, value: unknown, nowS: number): Date {
  if (field.type === 'datetime' && typeof value === 'number') {
    return new Date(value * 1000)
  }

  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null

  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(nowS * 1000)
}

/** The value a picked Date stores: a calendar day, or epoch seconds. */
function fromDate(field: Field, date: Date): string | number {
  return field.type === 'datetime' ? Math.round(date.getTime() / 1000) : dateValue(date)
}

/** Changing one field of a record, by its type. The bot sees that you changed it and leaves it alone from then on. */
export function FieldSheet({ field, value, subtitle, nowS, botName, onClose, onSave }: Props) {
  return (
    <Sheet visible={!!field} onClose={onClose} label={field ? field.label : 'Field'} avoidKeyboard>
      {/* Keyed by field so a new field starts with a fresh draft. */}
      {field ? <FieldEditor key={field.key} field={field} value={value} subtitle={subtitle} nowS={nowS} botName={botName} onClose={onClose} onSave={onSave} /> : null}
    </Sheet>
  )
}

function FieldEditor({ field, value, subtitle, nowS, botName, onClose, onSave }: Props & { field: Field }) {
  const { c, scheme } = useTheme()
  const [draft, setDraft] = useState(() => (value === null || value === undefined ? '' : String(value)))
  const [picking, setPicking] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(next: string | number | boolean | null) {
    setSaving(true)
    setError(null)
    const problem = await onSave(next)
    setSaving(false)

    if (problem) {
      setError(problem)
    } else {
      onClose()
    }
  }

  function pickDate() {
    const start = asDate(field, value, nowS)

    if (Platform.OS !== 'android') {
      setPicking(start)

      return
    }

    // Android shows the system dialogs one after another: the day, then (for a date and time) the time.
    DateTimePickerAndroid.open({
      value: start,
      mode: 'date',
      onValueChange: (_event, day) => {
        if (field.type !== 'datetime') {
          void save(fromDate(field, day))

          return
        }

        DateTimePickerAndroid.open({ value: day, mode: 'time', onValueChange: (_timeEvent, time) => void save(fromDate(field, time)) })
      },
    })
  }

  // A status always has a stage, so it is never cleared.
  const clearable = !field.required && field.type !== 'status' && value !== null && value !== undefined && value !== ''
  let choices: Choice[] | null = null

  if (field.type === 'status') {
    choices = (field.stages ?? []).map(stage => ({ label: stage.name, note: stage.done ? 'Closes it' : undefined, value: stage.name, selected: stage.name === value }))
  } else if (field.type === 'choice') {
    choices = (field.options ?? []).map(option => ({ label: option, value: option, selected: option === value }))
  } else if (field.type === 'rating') {
    choices = [1, 2, 3, 4, 5].map(stars => ({ label: `${stars} of 5`, value: stars, selected: stars === value }))
  } else if (field.type === 'date' || field.type === 'datetime') {
    const time = field.type === 'datetime' ? asDate(field, value, nowS) : null

    choices = datePicks(nowS).map(pick => {
      if (!time) {
        return { label: pick.label, note: calendarLabel({ type: 'date', value: pick.value }), value: pick.value, selected: pick.value === value }
      }

      // A date and time keeps its time of day (9 AM when it had none) on the day picked.
      const [year, month, day] = pick.value.split('-').map(Number)
      const at = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, value ? time.getHours() : 9, value ? time.getMinutes() : 0)
      const seconds = Math.round(at.getTime() / 1000)

      return { label: pick.label, note: calendarLabel({ type: 'datetime', value: seconds }), value: seconds, selected: seconds === value }
    })
    choices.push({ label: field.type === 'datetime' ? 'Pick a day and time' : 'Pick a day', value: null, selected: false, pick: true })
  }

  if (choices && clearable) {
    choices.push({ label: 'Clear', value: null, selected: false })
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.title}>
        <T variant="heading">{field.label}</T>
        {subtitle ? (
          <T variant="label" color="text2">
            {subtitle}
          </T>
        ) : null}
      </View>

      {picking ? (
        <View style={styles.picker}>
          <DateTimePicker value={picking} mode={field.type === 'datetime' ? 'datetime' : 'date'} display="inline" themeVariant={scheme} accentColor={c.text} onValueChange={(_event, date) => setPicking(date)} />
          <Pill label="Save" variant="primary" height={52} loading={saving} onPress={() => void save(fromDate(field, picking))} />
        </View>
      ) : choices ? (
        <>
          {choices.map((choice, index) => (
            <Fragment key={`${choice.label}:${index}`}>
              {index > 0 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: choice.selected, disabled: saving }}
                accessibilityLabel={choice.note ? `${choice.label}, ${choice.note}` : choice.label}
                disabled={saving}
                onPress={() => (choice.pick ? pickDate() : choice.selected ? onClose() : void save(choice.value))}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.pressedIn }]}
              >
                <T variant="body" color={choice.value === null && !choice.pick ? 'text2' : 'text'} style={styles.flex}>
                  {choice.label}
                </T>
                {choice.note ? (
                  <T variant="label" color="text2">
                    {choice.note}
                  </T>
                ) : null}
                {choice.selected ? <Feather name="check" size={18} color={c.text} /> : null}
                {choice.pick ? <Feather name="calendar" size={16} color={c.text2} /> : null}
              </Pressable>
            </Fragment>
          ))}
        </>
      ) : (
        <View style={styles.form}>
          <TextInput
            value={draft}
            onChangeText={text => {
              setDraft(text)
              setError(null)
            }}
            autoFocus
            multiline={field.type === 'longtext' || field.type === 'draft'}
            keyboardType={TYPED_KEYBOARD[field.type] ?? 'default'}
            autoCapitalize={TYPED_KEYBOARD[field.type] ? 'none' : 'sentences'}
            autoCorrect={!TYPED_KEYBOARD[field.type]}
            placeholder={field.label}
            placeholderTextColor={c.text2}
            accessibilityLabel={field.label}
            textAlignVertical="top"
            style={[styles.input, (field.type === 'longtext' || field.type === 'draft') && styles.tall, { backgroundColor: c.pressedIn, color: c.text }]}
          />
          <Pill
            label="Save"
            variant="primary"
            height={52}
            loading={saving}
            onPress={() => {
              const parsed = parseDraft(field, draft)

              if ('error' in parsed) {
                setError(parsed.error)
              } else {
                void save(parsed.value)
              }
            }}
          />
        </View>
      )}

      {error ? (
        <T variant="label" color="danger" style={styles.note}>
          {error}
        </T>
      ) : null}
      <T variant="label" color="text2" style={styles.note}>
        {field.type === 'draft' ? `${botName} sends your version, and won’t rewrite it.` : `${botName} sees that you changed it, and won’t change it back.`}
      </T>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { paddingBottom: 8 },
  title: { marginHorizontal: 4, marginTop: 6, marginBottom: 8, gap: 2 },
  row: { minHeight: 52, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 8 },
  separator: { height: 1, marginLeft: 4 },
  picker: { gap: 12 },
  form: { gap: 12, paddingTop: 4 },
  input: { borderRadius: radius.field, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.regular, fontSize: 16 },
  tall: { minHeight: 140 },
  note: { marginHorizontal: 4, marginTop: 10 },
})
