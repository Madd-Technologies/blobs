# The demo Hermes

Every screenshot, App Preview, README loop and website clip of Blobs is made against a **demo Hermes**: a separate,
fictional Hermes Agent on your Mac with five bots in known states and a scripted model. Nothing in it comes from a
real server, and it never touches one. It is also the world App Review sign-ins are meant to see. The capture rig
([CAPTURE.md](CAPTURE.md)) films it.

```bash
npm run demo:start      # first run: installs Hermes, builds the demo world, starts it
npm run demo:reset      # back to the seeded states (keeps the install and the sign-in)
npm run demo:stop       # stops the demo's own processes and its Linux VM, nothing else
npm run demo:status     # what runs, and whether the waiting states are still live
npm run demo:password   # copies the sign-in password to the clipboard (never prints it)
```

Sign in from the app at `http://127.0.0.1:9219` as **demo**. For a simulator, put the password on its pasteboard with
`npm run demo:password -- --sim <udid>`, long-press the Password field and Paste. For an Android emulator, which has no
pasteboard to fill from outside, focus the Password field and `npm run demo:password -- --adb <serial>` types it in (on
the emulator shell's stdin, never on a command line). A reset keeps the token secret, so the app stays signed in across
resets.

## What is in it

| Bot | State after a reset | Story (send this message to replay it) |
| --- | --- | --- |
| **Scout** | Asking a question with three choices; its Bot Screen shows the shop | "Compare the three hosting plans for the new site"; "Open the shop preview" |
| **Courier** | Waiting for your OK to run `git push --force-with-lease origin main` | "Push the release to main" |
| **Forge** | Working: a browser test run that lasts about 3.5 hours | "Clear the cache and run the tests" (steps tick, 214 passing) |
| **Scribe** | Finished: release notes, with a file chip | "Write the release notes for 1.4" |
| **Ember** | Idle, with a "Morning brief" routine at 7:00 AM that ran once | Run the routine from its Routines screen |

- **Faces** are the website's five (`scripts/build-site.mjs`): blobatar seeds chosen so the app draws the same colours.
- **Room** "Launch week" with Scout, Forge and Scribe: two exchanges seeded. "@scout can you check the feeds?" is left
  for a recording.
- **Dashboards** (the hermes-dashboard plugin, pinned at `c4a245e` of the plugins repo, in the demo home only):
  Courier's "Requests" (7 open, a chart per day, a board with one late order that needs you), Scout's hosting plans and
  Forge's build stats.
- The **project** the bots work on is a small fictional shop, "storefront", with a local bare remote, so approving
  Courier's push is harmless.
- The default profile ("Hermes") is hidden, so Home shows exactly the five.

The model (`scripts/demo/demo-llm.mjs`) plays a fixed story for each message above, matched by its words; anything else
gets a polite one-liner. Every run looks the same. Add a story there to film something new.

## Where things live

| What | Where |
| --- | --- |
| Hermes Agent 0.21.6 (its own clone and venv) | `~/blobs-demo/hermes-agent` |
| Its `HERMES_HOME` (bots, chats, plugins, dashboards) | `~/blobs-demo/home` |
| Sign-in (username, password, token secret; mode 600) | `~/blobs-demo/login` |
| Logs, including every model request | `~/blobs-demo/logs` |
| The bots' project (a neutral path, so no user name shows) | `/Users/Shared/blobs-demo` |
| Scout's sandbox: a Colima VM of its own (2 CPUs, 4 GB) | Colima profile `blobs-demo` |
| Dashboard, model | `127.0.0.1:9219`, `127.0.0.1:9220` |

`scripts/demo/demo.sh` runs `hermes dashboard` (with Hermes's password sign-in switched on by a placeholder
`dashboard.public_url`) and `hermes gateway run` (routines), both with `HERMES_HOME` set to the demo home. It never
touches `~/.hermes`, Hermes.app or `~/.local/bin/hermes`, and never runs `hermes dashboard --stop` or `hermes serve --stop`,
which stop every Hermes on the machine. Override the paths and ports with `DEMO_ROOT`, `DEMO_WORKSPACE`, `DEMO_PORT`
and `DEMO_MODEL_PORT`.

## Things to know

- **Waiting states end when the servers stop.** A restart (or a reboot) ends the approval, the question, Forge's run and
  Scout's screen. `demo:start` on an existing world says so; `demo:reset` brings them back in about two minutes.
- **Signing a simulator into the demo replaces its sign-in.** To keep a real one, shut the simulator down and copy its
  `data/Library/Keychains` and Expo Go's data container first; copy them back (shut down again) afterwards.
- **Right after a reset, Home doesn't know Scout's question yet.** Courier's push shows as a real approval (the app asks
  `approval.pending` for `working` and `waiting` sessions), but Hermes can only list a question by resuming its chat, so
  Scout reads "Waiting for your answer" until its chat has been opened once. Open Scout's chat before filming Home.
- **An app signed in during a reset** makes each bot's "Bot Chat" as soon as the bot appears; the seeder then uses that
  chat, so the seeded conversation is still the one the bot's row opens.
- **Courier asks about a force push**, not a plain `git push origin main`: Hermes only asks before risky commands, and a
  plain push is not one of them.
- **Room messages need a moment between them.** A message sent while the room is still closing a round is never picked
  up on 0.21.6; the seeder waits for each round to finish.
- **App Review** needs a server the reviewers can reach. This demo is localhost only; a hosted copy of the same world is
  a separate step.

## Bot Screen

Scout's screen is real: Hermes's Bot Screen needs Linux, so Scout's commands, browser and screen run in a container of
upstream's desktop sandbox image (`nousresearch/hermes-sandbox:v0.21.6-desktop`: TigerVNC, Xfce and Chromium, no Hermes
inside), while Hermes itself stays on macOS. The container runs in a Colima VM used only by the demo: profile
`blobs-demo`, reached through `DOCKER_HOST` so the Mac's own Docker context is never switched, with only
`/Users/Shared/blobs-demo` and `~/blobs-demo` mounted. Scout's `config.yaml` sets `terminal.backend: docker`, that image,
the project at `/workspace` and `bot_desktop.idle_stop_minutes: 0`; Hermes places the screen in the container on its own
(`bot_desktop.placement: auto`).

A reset starts the screen and has Scout run "Open the shop preview": `npm run preview` (a static server for
`storefront/site/`) and `npm run show` (Chromium on the screen, as the image's desktop user), so watching Scout shows
a fictional shop with a search box to type into when you take over. Everything on it comes from `scripts/demo/storefront/`.

- **Needs** Colima and the Docker CLI (`brew install colima docker`). Without them the demo still runs and Scout simply
  has no screen. The first run pulls the image (about 1.2 GB) and makes the VM; `demo:stop` stops the VM, `demo:start`
  brings it back.
- **The workspace folder is emptied, never deleted,** on a reset: the VM mounts it, and a folder made anew would leave a
  stale, empty mount. If that happens anyway, the launcher notices and restarts the VM.
- Chromium shows a "Sign in to Chromium?" chip in its toolbar; it is the browser's own, not anything from this Mac.
- The other four bots run on macOS, which cannot host a screen; the app's Screens grid shows "Set up screens" on their
  tiles. Film Scout's.
- Two Hermes 0.21.6 quirks the launcher works around: the viewer finds a sandboxed screen through the *launch*
  profile's terminal backend, so the hidden default bot is set to the same Docker sandbox; and Hermes forgets an idle
  sandbox after `TERMINAL_LIFETIME_SECONDS` (300 s) while its container runs on, after which the screen cannot be
  watched, so the demo raises it to two days.
- Checked from the app: watch the screen, Take over, type into the shop's search box, Hand back.
