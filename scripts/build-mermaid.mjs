#!/usr/bin/env node
/**
 * Copies Mermaid (the build npm ships as `dist/mermaid.min.js`) to `assets/web/mermaid.min.txt`, which the diagram
 * viewer loads on first use. No CDN: the page must work with nothing but the Hermes server reachable. Stored as a
 * bundled asset rather than inline JS so the startup bundle stays lean. Run after changing the mermaid version.
 *
 *   npm run build:mermaid
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const version = JSON.parse(readFileSync('node_modules/mermaid/package.json', 'utf8')).version
// A literal "</script" inside the library would end the page's script tag early.
const code = readFileSync('node_modules/mermaid/dist/mermaid.min.js', 'utf8').replace(/<\/script/gi, '<\\/script')

mkdirSync('assets/web', { recursive: true })
writeFileSync('assets/web/mermaid.min.txt', code)
console.log(`wrote assets/web/mermaid.min.txt: mermaid ${version}, ${(code.length / 1024 / 1024).toFixed(1)} MB`)
