import { memo, useEffect, useMemo, useRef } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Ellipse, Path, SvgXml } from 'react-native-svg'

import { MOTIONS, REACTIONS, nextBlink, type FaceMotion } from '@/features/face/motion'
import { blobSvg, isBlobShape, splitBlob } from '@/lib/hermes/blob'
import { buildFace, type Face, type FaceMood } from '@/lib/hermes/face'
import { avatarColor, botAppearance, type BotMeta } from '@/lib/hermes/identity'

interface Props {
  /** The profile name: seeds the default color, shape and blobatar. */
  name: string
  /** `ui_meta['hermes-bots']`; omit for a bot with no customization. */
  meta?: BotMeta | null
  size?: number
  /** `work` makes the eyes taller; `off` turns them into lines. */
  mood?: FaceMood
  /** A photo data URL (from `profiles.get_asset`), which replaces the drawn face. */
  photo?: string | null
  /** How the face moves (see `features/face/motion.ts`). `still`, the default, draws it as it is. */
  motion?: FaceMotion
  /** Raise it to make the face react to a press (it squishes and blinks). */
  poke?: number
}

// ── the parts of a face ──────────────────────────────────────────────────────────────────────────

function ClassicBody({ face, color, size }: { face: Face; color: string; size: number }) {
  if (face.type === 'sigil') {
    return (
      <Svg width={size} height={size} viewBox={face.viewBox}>
        {face.ring ? <Path d={face.ring} fill="none" stroke={color} strokeWidth={1.2} opacity={0.5} /> : null}
        <Path d={face.strokes} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    )
  }

  // Desktop draws into a 40x44 box to leave room for working dots; the app draws the body into the
  // 40x40 box the design uses, so a face fills its frame.
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Path d={face.body} fill={color} />
    </Svg>
  )
}

function ClassicEyes({ face, color, mood, size }: { face: Face; color: string; mood: FaceMood; size: number }) {
  if (face.type === 'sigil') {
    return (
      <Svg width={size} height={size} viewBox={face.viewBox}>
        {face.eyes.map(eye => (
          <Circle key={eye.cx} cx={eye.cx} cy={eye.cy} r={eye.r} fill={color} />
        ))}
      </Svg>
    )
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      {mood === 'off' ? (
        <Path d={face.shut} fill="none" stroke={face.eyeFill} strokeWidth={2} strokeLinecap="round" />
      ) : (
        <>
          {face.eyes.map(eye => (
            <Ellipse key={eye.cx} cx={eye.cx} cy={eye.cy} rx={eye.rx} ry={eye.ry} fill={face.eyeFill} />
          ))}
          {face.highlights.map(light => (
            <Circle key={light.cx} cx={light.cx} cy={light.cy} r={light.r} fill={face.highlightFill} />
          ))}
        </>
      )}
    </Svg>
  )
}

/** The eye line as a share of the face's height: classic faces are drawn in a 40-unit box. */
function classicEyeLine(face: Face): number {
  return face.eyes[0].cy / 40
}

// ── a face that moves ────────────────────────────────────────────────────────────────────────────

interface Layers {
  body: React.ReactNode
  /** Null for a photo, or a drawing that could not be split: it moves as a whole. */
  eyes: React.ReactNode | null
  eyeLine: number
}

function LiveFace({ layers, size, motion, poke }: { layers: Layers; size: number; motion: FaceMotion; poke: number }) {
  const blink = useSharedValue(1)
  const squint = useSharedValue(1)
  const eyeScale = useSharedValue(1)
  const glance = useSharedValue(0)
  const breath = useSharedValue(0)
  const hop = useSharedValue(0)
  const squish = useSharedValue(0)
  const spec = motion === 'still' ? null : MOTIONS[motion]
  const previous = useRef<FaceMotion>(motion)

  // The motion's loops: glance, breathing, hops, eye size.
  useEffect(() => {
    eyeScale.set(withTiming(spec?.eyes ?? 1, { duration: 250 }))

    if (spec?.glance) {
      const { period } = spec.glance
      glance.set(
        withRepeat(
          withSequence(
            withTiming(-1, { duration: period * 0.12, easing: Easing.out(Easing.quad) }),
            withDelay(period * 0.3, withTiming(1, { duration: period * 0.16, easing: Easing.inOut(Easing.quad) })),
            withDelay(period * 0.3, withTiming(0, { duration: period * 0.12, easing: Easing.in(Easing.quad) })),
          ),
          -1,
          false,
        ),
      )
    }

    if (spec?.bob) {
      breath.set(withRepeat(withTiming(1, { duration: spec.bob.period / 2, easing: Easing.inOut(Easing.sin) }), -1, true))
    }

    if (spec?.hop) {
      hop.set(
        withRepeat(
          withSequence(withDelay(spec.hop.every, withTiming(1, { duration: 170, easing: Easing.out(Easing.quad) })), withTiming(0, { duration: 230, easing: Easing.in(Easing.quad) })),
          -1,
          false,
        ),
      )
    }

    return () => {
      for (const value of [glance, breath, hop]) {
        cancelAnimation(value)
        value.set(withTiming(0, { duration: 200 }))
      }
    }
  }, [spec, eyeScale, glance, breath, hop])

  // Blinks at random gaps, from the JS side: they are rare, and a fixed rhythm looks mechanical.
  useEffect(() => {
    if (!spec?.blink) {
      return
    }

    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => {
        blink.set(withSequence(withTiming(0.1, { duration: 70 }), withTiming(1, { duration: 110 })))
        schedule()
      }, nextBlink(spec) ?? 5000)
    }

    schedule()

    return () => clearTimeout(timer)
  }, [spec, blink])

  // A turn just finished: a happy squint and a little bounce.
  useEffect(() => {
    if (previous.current === 'work' && motion !== 'work' && motion !== 'needs') {
      const { squint: amount, duration } = REACTIONS.done
      squint.set(withSequence(withTiming(amount, { duration: duration * 0.18 }), withDelay(duration * 0.5, withTiming(1, { duration: duration * 0.32 }))))
      hop.set(withSequence(withTiming(REACTIONS.done.bounce / 0.1, { duration: 140 }), withTiming(0, { duration: 220 })))
    }

    previous.current = motion
  }, [motion, squint, hop])

  // A press: squish and blink.
  useEffect(() => {
    if (poke > 0) {
      squish.set(withSequence(withTiming(REACTIONS.poke.squish, { duration: REACTIONS.poke.duration * 0.3 }), withSpring(0, { damping: 12, stiffness: 320 })))
      blink.set(withSequence(withTiming(0.1, { duration: 70 }), withTiming(1, { duration: 130 })))
    }
  }, [poke, squish, blink])

  const bobAmount = spec?.bob?.amount ?? 0
  const hopAmount = spec?.hop?.amount ?? 0.1
  const glanceAmount = spec?.glance?.amount ?? 0
  const lift = (layers.eyeLine - 0.5) * size

  const faceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -(breath.value * bobAmount + hop.value * hopAmount) * size },
      { scaleX: 1 + squish.value },
      { scaleY: (1 + breath.value * 0.025) * (1 - squish.value) },
    ],
  }))
  const eyesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: glance.value * glanceAmount * size }, { translateY: lift }, { scaleY: eyeScale.value * blink.value * squint.value }, { translateY: -lift }],
  }))

  return (
    <Animated.View style={[{ width: size, height: size }, faceStyle]}>
      {layers.body}
      {layers.eyes ? <Animated.View style={[StyleSheet.absoluteFill, eyesStyle]}>{layers.eyes}</Animated.View> : null}
    </Animated.View>
  )
}

// ── the face ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A bot's face, identical to Hermes Desktop: the same shape, hue and eyes derived from the same
 * profile data. Classic shapes are drawn from ported geometry; `blobatar` shapes from the library.
 * Still by default; with a `motion` (or a press) it comes alive: blinks, glances, breathes, hops.
 * Decorative: the bot's name is always shown next to it.
 */
export const BotFace = memo(function BotFace({ name, meta, size = 44, mood = 'idle', photo, motion = 'still', poke = 0 }: Props) {
  const reduced = useReducedMotion()
  const appearance = useMemo(() => botAppearance(name, meta), [name, meta])
  const image = photo ?? appearance.image
  const color = avatarColor(appearance.color, name)
  const shape = appearance.shape

  const blob = useMemo(() => (isBlobShape(shape) && !image ? blobSvg(shape, name, size) : null), [shape, name, size, image])
  // An unrenderable blobatar falls back to the name's classic shape, like Desktop's older SDKs.
  const classic = isBlobShape(shape) ? botAppearance(name, { ...meta, shape: undefined }).shape : shape
  const face = useMemo(() => buildFace(classic, color, name, mood), [classic, color, name, mood])
  const live = !reduced && (motion !== 'still' || poke > 0)
  const parts = useMemo(() => (live && blob ? splitBlob(blob) : null), [live, blob])

  if (!live) {
    return (
      <View aria-hidden style={{ width: size, height: size }}>
        {image ? (
          <Image source={{ uri: image }} style={{ width: size, height: size, borderRadius: size * 0.22 }} />
        ) : blob ? (
          <SvgXml xml={blob} width={size} height={size} />
        ) : (
          <>
            <ClassicBody face={face} color={color} size={size} />
            <View style={StyleSheet.absoluteFill}>
              <ClassicEyes face={face} color={color} mood={mood} size={size} />
            </View>
          </>
        )}
      </View>
    )
  }

  const layers: Layers = image
    ? { body: <Image source={{ uri: image }} style={{ width: size, height: size, borderRadius: size * 0.22 }} />, eyes: null, eyeLine: 0.5 }
    : blob
      ? parts
        ? { body: <SvgXml xml={parts.body} width={size} height={size} />, eyes: <SvgXml xml={parts.eyes} width={size} height={size} />, eyeLine: parts.eyeLine }
        : { body: <SvgXml xml={blob} width={size} height={size} />, eyes: null, eyeLine: 0.5 }
      : { body: <ClassicBody face={face} color={color} size={size} />, eyes: <ClassicEyes face={face} color={color} mood={mood} size={size} />, eyeLine: classicEyeLine(face) }

  return (
    <View aria-hidden style={{ width: size, height: size }}>
      <LiveFace layers={layers} size={size} motion={motion} poke={poke} />
    </View>
  )
})
