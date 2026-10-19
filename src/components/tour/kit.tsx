import { createContext, useContext, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { LinearTransition } from 'react-native-reanimated'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { BotFace } from '@/components/bots/BotFace'
import { RiseIn } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { CROWD, crowdColor, crowdSvg, type CrowdId } from '@/features/tour/crowd'
import { BotTint, useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

/** One of the brand's faces, alive like any bot's (see `BotFace`). */
export function CrowdFace({ id, size, ...rest }: { id: CrowdId; size: number } & Omit<ComponentProps<typeof BotFace>, 'name' | 'xml' | 'size'>) {
  const xml = useMemo(() => crowdSvg(id, size), [id, size])

  return <BotFace name={CROWD[id].name} xml={xml} size={size} {...rest} />
}

/**
 * A scene's script. While its page is showing, `beat` counts up from 0, reaching i + 1 at `at[i]` ms; leaving the page
 * sets it back to 0, so a scene plays from the start each time you come to it. `since(n)` is when beat n began (epoch ms),
 * for a step's running clock. `replay` starts it over in place.
 */
export function useBeats(active: boolean, at: readonly number[]): { beat: number; since: (beat: number) => number; replay: () => void } {
  const [script, setScript] = useState<{ beat: number; began: Record<number, number> }>({ beat: 0, began: {} })
  const [run, setRun] = useState(0)
  const [was, setWas] = useState(active)

  // Left (or came back to): from the top. Adjusted while rendering rather than in an effect, so nothing flashes.
  if (was !== active) {
    setWas(active)
    setScript({ beat: 0, began: {} })
  }

  useEffect(() => {
    if (!active) {
      return
    }

    const timers = at.map((ms, index) =>
      setTimeout(() => {
        const now = Date.now()
        setScript(current => ({ beat: index + 1, began: { ...current.began, [index + 1]: now } }))
      }, ms),
    )

    return () => timers.forEach(clearTimeout)
  }, [active, at, run])

  return {
    beat: script.beat,
    since: beat => script.began[beat] ?? 0,
    replay: () => {
      setScript({ beat: 0, began: {} })
      setRun(count => count + 1)
    },
  }
}

/** Lets a scene stop the pages from turning while a finger is on something it moves itself (a card, a cursor). */
export const PagerHold = createContext<(held: boolean) => void>(() => undefined)

export function usePagerHold(): (held: boolean) => void {
  return useContext(PagerHold)
}

/** How much of a peeking face hides behind the top of its card. */
const TUCK = 0.24

/**
 * A bot's own screen in miniature, in its tinted paper: its name and what it is doing on top, the chat below. The bot itself
 * peeks over the top edge, big, and rides up as the chat grows.
 */
export function BotPanel({ id, status, waiting, face, faceSize, children }: { id: CrowdId; status: string; waiting?: boolean; face: ReactNode; faceSize: number; children: ReactNode }) {
  return (
    <BotTint color={crowdColor(id)}>
      <Peek size={faceSize}>{face}</Peek>
      <PanelPaper>
        <PanelHead title={CROWD[id].name} status={status} waiting={waiting} />
        <View style={styles.body}>{children}</View>
      </PanelPaper>
    </BotTint>
  )
}

/** A panel's name and what is going on, with the amber dot while it waits for you. */
export function PanelHead({ title, status, waiting }: { title: string; status: string; waiting?: boolean }) {
  return (
    <View style={styles.head}>
      <T variant="heading">{title}</T>
      <View style={styles.status}>
        {waiting ? <AttentionDot /> : null}
        <T variant="status" color="text2" numberOfLines={1}>
          {status}
        </T>
      </View>
    </View>
  )
}

/** Faces standing behind the card below them, their bottoms hidden by its top edge. */
export function Peek({ size, children }: { size: number; children: ReactNode }) {
  return (
    <Settle style={[styles.peek, { marginBottom: -size * TUCK }]}>
      {children}
    </Settle>
  )
}

/** The sheet a scene is drawn on, in whatever tint is around it. It hugs what it holds, up to the height of the stage. */
export function PanelPaper({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()

  return <View style={[styles.panel, { backgroundColor: c.sheet }, style]}>{children}</View>
}

/** Something new in a scene: it rises in quietly, and what was there before slides up to make room. */
export function Arrive({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View layout={LinearTransition.duration(240)} style={style}>
      <RiseIn quiet>{children}</RiseIn>
    </Animated.View>
  )
}

/** Moves along with what arrives below it. */
export function Settle({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View layout={LinearTransition.duration(240)} style={style}>
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  panel: { width: '100%', flexShrink: 1, borderRadius: radius.tray, padding: 16, gap: 10, overflow: 'hidden' },
  head: { gap: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  peek: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 6 },
  // Newest at the bottom, like a chat: when there is more than fits, the oldest goes off the top. It reaches out to the card's
  // edges, so a raised card's shadow inside is cut by the card's round corners, not a square.
  body: { flexShrink: 1, justifyContent: 'flex-end', gap: 8, overflow: 'hidden', marginHorizontal: -16, paddingHorizontal: 16, marginBottom: -16, paddingBottom: 16 },
})
