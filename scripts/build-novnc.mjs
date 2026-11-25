#!/usr/bin/env node
/**
 * Bundles noVNC and the bridge in `scripts/novnc-entry.js` into one self-contained HTML asset at `assets/web/novnc.html`,
 * which the app loads lazily into a WebView. No CDN: the page must work with nothing but the Hermes server reachable.
 * Run after changing the entry or the noVNC version.
 *
 *   npm run build:novnc
 *
 * ESM output is required: noVNC uses top-level await.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const built = await build({
  entryPoints: ['scripts/novnc-entry.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
})

// A literal "</script" inside the bundle would end the tag early.
const code = built.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:#2B2E34;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}#screen{position:fixed;inset:0}</style>
</head><body><div id="screen"></div><script type="module">${code}</script></body></html>`

mkdirSync('assets/web', { recursive: true })
writeFileSync('assets/web/novnc.html', html)
console.log(`wrote assets/web/novnc.html (${Math.round(html.length / 1024)} KB)`)
