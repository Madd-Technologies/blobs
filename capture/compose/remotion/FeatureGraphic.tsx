// Google Play's feature graphic, 1024 x 500: Courier's colour, the name and one line, and the approval card lifted out of
// a real capture with Courier's face, huge and a shade darker, peeking over it. Google asks for no device frame here,
// so the card stands on its own.

import { AbsoluteFill } from 'remotion'

import { botColour, Cutout, Face, peek, SANS, type Shot } from './parts.tsx'
import { BLACK, cropFor, TONE, type Platform } from '../set.ts'

export type FeatureGraphicProps = {
  platform: Platform
  /** The capture holding the approval card. */
  shot: Shot
}

const CARD = { x: 556, y: 236, width: 384 }

export function FeatureGraphic({ platform, shot }: FeatureGraphicProps) {
  const crop = cropFor(platform, 'approval', shot.width)

  return (
    <AbsoluteFill style={{ background: botColour('courier'), overflow: 'hidden', fontFamily: SANS, color: BLACK }}>
      <Face bot="courier" size={440} tone={TONE} {...peek('courier', 440, CARD.x + CARD.width / 2, CARD.y, 14)} look={{ x: -0.6, y: 1 }} />
      <h1 style={{ position: 'absolute', left: 80, top: 150, margin: 0, fontSize: 88, lineHeight: '88px', fontWeight: 700, letterSpacing: -3 }}>Blobs</h1>
      <p style={{ position: 'absolute', left: 82, top: 258, width: 400, margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 500, letterSpacing: -0.4, color: 'rgba(10,10,10,.72)' }}>
        Your Hermes Agent bots,
        <br />
        in your pocket.
      </p>
      <Cutout shot={shot} crop={crop} x={CARD.x} y={CARD.y} width={CARD.width} rotate={-2} shadow="0 24px 50px rgba(0,0,0,.3), 0 3px 8px rgba(0,0,0,.2)" />
    </AbsoluteFill>
  )
}
