import { useEffect } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'

import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

interface SkeletonProps {
  width?: number | `${number}%`
  height: number
  radius?: number
  style?: StyleProp<ViewStyle>
}

/** Gentle Card Stock loading block matching tonal paper without borders or shimmer stripes. */
export function Skeleton({ width = '100%', height, radius: corner = 8, style }: SkeletonProps) {
  const { c } = useTheme()
  const reduced = useReducedMotion()
  const opacity = useSharedValue(reduced ? 0.65 : 0.45)

  useEffect(() => {
    if (reduced) {
      opacity.value = 0.65

      return
    }

    opacity.value = withRepeat(
      withSequence(
        withTiming(0.85, { duration: 750, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.45, { duration: 750, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    )

    return () => cancelAnimation(opacity)
  }, [opacity, reduced])

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return <Animated.View style={[{ width, height, borderRadius: corner, backgroundColor: c.tone }, animated, style]} />
}

/** Bot row placeholders inside Home's paper sheet while the initial roster is fetching. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <View style={styles.rows} accessibilityLabel="Loading bots">
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.row}>
          <Skeleton width={42} height={42} radius={21} />
          <View style={styles.rowText}>
            <Skeleton width={index % 2 === 0 ? '42%' : '56%'} height={15} radius={6} />
            <Skeleton width={index % 2 === 0 ? '76%' : '62%'} height={12} radius={6} />
          </View>
        </View>
      ))}
    </View>
  )
}

/** Alternating message silhouettes while a chat session hydrates. */
export function SkeletonChat() {
  return (
    <View style={styles.chat} accessibilityLabel="Loading conversation">
      <View style={styles.incoming}>
        <Skeleton width="78%" height={14} radius={7} />
        <Skeleton width="54%" height={14} radius={7} />
      </View>
      <View style={styles.outgoing}>
        <Skeleton width="64%" height={40} radius={18} />
      </View>
      <View style={styles.incoming}>
        <Skeleton width="84%" height={14} radius={7} />
        <Skeleton width="72%" height={14} radius={7} />
        <Skeleton width="40%" height={14} radius={7} />
      </View>
    </View>
  )
}

/** Dashboard record detail placeholder while fetching full field history. */
export function SkeletonRecord() {
  return (
    <View style={styles.record} accessibilityLabel="Loading record">
      <Skeleton width="72%" height={26} radius={8} />
      <Skeleton width="44%" height={14} radius={6} />
      <View style={styles.recordCard}>
        <Skeleton width="35%" height={12} radius={6} />
        <Skeleton width="88%" height={16} radius={6} />
        <Skeleton width="28%" height={12} radius={6} style={styles.spaceTop} />
        <Skeleton width="64%" height={16} radius={6} />
        <Skeleton width="32%" height={12} radius={6} style={styles.spaceTop} />
        <Skeleton width="92%" height={16} radius={6} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  rows: { paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 },
  rowText: { flex: 1, gap: 8 },
  chat: { flex: 1, paddingHorizontal: 20, paddingTop: 28, gap: 22 },
  incoming: { alignSelf: 'flex-start', width: '82%', gap: 8 },
  outgoing: { alignSelf: 'flex-end', alignItems: 'flex-end', width: '74%' },
  record: { paddingHorizontal: 20, paddingTop: 12, gap: 12 },
  recordCard: { borderRadius: radius.group, gap: 10, paddingTop: 14 },
  spaceTop: { marginTop: 8 },
})
