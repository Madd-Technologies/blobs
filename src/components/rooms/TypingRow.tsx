import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated'

import { BotFace } from '@/components/bots/BotFace'
import { Markdown } from '@/components/chat/Markdown'
import { T } from '@/components/ui/T'
import type { BotMeta } from '@/lib/hermes/identity'
import type { LiveStep } from '@/lib/hermes/livepush'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts } from '@/theme/tokens'

/** One dot of the three, brightening in turn. */
function Dot({ phase }: { phase: SharedValue<number> }) {
  const { c } = useTheme()
  const style = useAnimatedStyle(() => ({ opacity: 0.3 + 0.7 * phase.value, transform: [{ translateY: -2 * phase.value }] }))

  return <Animated.View style={[styles.dot, { backgroundColor: c.text2 }, style]} />
}

function useDotPhase(delay: number, still: boolean): SharedValue<number> {
  const phase = useSharedValue(still ? 0.6 : 0)

  useEffect(() => {
    if (still) {
      return
    }

    const pulse = withSequence(withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }), withTiming(0, { duration: 360 }))
    phase.value = withDelay(delay, withRepeat(pulse, -1, false))

    return () => cancelAnimation(phase)
  }, [delay, phase, still])

  return phase
}

/** A tool step of a turn in progress, as one quiet line. */
function stepLine(step: LiveStep): string {
  return step.done ? `Ran ${step.name}${step.seconds !== undefined ? ` · ${step.seconds} s` : ''}` : `Running ${step.name}…`
}

/**
 * A bot in a room that is busy right now: its face and name, as its message will have, what it is doing when the server says
 * ("running a command · 4 min", "writing"), then its reply as it streams with a quiet line per tool step (hermes-bot-mobile
 * 0.2+), or, without the words yet, a small bubble of three dots that brighten in turn (still, when the phone asks for less
 * motion).
 */
export function TypingRow({ name, profile, meta, doing, minutes = 0, text, steps, cut }: { name: string; profile: string; meta?: BotMeta; doing?: string | null; minutes?: number; text?: string; steps?: LiveStep[]; cut?: boolean }) {
  const still = useReducedMotion()
  const first = useDotPhase(0, still)
  const second = useDotPhase(160, still)
  const third = useDotPhase(320, still)

  return (
    <View style={styles.row} accessible accessibilityLabel={`${name} ${doing ?? 'is working'}${minutes > 0 ? `, ${minutes} min` : ''}`}>
      <View style={styles.head}>
        <BotFace name={profile} meta={meta} size={20} mood="work" motion="work" />
        <T variant="label" numberOfLines={1} style={styles.name}>
          {name}
          <T variant="label" color="text2">
            {' '}
            {doing ? `${doing.replace(/^is /, '')}${minutes > 0 ? ` · ${minutes} min` : ''}` : 'writing'}
          </T>
        </T>
      </View>
      {steps?.length ? (
        <View style={styles.steps}>
          {steps.slice(-3).map((step, index) => (
            <T key={`${step.id}-${index}`} variant="label" color="text2" numberOfLines={1}>
              {stepLine(step)}
            </T>
          ))}
        </View>
      ) : null}
      {text ? (
        <Markdown text={cut ? `…${text}` : text} size="reply" />
      ) : (
        <View style={styles.dots}>
          <Dot phase={first} />
          <Dot phase={second} />
          <Dot phase={third} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { alignSelf: 'stretch', gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontFamily: fonts.semibold, flexShrink: 1 },
  // Where its words will be: three dots, no bubble.
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 12, paddingLeft: 2 },
  steps: { gap: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
})
