// The pieces every Blobs store composition is drawn from: Geist, the bots' faces (the app's own blobatar code), a phone
// holding a real screenshot, a piece of UI lifted out of it, and the 440 x 956 design grid scaled to each output.

import { blobatar } from 'blobatar/blob'
import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { AbsoluteFill, cancelRender, continueRender, delayRender, Img, staticFile, useVideoConfig } from 'remotion'

import { BLOB_KIND_TRAIT, splitBlob } from '../../../src/lib/hermes/blob.ts'
import { CAST, DESIGN, PHONE, shade, type BotName, type Crop, type Platform } from '../set.ts'

// ── type ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const FONTS = [
  [400, 'fonts/Geist_400Regular.ttf'],
  [500, 'fonts/Geist_500Medium.ttf'],
  [700, 'fonts/Geist_700Bold.ttf'],
] as const

const fontsReady = delayRender('Loading Geist')

Promise.all(FONTS.map(([weight, file]) => new FontFace('Geist', `url(${staticFile(file)})`, { weight: String(weight) }).load()))
  .then(faces => {
    for (const face of faces) {
      document.fonts.add(face)
    }

    continueRender(fontsReady)
  })
  .catch((error: unknown) => cancelRender(error))

export const SANS = 'Geist, system-ui, sans-serif'

// ── the design grid ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lays its children out on the 440 x 956 design grid, scaled so the grid fills the output's height. Wider outputs (the
 * 9:16 Play stills) show more of the same scene at the sides instead of a different layout.
 */
export function Grid({ background, children }: { background: string; children: ReactNode }) {
  const { width, height } = useVideoConfig()
  const unit = height / DESIGN.height
  const viewWidth = width / unit

  return (
    <AbsoluteFill style={{ background, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: viewWidth, height: DESIGN.height, zoom: unit }}>
        <div style={{ position: 'absolute', left: (viewWidth - DESIGN.width) / 2, top: 0, width: DESIGN.width, height: DESIGN.height }}>{children}</div>
      </div>
    </AbsoluteFill>
  )
}

export function Headline({ lines, color, sub, subColor }: { lines: readonly string[]; color: string; sub?: string; subColor?: string }) {
  return (
    <>
      <h1 style={{ position: 'absolute', left: 32, top: 64, width: 376, margin: 0, fontFamily: SANS, fontWeight: 700, fontSize: 40, lineHeight: '42px', letterSpacing: -1.3, color }}>
        {lines.map((line, index) => (
          <Fragment key={line}>
            {index > 0 ? <br /> : null}
            {line}
          </Fragment>
        ))}
      </h1>
      {sub ? (
        <p style={{ position: 'absolute', left: 32, top: 64 + lines.length * 42 + 12, width: 360, margin: 0, fontFamily: SANS, fontWeight: 400, fontSize: 16, lineHeight: '22px', textWrap: 'balance', color: subColor }}>
          {sub}
        </p>
      ) : null}
    </>
  )
}

// ── faces ────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface FaceArt {
  body: string
  eyes: string
  eyeLine: number
  colour: string
}

const arts = new Map<BotName, FaceArt>()

/** A bot's face, split into body and eyes the way the app draws it, with its body colour (the colour of its frame). */
export function faceArt(bot: BotName): FaceArt {
  const cached = arts.get(bot)

  if (cached) {
    return cached
  }

  const { seed, kind } = CAST[bot]
  const parts = splitBlob(blobatar(seed, { traits: { shape: BLOB_KIND_TRAIT[kind] } }).trim())
  const colour = parts ? /<g[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(parts.body)?.[1] : undefined

  if (!parts || !colour) {
    throw new Error(`blobatar changed shape: no body and eyes for ${bot}`)
  }

  const art = { ...parts, colour }
  arts.set(bot, art)

  return art
}

/** The colour a bot's frame takes: its own face colour. */
export const botColour = (bot: BotName) => faceArt(bot).colour

const svgUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

export interface FaceProps {
  bot: BotName
  x: number
  y: number
  size: number
  /** Where the eyes look, -1 to 1 on each axis (5 % of the face's size at the ends). */
  look?: { x: number; y: number }
  /** 0 open, 1 shut. */
  blink?: number
  /** Draws the body this much darker (0 to 1), for a face on paper of its own colour. */
  tone?: number
  style?: CSSProperties
}

export function Face({ bot, x, y, size, look = { x: 0, y: 0 }, blink = 0, tone = 0, style }: FaceProps) {
  const art = faceArt(bot)
  const body = tone ? art.body.replace(art.colour, shade(art.colour, tone)) : art.body
  const layer: CSSProperties = { position: 'absolute', left: 0, top: 0, width: size, height: size, display: 'block' }

  return (
    <div style={{ position: 'absolute', left: x, top: y, width: size, height: size, ...style }}>
      <img src={svgUri(body)} alt="" style={layer} />
      <img
        src={svgUri(art.eyes)}
        alt=""
        style={{
          ...layer,
          transform: `translate(${look.x * 5}%, ${look.y * 5}%) scaleY(${1 - 0.9 * blink})`,
          transformOrigin: `50% ${art.eyeLine * 100}%`,
        }}
      />
    </div>
  )
}

/**
 * Where a face of `size` goes to peek over an edge: centred on `centre`, its eyes clearing the edge at `edge` by `gap`,
 * the rest of it hidden behind whatever the edge belongs to.
 */
export function peek(bot: BotName, size: number, centre: number, edge: number, gap = 12) {
  return { x: centre - size / 2, y: edge - gap - (faceArt(bot).eyeLine + 0.06) * size }
}

export function AmberDot({ x, y, size = 14 }: { x: number; y: number; size?: number }) {
  return <span style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size / 2, background: '#FFB020' }} />
}

// ── phones and cut-outs ──────────────────────────────────────────────────────────────────────────────────────────────

/** A screenshot staged in the public folder, with its pixel size. */
export type Shot = { src: string; width: number; height: number }

/** iPhone displays have deep corners; Android phones vary, so a gentler generic radius. */
export const screenRadius = (platform: Platform) => (platform === 'iphone' ? 45 : 30)

export function Phone({ shot, platform, x, y, rotate = 0, bezel, shadow }: { shot: Shot; platform: Platform; x: number; y: number; rotate?: number; bezel: string; shadow: string }) {
  const height = (PHONE.screenWidth * shot.height) / shot.width
  const radius = screenRadius(platform)

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        padding: PHONE.bezel,
        borderRadius: radius + PHONE.bezel,
        background: bezel,
        boxShadow: shadow,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
      }}
    >
      <Img src={staticFile(shot.src)} style={{ display: 'block', width: PHONE.screenWidth, height, borderRadius: radius }} />
    </div>
  )
}

/** A piece of real UI lifted out of a screenshot: the same pixels, cropped to the card and drawn larger in front. */
export function Cutout({ shot, crop, x, y, width, rotate = 0, shadow }: { shot: Shot; crop: Crop; x: number; y: number; width: number; rotate?: number; shadow: string }) {
  const scale = width / crop.w

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height: crop.h * scale,
        borderRadius: crop.radius * scale,
        overflow: 'hidden',
        boxShadow: shadow,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
      }}
    >
      <Img
        src={staticFile(shot.src)}
        style={{ position: 'absolute', left: -crop.x * scale, top: -crop.y * scale, width: shot.width * scale, height: shot.height * scale, maxWidth: 'none' }}
      />
    </div>
  )
}
