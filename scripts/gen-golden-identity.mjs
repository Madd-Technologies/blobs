#!/usr/bin/env node
/**
 * Generates src/lib/hermes/fixtures/golden-identity.json from Hermes Desktop's own source, so the
 * tests prove HermesBot draws the same bot faces. Needs a Hermes checkout (default
 * ~/.hermes/hermes-agent). Re-run only when Desktop's avatar code changes.
 *
 * It bundles Desktop's avatar.tsx with esbuild (stubbing only `@hermes/plugin-sdk`), renders
 * BotFace with react-dom/server, and records what Desktop draws.
 */
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hermes = process.env.HERMES_AGENT_DIR ?? join(homedir(), '.hermes', 'hermes-agent')
const desktop = join(hermes, 'apps/desktop/src')
const outDir = join(root, 'node_modules/.cache/hermesbot-golden')
mkdirSync(outDir, { recursive: true })

// The only thing Desktop's avatar.tsx needs from its SDK.
const stub = join(outDir, 'sdk-stub.mjs')
writeFileSync(
  stub,
  `export { profileColor } from ${JSON.stringify(join(desktop, 'lib/profile-color.ts'))}
export { blobatar as blobatarSvg } from ${JSON.stringify(join(root, 'node_modules/blobatar/dist/blob.js'))}
`,
)

const bundle = join(outDir, 'avatar.mjs')
await build({
  entryPoints: [join(desktop, 'plugins/hermes-bots/avatar.tsx')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  alias: { '@hermes/plugin-sdk': stub },
  external: ['react', 'react/jsx-runtime', 'blobatar', 'blobatar/*'],
  logLevel: 'error',
})

const { default: React } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const avatar = await import(pathToFileURL(bundle).href)
const { profileColor } = await import(pathToFileURL(join(desktop, 'lib/profile-color.ts')).href)

const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
const num = (tag, name) => Number(attr(tag, name))

function extractRing(markup) {
  const body = /<path d="([^"]*)" data-hb-body="1" fill="([^"]*)"/.exec(markup)
  const eyes = [...markup.matchAll(/<ellipse [^>]*>/g)].map(m => ({
    cx: num(m[0], 'cx'), cy: num(m[0], 'cy'), rx: num(m[0], 'rx'), ry: num(m[0], 'ry'), fill: attr(m[0], 'fill'),
  }))
  const circles = [...markup.matchAll(/<circle [^>]*>/g)].map(m => m[0])
  const highlights = circles.filter(c => c.includes('data-hb-hl-')).map(c => ({
    cx: num(c, 'cx'), cy: num(c, 'cy'), r: num(c, 'r'), fill: attr(c, 'fill'),
  }))
  const dots = circles.filter(c => c.includes('data-hb-dot')).map(c => ({
    cx: num(c, 'cx'), cy: num(c, 'cy'), r: num(c, 'r'), opacity: num(c, 'opacity'),
  }))
  const shut = /<path d="([^"]*)" data-hb-shut="1"/.exec(markup)?.[1]
  return { viewBox: attr(markup, 'viewBox'), body: body?.[1], eyes, highlights, dots, shut }
}

function extractSigil(markup) {
  const paths = [...markup.matchAll(/<path [^>]*>/g)].map(m => m[0])
  const ring = paths.find(p => p.includes('opacity="0.5"'))
  const strokes = paths.find(p => p.includes('stroke-width="2.2"'))
  const circles = [...markup.matchAll(/<circle [^>]*>/g)].map(m => ({
    cx: num(m[0], 'cx'), cy: num(m[0], 'cy'), r: num(m[0], 'r'),
  }))
  return { viewBox: attr(markup, 'viewBox'), ring: ring ? attr(ring, 'd') : null, strokes: attr(strokes, 'd'), eyes: circles }
}

const names = [
  'default', '', '  ', 'zz-alpha', 'zz-beta', 'forge', 'Researcher', 'a', 'z', 'bot-1', 'bot_2',
  'scribe', 'ops-agent', 'night-shift', 'ünïcode', 'very-long-profile-name-with-many-characters-0123456789',
  'x'.repeat(64), '0',
]

const colors = names.map(name => ({ name, color: profileColor(name) }))
const shapes = names.map(name => ({ name, shape: avatar.defaultShapeFor(name) }))

const appearances = [
  ['default', null], ['default', { custom: true, shape: 'hexagon', color: '#112233' }],
  ['zz-alpha', { shape: 'cloud', color: 'hsl(210 68% 58%)' }],
  ['forge', { title: 'Forge', shape: 'blobatar:abc:sun' }], ['scribe', { image: 'data:image/png;base64,AAAA' }],
].map(([name, meta]) => ({ name, meta, appearance: avatar.botAppearance(name, meta) }))

const ringShapes = ['circle', 'blob', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop', 'cube', 'octahedron', 'pebble', 'tetrahedron', 'icosahedron', 'unknown-shape']
const faceColors = ['#8b5cf6', '#1a1a1a', '#F97352']
const faces = []
for (const shape of ringShapes) {
  for (const color of faceColors) {
    for (const mood of ['idle', 'work']) {
      const markup = renderToStaticMarkup(React.createElement(avatar.BotFace, { shape, color, name: 'zz-alpha', mood, size: 40 }))
      faces.push({ shape, color, mood, face: extractRing(markup) })
    }
  }
}

const sigils = []
for (const [name, n] of [['zz-alpha', 0], ['zz-alpha', 3], ['forge', 7], ['forge', 12]]) {
  const shape = `sigil-${n}`
  const markup = renderToStaticMarkup(React.createElement(avatar.BotFace, { shape, color: '#84cc16', name, size: 40 }))
  sigils.push({ shape, name, face: extractSigil(markup) })
}

const out = join(root, 'src/lib/hermes/fixtures/golden-identity.json')
writeFileSync(out, JSON.stringify({ source: 'hermes-agent apps/desktop (avatar.tsx, profile-color.ts)', colors, shapes, appearances, faces, sigils }, null, 1) + '\n')
console.log(`wrote ${out}: ${colors.length} colors, ${faces.length} faces, ${sigils.length} sigils`)
