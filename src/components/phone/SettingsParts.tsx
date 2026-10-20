import Feather from '@expo/vector-icons/Feather'
import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native'

import { GroupedList } from '@/components/ui/GroupedList'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import { addNumber, formatNumber, hourLabel } from '@/features/phone/view'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius, size } from '@/theme/tokens'

/** A settings row with an optional face or icon before it and a second line under its label. */
export function SubRow({ label, sub, value, right, lead, chevron = true, onPress }: { label: string; sub?: string; value?: string; right?: ReactNode; lead?: ReactNode; chevron?: boolean; onPress?: () => void }) {
  const { c } = useTheme()
  const content = (
    <>
      {lead}
      <View style={styles.flex}>
        <T variant="body" numberOfLines={1}>
          {label}
        </T>
        {sub ? (
          <T variant="label" color="text2">
            {sub}
          </T>
        ) : null}
      </View>
      {value ? (
        <T variant="body" color="text2" numberOfLines={1} style={styles.value}>
          {value}
        </T>
      ) : null}
      {right}
      {onPress && !right && chevron ? <Feather name="chevron-right" size={16} color={c.text2} /> : null}
    </>
  )

  if (!onPress) {
    return <View style={[styles.row, sub ? styles.tall : null]}>{content}</View>
  }

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} onPress={onPress} style={({ pressed }) => [styles.row, sub ? styles.tall : null, { backgroundColor: pressed ? c.tone : 'transparent' }]}>
      {content}
    </Pressable>
  )
}

/** Two or three choices in a pill: the chosen one sits in the tone. */
export function Segmented<V extends string>({ options, value, label, onChange }: { options: { value: V; label: string }[]; value: V; label: string; onChange: (value: V) => void }) {
  const { c } = useTheme()

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segments, { backgroundColor: c.canvas }]}>
      {options.map(option => {
        const on = option.value === value

        return (
          <Press key={option.value} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={option.label} onPress={() => onChange(option.value)} style={[styles.segment, on && { backgroundColor: c.tone }]}>
            <T variant="secondary" color={on ? 'text' : 'text2'} style={{ fontFamily: on ? fonts.semibold : fonts.medium }}>
              {option.label}
            </T>
          </Press>
        )
      })}
    </View>
  )
}

/** A number in bounds, with − and +. */
function Stepper({ value, min, max, unit, onChange, label }: { value: number; min: number; max: number; unit: (n: number) => string; onChange: (n: number) => void; label: string }) {
  return (
    <View style={styles.stepper} accessibilityLabel={`${label}: ${unit(value)}`}>
      <IconCircle icon="minus" label={`Less ${label.toLowerCase()}`} diameter={44} disabled={value <= min} onPress={() => onChange(Math.max(min, value - 1))} />
      <T variant="stat" style={styles.stepperValue}>
        {unit(value)}
      </T>
      <IconCircle icon="plus" label={`More ${label.toLowerCase()}`} diameter={44} disabled={value >= max} onPress={() => onChange(Math.min(max, value + 1))} />
    </View>
  )
}

/** One number setting in a sheet: − and + within the plugin's bounds, then Save. */
export function StepperSheet({ title, visible, onClose, ...body }: StepperProps & { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} label={title}>
      {/* Keyed on opening, so each opening starts from the saved value. */}
      <StepperBody key={String(visible)} title={title} {...body} />
    </Sheet>
  )
}

interface StepperProps {
  title: string
  note?: string
  value: number
  min: number
  max: number
  unit: (n: number) => string
  onSave: (n: number) => void
}

function StepperBody({ title, note, value, min, max, unit, onSave }: StepperProps) {
  const [draft, setDraft] = useState(value)

  return (
    <View style={styles.sheetBody}>
      <T variant="sheetTitle">{title}</T>
      <Stepper value={draft} min={min} max={max} unit={unit} onChange={setDraft} label={title} />
      {note ? (
        <T variant="label" color="text2">
          {note}
        </T>
      ) : null}
      <Pill label="Save" variant="primary" height={52} disabled={draft === value} onPress={() => onSave(draft)} />
    </View>
  )
}

/** Calling hours: when the first call may start and when the last must, in the server's local time. */
export function HoursSheet({ hours, visible, onClose, onSave }: { hours: [number, number]; visible: boolean; onClose: () => void; onSave: (hours: [number, number]) => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} label="Calling hours">
      <HoursBody key={String(visible)} hours={hours} onSave={onSave} />
    </Sheet>
  )
}

function HoursBody({ hours, onSave }: { hours: [number, number]; onSave: (hours: [number, number]) => void }) {
  const [start, setStart] = useState(hours[0])
  const [end, setEnd] = useState(hours[1])

  return (
    <View style={styles.sheetBody}>
      <T variant="sheetTitle">Calling hours</T>
      <T variant="label" color="text2">
        From
      </T>
      <Stepper value={start} min={0} max={end - 1} unit={hourLabel} onChange={setStart} label="Start" />
      <T variant="label" color="text2">
        Until
      </T>
      <Stepper value={end} min={start + 1} max={24} unit={hourLabel} onChange={setEnd} label="End" />
      <T variant="label" color="text2">
        In the server’s local time. A call that would start outside these hours waits for them.
      </T>
      <Pill label="Save" variant="primary" height={52} disabled={start === hours[0] && end === hours[1]} onPress={() => onSave([start, end])} />
    </View>
  )
}

interface TextProps {
  title: string
  note?: string
  value: string
  placeholder?: string
  keyboardType?: KeyboardTypeOptions
  onSave: (text: string) => void
  check?: (text: string) => string | null
  /** A sentence or two rather than a name or an address: several lines, capitals for sentences only. */
  multiline?: boolean
  /** Shown under the field even while `check` reports a problem (a rule that always holds). */
  footnote?: string
}

/** Text in a sheet (a name, an address, or with `multiline` a sentence or two), then Save. */
export function TextSheet({ title, visible, onClose, ...body }: TextProps & { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} label={title} avoidKeyboard>
      <TextBody key={String(visible)} title={title} {...body} />
    </Sheet>
  )
}

function TextBody({ title, note, value, placeholder, keyboardType, onSave, check, multiline, footnote }: TextProps) {
  const { c } = useTheme()
  const [draft, setDraft] = useState(value)
  const problem = check ? check(draft.trim()) : null

  return (
    <View style={styles.sheetBody}>
      <T variant="sheetTitle">{title}</T>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={placeholder}
        placeholderTextColor={c.text2}
        autoFocus
        autoCapitalize={keyboardType === 'url' ? 'none' : multiline ? 'sentences' : 'words'}
        autoCorrect={!!multiline}
        keyboardType={keyboardType}
        multiline={multiline}
        accessibilityLabel={title}
        style={[styles.input, multiline ? styles.multiline : null, { backgroundColor: c.pressedIn, color: c.text }]}
      />
      {problem || note ? (
        <T variant="label" color="text2">
          {problem ?? note}
        </T>
      ) : null}
      {footnote ? (
        <T variant="label" color="text2">
          {footnote}
        </T>
      ) : null}
      <Pill label="Save" variant="primary" height={52} disabled={!!problem || draft.trim() === value} onPress={() => onSave(draft.trim())} />
    </View>
  )
}

/** A list of phone numbers in a sheet: each with − to take it off, and a field to add one. */
export function NumbersSheet({ title, note, numbers, visible, onClose, onSave }: { title: string; note: string; numbers: string[]; visible: boolean; onClose: () => void; onSave: (numbers: string[]) => void }) {
  const { c } = useTheme()
  const [typed, setTyped] = useState('')
  const added = addNumber(numbers, typed)

  return (
    <Sheet visible={visible} onClose={onClose} label={title} avoidKeyboard>
      <View style={styles.sheetBody}>
        <T variant="sheetTitle">{title}</T>
        <T variant="label" color="text2">
          {note}
        </T>
        {numbers.length ? (
          <GroupedList>
            {numbers.map(number => (
              <View key={number} style={styles.row}>
                <T variant="body" style={[styles.flex, styles.tabular]}>
                  {formatNumber(number)}
                </T>
                <IconCircle icon="minus" label={`Remove ${formatNumber(number)}`} bare diameter={32} onPress={() => onSave(numbers.filter(other => other !== number))} />
              </View>
            ))}
          </GroupedList>
        ) : null}
        <View style={styles.add}>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="(202) 555-0123"
            placeholderTextColor={c.text2}
            keyboardType="phone-pad"
            accessibilityLabel="Number to add"
            style={[styles.input, styles.flex, { backgroundColor: c.pressedIn, color: c.text }]}
          />
          <Pill
            label="Add"
            variant="primary"
            height={48}
            disabled={!added || added.length === numbers.length}
            onPress={() => {
              if (added) {
                onSave(added)
                setTyped('')
              }
            }}
          />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { minHeight: size.row, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  tall: { minHeight: 60, paddingVertical: 8 },
  value: { flexShrink: 1, maxWidth: '55%', textAlign: 'right' },
  segments: { flexDirection: 'row', padding: 3, borderRadius: radius.pill },
  segment: { height: 32, paddingHorizontal: 16, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stepperValue: { flex: 1, textAlign: 'center', fontVariant: ['tabular-nums'] },
  sheetBody: { gap: 14, paddingBottom: 16 },
  input: { height: 48, borderRadius: radius.field, paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 16 },
  multiline: { height: undefined, minHeight: 96, paddingTop: 12, paddingBottom: 12, textAlignVertical: 'top' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tabular: { fontVariant: ['tabular-nums'] },
})
