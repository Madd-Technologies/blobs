# The demo Hermes

Every screenshot, App Preview, README loop and website clip of Blobs is made against a **demo Hermes**: a separate,
fictional Hermes Agent on your Mac with five bots in known states and a scripted model. Nothing in it comes from a
real server, and it never touches one. It is also the world App Review sign-ins are meant to see.

```bash
npm run demo:start      # first run: installs Hermes, builds the demo world, starts it
npm run demo:reset      # back to the seeded states (keeps the install and the sign-in)
npm run demo:stop       # stops the demo's own processes, nothing else
npm run demo:status     # what runs, and whether the waiting states are still live
npm run demo:password   # copies the sign-in password to the clipboard (never prints it)
```

Sign in from the app at `http://127.0.0.1:9219` as **demo**. For a simulator, put the password on its pasteboard with
`npm run demo:password -- --sim <udid>`, long-press the Password field and Paste. A reset keeps the token secret, so the
app stays signed in across resets.

## What is in it

| Bot | State after a reset | Story (send this message to replay it) |
| --- | --- | --- |
| **Scout** | Asking a question with three choices | "Compare the three hosting plans for the new site" |
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
| Dashboard, model | `127.0.0.1:9219`, `127.0.0.1:9220` |

`scripts/demo/demo.sh` runs `hermes dashboard` (with Hermes's password sign-in switched on by a placeholder
`dashboard.public_url`) and `hermes gateway run` (routines), both with `HERMES_HOME` set to the demo home. It never
touches `~/.hermes`, Hermes.app or `~/.local/bin/hermes`, and never runs `hermes dashboard --stop` or `hermes serve --stop`,
which stop every Hermes on the machine. Override the paths and ports with `DEMO_ROOT`, `DEMO_WORKSPACE`, `DEMO_PORT`
and `DEMO_MODEL_PORT`.

## Things to know

- **Waiting states end when the servers stop.** A restart (or a reboot) ends the approval, the question and Forge's run.
  `demo:start` on an existing world says so; `demo:reset` brings them back in about 90 seconds.
- **Signing a simulator into the demo replaces its sign-in.** To keep a real one, shut the simulator down and copy its
  `data/Library/Keychains` and Expo Go's data container first; copy them back (shut down again) afterwards.
- **Right after a reset, Home only half knows what waits.** Courier and Scout read "Waiting for your answer" and the
  Needs-you sheet may count only the dashboard's late order: the app learns a prompt it did not start only by opening
  that chat (it asks `approval.pending` just for sessions in `working`, and on 0.21.6 a session holding a prompt reports
  `waiting`; `src/features/inbox/store.ts`). Open Courier's and Scout's chats once before filming Home: it then shows
  "3 things need you", the push and the question.
- **Courier asks about a force push**, not a plain `git push origin main`: Hermes only asks before risky commands, and a
  plain push is not one of them.
- **Room messages need a moment between them.** A message sent while the room is still closing a round is never picked
  up on 0.21.6; the seeder waits for each round to finish.
- **App Review** needs a server the reviewers can reach. This demo is localhost only; a hosted copy of the same world is
  a separate step.

## Bot Screen

Taking over a bot's screen needs Linux: Hermes's Bot Screen runs TigerVNC (`Xvnc`) with Xfce (`xfwm4`,
`xfce4-panel`, `xfdesktop`, `xfsettingsd`), `dbus-run-session`, `xauth` and the X11 utilities, plus a browser for the bot
to drive (`tools/bot_desktop/runtime.py`). It is not set up here. The smallest way to add it:

1. Install a container runtime on the Mac (not done; ask first): Colima (`brew install colima docker`, then
   `colima start --cpu 2 --memory 6`), or OrbStack or Docker Desktop.
2. Pull upstream's desktop sandbox image, `nousresearch/hermes-sandbox:desktop` (`docker/sandbox-desktop.Dockerfile`:
   TigerVNC, Xfce, headed Chromium and cua-driver, no Hermes inside; check it has an arm64 build, or build it locally).
3. Give one bot (the storyboard has Scout driving) a Docker terminal: `terminal.backend: docker` and
   `terminal.docker_image: nousresearch/hermes-sandbox:desktop` in its `config.yaml`. With `bot_desktop.placement: auto`
   (the default) Hermes then runs that bot's screen inside its container while Hermes itself stays on macOS
   (`tools/bot_desktop/placement.py`, `sandbox_host.py`). That bot's commands also run in the container.
4. Script a short visible task for that bot in the demo model (open a page, type, click) so the take-over scene is the
   same every time.

The fallback is to run the whole demo Hermes in a Linux VM or container (Hermes's own Docker image) instead.
