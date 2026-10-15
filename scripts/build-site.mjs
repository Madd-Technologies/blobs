// Builds the landing page's generated assets in site/: the brand faces (an animated row for the hero and the README, a
// favicon) drawn with the same blobatar library and silhouettes as the app, and the self-hosted Geist fonts.
// Run with `npm run build:site` and commit the output: GitHub Pages serves site/ as it is, with no build step.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { blobatar } from 'blobatar/blob'

// Same trait positions as BLOB_KIND_TRAIT in src/lib/hermes/blob.ts.
const SHAPE = { round: 0.11, boxy: 0.54, cloud: 0.825, droplet: 0.8875, hexagon: 0.9325 }

// Five faces in mid tones that read on both the dark and the light canvas. No amber hues: amber means "needs you".
const FACES = [
  { seed: 'blobs-1', shape: 'cloud', hue: 175 },
  { seed: 'blobs-2', shape: 'droplet', hue: 215, needsYou: true },
  { seed: 'blobs-3', shape: 'hexagon', hue: 20 },
  { seed: 'blobs-4', shape: 'boxy', hue: 330 },
  { seed: 'blobs-5', shape: 'round', hue: 265 },
]

const AMBER = '#FFB020'

function face({ seed, shape, hue }) {
  const svg = blobatar(seed, { hue, tone: 0.5, traits: { shape: SHAPE[shape] } })
  const groups = svg.match(/<g\b[^>]*>[\s\S]*?<\/g>/g)

  if (groups?.length !== 2) {
    throw new Error(`blobatar changed shape: expected a body and an eyes group for ${seed}`)
  }

  return { body: groups[0], eyes: groups[1].replace('<g ', '<g class="eyes" ') }
}

// The row: each face bobs and blinks on its own clock, the way a crowd of bots idles in the app. Static under reduced
// motion. CSS inside the SVG keeps it working as a plain <img>, which is all a GitHub README allows.
function row() {
  const size = 100
  const gap = 28
  const width = FACES.length * size + (FACES.length - 1) * gap
  const items = FACES.map((spec, index) => {
    const { body, eyes } = face(spec)
    const dot = spec.needsYou ? `<circle cx="86" cy="22" r="7" fill="${AMBER}"/>` : ''

    return `<g transform="translate(${index * (size + gap)} 6)"><g class="face" style="animation-delay:${-index * 0.7}s">${body}${eyes}${dot}</g></g>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${size + 12}" width="${width}" height="${size + 12}" role="img" aria-label="Five Blobs bot faces">
<style>
.face{animation:bob 3.6s ease-in-out infinite}
.eyes{transform-box:fill-box;transform-origin:center;animation:blink 5.2s infinite}
g:nth-child(2) .eyes{animation-delay:-1.3s}
g:nth-child(3) .eyes{animation-delay:-3.1s}
g:nth-child(4) .eyes{animation-delay:-0.6s}
g:nth-child(5) .eyes{animation-delay:-2.2s}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}
@media (prefers-reduced-motion:reduce){.face,.eyes{animation:none}}
</style>
${items.join('\n')}
</svg>
`
}

function favicon() {
  const { body, eyes } = face(FACES[1])

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}${eyes}</svg>\n`
}

mkdirSync('site/assets', { recursive: true })
mkdirSync('site/fonts', { recursive: true })
writeFileSync('site/assets/blobs.svg', row())
writeFileSync('site/favicon.svg', favicon())

// One still face per file, for the app moments drawn on the page.
FACES.forEach((spec, index) => {
  const { body, eyes } = face(spec)
  writeFileSync(`site/assets/face-${index + 1}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}${eyes}</svg>\n`)
})

const fonts = [
  ['geist', '400Regular/Geist_400Regular.ttf'],
  ['geist', '500Medium/Geist_500Medium.ttf'],
  ['geist', '600SemiBold/Geist_600SemiBold.ttf'],
  ['geist', '700Bold/Geist_700Bold.ttf'],
  ['geist-mono', '400Regular/GeistMono_400Regular.ttf'],
]

for (const [family, file] of fonts) {
  copyFileSync(`node_modules/@expo-google-fonts/${family}/${file}`, `site/fonts/${file.split('/')[1]}`)
}

copyFileSync('node_modules/@expo-google-fonts/geist/LICENSE_FONT', 'site/fonts/OFL.txt')

// blobatar for the page itself (the crowd and "make your blob"): its self-contained renderer, without the source map line.
mkdirSync('site/vendor', { recursive: true })
const { version } = JSON.parse(readFileSync('node_modules/blobatar/package.json', 'utf8'))
const renderer = readFileSync('node_modules/blobatar/dist/blob.js', 'utf8').replace(/\n\/\/# (debugId|sourceMappingURL)=.*$/gm, '')
writeFileSync('site/vendor/blobatar.js', `// blobatar ${version} (MIT), https://www.npmjs.com/package/blobatar. Licence: vendor/blobatar-LICENSE.txt\n${renderer}`)
copyFileSync('node_modules/blobatar/LICENSE', 'site/vendor/blobatar-LICENSE.txt')
console.log('site/: blobs.svg, favicon.svg, fonts and vendor/blobatar.js written')
