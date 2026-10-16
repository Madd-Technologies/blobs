// The App Store preview: the rig's real recordings, one window per moment, on the "Face colour" paper. Apple allows only
// footage of the app itself plus overlays, so the footage plays untouched in a bare screen (no device frame) and the
// captions, the colour and the faces sit around it. Segments dissolve into each other, as Apple suggests.

import { Easing, interpolate, interpolateColors, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

import { AmberDot, botColour, Face, Grid, Headline, peek } from './parts.tsx'
import { BLACK, CAST_ORDER, CROSSFADE, DESIGN, PREVIEW, TONE, timeline, type PreviewSegment } from '../set.ts'

type Clip = { src: string; width: number; height: number }

export type PreviewProps = {
  /** The staged clips, by the rig's clip name (01-home, 07-courier, …). */
  clips: Record<string, Clip>
}

const SCREEN = { width: 304, top: 250, radius: 38 }
const SCREEN_X = (DESIGN.width - SCREEN.width) / 2
const MIDDLE = DESIGN.width / 2
const GIANT = 440
const CROWD = { size: 116, step: 70, gaps: [14, 6, 16, 8, 18] } as const
/** How far below its peeking place a face waits, hidden behind the screen, before it rises. */
const HIDDEN = 260

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const colourOf = (segment: PreviewSegment) => (segment.bot ? botColour(segment.bot) : BLACK)

export function Preview({ clips }: PreviewProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { items } = timeline(PREVIEW, fps)

  // The paper turns from one bot's colour to the next while their segments overlap.
  const index = Math.max(0, items.findLastIndex(item => item.start <= frame))
  const item = items[index]!
  const previous = items[index - 1]
  const t = previous ? Easing.inOut(Easing.cubic)(interpolate(frame, [item.start, item.start + CROSSFADE], [0, 1], clamp)) : 1
  const background = previous ? interpolateColors(t, [0, 1], [colourOf(previous.segment), colourOf(item.segment)]) : colourOf(item.segment)

  const first = clips[PREVIEW[0]!.clip]
  const screenHeight = first ? (SCREEN.width * first.height) / first.width : SCREEN.width * 2.17

  return (
    <Grid background={background}>
      {items.map(({ segment, start, duration }, place) => (
        <Sequence key={segment.id} from={start} durationInFrames={duration} layout="none">
          {segment.bot ? <Giant segment={segment} duration={duration} last={place === items.length - 1} /> : <Cast duration={duration} last={place === items.length - 1} />}
        </Sequence>
      ))}

      <div
        style={{
          position: 'absolute',
          left: SCREEN_X,
          top: SCREEN.top,
          width: SCREEN.width,
          height: screenHeight,
          borderRadius: SCREEN.radius,
          overflow: 'hidden',
          background: BLACK,
          boxShadow: '0 30px 60px rgba(0,0,0,.3), 0 3px 8px rgba(0,0,0,.2)',
        }}
      >
        {items.map(({ segment, start, duration }, place) => {
          const clip = clips[segment.clip]

          return clip ? (
            <Sequence key={segment.id} from={start} durationInFrames={duration} layout="none">
              <Footage clip={clip} from={segment.from} fadeIn={place > 0} />
            </Sequence>
          ) : null
        })}
      </div>

      {items.map(({ segment, start, duration }, place) => (
        <Sequence key={`${segment.id}-caption`} from={start} durationInFrames={duration} layout="none">
          <Caption segment={segment} duration={duration} first={place === 0} last={place === items.length - 1} />
        </Sequence>
      ))}
    </Grid>
  )
}

function Footage({ clip, from, fadeIn }: { clip: Clip; from: number; fadeIn: boolean }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = fadeIn ? interpolate(frame, [0, CROSSFADE], [0, 1], clamp) : 1

  return (
    <OffthreadVideo
      src={staticFile(clip.src)}
      trimBefore={Math.round(from * fps)}
      muted
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity }}
    />
  )
}

function Caption({ segment, duration, first, last }: { segment: PreviewSegment; duration: number; first: boolean; last: boolean }) {
  const frame = useCurrentFrame()
  // The old caption leaves in the first half of the dissolve and the new one arrives in the second, so they never overlap.
  const enter = first ? 1 : interpolate(frame, [CROSSFADE / 2, CROSSFADE], [0, 1], clamp)
  const exit = last ? 0 : interpolate(frame, [duration - CROSSFADE, duration - CROSSFADE / 2], [0, 1], clamp)
  const y = (1 - Easing.out(Easing.cubic)(enter)) * 14 - Easing.in(Easing.cubic)(exit) * 14
  const onBlack = segment.bot === null

  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: enter * (1 - exit), transform: `translateY(${y}px)` }}>
      <Headline lines={segment.headline} color={onBlack ? '#F4F4F5' : BLACK} />
    </div>
  )
}

/** How far a face sits below its peeking place: it rises from behind the screen and sinks back as the segment ends. */
function useRise(duration: number, last: boolean, delay = 0) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rise = spring({ frame: frame - 4 - delay, fps, config: { damping: 15, stiffness: 120, mass: 0.9 } })
  const sink = last ? 0 : interpolate(frame, [duration - CROSSFADE, duration - CROSSFADE / 3], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) })

  return (1 - rise + sink) * HIDDEN
}

/** A blink: shut and open again over six frames, starting at `at`. */
const blinkAt = (frame: number, at: number) => interpolate(frame, [at, at + 3, at + 6], [0, 1, 0], clamp)

/** The segment's bot, huge and a shade darker, rising behind the screen to peek over it, glancing down and blinking once. */
function Giant({ segment, duration, last }: { segment: PreviewSegment; duration: number; last: boolean }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const drop = useRise(duration, last)

  if (!segment.bot) {
    return null
  }

  const at = peek(segment.bot, GIANT, MIDDLE, SCREEN.top, 14)
  const bob = Math.sin(((frame / fps) * Math.PI * 2) / 3.6) * 3
  const down = interpolate(frame, [16, 24], [0, 1], clamp)

  return (
    <Face bot={segment.bot} size={GIANT} tone={TONE} x={at.x} y={at.y + drop + bob} look={{ x: 0, y: down }} blink={blinkAt(frame, Math.round(duration * 0.55))} />
  )
}

/** The whole cast peeking over the screen, rising one after another, bobbing out of step and blinking now and then. */
function Cast({ duration, last }: { duration: number; last: boolean }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  return (
    <>
      {CAST_ORDER.map((bot, place) => (
        <CastFace key={bot} bot={bot} place={place} duration={duration} last={last} frame={frame} fps={fps} />
      ))}
    </>
  )
}

function CastFace({ bot, place, duration, last, frame, fps }: { bot: (typeof CAST_ORDER)[number]; place: number; duration: number; last: boolean; frame: number; fps: number }) {
  const drop = useRise(duration, last, place * 3)
  const at = peek(bot, CROWD.size, MIDDLE + (place - 2) * CROWD.step, SCREEN.top, CROWD.gaps[place])
  const bob = Math.sin(((frame / fps) * Math.PI * 2) / 3.2 + place * 1.3) * 2.5
  const y = at.y + drop + bob

  return (
    <>
      <Face bot={bot} size={CROWD.size} x={at.x} y={y} look={{ x: (2 - place) * 0.3, y: 1 }} blink={blinkAt(frame, 40 + place * 17)} />
      {bot === 'courier' ? <AmberDot x={at.x + CROWD.size * 0.66} y={y + CROWD.size * 0.3} size={11} /> : null}
    </>
  )
}
