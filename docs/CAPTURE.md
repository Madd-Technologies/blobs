# The capture rig

Store screenshots and the clips for the App Store preview, the Play listing's video, the launch video and the website
come from scripted runs through the real app, always against the [demo Hermes](DEMO.md), never a real server. One
command resets the demo, drives a Release build of the app on each phone through each moment of the storyboard, and
writes the PNGs and trimmed clips to `capture/out/` (git-ignored). Re-run it after any UI change and every asset comes
out again, the same way.

```bash
npm run capture                          # both phones: iPhone, then Android, each from its own reset of the demo
npm run capture -- --platform=android    # one phone (iphone or android)
```

Each phone gets every moment twice: light (screenshots), then dark (screenshots and clips). Phones only for now:
tablets come later.

## Setup, once

You need Xcode with an iOS 26 simulator runtime, CocoaPods, ffmpeg, a Java 17, Maestro (free, open source) and the
Android command-line tools:

```bash
brew install openjdk@17 ffmpeg cocoapods
brew install --cask android-commandlinetools
brew tap mobile-dev-inc/tap
brew install mobile-dev-inc/tap/maestro
```

Homebrew's own `maestro` formula is an unrelated product; use the tap. The rig points Maestro and Gradle at
`/opt/homebrew/opt/openjdk@17` unless `JAVA_HOME` is set, and finds the Android SDK at
`/opt/homebrew/share/android-commandlinetools` unless `ANDROID_HOME` is set. The Android side needs the platform tools,
the emulator and one Google APIs arm64 system image (about 4 GB; the rig uses the newest one installed):

```bash
sdkmanager "platform-tools" "emulator" "system-images;android-36;google_apis;arm64-v8a"
```

The demo must be installed (`npm run demo:start` once, see [DEMO.md](DEMO.md)). Then build the app:

```bash
npm run capture:build                          # both phones
npm run capture:build -- --platform=android    # or one
```

Both are Release builds: the JavaScript is bundled into the app, so there is no Metro, no dev menu and no Expo Go. Each
runs `npx expo prebuild` first every time, so `app.json` changes (the name, the icon) reach the build. **Run it again
after any app change**; the capture uses whatever build is on the device.

- **iPhone:** `xcodebuild -configuration Release` for the simulator, arm64 only, its build folder in the git-ignored
  `ios/build`.
- **Android:** `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a` in the git-ignored `android/` (about
  5 minutes cold, 1 GB), signed with the debug key the way Expo's template does, then `adb install -r`.

### The devices

Each phone is the rig's own, so a capture never fights other work for a shared one, and each only ever signs in to the
demo. `npm run capture:device` just creates and boots them (`--platform=` works here too).

- **iPhone: "Blobs Capture 17 Pro Max"**, a simulator (6.9", the size App Store Connect requires: screenshots come out
  at 1320 x 2868), with Apple's status bar (9:41, full bars, charged battery). The app is iPhone-only on iOS
  (`supportsTablet: false`, so the App Store asks for no iPad screenshots).
- **Android: "Blobs Capture Phone"**, an emulator: AVD `blobs_capture_phone`, the `pixel_xl` profile on the newest Google
  APIs arm64 image (API 36 today), **1440 x 2560 at 560 dpi (9:16, 411 x 731 dp)**, gesture navigation. The runner
  creates the AVD if it is missing (`~/.android/avd`, about 2 GB once used) and keeps its `config.ini` on the rig's
  settings (3 GB RAM, host GPU, no camera or microphone, a cold boot every start so no snapshots fill the disk). It
  runs headless on its own console port, **5584**, so its serial is always `emulator-5584`; every adb call is aimed at
  that serial, and the runner refuses to go on if anything other than this AVD answers there. It never touches a
  phone or another emulator, and stays up between runs like the simulator. Each run sets it up again:
  SystemUI's demo mode for a clean status bar (9:41, full wifi and battery, no notification icons; the mobile signal
  is hidden because this SystemUI always draws a "3G" beside it), the screen kept on, no autofill "Save password?"
  sheet, no spell-check underlines, and `adb reverse tcp:9219 tcp:9219` so the app reaches the demo at
  `http://127.0.0.1:9219` as if it ran on the emulator.

Why 9:16 and not a modern 20:9 Pixel: Google Play refuses a screenshot whose long side is more than twice its short
side (20:9 is 2.22), and only promotes listings with portrait screenshots that are 9:16 and at least 1080 x 1920. See
[Google Play](#google-play) below.

## What a run does

For each phone, in turn (iPhone first):

1. **Quits the app on every phone of the rig and resets the demo** (`scripts/demo/demo.sh reset`, about two minutes;
   an open app would reconnect and take over the bots' chats while they are seeded), checks its waiting states are
   live, then puts Ember to sleep: `capture/lib/doze.py` moves Ember's chats 8 hours back, past the app's 6-hour doze,
   in the demo's own `state.db` only. If someone else is resetting the demo, it waits for that first. Each phone gets
   its own reset because its dark pass sends the room message and allows Courier's push, which only a reset brings
   back.
2. **Boots the device** with its clean status bar.
3. **Signs in** if the app is on its Connect screen. Nothing ever prints the demo password, and it is never on a command
   line on this Mac:
   - *iPhone:* the password goes onto the simulator's pasteboard (`demo.sh password --sim`), the flow pastes it, and
     the pasteboard is cleared straight after.
   - *Android* has no pasteboard to fill from outside. The flow fills the address and username and focuses the
     password field; the runner watches the input method service (`dumpsys input_method`) until a password field of
     the app has the keyboard, then `demo.sh password --adb` types it there through the emulator shell's stdin, and
     Go is pressed. Nothing goes onto any clipboard, and Android's "show the last character typed" is off, so no
     frame shows it. Checked: it appears in no output file, Maestro log or logcat.
4. **Light pass**: every moment, screenshots only, changing nothing.
5. **Dark pass** (dark is the app's default, so it is the one filmed): every moment again, each recorded, and this pass
   also does what can only happen once per reset: it sends the room message and allows Courier's push.
   - *iPhone:* the simulator's own recorder (`xcrun simctl io recordVideo --codec=h264`).
   - *Android:* `adb shell screenrecord` (H.264, 20 Mbit/s, full resolution), pulled off the emulator when the moment
     ends. It stops by itself at 3 minutes; each moment is far shorter.

## The moments

Each moment is one Maestro flow in `capture/flows/`, one clip per phone, and the screenshots it takes at fixed points.
The same flows drive both phones.

| # | Flow | Screenshots | The clip | Changes the demo |
| --- | --- | --- | --- | --- |
| 1 | `home` | `01-home`, `02-needs-you` | Home with the raised Needs-you sheet, then Review all opens the deck | no |
| 2 | `forge` | `03-forge-working`, `04-forge-steps` | Forge's running step, its time ticking; the finished run opens to its steps | no |
| 3 | `scribe` | `05-scribe`, `06-scribe-file` | Scribe's reply with its file chip; the release notes open in the viewer | no |
| 4 | `dashboard` | `07-dashboard` | Courier's dashboard from Home's strip; the board slides to Done | no |
| 5 | `ember` | `08-ember-dozing`, `09-ember-awake` | Ember's details, eyes shut; a tap on the face wakes it | no |
| 6 | `room` | `10-room`, `11-room-reply` | "Launch week"; @scout asks to check the feeds and Scout answers | dark pass only |
| 7 | `courier` | `12-courier-approval`, `13-courier-allowed` | The approval card raised; Allow, and Courier reports the push | dark pass only |

Bot Screen (watch and take over) is not filmed yet: it runs in the demo's Linux container and needs a flow of its own.

## Output

```
capture/out/<phone>/                iphone or android
  screenshots/light/01-home.png …   light pass (11: the room reply and the allowed push are dark only)
  screenshots/dark/01-home.png …    dark pass (all 13)
  clips/01-home.mp4 …               one per moment: H.264, constant 60 fps, full resolution, no audio
  raw/                              the untrimmed recordings, each with its timing (.json) for recut
  logs/<theme>-<moment>/            Maestro's debug output: commands.json, its own screenshots, logs
capture/out/emulator.log            the Android emulator's own log
```

| Phone | Screenshots | Clips |
| --- | --- | --- |
| iPhone | 1320 x 2868 PNG | 1320 x 2868 (the recordings show the Dynamic Island; the screenshots don't) |
| Android | 1440 x 2560 PNG (24-bit, no alpha, about 0.3 MB each) | 1440 x 2560 |

A clip is cut from its raw recording at the flow's `clip start` and `clip end` marks, which Maestro timestamps in
`commands.json`, plus 0.4 s before and 0.6 s after. Both recorders only write a frame when the screen changes, so the
raw files are variable frame rate with gaps; the cut makes them constant 60 fps first and cuts by time from the start
(seeking into a gap with `-ss` loses time). Clips are raw footage: captions, device frames and the stores' preview sizes
come later (Remotion).

## Google Play

Checked against Play Console Help's
[preview assets](https://support.google.com/googleplay/android-developer/answer/9866151) page on 2026-10-15:

| Play's rule for phone screenshots | The Android set |
| --- | --- |
| JPEG or 24-bit PNG, no alpha | PNG, 24-bit, no alpha |
| Each side 320 to 3840 px | 1440 x 2560 |
| Long side at most twice the short side | 1.78 (9:16) |
| At least 2 screenshots to publish (across device types), up to 8 per device type | 13 dark and 11 light: pick up to 8 |
| To be eligible for promotion: at least 4 portrait screenshots, 9:16, at least 1080 x 1920 | yes: 9:16 at 1440 x 2560 |

So the Android screenshots meet every phone requirement as they come out, including the promotion ones. Play's preview
video is a YouTube link, not an upload: the clips are raw material for that video (and the website), not files for the
Play Console.

## Options

```bash
npm run capture -- home courier         # only these moments (keeps the rest of capture/out)
npm run capture -- --platform=android   # one phone; iphone,android (the default) is both
npm run capture -- --no-reset           # use the demo as it is (npm run demo:status must be all ok)
npm run capture -- --no-clips           # screenshots only
npm run capture -- --themes=dark        # one theme; the last theme listed records and acts
npm run capture -- recut                # cut the clips again from raw/ (after changing LEAD_IN or HOLD in capture.ts)
```

A full run (no moments named) clears `capture/out/<phone>` first, so nothing stale is left beside the new set. To try a
change on one moment, run just it on one phone with `--no-reset` (a reset takes two minutes). With `--no-reset` and
both phones, only the first phone sends the room message and allows the push: the demo has no second one to give.

## Writing a flow

- Start from Home with `runFlow: _home.yaml` (a fresh launch that waits for "3 things need you"), or open a screen by
  its link with `_open.yaml` (`LINK`, `TEXT` to wait for; it answers iOS's "Open in …?").
- Everything before the `clip start` mark is setup and is cut from the clip. Mark both ends with labelled
  `evalScript` commands, as the flows do.
- `takeScreenshot: 07-dashboard` names the PNG; the runner copies it out of Maestro's debug folder (Maestro 2 only
  writes screenshots inside its own output folder).
- `runFlow: _hold.yaml` with `MS` holds the frame (Maestro has no sleep; it shows as WARNED, which is fine). On Android
  a hold runs a second or two longer: each check of the screen is slower there.
- Go to another screen with `runFlow: _tap.yaml` (`TARGET` to tap, `THEN` that only the next screen shows): a tap can
  be lost while the app is busy, and this tries again only if the next screen did not come.
- Use `retryTapIfNoChange: false` on other taps: when the screen is slow to change, Maestro taps again, which flips a
  toggle straight back.
- Anything that can only happen once per reset goes under `when: true: ${ACT == 'true'}`.
- Find what to tap with `maestro --device <udid or emulator-5584> hierarchy`: elements match by their accessibility
  label. Faces are decorative (no label), so Ember's is tapped by its position (`50%,16%` lands on it on both phones).
- Add the new flow's name to `MOMENTS` in `capture/capture.ts`, in order: moments that change the demo go last.

### Android

Keep one flow for both phones; branch with `when: platform: Android` (or `iOS`) only where Android really differs:

- **"adb tap".** While anything on screen moves (the faces always do, and a running step's clock), Maestro's Android
  driver waits about ten seconds around each tap or swipe for the screen to settle, which leaves a clip standing still;
  `waitToSettleTimeoutMs` does not reach that wait. So a tap inside a clip that would stall is asked of the runner: a
  `runFlow` labelled `adb tap <x>%,<y>%` whose commands wait for the next screen. The runner reads Maestro's output, and
  the moment that label goes by it taps the point with `adb shell input tap` (under a second). The point is where the
  element sits on the rig's emulator; the wait checks the tap landed, so a layout change fails the run instead of
  filming the wrong thing. Maestro fills no variables into labels, so each point is written out. Home's Review all,
  Forge's "Ran 3 steps" and Courier's Allow work this way; taps outside clips, and the room's (2 to 4 s), stay Maestro's.
- **The keyboard.** The emulator's screen is shorter (731 dp against the iPhone's 956 pt) and Gboard covers the lower
  half: `hideKeyboard` before tapping a field below it (the sign-in does).
- **No "Open in …?"** for links: `_open.yaml` only answers it on iOS.
- The back button is never needed: every moment starts from a fresh launch.

## Things to know

- **Never point it at a real server.** It signs in to `http://127.0.0.1:9219` only and has no other address.
- **One demo, one run at a time.** A reset by anyone else during a capture spoils that run, and opening the app while
  a reset seeds the bots spoils the reset (the app makes a bot's chat before the seeder does). The rig waits for a
  running reset before it starts its own, and quits the app on both of its phones before each reset; it cannot quit
  the app on devices that are not its own.
- The app still says HermesBot with Expo's placeholder icon; after the rename, `npm run capture:build` and
  `npm run capture` again. If the bundle id or package changes, update `APP_ID` in `capture/capture.ts`.
- In-app times are real (the chat says "Today 7:12 PM" while the status bar says 9:41).
- The iPhone Release build's generated Info.plist has App Transport Security with `NSAllowsArbitraryLoads` false and
  `NSAllowsLocalNetworking` true: plain `http://127.0.0.1` works. On Android, `usesCleartextTraffic` (from
  `expo-build-properties` in `app.json`) allows it.
- The emulator needs a few GB free: its data image grows to about 2 GB, and a cold boot takes a minute or two. Stop it
  with `adb -s emulator-5584 emu kill`; the next run boots it again.
