// Draws the native splash image, assets/splash-icon.png: Courier, the brand face (the website's favicon), on a transparent
// 1024 px square. The animated splash in the app (src/components/boot/BootSplash.tsx) starts from this exact drawing, at
// the size app.json gives it, so the hand-off from the native splash to the app cannot be seen.
// Run with `npm run build:splash` after changing the face, and commit the output. Needs Google Chrome (or CHROME=<path>).

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { blobatar } from 'blobatar/blob'

const SIZE = 1024
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Same face as CROWD.courier in src/features/tour/crowd.ts.
const svg = blobatar('blobs-2', { hue: 215, tone: 0.5, size: SIZE, traits: { shape: 0.8875 } })

const dir = mkdtempSync(join(tmpdir(), 'blobs-splash-'))
const page = join(dir, 'splash.html')
const out = resolve('assets/splash-icon.png')

writeFileSync(page, `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`)

try {
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${SIZE},${SIZE}`,
    '--default-background-color=00000000',
    `--screenshot=${out}`,
    `file://${page}`,
  ], { stdio: 'ignore' })
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`${out} written`)
