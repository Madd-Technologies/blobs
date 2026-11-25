import { useEffect } from 'react'
import { PixelRatio, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SvgXml } from 'react-native-svg'

import { getCachedMathPicture, mathCacheKey } from '@/lib/math'
import { requestMath, useMathWorker } from '@/stores/mathWorker'
import { fonts } from '@/theme/tokens'

const exOf = (fontSize: number) => fontSize * 0.5

function useMathPicture(tex: string, display: boolean) {
  const key = mathCacheKey(tex, display)
  useMathWorker(state => state.versions[key] ?? 0)
  const cached = getCachedMathPicture(tex, display)

  useEffect(() => {
    if (cached === undefined) {
      requestMath(tex, display)
    }
  }, [cached, tex, display])

  return cached ?? null
}

interface InlineProps {
  tex: string
  /** `$$…$$` written in a sentence: drawn in the larger display style. */
  display: boolean
  fontSize: number
  color: string
}

export function InlineMath({ tex, display, fontSize, color }: InlineProps) {
  const picture = useMathPicture(tex, display)

  if (!picture) {
    return <Text style={{ fontFamily: fonts.mono, fontSize: fontSize - 1, color }}>{`$${tex}$`}</Text>
  }

  const ex = exOf(fontSize)
  const width = picture.width * ex
  const height = picture.height * ex
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

export function MathBlock({ tex, color }: BlockProps) {
  const picture = useMathPicture(tex, true)

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
  fit: { flexGrow: 0 },
  row: { paddingVertical: 2 },
  raw: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 },
})
