#!/usr/bin/env node
/**
 * Bundles pdf.js (pdfjs-dist, legacy build) and the page in `scripts/pdf-entry.js` into one self-contained HTML asset at
 * `assets/web/pdf.html`, which the app loads lazily into a WebView. The worker's code is inlined in the page (converted
 * into a module worker at runtime), so nothing comes from a CDN. Run after changing the entry or the pdf.js version.
 *
 *   npm run build:pdfjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const built = await build({
  entryPoints: ['scripts/pdf-entry.js'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  write: false,
  legalComments: 'none',
})

// A literal "</script" inside either script would end its tag early.
const escape = text => text.replace(/<\/script/gi, '<\\/script')
const code = escape(built.outputFiles[0].text)
const worker = escape(readFileSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'utf8'))

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=5,user-scalable=yes">
<style>html,body{margin:0;padding:0;background:#0A0A0A}#pages{display:flex;flex-direction:column;gap:10px;padding:10px 0 40px}.page{background:#fff;width:100%;position:relative}.page canvas{width:100%;height:100%;display:block}</style>
</head><body><div id="pages"></div>
<script type="text/plain" id="pdf-worker">${worker}</script>
<script type="module">${code}</script></body></html>`

mkdirSync('assets/web', { recursive: true })
writeFileSync('assets/web/pdf.html', html)
console.log(`wrote assets/web/pdf.html (${Math.round(html.length / 1024)} KB)`)
