#!/usr/bin/env node
/**
 * The capture rig (docs/CAPTURE.md). Maestro flows in capture/flows/ drive the Release app through each moment of the
 * storyboard against the demo Hermes (docs/DEMO.md); this script runs them and writes store screenshots and one clip per
 * moment to capture/out/<phone>/ (git-ignored).
 *
 *   npm run capture                    both phones, each from its own reset of the demo: every moment in light
 *                                      (screenshots), then dark (screenshots and clips). Dark goes last: only the last
 *                                      pass allows Courier's push and sends the room message, which a reset brings back.
 *   npm run capture -- --platform=android   one phone: iphone or android (comma-separated for both, the default)
 *   npm run capture -- home room       only these moments
 *   npm run capture -- --no-reset      use the demo as it is (its waiting states must still be live: npm run demo:status)
 *   npm run capture -- --no-clips      screenshots only
 *   npm run capture -- --themes=dark   one theme (the last one listed records and acts)
 *   npm run capture:build              build the Release app and install it on each phone (--platform= works here too)
 *   npm run capture -- recut           cut the clips again from the raw recordings (after changing LEAD_IN or HOLD)
 *
 * It only talks to the demo Hermes on 127.0.0.1 and only drives devices of its own (a simulator and an emulator), so
 * nothing real is ever on screen.
 */
import { spawn, spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FLOWS = join(ROOT, 'capture', 'flows')
const DEMO = join(ROOT, 'scripts', 'demo', 'demo.sh')
const APP_ID = 'com.maddtechnologies.blobs'
const DEMO_ROOT = process.env.DEMO_ROOT ?? join(homedir(), 'blobs-demo')
const DEMO_PORT = process.env.DEMO_PORT ?? '9219'
const DEMO_URL = `http://127.0.0.1:${DEMO_PORT}`
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'
// A bot dozes after 6 hours without activity (src/features/face/motion.ts); a reset runs Ember's routine just now.
const DOZE = { bot: 'ember', hoursAgo: 8 }

/**
 * The storyboard's moments, in the order they run: each is capture/flows/<name>.yaml and becomes one clip. The ones that
 * change the demo (the room message, Courier's push) come last.
 */
const MOMENTS = ['home', 'forge', 'scribe', 'dashboard', 'ember', 'room', 'courier'] as const
type Moment = (typeof MOMENTS)[number]
type Theme = 'dark' | 'light'

interface Pass {
  theme: Theme
  /** Only the last pass records clips. */
  last: boolean
  /** Whether this pass may do what can only happen once per reset (the last pass on a freshly reset demo). */
  act: boolean
}

// Seconds of footage kept before a flow's "clip start" and after its "clip end".
const LEAD_IN = 0.4
const HOLD = 0.6

// ── command line ─────────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const command = args[0] === 'build' || args[0] === 'device' || args[0] === 'recut' ? args[0] : 'capture'

function say(message: string) {
  console.log(`capture: ${message}`)
}

function fail(message: string): never {
  console.error(`capture: ${message}`)
  process.exit(1)
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Runs a command to completion, its output on this terminal unless `quiet`; returns stdout when captured. It throws on
 * failure (rather than exiting) so a recording in progress is still stopped.
 */
function run(file: string, argv: string[], options: SpawnSyncOptions & { quiet?: boolean; allowFail?: boolean } = {}): string {
  const result = spawnSync(file, argv, { encoding: 'utf8', stdio: options.quiet ? 'pipe' : 'inherit', ...options })

  if (result.error) {
    throw new Error(`${file} could not start: ${result.error.message}`)
  }

  if (result.status !== 0 && !options.allowFail) {
    throw new Error(`${basename(file)} ${argv[0] ?? ''} failed (exit ${result.status})${options.quiet && result.stderr ? `:\n${String(result.stderr).trim()}` : ''}`)
  }

  return String(result.stdout ?? '')
}

/** Waits until `ready` says yes, checking every `every` ms; throws `message` after `timeout` ms. */
async function waitFor(ready: () => boolean, timeout: number, message: string, every = 2000) {
  const until = Date.now() + timeout

  while (!ready()) {
    if (Date.now() > until) {
      throw new Error(message)
    }

    await sleep(every)
  }
}

// ── the phones ───────────────────────────────────────────────────────────────────────────────────

type Platform = 'iphone' | 'android'

interface Recording {
  /** When the first frame was taken (epoch ms, this Mac's clock, like Maestro's timestamps). */
  startedAt: number
  /** Stops recording and leaves the finished file where it was asked for. */
  stop: () => Promise<void>
}

/** One phone the rig drives: always a device of its own, never a shared simulator or a real phone. */
interface Phone {
  platform: Platform
  /** The device's name, for messages. */
  label: string
  /** Creates the device if needed, boots it and cleans its status bar; returns the id Maestro takes as --device. */
  boot: () => Promise<string>
  /** Builds the Release app and installs it. */
  build: (id: string) => void
  installed: (id: string) => boolean
  /** Quits the app if the device is up, without booting it (before a reset, for every phone). */
  quit: () => void
  appearance: (id: string, theme: Theme) => void
  /** Runs the signin flow with the demo password made available to it, and leaves nothing of it behind. */
  signIn: (id: string, debug: string) => Promise<void>
  record: (id: string, file: string) => Promise<Recording>
  /** Acts on requests a flow prints while it runs, for one run of a flow (Android's "adb tap" labels). */
  watcher?: (id: string) => (output: string) => void
}

// ── the iPhone: a simulator of the rig's own ─────────────────────────────────────────────────────

/**
 * 6.9", the size App Store Connect requires screenshots for. Phones only for now (decided 2026-10-15): tablets come
 * later.
 */
const SIMULATOR = { name: 'Blobs Capture 17 Pro Max', type: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max' }

interface SimDevice {
  udid: string
  name: string
  state: string
}

function findSimulator(): SimDevice | undefined {
  const list = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '-j'], { quiet: true })) as { devices: Record<string, SimDevice[]> }

  return Object.values(list.devices)
    .flat()
    .find(entry => entry.name === SIMULATOR.name)
}

/** The newest iOS runtime installed, for a device the rig creates. */
function newestRuntime(): string {
  const list = JSON.parse(run('xcrun', ['simctl', 'list', 'runtimes', '-j'], { quiet: true })) as {
    runtimes: { identifier: string; platform: string; version: string; isAvailable: boolean }[]
  }
  const ios = list.runtimes.filter(runtime => runtime.platform === 'iOS' && runtime.isAvailable)
  const newest = ios.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true })).at(-1)

  return newest?.identifier ?? fail('no iOS simulator runtime is installed (Xcode > Settings > Components)')
}

/** Creates the rig's simulator if needed, boots it and gives it Apple's clean status bar. */
function bootSimulator(): string {
  let sim = findSimulator()

  if (!sim) {
    const udid = run('xcrun', ['simctl', 'create', SIMULATOR.name, SIMULATOR.type, newestRuntime()], { quiet: true }).trim()
    say(`created the simulator "${SIMULATOR.name}" (${udid})`)
    sim = { udid, name: SIMULATOR.name, state: 'Shutdown' }
  }

  if (sim.state !== 'Booted') {
    run('xcrun', ['simctl', 'boot', sim.udid])
  }

  // Headless: Maestro, screenshots and recordings need no Simulator window.
  run('xcrun', ['simctl', 'bootstatus', sim.udid, '-b'], { quiet: true })
  run('xcrun', ['simctl', 'status_bar', sim.udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3',
    '--cellularMode', 'active', '--cellularBars', '4', '--operatorName', '', '--batteryState', 'charged', '--batteryLevel', '100'])

  return sim.udid
}

/** A Release build (no Metro, no dev menu) for the simulator, arm64 only, its build folder in the git-ignored ios/. */
function buildIos(udid: string) {
  const ios = join(ROOT, 'ios')
  const env = { ...process.env, CI: '1', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', RCT_METRO_PORT: '8084' }

  // Every time: it carries app.json changes (the name, the icon, supportsTablet) into ios/ and installs pods as needed.
  say('bringing ios/ up to date with app.json (npx expo prebuild)')
  run('npx', ['expo', 'prebuild', '--platform', 'ios'], { cwd: ROOT, env })

  const workspace = readdirSync(ios).find(name => name.endsWith('.xcworkspace')) ?? fail('ios/ has no .xcworkspace')
  const scheme = workspace.replace(/\.xcworkspace$/, '')
  say(`building ${scheme} (Release, simulator, arm64): several minutes the first time`)
  run('xcodebuild', ['-workspace', workspace, '-scheme', scheme, '-configuration', 'Release', '-sdk', 'iphonesimulator',
    '-destination', `id=${udid}`, '-derivedDataPath', 'build', 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES', 'COMPILER_INDEX_STORE_ENABLE=NO',
    '-quiet', 'build'], { cwd: ios, env })

  const app = join(ios, 'build', 'Build', 'Products', 'Release-iphonesimulator', `${scheme}.app`)
  run('xcrun', ['simctl', 'install', udid, app])
  say(`installed ${scheme}.app on "${SIMULATOR.name}"`)
}

/** Starts the simulator's own screen recorder (full resolution, the unmasked rectangle); resolves once it records. */
async function recordSimulator(udid: string, file: string): Promise<Recording> {
  // A run that was killed can leave its recorder going, and the simulator then refuses a second one (exit 16).
  const pattern = `simctl io ${udid} recordVideo`

  if (spawnSync('pkill', ['-INT', '-f', pattern]).status === 0) {
    say('stopped a recording left over from an earlier run')

    while (spawnSync('pgrep', ['-f', pattern], { stdio: 'ignore' }).status === 0) {
      await sleep(250)
    }
  }

  const child = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--mask=ignored', '--force', file], { stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))

  await new Promise<void>((resolve, reject) => {
    const listen = (chunk: Buffer) => {
      if (chunk.toString().includes('Recording started')) {
        resolve()
      }
    }

    child.stdout.on('data', listen)
    child.stderr.on('data', listen)
    child.once('exit', code => reject(new Error(`the recorder stopped before it started (exit ${code})`)))
  })

  return {
    startedAt: Date.now(),
    stop: async () => {
      child.kill('SIGINT')
      await exited
    },
  }
}

const iphone: Phone = {
  platform: 'iphone',
  label: SIMULATOR.name,
  boot: async () => bootSimulator(),
  build: buildIos,
  installed: udid => spawnSync('xcrun', ['simctl', 'get_app_container', udid, APP_ID], { stdio: 'ignore' }).status === 0,
  quit: () => {
    const sim = findSimulator()

    if (sim?.state === 'Booted') {
      run('xcrun', ['simctl', 'terminate', sim.udid, APP_ID], { quiet: true, allowFail: true })
    }
  },
  appearance: (udid, theme) => run('xcrun', ['simctl', 'ui', udid, 'appearance', theme]),
  signIn: async (udid, debug) => {
    // The password goes onto the simulator's pasteboard (never through this process) for the flow to paste, and comes
    // off it again straight after.
    run(DEMO, ['password', '--sim', udid])

    try {
      await maestro(udid, 'signin', { DEMO_URL }, debug)
    } finally {
      spawnSync('xcrun', ['simctl', 'pbcopy', udid], { input: '' })
    }
  },
  record: recordSimulator,
}

// ── the Android phone: an emulator of the rig's own ──────────────────────────────────────────────

const SDK = process.env.ANDROID_HOME ?? '/opt/homebrew/share/android-commandlinetools'
const ADB = join(SDK, 'platform-tools', 'adb')
const ANDROID_ENV = { ...process.env, JAVA_HOME, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK }
const AVD_HOME = process.env.ANDROID_AVD_HOME ?? join(homedir(), '.android', 'avd')

/**
 * The rig's own AVD, on its own console port, so its serial is always emulator-5584 and it never fights other work for
 * an emulator (or gets mistaken for a phone). 9:16 at 1440 x 2560, 560 dpi (the Pixel XL's screen, 411 x 731 dp):
 * Google Play promotes listings whose portrait screenshots are 9:16 and at least 1080 x 1920, and refuses any whose
 * long side is more than twice the short one, which today's 20:9 phones are.
 */
const AVD = {
  name: 'blobs_capture_phone',
  label: 'Blobs Capture Phone',
  profile: 'pixel_xl',
  port: 5584,
  /** config.ini settings over the profile's: a cold boot every time (no snapshots on disk), the host GPU, no mic. */
  config: {
    'avd.ini.displayname': 'Blobs Capture Phone',
    'hw.ramSize': '3G',
    'hw.gpu.enabled': 'yes',
    'hw.gpu.mode': 'host',
    'hw.keyboard': 'no',
    'hw.audioInput': 'no',
    'hw.camera.back': 'none',
    'hw.camera.front': 'none',
    'disk.dataPartition.size': '6G',
    'showDeviceFrame': 'no',
    'fastboot.forceColdBoot': 'yes',
    'fastboot.forceFastBoot': 'no',
    'firstboot.saveToLocalSnapshot': 'no',
  } as Record<string, string>,
}
const SERIAL = `emulator-${AVD.port}`

/** adb, always aimed at the rig's emulator and nothing else. */
function adb(argv: string[], options: SpawnSyncOptions & { quiet?: boolean; allowFail?: boolean } = {}): string {
  return run(ADB, ['-s', SERIAL, ...argv], { quiet: true, env: ANDROID_ENV, ...options })
}

/** The newest Google APIs arm64 system image installed, as an sdkmanager package path. */
function newestImage(): string {
  const images = join(SDK, 'system-images')
  const level = (name: string) => (name.match(/^android-(\d+)(?:-ext(\d+))?/) ?? []).slice(1).map(Number)
  const installed = existsSync(images)
    ? readdirSync(images).filter(name => existsSync(join(images, name, 'google_apis', 'arm64-v8a', 'system.img')))
    : []
  const newest = installed.sort((a, b) => {
    const [x = 0, xe = 0] = level(a)
    const [y = 0, ye = 0] = level(b)

    return x - y || xe - ye
  }).at(-1)

  return newest
    ? `system-images;${newest};google_apis;arm64-v8a`
    : fail('no Google APIs arm64 system image is installed: sdkmanager "system-images;android-36;google_apis;arm64-v8a" (about 4 GB)')
}

/** Creates the rig's AVD if it is missing, and keeps its config.ini on the rig's settings. */
function ensureAvd() {
  const folder = join(AVD_HOME, `${AVD.name}.avd`)

  if (!existsSync(join(AVD_HOME, `${AVD.name}.ini`))) {
    const image = newestImage()
    const local = join(SDK, 'cmdline-tools', 'latest', 'bin', 'avdmanager')
    run(existsSync(local) ? local : 'avdmanager', ['create', 'avd', '--name', AVD.name, '--package', image, '--device', AVD.profile], {
      quiet: true,
      env: ANDROID_ENV,
      input: 'no\n',
    })
    say(`created the emulator "${AVD.label}" (${AVD.profile} on ${image})`)
  }

  const file = join(folder, 'config.ini')
  const lines = readFileSync(file, 'utf8').split('\n').filter(line => line && !(line.replace(/=.*/, '') in AVD.config))
  writeFileSync(file, `${[...lines, ...Object.entries(AVD.config).map(([key, value]) => `${key}=${value}`)].join('\n')}\n`)
}

/** Whether the rig's emulator is up and answering adb. */
function emulatorUp(): boolean {
  return spawnSync(ADB, ['-s', SERIAL, 'get-state'], { encoding: 'utf8', env: ANDROID_ENV }).stdout?.trim() === 'device'
}

/**
 * Boots the rig's emulator if it is not running (headless; it keeps running between runs, like the simulator) and sets it
 * up for capturing. Refuses anything on its serial that is not the rig's own AVD.
 */
async function bootEmulator(): Promise<string> {
  const booting = !emulatorUp()

  if (booting) {
    ensureAvd()
    mkdirSync(join(ROOT, 'capture', 'out'), { recursive: true })
    const log = openSync(join(ROOT, 'capture', 'out', 'emulator.log'), 'w')
    spawn(join(SDK, 'emulator', 'emulator'), ['-avd', AVD.name, '-port', String(AVD.port), '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot',
      '-gpu', 'host'], { detached: true, stdio: ['ignore', log, log], env: ANDROID_ENV }).unref()
    say(`booting the emulator "${AVD.label}" (headless, a minute or two)`)
    await waitFor(emulatorUp, 180_000, `the emulator did not come up (capture/out/emulator.log)`)
  }

  const name = adb(['emu', 'avd', 'name'], { allowFail: true }).split(/\r?\n/)[0]?.trim()

  if (name !== AVD.name) {
    fail(`${SERIAL} is not the rig's emulator (it runs "${name || 'unknown'}"); stop it or free port ${AVD.port}`)
  }

  await waitFor(() => adb(['shell', 'getprop', 'sys.boot_completed'], { allowFail: true }).trim() === '1', 300_000, 'the emulator did not finish booting')

  if (booting) {
    // SystemUI is still putting its status bar together for a while after the boot; demo mode set up that early can
    // leave a second wifi icon behind.
    await sleep(15_000)
  }

  await setUpEmulator()

  return SERIAL
}

/**
 * Every run, since a reboot forgets some of it: awake and unlocked, gesture navigation, no autofill sheet ("Save
 * password?"), no spell-check underlines, no last character shown in a password field, and SystemUI's demo mode for a
 * clean status bar: 9:41, full battery and wifi, no notification icons. The mobile signal is hidden: this SystemUI
 * always draws a data type ("3G") beside it. One shell, its script on stdin, run again until SystemUI says it is in demo
 * mode: just after a boot it can drop all of it.
 */
async function setUpEmulator() {
  const demo = (command: string, extras: string) => `am broadcast -a com.android.systemui.demo -e command ${command} ${extras} >/dev/null`
  const script = [
    'svc power stayon true',
    'settings put system screen_off_timeout 2147483647',
    'wm dismiss-keyguard',
    'cmd overlay enable com.android.internal.systemui.navbar.gestural',
    'settings put secure autofill_service null',
    'settings put secure spell_checker_enabled 0',
    'settings put system show_password 0',
    'settings put global sysui_demo_allowed 1',
    // From a clean slate: demo mode keeps what an earlier run set.
    demo('exit', ''),
    demo('enter', ''),
    demo('clock', '-e hhmm 0941'),
    demo('battery', '-e level 100 -e plugged false -e powersave false'),
    demo('network', '-e wifi show -e level 4 -e fully true'),
    demo('network', '-e mobile hide'),
    demo('notifications', '-e visible false'),
    demo('status', '-e volume hide -e bluetooth hide -e location hide -e alarm hide -e sync hide -e mute hide -e speakerphone hide'),
    'exit',
  ]
  await waitFor(() => {
    adb(['shell'], { input: `${script.join('\n')}\n` })

    // Filtered on the emulator: the whole dump is about a megabyte.
    return adb(['shell', 'dumpsys activity service com.android.systemui | grep isInDemoMode'], { allowFail: true }).includes('isInDemoMode=true')
  }, 120_000, 'SystemUI did not take its demo mode (the clean status bar)', 3000)
  // The app reaches the demo on this Mac's 127.0.0.1 through adb, as if it were the emulator's own.
  adb(['reverse', `tcp:${DEMO_PORT}`, `tcp:${DEMO_PORT}`])
}

/** A Release APK (no Metro, no dev menu), arm64 only, its build output in the git-ignored android/. */
function buildAndroid(serial: string) {
  const env = { ...ANDROID_ENV, CI: '1', RCT_METRO_PORT: '8084' }

  say('bringing android/ up to date with app.json (npx expo prebuild)')
  run('npx', ['expo', 'prebuild', '--platform', 'android'], { cwd: ROOT, env })
  say('building the Release APK (arm64): several minutes the first time')
  run('./gradlew', ['assembleRelease', '-PreactNativeArchitectures=arm64-v8a', '--console=plain', '--quiet'], { cwd: join(ROOT, 'android'), env })

  const apk = join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  run(ADB, ['-s', serial, 'install', '-r', apk], { env: ANDROID_ENV })
  say(`installed app-release.apk on "${AVD.label}"`)
}

/**
 * Whether a password field of the app has the keyboard's focus. Read from the input method service, not the view
 * hierarchy: Maestro holds the device's only UI automation connection while its flow runs.
 */
function passwordFieldFocused(): boolean {
  const state = adb(['shell', 'dumpsys', 'input_method'], { allowFail: true })
  // The field being edited: "curEditorInfo:", then its inputType and, a few lines on, its app's packageName.
  const editor = state.match(/curEditorInfo:?\s*\n((?:[ \t]+[^\n]*\n){1,8})/i)?.[1] ?? ''
  const inputType = parseInt(editor.match(/inputType=0x([0-9a-f]+)/)?.[1] ?? '0', 16)

  // 0x80 is TYPE_TEXT_VARIATION_PASSWORD (0x81 with TYPE_CLASS_TEXT, as React Native's secureTextEntry sets it).
  return editor.includes(`packageName=${APP_ID} `) && (inputType & 0xff0) === 0x80
}

/** Records with Android's screenrecord on the emulator (it stops by itself at 3 minutes; each moment is far shorter). */
async function recordEmulator(serial: string, file: string): Promise<Recording> {
  const remote = '/sdcard/blobs-capture.mp4'
  adb(['shell', 'pkill', '-INT', 'screenrecord'], { allowFail: true })

  const child = spawn(ADB, ['-s', serial, 'shell', 'screenrecord', '--verbose', '--bit-rate', '20000000', '--time-limit', '180', remote], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: ANDROID_ENV,
  })
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))

  // With --verbose it reports the content area just before the first frame.
  await new Promise<void>((resolve, reject) => {
    const listen = (chunk: Buffer) => {
      if (chunk.toString().includes('Content area is')) {
        resolve()
      }
    }

    child.stdout.on('data', listen)
    child.stderr.on('data', listen)
    child.once('exit', code => reject(new Error(`screenrecord stopped before it started (exit ${code})`)))
  })

  return {
    startedAt: Date.now(),
    stop: async () => {
      // SIGINT lets screenrecord finish the file; the adb shell running it ends when it does.
      adb(['shell', 'pkill', '-INT', 'screenrecord'], { allowFail: true })
      await exited
      adb(['pull', remote, file])
      adb(['shell', 'rm', '-f', remote], { allowFail: true })
    },
  }
}

/**
 * Taps for a flow's "adb tap <x>%,<y>%" labels the moment Maestro prints them (Maestro fills no variables into labels,
 * so each is written out in its flow). adb's tap lands at once; Maestro's own taps and swipes wait about ten seconds,
 * before or after, while anything on screen moves, and the faces always do.
 */
function adbTapper(serial: string): (output: string) => void {
  const [, width = 0, height = 0] = (adb(['shell', 'wm', 'size']).match(/(\d+)x(\d+)/) ?? []).map(Number)
  let done = 0

  return output => {
    const requests = [...output.matchAll(/adb tap (\d+(?:\.\d+)?)%,(\d+(?:\.\d+)?)%/g)]

    for (const [, x, y] of requests.slice(done)) {
      run(ADB, ['-s', serial, 'shell', 'input', 'tap', String(Math.round((width * Number(x)) / 100)), String(Math.round((height * Number(y)) / 100))], {
        quiet: true,
        env: ANDROID_ENV,
      })
    }

    done = requests.length
  }
}

const android: Phone = {
  platform: 'android',
  label: AVD.label,
  boot: bootEmulator,
  build: buildAndroid,
  installed: serial => run(ADB, ['-s', serial, 'shell', 'pm', 'path', APP_ID], { quiet: true, allowFail: true, env: ANDROID_ENV }).includes('package:'),
  quit: () => {
    if (emulatorUp()) {
      adb(['shell', 'am', 'force-stop', APP_ID], { allowFail: true })
    }
  },
  appearance: (_serial, theme) => {
    adb(['shell', 'cmd', 'uimode', 'night', theme === 'dark' ? 'yes' : 'no'])
  },
  signIn: async (serial, debug) => {
    // Android has no pasteboard to fill from outside. The flow focuses the password field and waits; once Android says
    // a password field of the app has the keyboard, demo.sh types the password into it (on the emulator shell's stdin,
    // never on a command line) and Go is pressed. Nothing is put on any clipboard.
    const flow = maestro(serial, 'signin', { DEMO_URL }, debug)
    let finished = false
    flow.then(() => (finished = true), () => (finished = true))

    while (!finished) {
      if (passwordFieldFocused()) {
        run(DEMO, ['password', '--adb', serial], { env: { ...process.env, ADB } })
        adb(['shell', 'input', 'keyevent', 'KEYCODE_ENTER'])
        break
      }

      await sleep(500)
    }

    await flow
  },
  record: recordEmulator,
  watcher: adbTapper,
}

const PHONES: Record<Platform, Phone> = { iphone, android }

// ── the demo ─────────────────────────────────────────────────────────────────────────────────────

/** Whether someone else is resetting the demo right now (another checkout's demo.sh, or its seeder). */
function demoResetRunning(): boolean {
  return ['scripts/demo/demo.sh reset', 'scripts/demo/seed.ts'].some(pattern => spawnSync('pgrep', ['-f', pattern], { stdio: 'ignore' }).status === 0)
}

/** Back to the seeded world, then Ember dozing. Every run starts from exactly this. */
async function resetDemo() {
  // The app must not be open while the seeder works: it would reconnect and take over the bots' chats (Forge's run then
  // reads idle). So it is quit on every phone of the rig, whichever one this run is for.
  for (const phone of Object.values(PHONES)) {
    phone.quit()
  }

  if (demoResetRunning()) {
    say('someone else is resetting the demo; waiting for that to finish')

    while (demoResetRunning()) {
      await sleep(3000)
    }
  }

  say('resetting the demo Hermes (about 90 s)')
  run(DEMO, ['reset'])
  run(DEMO, ['status'])
  run(join(DEMO_ROOT, 'hermes-agent', 'venv', 'bin', 'python'), ['-I', join(ROOT, 'capture', 'lib', 'doze.py'), join(DEMO_ROOT, 'home'), DOZE.bot,
    String(DOZE.hoursAgo)])
}

// ── maestro ──────────────────────────────────────────────────────────────────────────────────────

const MAESTRO_ENV = {
  ...ANDROID_ENV,
  MAESTRO_CLI_NO_ANALYTICS: '1',
  MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
  // The first run installs Maestro's driver on the device, which can take a while.
  MAESTRO_DRIVER_STARTUP_TIMEOUT: '180000',
}

/**
 * Runs one flow on a phone of the rig. Maestro writes its debug output to `debug/<flow name>/`: `commands.json` (each
 * command with its timestamp) and `takeScreenshot/<name>.png` for every screenshot the flow takes (Maestro 2 only
 * writes screenshots inside its own output folder). `watch`, when given, sees Maestro's output so far as it comes.
 */
function maestro(id: string, flow: string, env: Record<string, string>, debug: string, watch?: (output: string) => void): Promise<void> {
  rmSync(debug, { recursive: true, force: true })
  mkdirSync(debug, { recursive: true })
  const vars = Object.entries({ APP_ID, ...env }).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  const child = spawn('maestro', ['--device', id, 'test', '--no-ansi', '--debug-output', debug, '--flatten-debug-output', ...vars, join(FLOWS, `${flow}.yaml`)], {
    env: MAESTRO_ENV,
    stdio: ['inherit', watch ? 'pipe' : 'inherit', 'inherit'],
  })
  let output = ''

  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk)
    output += chunk.toString()
    watch?.(output)
  })

  return new Promise((resolve, reject) => {
    child.once('error', error => reject(new Error(`maestro could not start: ${error.message}`)))
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`maestro test ${flow} failed (exit ${code})`))))
  })
}

/** Every file under `dir` whose path matches. */
function findFiles(dir: string, match: (path: string) => boolean): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map(path => join(dir, path))
    .filter(match)
}

/** Copies the screenshots a flow took into `into`, by the names the flow gave them. */
function collectScreenshots(debug: string, into: string): string[] {
  mkdirSync(into, { recursive: true })

  return findFiles(debug, path => path.includes(`${sep}takeScreenshot${sep}`) && path.endsWith('.png')).map(path => {
    const target = join(into, basename(path))
    copyFileSync(path, target)

    return basename(path, '.png')
  })
}

interface CommandRecord {
  command?: Record<string, { label?: string } | undefined>
  metadata?: { status?: string; timestamp?: number; duration?: number }
}

/** When the flow passed its "clip start" and "clip end" marks (epoch ms), from Maestro's debug output. */
function clipMarks(debug: string): { start: number; end: number } {
  const marks: Record<string, number> = {}

  for (const file of findFiles(debug, path => basename(path) === 'commands.json')) {
    for (const record of JSON.parse(readFileSync(file, 'utf8')) as CommandRecord[]) {
      const label = Object.values(record.command ?? {}).find(value => value?.label)?.label
      const at = record.metadata?.timestamp

      if ((label === 'clip start' || label === 'clip end') && at) {
        marks[label] = at + (label === 'clip end' ? (record.metadata?.duration ?? 0) : 0)
      }
    }
  }

  const start = marks['clip start']
  const end = marks['clip end']

  return start && end && end > start ? { start, end } : fail(`no "clip start" and "clip end" marks in ${debug}`)
}

// ── clips ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Cuts a raw recording to its moment (seconds from the start of the recording), as constant 60 fps H.264, which is what
 * editors and the stores want. Both recorders only write a frame when the screen changes, so a raw recording is variable
 * frame rate with long gaps where nothing moved. It is made constant first and then cut by time, from the start
 * (seeking with -ss loses time in those gaps), and its last frame is held in case the cut runs past the end.
 */
function trim(raw: string, clip: string, from: number, to: number) {
  const start = Math.max(0, from - LEAD_IN)
  const filter = `fps=60,tpad=stop_mode=clone:stop_duration=60,trim=start=${start.toFixed(3)}:end=${(to + HOLD).toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p`
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', filter, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-movflags', '+faststart', '-an', clip])
}

const clipName = (moment: Moment) => `${String(MOMENTS.indexOf(moment) + 1).padStart(2, '0')}-${moment}.mp4`

// ── one moment ───────────────────────────────────────────────────────────────────────────────────

async function capture(phone: Phone, id: string, out: string, moment: Moment, pass: Pass, clips: boolean) {
  const debug = join(out, 'logs', `${pass.theme}-${moment}`)
  // ACT lets the flow do what can only happen once per reset (send the room message, allow the push).
  const env = { THEME: pass.theme, ACT: String(pass.act) }
  const record = clips && pass.last
  say(`${phone.platform}: ${moment} (${pass.theme}${record ? ', recording' : ''})`)

  if (!record) {
    await maestro(id, moment, env, debug, phone.watcher?.(id))
  } else {
    mkdirSync(join(out, 'raw'), { recursive: true })
    mkdirSync(join(out, 'clips'), { recursive: true })
    const raw = join(out, 'raw', `${moment}.mp4`)
    const recording = await phone.record(id, raw)

    try {
      await maestro(id, moment, env, debug, phone.watcher?.(id))
    } finally {
      await recording.stop()
    }

    const marks = clipMarks(debug)
    const clip = join(out, 'clips', clipName(moment))
    const cut = { from: (marks.start - recording.startedAt) / 1000, to: (marks.end - recording.startedAt) / 1000 }
    // Kept beside the raw recording, to check a cut or make it again by hand.
    writeFileSync(raw.replace(/\.mp4$/, '.json'), `${JSON.stringify({ recordingStartedAt: recording.startedAt, marks, cut, leadIn: LEAD_IN, hold: HOLD }, null, 2)}\n`)
    trim(raw, clip, cut.from, cut.to)
    say(`  clip ${clip} (${((marks.end - marks.start) / 1000).toFixed(1)} s)`)
  }

  const shots = collectScreenshots(debug, join(out, 'screenshots', pass.theme))
  say(`  ${shots.length ? shots.join(', ') : 'no screenshots'}`)
}

/** Cuts every clip again from its raw recording and the timing kept beside it (after changing LEAD_IN or HOLD). */
function recut(out: string) {
  for (const moment of MOMENTS) {
    const raw = join(out, 'raw', `${moment}.mp4`)
    const timing = raw.replace(/\.mp4$/, '.json')

    if (!existsSync(raw) || !existsSync(timing)) {
      continue
    }

    const { cut } = JSON.parse(readFileSync(timing, 'utf8')) as { cut: { from: number; to: number } }
    const clip = join(out, 'clips', clipName(moment))
    trim(raw, clip, cut.from, cut.to)
    say(`cut ${clip}`)
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────

/** The phones this run is for, from --platform (iphone, android, or both comma-separated; both by default). */
function pickPhones(): Phone[] {
  const names = (option('platform') ?? 'iphone,android').split(',').map(name => (name === 'ios' ? 'iphone' : name))
  const unknown = names.filter(name => !(name in PHONES))

  if (unknown.length) {
    fail(`--platform takes iphone, android or both, comma-separated (got ${option('platform')})`)
  }

  return Object.values(PHONES).filter(phone => names.includes(phone.platform))
}

async function main() {
  const phones = pickPhones()
  const outOf = (phone: Phone) => join(ROOT, 'capture', 'out', phone.platform)

  if (command === 'recut') {
    phones.forEach(phone => recut(outOf(phone)))

    return
  }

  if (command === 'device' || command === 'build') {
    for (const phone of phones) {
      const id = await phone.boot()

      if (command === 'build') {
        phone.build(id)
      } else {
        say(`"${phone.label}" is booted (${id})`)
      }
    }

    return
  }

  const picked = args.filter(arg => !arg.startsWith('--'))
  const unknown = picked.filter(name => !MOMENTS.includes(name as Moment))

  if (unknown.length) {
    fail(`unknown moment ${unknown.join(', ')} (${MOMENTS.join(', ')})`)
  }

  const moments = picked.length ? MOMENTS.filter(name => picked.includes(name)) : [...MOMENTS]
  const themes = (option('themes') ?? 'light,dark').split(',') as Theme[]

  if (!themes.every(theme => theme === 'light' || theme === 'dark')) {
    fail(`--themes takes light, dark or both, comma-separated (got ${option('themes')})`)
  }
  const clips = !flag('no-clips')
  const reset = !flag('no-reset')

  // Every phone up and with the app before anything long starts.
  const ids = new Map<Phone, string>()

  for (const phone of phones) {
    const id = await phone.boot()

    if (!phone.installed(id)) {
      fail(`the app is not on "${phone.label}" yet: npm run capture:build -- --platform=${phone.platform}`)
    }

    ids.set(phone, id)
  }

  for (const [index, phone] of phones.entries()) {
    const id = ids.get(phone) ?? fail(`"${phone.label}" did not boot`)
    const out = outOf(phone)

    // A full run replaces the whole set, so nothing stale from an earlier run is left beside it.
    if (!picked.length) {
      rmSync(out, { recursive: true, force: true })
    }

    // Each phone gets a demo of its own: what one phone's last pass does (the room message, the push) a reset undoes.
    if (reset) {
      await resetDemo()
    } else if (index > 0) {
      say(`${phone.platform}: the demo was not reset for it, so it neither sends the room message nor allows the push`)
    }

    phone.appearance(id, 'dark')
    await phone.signIn(id, join(out, 'logs', 'signin'))

    for (const [pass, theme] of themes.entries()) {
      const last = pass === themes.length - 1
      phone.appearance(id, theme)

      for (const moment of moments) {
        await capture(phone, id, out, moment, { theme, last, act: last && (reset || index === 0) }, clips)
      }
    }

    say(`${phone.platform} done: ${join(out, 'screenshots')}${clips ? ` and ${join(out, 'clips')}` : ''}`)
  }
}

try {
  await main()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
