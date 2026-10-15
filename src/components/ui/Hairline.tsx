import { View, type ViewStyle } from 'react-native'

import { useTheme } from '@/theme/ThemeProvider'

/** 1 px line on the canvas. Inside a surface use the list separator instead. */
export function Hairline({ style }: { style?: ViewStyle }) {
  const { c } = useTheme()

  return <View aria-hidden style={[{ height: 1, backgroundColor: c.hairline }, style]} />
}
