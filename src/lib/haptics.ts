import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'

/** What just happened, in Android's own haptic vocabulary (performAndroidHapticsAsync needs no vibrate permission). */
export type HapticKind = 'confirm' | 'reject' | 'toggleOn' | 'toggleOff' | 'tick' | 'gestureStart' | 'gestureEnd' | 'longPress'

const ANDROID: Record<HapticKind, Haptics.AndroidHaptics> = {
  confirm: Haptics.AndroidHaptics.Confirm,
  reject: Haptics.AndroidHaptics.Reject,
  toggleOn: Haptics.AndroidHaptics.Toggle_On,
  toggleOff: Haptics.AndroidHaptics.Toggle_Off,
  tick: Haptics.AndroidHaptics.Segment_Tick,
  gestureStart: Haptics.AndroidHaptics.Gesture_Start,
  gestureEnd: Haptics.AndroidHaptics.Gesture_End,
  longPress: Haptics.AndroidHaptics.Long_Press,
}

/** The closest iOS feel for each. */
function ios(kind: HapticKind): Promise<void> {
  switch (kind) {
    case 'confirm':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    case 'reject':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    case 'longPress':
    case 'gestureStart':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    default:
      return Haptics.selectionAsync()
  }
}

/** A haptic for a moment (a card rising, a swipe passing its threshold, a toggle). Never throws. */
export function haptic(kind: HapticKind): void {
  const run = Platform.OS === 'android' ? Haptics.performAndroidHapticsAsync(ANDROID[kind]) : Platform.OS === 'ios' ? ios(kind) : null

  run?.catch(() => {})
}
