import Feather from '@expo/vector-icons/Feather'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated'

import { UserBubble } from '@/components/chat/Bubble'
import { Pill } from '@/components/ui/Pill'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { CROWD, crowdColor, type CrowdId } from '@/features/tour/crowd'
import { BotTint, useTheme } from '@/theme/ThemeProvider'
import { fonts, radius, tintLevel } from '@/theme/tokens'

import { Arrive, CrowdFace, PanelPaper, Peek, Settle, useBeats } from './kit'

/** You ask, Scout starts writing, Scout answers. */
const BEATS = [800, 1500, 3400] as const
/** How long the routine takes when you run it now (ms). */
const ROUTINE_MS = 2200

/** The room's members, standing behind its card. */
const MEMBERS: CrowdId[] = ['forge', 'scout', 'scribe']
const PEEK_SIZE = 64

function Said({ id, text }: { id: CrowdId; text: string }) {
  return (
    <View style={styles.said}>
      <CrowdFace id={id} size={24} />
      <View style={styles.flex}>
        <T variant="label" color="text2" style={styles.name}>
          {CROWD[id].name}
        </T>
        <T variant="body">{text}</T>
      </View>
    </View>
  )
}

function Dot({ index }: { index: number }) {
  const { c } = useTheme()
  const reduced = useReducedMotion()
  const lift = useSharedValue(0)

  useEffect(() => {
    if (reduced) {
      return
    }

    lift.set(withDelay(index * 140, withRepeat(withSequence(withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) }), withTiming(0, { duration: 260 })), -1, false)))

    return () => cancelAnimation(lift)
  }, [index, reduced, lift])

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.get() * 4 }], opacity: 0.5 + lift.get() * 0.5 }))

  return <Animated.View style={[styles.dot, { backgroundColor: c.text2 }, style]} />
}

/** Someone in the room is writing: their face, three dots, and who it is. */
function Writing({ id }: { id: CrowdId }) {
  return (
    <View style={styles.said}>
      <CrowdFace id={id} size={24} motion="work" />
      <View style={styles.dots}>
        {[0, 1, 2].map(index => (
          <Dot key={index} index={index} />
        ))}
      </View>
      <T variant="label" color="text2">
        {CROWD[id].name} is writing
      </T>
    </View>
  )
}

/** Ember's morning brief: Ember dozes until you run it now, works through it, then rests. */
function Routine({ active }: { active: boolean }) {
  const { c, scheme } = useTheme()
  const [run, setRun] = useState<'idle' | 'running' | 'ran'>('idle')
  const [poke, setPoke] = useState(0)
  const [was, setWas] = useState(active)

  if (was !== active) {
    setWas(active)
    setRun('idle')
  }

  useEffect(() => {
    if (run !== 'running') {
      return
    }

    const timer = setTimeout(() => setRun('ran'), ROUTINE_MS)

    return () => clearTimeout(timer)
  }, [run])

  return (
    <BotTint color={crowdColor('ember')}>
      <PanelPaper style={styles.routine}>
        <CrowdFace id="ember" size={40} motion={run === 'idle' ? 'doze' : run === 'running' ? 'work' : 'idle'} poke={poke} />
        <View style={styles.flex}>
          <T variant="rowTitle">Morning brief</T>
          <View style={styles.when}>
            {run === 'running' ? <Spinner /> : run === 'ran' ? <Feather name="check" size={13} color={c.text2} /> : null}
            <T variant="label" color="text2" numberOfLines={1}>
              {run === 'running' ? 'Running now' : run === 'ran' ? 'Ran just now' : 'Every day at 7:00 AM'}
            </T>
          </View>
        </View>
        {run === 'idle' ? (
          <Pill
            label="Run now"
            height={36}
            // The card is Ember's sheet, which is where its paper puts secondary pills: one level up keeps this one visible.
            style={{ backgroundColor: tintLevel(scheme, 'tone', crowdColor('ember')) }}
            onPress={() => {
              setPoke(count => count + 1)
              setRun('running')
            }}
          />
        ) : null}
      </PanelPaper>
    </BotTint>
  )
}

/**
 * A room with three bots: you @mention Scout, it starts writing (the dots), then answers. Below, a routine: Ember dozes
 * until its time, or until you run it now.
 */
export function Rooms({ active }: { active: boolean }) {
  const { beat } = useBeats(active, BEATS)

  return (
    <View style={styles.fill}>
      <Peek size={PEEK_SIZE}>
        {MEMBERS.map(id => (
          <CrowdFace key={id} id={id} size={id === 'scout' ? PEEK_SIZE : PEEK_SIZE - 10} motion={id === 'scout' && beat === 2 ? 'work' : 'idle'} />
        ))}
      </Peek>
      <PanelPaper style={styles.room}>
        <View style={styles.head}>
          <T variant="heading">Launch week</T>
          <T variant="status" color="text2">
            Scout, Forge and Scribe
          </T>
        </View>
        <View style={styles.body}>
          <Settle>
            <Said id="forge" text="The build passed. 214 tests, all green." />
          </Settle>
          {beat >= 1 ? (
            <Arrive>
              <UserBubble text="@scout can you check the feeds?" />
            </Arrive>
          ) : null}
          {beat === 2 ? (
            <Arrive>
              <Writing id="scout" />
            </Arrive>
          ) : null}
          {beat >= 3 ? (
            <Arrive>
              <Said id="scout" text="Three feeds, nothing new since Monday." />
            </Arrive>
          ) : null}
        </View>
      </PanelPaper>
      <Routine active={active} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  flex: { flex: 1, minWidth: 0 },
  room: { flexShrink: 1 },
  head: { gap: 1 },
  body: { flexShrink: 1, justifyContent: 'flex-end', gap: 10, overflow: 'hidden' },
  said: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  name: { fontFamily: fonts.semibold },
  dots: { flexDirection: 'row', gap: 4, height: 24, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  routine: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderRadius: radius.group },
  when: { flexDirection: 'row', alignItems: 'center', gap: 6 },
})
