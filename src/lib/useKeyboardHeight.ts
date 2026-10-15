import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/** The height of the on-screen keyboard (0 when it is hidden). */
export function useKeyboardHeight(): number {
  // A screen that mounts (or reloads) while the keyboard is already up never hears the "shown" event.
  const [height, setHeight] = useState(() => (Keyboard.isVisible() ? (Keyboard.metrics()?.height ?? 0) : 0))

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', event => setHeight(event.endCoordinates.height))
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0))

    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  return height
}
