#!/usr/bin/env node
/**
 * Bundles `mathjax-full` (liteAdaptor + TeX packages used by chats + SVG output) into a self-contained offline HTML
 * asset at `assets/web/math.html` so MathJax stays completely out of the Hermes app JS bundle.
 *
 *   npm run build:math
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const built = await build({
  entryPoints: ['scripts/math-entry.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  write: false,
  legalComments: 'none',
  banner: {
    js: 'globalThis.PACKAGE_VERSION="3.2.2";',
  },
})

const code = built.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${code}</script></body></html>`

mkdirSync('assets/web', { recursive: true })
writeFileSync('assets/web/math.html', html)
console.log(`wrote assets/web/math.html (${Math.round(html.length / 1024)} KB)`)
