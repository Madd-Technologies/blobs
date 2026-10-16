// One store screenshot of the "Face colour" set: the frame's bot colour, its headline, the phone with the real capture,
// one piece of its UI lifted out of it, and the bot's own face, huge and a shade darker, peeking over the phone at it.
// The first frame is black instead, with the whole cast peeking over the phone.

import { AmberDot, botColour, Cutout, Face, Grid, Headline, peek, Phone, type Shot } from './parts.tsx'
import { BLACK, CAST_ORDER, lifted, PHONE, phoneTop, STILLS, TONE, type Platform } from '../set.ts'

export type StillProps = {
  /** Index into STILLS. */
  frame: number
  platform: Platform
  shot: Shot
}

const GIANT = 460
const CROWD = { size: 124, step: 74, gaps: [14, 6, 16, 8, 18] } as const

export function Still({ frame: index, platform, shot }: StillProps) {
  const frame = STILLS[index]

  if (!frame) {
    throw new Error(`no still ${index}`)
  }

  const onBlack = frame.bot === null
  const background = frame.bot ? botColour(frame.bot) : BLACK
  const top = phoneTop(frame)
  const lean = PHONE.lean[frame.phone]
  const lift = lifted(frame, platform, shot)

  // The top edge's middle, after the phone's tilt has swung it sideways.
  const outerHeight = (PHONE.screenWidth * shot.height) / shot.width + 2 * PHONE.bezel
  const middle = lean.x + PHONE.screenWidth / 2 + PHONE.bezel + (outerHeight / 2) * Math.sin((lean.rotate * Math.PI) / 180)
  const lookAtCard = lift ? Math.sign(lift.x + lift.width / 2 - middle) * 0.6 : 0

  const phoneShadow = onBlack ? 'inset 0 1px 0 #3A3A3E, 0 40px 80px rgba(0,0,0,.55)' : 'inset 0 1px 0 #2A2A2E, 0 30px 60px rgba(0,0,0,.28)'
  const cutShadow = onBlack ? '0 30px 60px rgba(0,0,0,.6), 0 4px 12px rgba(0,0,0,.45)' : '0 24px 50px rgba(0,0,0,.3), 0 3px 8px rgba(0,0,0,.2)'

  return (
    <Grid background={background}>
      {frame.bot ? (
        <Face bot={frame.bot} size={GIANT} tone={TONE} {...peek(frame.bot, GIANT, middle, top, 14)} look={{ x: lookAtCard, y: 1 }} />
      ) : (
        CAST_ORDER.map((bot, place) => {
          const at = peek(bot, CROWD.size, middle + (place - 2) * CROWD.step, top, CROWD.gaps[place])

          return (
            <div key={bot}>
              <Face bot={bot} size={CROWD.size} {...at} look={{ x: (2 - place) * 0.3, y: 1 }} />
              {bot === 'courier' ? <AmberDot x={at.x + CROWD.size * 0.66} y={at.y + CROWD.size * 0.3} size={12} /> : null}
            </div>
          )
        })
      )}

      <Headline lines={frame.headline} color={onBlack ? '#F4F4F5' : BLACK} sub={frame.sub} subColor={onBlack ? '#8E8E93' : 'rgba(10,10,10,.72)'} />

      <Phone shot={shot} platform={platform} x={lean.x} y={top} rotate={lean.rotate} bezel={onBlack ? '#1C1C1F' : BLACK} shadow={phoneShadow} />

      {lift ? <Cutout shot={shot} crop={lift.crop} x={lift.x} y={lift.y} width={lift.width} rotate={frame.cutout?.rotate} shadow={cutShadow} /> : null}
    </Grid>
  )
}
