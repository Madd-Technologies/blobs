/**
 * LaTeX to a drawable picture. MathJax runs in plain JavaScript (no browser needed) and writes SVG, which the app draws with
 * react-native-svg. Pure: no React Native imports.
 */

/** What turns TeX into SVG text: MathJax, loaded on first use (see `mathEngine.ts`). */
export type Converter = { convert: (tex: string, display: boolean) => string }

let load: (() => Converter) | null = null

/** Says how to get the converter. The app passes a function that `require`s the engine, so MathJax is not loaded until a formula needs it. */
export function configureMath(loader: () => Converter): void {
  load = loader
  converter = null
}

/** A formula as a picture: the SVG, and its size in `ex` (the height of a lowercase letter), `depth` being how far it hangs below the baseline. */
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

/** The picture for `tex`, or null when MathJax cannot read it (or it is empty). Remembered, since a streaming reply asks again at every flush. */
export function texToPicture(tex: string, display: boolean): MathPicture | null {
  const source = tex.trim()

  if (!source) {
    return null
  }

  const key = `${display ? 'D' : 'I'}${source}`

  if (cache.has(key)) {
    return cache.get(key) ?? null
  }

  let picture: MathPicture | null = null

  try {
    converter ??= load ? load() : null

    if (!converter) {
      return null
    }

    const svg = converter.convert(source, display)
    const open = /<svg\b[^>]*>/.exec(svg)?.[0] ?? ''
    const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(open)?.[1]
    const depth = ex(/vertical-align:\s*(-?[\d.]+)ex/.exec(open)?.[1])
    const width = ex(attr('width'))
    const height = ex(attr('height'))

    // `style`, `role` and `focusable` mean nothing to react-native-svg, and its parser does not like some of them.
    const xml = svg.replace(open, open.replace(/\s(?:style|role|focusable)="[^"]*"/g, ''))

    picture = width > 0 && height > 0 ? { xml, width, height, depth: -depth } : null
  } catch {
    picture = null
  }

  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value as string)
  }

  cache.set(key, picture)

  return picture
}
