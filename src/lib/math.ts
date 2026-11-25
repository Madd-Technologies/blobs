/**
 * LaTeX to drawable SVG picture cache and parser.
 * Pure: no React Native imports. On native, MathJax runs inside a lazy hidden WebView worker (`assets/web/math.html`)
 * so `mathjax-full` never inflates the app's JS bundle; tests can still configure an in-process converter.
 */

export type Converter = { convert: (tex: string, display: boolean) => string }

let load: (() => Converter) | null = null

export function configureMath(loader: () => Converter): void {
  load = loader
  converter = null
}

export interface MathPicture {
  xml: string
  width: number
  height: number
  depth: number
}

let converter: Converter | null = null

const CACHE_LIMIT = 300
const cache = new Map<string, MathPicture | null>()

const ex = (value: string | undefined): number => {
  const parsed = Number.parseFloat(value ?? '')

  return Number.isFinite(parsed) ? parsed : 0
}

export function mathCacheKey(tex: string, display: boolean): string {
  return `${display ? 'D' : 'I'}${tex.trim()}`
}

export function parseMathSvg(svg: string | null | undefined): MathPicture | null {
  if (!svg) {
    return null
  }

  const start = svg.indexOf('<svg')
  const end = svg.lastIndexOf('</svg>')

  if (start < 0 || end < start) {
    return null
  }

  const rawSvg = svg.slice(start, end + '</svg>'.length)
  const open = /<svg\b[^>]*>/.exec(rawSvg)?.[0] ?? ''

  if (!open) {
    return null
  }

  const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(open)?.[1]
  const depth = ex(/vertical-align:\s*(-?[\d.]+)ex/.exec(open)?.[1])
  const width = ex(attr('width'))
  const height = ex(attr('height'))
  // `style`, `role`, and `focusable` mean nothing to react-native-svg and can trip its parser.
  const xml = rawSvg.replace(open, open.replace(/\s(?:style|role|focusable)="[^"]*"/g, ''))

  return width > 0 && height > 0 ? { xml, width, height, depth: -depth } : null
}

/** Returns cached MathPicture, `null` when TeX failed, or `undefined` when not rendered yet. */
export function getCachedMathPicture(tex: string, display: boolean): MathPicture | null | undefined {
  const source = tex.trim()

  if (!source) {
    return null
  }

  const key = mathCacheKey(source, display)

  return cache.has(key) ? (cache.get(key) ?? null) : undefined
}

export function cacheMathPicture(tex: string, display: boolean, picture: MathPicture | null): MathPicture | null {
  const source = tex.trim()

  if (!source) {
    return null
  }

  const key = mathCacheKey(source, display)

  if (!cache.has(key) && cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value as string)
  }

  cache.set(key, picture)

  return picture
}

export function texToPicture(tex: string, display: boolean): MathPicture | null {
  const cached = getCachedMathPicture(tex, display)

  if (cached !== undefined) {
    return cached
  }

  let picture: MathPicture | null = null

  try {
    converter ??= load ? load() : null

    if (!converter) {
      return null
    }

    picture = parseMathSvg(converter.convert(tex.trim(), display))
  } catch {
    picture = null
  }

  return cacheMathPicture(tex, display, picture)
}
