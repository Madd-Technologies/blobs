import Feather from '@expo/vector-icons/Feather'
import { useRef, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'

import { T } from '@/components/ui/T'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts } from '@/theme/tokens'

interface Props {
  children: ReactNode
  /** The record is done: the right swipe reopens it instead. */
  done: boolean
  /** The record is muted: the left swipe unmutes it instead. */
  muted: boolean
  /** Swiped right. */
  onDone: () => void
  /** Swiped left. */
  onMute: () => void
}

const ACTION_WIDTH = 96

function Action({ icon, label }: { icon: 'check' | 'rotate-ccw' | 'bell-off' | 'bell'; label: string }) {
  const { c } = useTheme()

  return (
    <View style={[styles.action, { backgroundColor: c.tone }]}>
      <Feather name={icon} size={20} color={c.text} />
      <T variant="label" style={styles.label}>
        {label}
      </T>
    </View>
  )
}

/** A record's row in a panel or Needs you: swipe right to mark it done (or open it again), left to mute it (or unmute). */
export function SwipeRow({ children, done, muted, onDone, onMute }: Props) {
  const row = useRef<SwipeableMethods>(null)

  return (
    <ReanimatedSwipeable
      ref={row}
      friction={1.6}
      leftThreshold={ACTION_WIDTH * 0.7}
      rightThreshold={ACTION_WIDTH * 0.7}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => <Action icon={done ? 'rotate-ccw' : 'check'} label={done ? 'Reopen' : 'Done'} />}
      renderRightActions={() => <Action icon={muted ? 'bell' : 'bell-off'} label={muted ? 'Unmute' : 'Mute'} />}
      onSwipeableOpen={direction => {
        // The row slides back as soon as the action is taken: the panel then shows the record as it now is.
        row.current?.close()

        if (direction === SwipeDirection.RIGHT) {
          onDone()
        } else {
          onMute()
        }
      }}
    >
      {children}
    </ReanimatedSwipeable>
  )
}

const styles = StyleSheet.create({
  action: { width: ACTION_WIDTH, alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { fontFamily: fonts.medium },
})
