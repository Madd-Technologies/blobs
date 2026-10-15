import { Text, type TextProps } from 'react-native'

import { useTheme } from '@/theme/ThemeProvider'
import { typeScale, type Palette, type TypeVariant } from '@/theme/tokens'

export type TextColor = keyof Pick<Palette, 'text' | 'text2' | 'needsYou' | 'needsYouText' | 'danger' | 'connected' | 'onPrimary' | 'userBubbleText'>

interface Props extends TextProps {
  variant?: TypeVariant
  /** A palette key, or a raw color. */
  color?: TextColor | (string & {})
}

/** The one text component: a design-system type variant in a palette color. */
export function T({ variant = 'body', color = 'text', style, ...rest }: Props) {
  const { c } = useTheme()
  const resolved = color in c ? c[color as keyof Palette] : color

  return <Text {...rest} style={[typeScale[variant], { color: resolved }, style]} />
}
