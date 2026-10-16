# Developing Blobs

How to build and test the app from source. The [README](../README.md) covers what Blobs is and how to connect a server.

## Development setup

You need Node 26, Xcode with an iOS Simulator, and a local Hermes install (v0.21.0 at
`~/.hermes/hermes-agent`).

```bash
npm install
```

Create `.env.local` (git-ignored; never commit it, never give the token an `EXPO_PUBLIC_` prefix):

```bash
HERMES_DASHBOARD_SESSION_TOKEN=<any long random string>
HERMES_DEV_URL=http://127.0.0.1:9119
# Dev sessions are switched to this model right after create/resume, so tests stay cheap.
EXPO_PUBLIC_HERMES_DEV_MODEL=z-ai/glm-5.3-flash
HERMES_DEV_MODEL=z-ai/glm-5.3-flash
```

### 1. Start the backend

**Quit Hermes.app first** — only one Hermes backend may run at a time.

```bash
npm run dev:server
```

This refuses to start if Hermes.app is open, anything listens on port 9119, or another
`hermes serve` / gateway is running. It binds `127.0.0.1` only. Run `scripts/dev-server.sh --check`
to run the preflight without starting anything.

The script sets two environment variables on purpose:

| Variable | Why |
| --- | --- |
| `HERMES_DESKTOP=1` | makes `serve` run the cron ticker, so routines work. It also kills orphaned Hermes processes and runs cron for **every** profile. |
| `HERMES_TUI_WS_ORPHAN_REAP_GRACE_S=0` | keeps a running turn alive when the app's socket drops (the default 20 s grace kills it). |

The dev server also starts `scripts/fake-llm.mjs`, a scripted OpenAI-compatible model, and points only the dev
Hermes process at it (so tests need no model credentials; see `docs/protocol.md`). Replies are chosen by keywords
in your message: `approval`, a \`backticked command\`, `clarify`, `slow`, `think`, `markdown`, `fail`. Set
`HERMES_DEV_REAL_LLM=1` to use Hermes's own configured model instead.

Stop it with `npm run dev:stop`. `npm run smoke` exercises the protocol (it creates and deletes a throwaway
`zz-smoke` bot and refreshes `docs/protocol-captures/`), and `npm run smoke:app` runs the app's real session
and inbox logic against the server on a throwaway `zz-app` bot.

### 2. Start the app

```bash
npx expo start --ios     # iOS Simulator (Expo Go, SDK 57)
```

On the Connect screen enter `http://127.0.0.1:9119` and the token from `.env.local`.
An Android emulator needs `adb reverse tcp:9119 tcp:9119` so the Host header stays `localhost`.

### Connecting to a remote Hermes (username and password)

A Hermes bound to anything but loopback (a Tailscale address, say) has no session token: it asks you to
sign in. Enter its address (e.g. `http://100.x.y.z:9119`) on the Connect screen. When the server asks for
a login the screen switches to **Username** and **Password**; sign in once and the app keeps its session
tokens in the device keychain and renews them itself. If the session can no longer be renewed (the server
was reset, or 30 days passed) you land back on Connect with the address and username filled in. The
password itself is never stored.

`npm run smoke:auth` checks the sign-in against a real Hermes: it starts a throwaway `hermes dashboard`
with its own empty `HERMES_HOME` on this machine's Tailscale address, a random password that is never
printed, and tears it down. Quit the dev server first (`npm run dev:stop`). `HERMES_SMOKE_QUICK=1` skips
the one-minute wait for a real token expiry.

### Checks (run before every commit)

```bash
npm run check    # tsc --noEmit && expo lint && node --test
```

Pure modules (`src/lib/hermes/**`, `src/features/**/{reduce,derive}.ts`, `identity.ts`) have no React Native
imports and use relative `.ts` imports, so Node runs their tests directly (native type stripping).

## Testing

Screenshots, videos and App Review use the demo Hermes instead: a separate, fictional Hermes with five bots in known
states (`npm run demo:start`, see [DEMO.md](DEMO.md)). `npm run capture` makes the whole screenshot set and the clips
from it in one go ([CAPTURE.md](CAPTURE.md)).

The real test is a real Hermes: the signed-in app against your own server (see above). The local dev server and its
fake model are Hermes 0.21.0, which speaks an older protocol than 0.21.5, so a green local run can hide a real bug
(prompts were silently dropped on 0.21.5 until the request bridge was added). Keep real-server tests harmless
(nonexistent temp paths, no installs, no config edits).

## Safety rules for development

- Never edit `~/.hermes/config.yaml` or `~/.hermes/plugins/` from a test or script.
- Never modify a real profile such as `default`. Write tests use throwaway `zz-*` bots and clean
  up after themselves.
- Never log WebSocket URLs (they contain `?token=` or a ticket) and never store secret or sudo values.
- Never store, log or echo a sign-in password: only the tokens it earns are kept, in SecureStore.

## Known limits

- Two clients on one session: the last one to resume or submit gets the live stream, and the other may
  hit error 4090. Quit Hermes.app while developing.
- Rooms created in the app are not visible in Hermes Desktop v0.21.0.
- Bot Screen needs a Linux Hermes host with Bot Screen (0.21.5 has it; 0.21.0 does not, and the app shows the unsupported state). The host also needs its desktop packages installed (`display.install`).
- iOS push needs APNs (later); push is Android-first via UnifiedPush.
