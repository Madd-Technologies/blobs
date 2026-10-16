/**
 * `npm run capture:compose`: the designed store set, rendered from whatever the capture rig last wrote.
 *
 *   capture/out/iphone/screenshots/dark/*.png    →  store/app-store/iphone-6.9/01-home.png …   1320 x 2868, the 6.9" iPhone set
 *                                                   store/app-store/iphone-6.3/01-home.png …   1206 x 2622, the 6.3" iPhone set
 *   capture/out/iphone/clips/*.mp4               →  store/app-store/preview-iphone-6.9.mp4     886 x 1920, the App Store preview
 *   capture/out/android/screenshots/dark/*.png   →  store/google-play/phone/01-home.png …      1080 x 1920, 9:16 phone stills
 *                                                   store/google-play/feature-graphic.png     1024 x 500
 *                                                   store/contact-*.png                       each set side by side, to review
 *
 * The design is "Face colour" (capture/compose/set.ts); the compositions are Remotion (capture/compose/remotion/). Stills
 * come out as PNGs without alpha, and the preview is re-encoded to Apple's spec (H.264 High 4.0, 30 fps, 10-12 Mbps,
 * stereo AAC 256 kbps). A platform whose captures are missing is skipped with a note. Needs ffmpeg, as the rig does.
 *
 *   npm run capture:compose -- --only=app-store,feature     just these parts (app-store, preview, play, feature)
 *   npm run capture:compose -- --in <folder> --out <folder> read another rig's output, write elsewhere
 */

import { bundle } from '@remotion/bundler'
import { openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { OUTPUTS, PREVIEW, STILLS, timeline, type Platform } from './set.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PARTS = ['app-store', 'preview', 'play', 'feature'] as const
type Part = (typeof PARTS)[number]

const say = (line: string) => console.log(line)
const fail = (message: string): never => {
  console.error(`capture:compose: ${message}`)
  process.exit(1)
}

function options(argv: string[]) {
  let input = join(ROOT, 'capture/out')
  let output: string | undefined
  let only: Part[] = [...PARTS]

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    const value = () => argv[++index] ?? fail(`${arg} needs a value`)

    if (arg === '--in') {
      input = resolve(value())
    } else if (arg === '--out') {
      output = resolve(value())
    } else if (arg.startsWith('--only=')) {
      only = arg
        .slice('--only='.length)
        .split(',')
        .map(part => (PARTS as readonly string[]).includes(part) ? (part as Part) : fail(`unknown part "${part}" (${PARTS.join(', ')})`))
    } else {
      fail(`unknown option ${arg}`)
    }
  }

  return { input, output: output ?? join(input, 'store'), only: new Set(only) }
}

/** Width and height from a PNG's header. */
function pngSize(file: string): { width: number; height: number } {
  const header = Buffer.alloc(24)
  const fd = openSync(file, 'r')
  readSync(fd, header, 0, 24, 0)
  closeSync(fd)

  if (header.toString('latin1', 1, 4) !== 'PNG') {
    fail(`${file} is not a PNG`)
  }

  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

function probe(file: string): { width: number; height: number; duration: number } {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' })
  const json = JSON.parse(out) as { streams?: { width: number; height: number }[]; format?: { duration?: string } }
  const stream = json.streams?.[0] ?? fail(`no video in ${file}`)

  return { width: stream.width, height: stream.height, duration: Number(json.format?.duration ?? 0) }
}

const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })

async function main() {
  const { input, output, only } = options(process.argv.slice(2))

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  } catch {
    fail('ffmpeg is missing (brew install ffmpeg)')
  }

  if (!existsSync(input)) {
    fail(`no captures at ${input}: run npm run capture first`)
  }

  // Everything the compositions read is copied into one public folder: the captures they use and Geist.
  const stage = join(output, '.stage')
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })

  const staged = (from: string, to: string) => {
    mkdirSync(dirname(join(stage, to)), { recursive: true })
    copyFileSync(from, join(stage, to))

    return to
  }

  for (const font of ['Geist_400Regular.ttf', 'Geist_500Medium.ttf', 'Geist_700Bold.ttf']) {
    staged(join(ROOT, 'site/fonts', font), `fonts/${font}`)
  }

  const shotOf = (platform: Platform, name: string) => {
    const from = join(input, platform, 'screenshots/dark', `${name}.png`)

    return existsSync(from) ? { src: staged(from, `${platform}/screenshots/dark/${name}.png`), ...pngSize(from) } : null
  }

  const shots: Record<Platform, Map<string, NonNullable<ReturnType<typeof shotOf>>>> = { iphone: new Map(), android: new Map() }

  for (const platform of ['iphone', 'android'] as const) {
    for (const frame of STILLS) {
      const shot = shotOf(platform, frame.shot)

      if (shot) {
        shots[platform].set(frame.shot, shot)
      }
    }
  }

  const clips: Record<string, { src: string; width: number; height: number }> = {}
  const missingClips: string[] = []

  if (only.has('preview')) {
    for (const segment of PREVIEW) {
      const from = join(input, 'iphone/clips', `${segment.clip}.mp4`)

      if (!existsSync(from)) {
        missingClips.push(segment.clip)
        continue
      }

      const { width, height, duration } = probe(from)

      if (duration + 0.05 < segment.to) {
        fail(`${segment.clip}.mp4 is ${duration.toFixed(2)} s, but the preview plays it up to ${segment.to} s (PREVIEW in capture/compose/set.ts)`)
      }

      clips[segment.clip] = { src: staged(from, `iphone/clips/${segment.clip}.mp4`), width, height }
    }
  }

  say('Bundling the compositions…')
  const serveUrl = await bundle({ entryPoint: join(ROOT, 'capture/compose/remotion/index.ts'), publicDir: stage })
  const browser = await openBrowser('chrome')
  const written: string[] = []

  const still = async (id: string, inputProps: Record<string, unknown>, file: string) => {
    const composition = await selectComposition({ serveUrl, id, inputProps, puppeteerInstance: browser })
    const raw = join(stage, 'raw.png')
    mkdirSync(dirname(file), { recursive: true })
    await renderStill({ composition, serveUrl, inputProps, output: raw, imageFormat: 'png', overwrite: true, puppeteerInstance: browser })
    // The stores refuse an alpha channel: flatten to plain RGB.
    ffmpeg(['-i', raw, '-pix_fmt', 'rgb24', file])
    written.push(file)
  }

  const contactSheet = (files: string[], file: string) => {
    if (files.length < 2) {
      return
    }

    const inputs = files.flatMap(path => ['-i', path])
    const scaled = files.map((_, index) => `[${index}]scale=330:-1,pad=iw+(${index < files.length - 1 ? 16 : 0}):ih:0:0:color=0x232326[s${index}]`)
    ffmpeg([...inputs, '-filter_complex', `${scaled.join(';')};${files.map((_, index) => `[s${index}]`).join('')}hstack=inputs=${files.length}`, file])
    written.push(file)
  }

  const plan = (platform: Platform) => STILLS.flatMap((frame, index) => {
    const shot = shots[platform].get(frame.shot)

    return shot ? [{ frame, index, shot }] : []
  })

  if (only.has('app-store')) {
    const set = plan('iphone')

    if (set.length === 0) {
      say('App Store stills: skipped, no iPhone dark-pass screenshots.')
    } else {
      say(`App Store stills: ${set.length} of ${STILLS.length}…`)
      const files: string[] = []

      for (const { frame, index, shot } of set) {
        const file = join(output, 'app-store/iphone-6.9', `${frame.id}.png`)
        await still('AppStoreStill', { frame: index, platform: 'iphone', shot }, file)
        await still('AppStoreStill63', { frame: index, platform: 'iphone', shot }, join(output, 'app-store/iphone-6.3', `${frame.id}.png`))
        files.push(file)
      }

      contactSheet(files, join(output, 'contact-app-store.png'))
    }
  }

  if (only.has('play')) {
    const set = plan('android')

    if (set.length === 0) {
      say('Google Play stills: skipped, no Android dark-pass screenshots.')
    } else {
      say(`Google Play stills: ${set.length} of ${STILLS.length}…`)
      const files: string[] = []

      for (const { frame, index, shot } of set) {
        const file = join(output, 'google-play/phone', `${frame.id}.png`)
        await still('PlayStill', { frame: index, platform: 'android', shot }, file)
        files.push(file)
      }

      contactSheet(files, join(output, 'contact-google-play.png'))
    }
  }

  if (only.has('feature')) {
    // Google Play's own graphic, so the Android card when there is one.
    const approval = STILLS.find(frame => frame.cutout?.crop === 'approval')?.shot ?? '12-courier-approval'
    const platform: Platform | null = shots.android.has(approval) ? 'android' : shots.iphone.has(approval) ? 'iphone' : null

    if (!platform) {
      say('Feature graphic: skipped, no approval screenshot.')
    } else {
      say(`Feature graphic (approval card from the ${platform} capture)…`)
      await still('FeatureGraphic', { platform, shot: shots[platform].get(approval) }, join(output, 'google-play/feature-graphic.png'))
    }
  }

  if (only.has('preview')) {
    if (missingClips.length) {
      say(`App Store preview: skipped, missing clips ${missingClips.join(', ')}.`)
    } else {
      const { fps } = OUTPUTS.appStorePreview
      const seconds = timeline(PREVIEW, fps).total / fps
      say(`App Store preview: ${seconds.toFixed(1)} s…`)
      const inputProps = { clips }
      const composition = await selectComposition({ serveUrl, id: 'AppStorePreview', inputProps, puppeteerInstance: browser })
      const raw = join(stage, 'preview.mp4')
      let shown = -1

      await renderMedia({
        composition,
        serveUrl,
        inputProps,
        codec: 'h264',
        crf: 12,
        enforceAudioTrack: true,
        outputLocation: raw,
        overwrite: true,
        puppeteerInstance: browser,
        onProgress: ({ progress }) => {
          const step = Math.floor(progress * 10)

          if (step > shown) {
            shown = step
            process.stdout.write(`  ${step * 10}%${step === 10 ? '\n' : ''}`)
          }
        },
      })

      // Apple's spec for an iPhone 6.9" preview: 886 x 1920, H.264 High profile level 4.0, 30 fps, 10-12 Mbps, stereo AAC.
      const file = join(output, 'app-store/preview-iphone-6.9.mp4')
      mkdirSync(dirname(file), { recursive: true })
      ffmpeg([
        '-i', raw,
        '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.0', '-pix_fmt', 'yuv420p', '-r', String(fps), '-preset', 'slow',
        // Constant 11 Mbps: x264 would spend far less on footage this still, and Apple asks for 10-12 Mbps.
        '-b:v', '11M', '-minrate', '11M', '-maxrate', '11M', '-bufsize', '22M', '-x264-params', 'nal-hrd=cbr',
        '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart',
        file,
      ])
      written.push(file)
    }
  }

  await browser.close({ silent: true })
  rmSync(join(stage, 'raw.png'), { force: true })
  rmSync(join(stage, 'preview.mp4'), { force: true })

  say(`\nWrote ${written.length} files to ${relative(process.cwd(), output) || '.'}:`)

  for (const file of written) {
    say(`  ${relative(output, file)}`)
  }
}

await main()
