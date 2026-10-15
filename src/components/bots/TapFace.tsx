import { useState, type ComponentProps } from 'react'
import { Pressable } from 'react-native'

import { BotFace } from './BotFace'

/** A big face to play with: it blinks at rest, and squishes and blinks when tapped. Decorative, like every face. */
export function TapFace(props: Omit<ComponentProps<typeof BotFace>, 'poke'>) {
  const [poke, setPoke] = useState(0)

  return (
    <Pressable accessible={false} onPress={() => setPoke(count => count + 1)} hitSlop={8}>
      <BotFace motion="idle" {...props} poke={poke} />
    </Pressable>
  )
}
