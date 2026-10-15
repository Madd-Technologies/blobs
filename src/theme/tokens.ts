/**
 * "Card Stock" design tokens. Layered paper in four tonal levels, tinted per bot on that bot's own screens; only what you
 * must act on rises (a 1 px lighter top edge and a soft shadow). The only colors are the bots' faces, the tint they give
 * their paper, and one amber "needs you" accent.
 *
 * Rules the tokens encode: no borders and no badge pills; one raised card per moment plus the composer tray; amber means
 * "your turn" and nothing else; mono is for commands, paths, env vars and output only.
 */

export type ColorScheme = 'light' | 'dark'

export interface Palette {
  /** Level 0: the screen background. */
  canvas: string
  /** Level 1: Home's list, Settings groups, grouped lists. */
  sheet: string
  /** Level 2: your bubble, inline code, separators inside a sheet. */
  tone: string
  /** Level 3: only what you must act on (approval cards, the Needs-you card, the composer tray, sheets). */
  raised: string
  /** The raised level's 1 px lighter top edge. */
  edge: string
  /** The raised level's soft drop shadow, in `boxShadow` syntax. */
  shadow: string
  /** The same shadow cast upward, for bottom sheets. */
  sheetShadow: string
  /** Icon circles and secondary pills on the canvas (one level up). */
  control: string
  /** Secondary buttons pressed into a raised card or the composer tray. */
  pressedIn: string
  /** The flat cards stacked behind a deck's top card: the next one and the one after. */
  deckNext: string
  deckThird: string
  /** A sheet's grab handle. */
  grab: string
  /** A spinner's ring and other quiet tracks. */
  track: string
  /** 1 px line on the canvas. */
  hairline: string
  /** Divider inside a sheet (grouped lists). */
  separator: string
  text: string
  text2: string
  /** Amber: "it is your turn". Never decorative. */
  needsYou: string
  /** Amber when it must read as text (light paper needs a darker amber). */
  needsYouText: string
  danger: string
  connected: string
  /** Your messages: a compact tonal bubble. */
  userBubble: string
  userBubbleText: string
  /** The one white-pill moment: fill and label. */
  primary: string
  onPrimary: string
  /** Scrim behind sheets. */
  scrim: string
}

const dark: Palette = {
  canvas: '#0A0A0A',
  sheet: '#141416',
  tone: '#1C1C1F',
  raised: '#262629',
  edge: '#38383C',
  shadow: '0 8px 24px rgba(0,0,0,0.35)',
  sheetShadow: '0 -8px 24px rgba(0,0,0,0.35)',
  control: '#1C1C1F',
  pressedIn: '#141416',
  deckNext: '#202023',
  deckThird: '#18181B',
  grab: '#48484C',
  track: '#38383C',
  hairline: '#1C1C1F',
  separator: '#1C1C1F',
  text: '#F4F4F5',
  text2: '#8E8E93',
  needsYou: '#FFB020',
  needsYouText: '#FFB020',
  danger: '#FF6B6B',
  connected: '#34C77B',
  userBubble: '#1C1C1F',
  userBubbleText: '#F4F4F5',
  primary: '#F4F4F5',
  onPrimary: '#0A0A0A',
  scrim: 'rgba(0,0,0,0.55)',
}

// The light neutrals are chosen so that tinted light paper keeps the same steps as dark.
const light: Palette = {
  canvas: '#FAFAFA',
  sheet: '#F1F1F2',
  tone: '#E6E6E8',
  raised: '#FFFFFF',
  edge: '#FFFFFF',
  shadow: '0 1px 2px rgba(20,20,24,0.08), 0 8px 24px rgba(20,20,24,0.10)',
  sheetShadow: '0 -1px 2px rgba(20,20,24,0.06), 0 -8px 24px rgba(20,20,24,0.10)',
  control: '#F1F1F2',
  pressedIn: '#F3F3F4',
  deckNext: '#E9E9EB',
  deckThird: '#F0F0F1',
  grab: '#D4D4D8',
  track: '#D7D6D7',
  hairline: '#E6E6E8',
  separator: '#E6E6E8',
  text: '#0A0A0A',
  text2: '#6E6E73',
  needsYou: '#F59E0B',
  needsYouText: '#B45309',
  danger: '#DC2626',
  connected: '#22A863',
  userBubble: '#E6E6E8',
  userBubbleText: '#0A0A0A',
  primary: '#0A0A0A',
  onPrimary: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.35)',
}

export const palettes: Record<ColorScheme, Palette> = { dark, light }

// ── per-bot tint ────────────────────────────────────────────────────────────────────────────────

type Rgb = [number, number, number]

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const s = saturation / 100
  const l = lightness / 100
  const k = (n: number) => (n + hue / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))

  return [f(0), f(8), f(4)].map(value => Math.round(value * 255)) as Rgb
}

/** A face color as channels: `#rgb`, `#rrggbb`, `rgb(…)`, or the `hsl(h s% l%)` that profile colors are. */
function channels(color: string): Rgb {
  const value = color.trim()
  const numbers = (value.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
  const [first = 0, second = 0, third = 0] = numbers
  const complete = numbers.length >= 3

  if (/^hsla?\(/i.test(value) && complete) {
    return hslToRgb(((first % 360) + 360) % 360, second, third)
  }

  if (/^rgba?\(/i.test(value) && complete) {
    return [first, second, third].map(n => Math.max(0, Math.min(255, Math.round(n)))) as Rgb
  }

  const hex = value.replace('#', '')
  const full = hex.length === 3 || hex.length === 4 ? hex.slice(0, 3).replace(/./g, ch => ch + ch) : hex.slice(0, 6)

  return [0, 2, 4].map(at => parseInt(full.slice(at, at + 2), 16) || 0) as Rgb
}

/** `from` moved `amount` (0-1) of the way toward `to`, per channel: the tint formula. */
export function mix(from: string, to: string, amount: number): string {
  const a = channels(from)
  const b = channels(to)

  return `#${a.map((value, index) => Math.round(value + ((b[index] ?? value) - value) * amount).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

/** A tintable level of paper. */
export type Level = 'canvas' | 'sheet' | 'tone' | 'raised' | 'edge' | 'pressedIn' | 'pinned'

// How far each level moves toward the face color. Dark: 4% canvas, 5% sheet, 6% tone, 7% raised and pinned tiles, 8% the
// raised top edge, the raised top edge. Light uses its own fitted amounts.
const AMOUNT: Record<ColorScheme, Record<Level, number>> = {
  dark: { canvas: 0.04, sheet: 0.05, tone: 0.06, raised: 0.07, edge: 0.08, pressedIn: 0.05, pinned: 0.07 },
  light: { canvas: 0.05, sheet: 0.06, tone: 0.07, raised: 0.012, edge: 0, pressedIn: 0.06, pinned: 0.07 },
}

function base(palette: Palette, level: Level): string {
  return level === 'pinned' ? palette.tone : palette[level]
}

/** One level of paper in a bot's tint: a pinned tile, a card in the Needs-you deck. */
export function tintLevel(scheme: ColorScheme, level: Level, face: string | null | undefined): string {
  const neutral = palettes[scheme]

  return face ? mix(base(neutral, level), face, AMOUNT[scheme][level]) : base(neutral, level)
}

/** The whole palette in a bot's tint, for that bot's own screens (chat, dashboard, record, details, screen). */
export function tintPalette(scheme: ColorScheme, face: string): Palette {
  const neutral = palettes[scheme]
  const at = (level: Level) => tintLevel(scheme, level, face)
  const tone = at('tone')
  // Light paper's shadow is a deep shade of the face; dark paper's stays black.
  const [r, g, b] = channels(mix('#000000', face, 0.3))
  const shade = (alpha: number) => `rgba(${r},${g},${b},${alpha})`

  return {
    ...neutral,
    canvas: at('canvas'),
    sheet: at('sheet'),
    tone,
    raised: at('raised'),
    edge: at('edge'),
    shadow: scheme === 'light' ? `0 1px 2px ${shade(0.08)}, 0 8px 24px ${shade(0.1)}` : neutral.shadow,
    sheetShadow: scheme === 'light' ? `0 -1px 2px ${shade(0.06)}, 0 -8px 24px ${shade(0.1)}` : neutral.sheetShadow,
    // On a bot's paper the icon circles are its sheet, which reads as light as the neutral tone does.
    control: at('sheet'),
    pressedIn: at('pressedIn'),
    deckNext: tone,
    deckThird: at('sheet'),
    grab: mix(neutral.grab, face, 0.09),
    track: mix(neutral.track, face, 0.07),
    hairline: tone,
    separator: tone,
    userBubble: tone,
  }
}

/** The raised level: one step lighter, a 1 px lighter top edge and a soft shadow. Nothing else casts a shadow. */
export function raisedStyle(c: Palette): { backgroundColor: string; boxShadow: string } {
  return { backgroundColor: c.raised, boxShadow: `inset 0 1px 0 ${c.edge}, ${c.shadow}` }
}

// ── type ────────────────────────────────────────────────────────────────────────────────────────

/** Names registered with `useFonts` in the root layout. RN has no font weights for custom fonts. */
export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const

export interface TypeStyle {
  fontFamily: string
  fontSize: number
  lineHeight: number
  letterSpacing?: number
}

/** Type scale (size/line-height). */
export const type = {
  /** 30/36 700, −0.6: page titles ("Needs you", "Settings", a bot's name on its details). */
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  /** 28/34 700, −0.5: a dashboard's numbers. */
  stat: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  /** 22/28 600, −0.3: the deck's top card. */
  display: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  /** 17/22 600: a sheet's title. */
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  /** 16/20 600: headers and card titles. */
  heading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20 },
  /** 16/25: a bot's reply, with no bubble. */
  reply: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 25 },
  /** 15/20 600: list-row names. */
  rowTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  /** 15/21: bubbles and card bodies. */
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  bodySemibold: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21 },
  /** 14/20: secondary lines. */
  secondary: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  /** 13/18: labels and tool steps. */
  label: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  /** 13/17: the status line under a header's name. */
  status: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 17 },
  /** 13/16 500: captions. */
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 16 },
  /** 12/16: timestamps. */
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  /** 13/19 mono: commands, paths, env vars. */
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 },
  /** 12/17 mono: quiet tool output under an activity line. */
  monoSmall: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 17 },
} as const satisfies Record<string, TypeStyle>

export type TypeVariant = keyof typeof type

/** Alias that reads better where a local `type` would shadow. */
export const typeScale = type

/** 4 pt grid. Gutters are 16-20. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const

/** Corners. Nested corners stay concentric: inner radius = outer radius − inset. */
export const radius = {
  /** Inline code. */
  code: 6,
  /** Command block, a draft inside a card. */
  block: 8,
  /** Thumbnails. */
  thumb: 10,
  /** Fields. */
  field: 14,
  /** Pinned tiles, a sheet's grouped list. */
  list: 16,
  /** Chips and Details tiles. */
  chip: 18,
  /** Bubbles. */
  bubble: 20,
  /** Bubble corner that points at the speaker. */
  tail: 6,
  /** The Needs-you card, Settings groups, dashboard panels. */
  group: 22,
  /** Approval and question cards. */
  card: 24,
  /** The deck's top card. */
  deck: 26,
  /** The composer tray and sheets. */
  tray: 28,
  pill: 999,
} as const

/** Sizes of the recurring controls. */
export const size = {
  /** Header icon circle. */
  iconCircle: 40,
  /** Composer buttons, field minimum. */
  control: 44,
  /** Pill buttons run 36-52; 42 is the standard. */
  pill: 42,
  /** Grouped-list row. */
  row: 52,
  /** Bot list row minimum. */
  botRow: 68,
} as const

/** Motion: press springs, cards rising in, sheets that follow the drag. */
export const motion = {
  /** Pressed things scale to this on a spring and come back on release. */
  pressScale: 0.97,
  press: { damping: 20, stiffness: 300 },
  /** Cards rise in from this far below, on a spring, fading in. */
  riseFrom: 16,
  /** A fling down faster than this (px/s) closes a sheet. */
  flingClose: 800,
} as const

/** Never go under this for anything tappable. */
export const MIN_TOUCH = 44
