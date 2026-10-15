import { PixelRatio, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SvgXml } from 'react-native-svg'

import { configureMath, texToPicture } from '@/lib/math'
import { fonts } from '@/theme/tokens'

// MathJax is big and the app rarely needs it: it is loaded when the first formula is drawn, not when the app starts. Its version file
// reads its own package.json with `eval('require')` (Hermes has no such global) unless this one is defined.
configureMath(() => {
  ;(globalThis as { PACKAGE_VERSION?: string }).PACKAGE_VERSION ??= '3.2.2'

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/mathEngine') as typeof import('@/lib/mathEngine')).createConverter()
})

/** How tall a lowercase letter is, for the text a formula sits in: the size MathJax's `ex` units are drawn at. */
const exOf = (fontSize: number) => fontSize * 0.5

interface InlineProps {
  tex: string
  /** `$$…$$` written in a sentence: drawn in the larger display style. */
  display: boolean
  fontSize: number
  color: string
}

/**
 * A formula inside a line of text, as an inline view the size of the picture, sitting on the text's baseline (the parts that hang below
 * it, like the tail of a "y", are moved down). A formula MathJax cannot read is shown as it was written.
 */
export function InlineMath({ tex, display, fontSize, color }: InlineProps) {
  const picture = texToPicture(tex, display)

  if (!picture) {
    return <Text style={{ fontFamily: fonts.mono, fontSize: fontSize - 1, color }}>{`$${tex}$`}</Text>
  }

  const ex = exOf(fontSize)
  const width = picture.width * ex
  const height = picture.height * ex

  // Android sizes the room an inline view takes in the line by the system font scale (React Native's TextLayoutManager uses
  // toPixelFromSP) and scales the text around it too, but not the picture. So the formula is drawn at that scale, matching the
  // words, inside a view of its unscaled size: scaled the same way, that claims exactly the room the formula fills.
  const scale = Platform.OS === 'android' ? PixelRatio.getFontScale() : 1

  return (
    <View style={{ width, height, alignItems: 'flex-start', transform: [{ translateY: picture.depth * ex * scale }] }}>
      <SvgXml xml={picture.xml} width={width * scale} height={height * scale} color={color} />
    </View>
  )
}

interface BlockProps {
  tex: string
  color: string
}

/** A formula on its own line: a little larger than the text, scrolling sideways when it is wider than the bubble. */
export function MathBlock({ tex, color }: BlockProps) {
  const picture = texToPicture(tex, true)

  if (!picture) {
    return (
      <Text selectable style={[styles.raw, { color }]}>
        {tex}
      </Text>
    )
  }

  const ex = exOf(17)

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fit} contentContainerStyle={styles.row}>
      <SvgXml xml={picture.xml} width={picture.width * ex} height={picture.height * ex} color={color} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  // flexGrow 0, as for the library's own horizontal scrolls: a ScrollView otherwise stretches to fill its parent.
  fit: { flexGrow: 0 },
  row: { paddingVertical: 2 },
  raw: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 },
})
