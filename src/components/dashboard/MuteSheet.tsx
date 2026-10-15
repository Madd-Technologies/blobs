import Feather from '@expo/vector-icons/Feather'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { Fragment, useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'

import { Pill } from '@/components/ui/Pill'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import { mutePicks } from '@/features/dashboard/view'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'

interface Props {
  /** The record being muted (its title); null keeps the sheet closed. */
  title: string | null
  botName: string
  nowS: number
  onClose: () => void
  /** Mutes until this time (server seconds). */
  onPick: (until: number) => void
}

/** "Mute until": quick timeframes, or a day and time from the system picker. */
export function MuteSheet({ title, botName, nowS, onClose, onPick }: Props) {
  return (
    <Sheet visible={title !== null} onClose={onClose} label="Mute until">
      {title !== null ? <MuteChoices key={title} title={title} botName={botName} nowS={nowS} onClose={onClose} onPick={onPick} /> : null}
    </Sheet>
  )
}

function MuteChoices({ title, botName, nowS, onPick }: Props & { title: string }) {
  const { c, scheme } = useTheme()
  const [picking, setPicking] = useState<Date | null>(null)
  const picks = mutePicks(nowS)

  const pickAt = (date: Date) => {
    const until = Math.round(date.getTime() / 1000)

    if (until <= Date.now() / 1000) {
      toast('Pick a time that is still ahead.')

      return
    }

    onPick(until)
  }

  function pickDay() {
    const start = new Date((nowS + 86_400) * 1000)
    start.setHours(9, 0, 0, 0)

    if (Platform.OS !== 'android') {
      setPicking(start)

      return
    }

    // Android shows the system dialogs one after another: the day, then the time.
    DateTimePickerAndroid.open({
      value: start,
      mode: 'date',
      onValueChange: (_event, day) => DateTimePickerAndroid.open({ value: day, mode: 'time', onValueChange: (_timeEvent, time) => pickAt(time) }),
    })
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.head}>
        <T variant="heading">Mute until</T>
        <T variant="label" color="text2" numberOfLines={1}>
          {title}
        </T>
      </View>

      {picking ? (
        <View style={styles.picker}>
          <DateTimePicker value={picking} mode="datetime" display="inline" minimumDate={new Date()} themeVariant={scheme} accentColor={c.text} onValueChange={(_event, date) => setPicking(date)} />
          <Pill label="Mute" variant="primary" height={52} onPress={() => pickAt(picking)} />
        </View>
      ) : (
        <>
          {picks.map((pick, index) => (
            <Fragment key={pick.label}>
              {index > 0 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={pick.note ? `${pick.label}, ${pick.note}` : pick.label} onPress={() => onPick(pick.until)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.pressedIn }]}>
                <T variant="body" style={styles.flex}>
                  {pick.label}
                </T>
                {pick.note ? (
                  <T variant="label" color="text2">
                    {pick.note}
                  </T>
                ) : null}
              </Pressable>
            </Fragment>
          ))}
          <View style={[styles.separator, { backgroundColor: c.separator }]} />
          <Pressable accessibilityRole="button" onPress={pickDay} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.pressedIn }]}>
            <T variant="body" style={styles.flex}>
              Pick a day and time
            </T>
            <Feather name="calendar" size={16} color={c.text2} />
          </Pressable>
        </>
      )}

      <T variant="label" color="text2" style={styles.note}>
        No amber dot and out of Needs you until then; it waits at the bottom of its panel. {botName} still sees it.
      </T>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { paddingBottom: 8 },
  head: { gap: 2, marginHorizontal: 4, marginTop: 6, marginBottom: 8 },
  row: { minHeight: 52, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 8 },
  separator: { height: 1, marginLeft: 4 },
  picker: { gap: 12 },
  note: { marginHorizontal: 4, marginTop: 10 },
})
