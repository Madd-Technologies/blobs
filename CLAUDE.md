# Blobs

An Expo SDK 57 app for Android and iOS: a mobile client for Nous Research's **Hermes Agent**. It covers the bot roster,
chat with live tool activity, approvals, a "Needs you" inbox, watching and taking over a bot's screen, routines, group
rooms and bot dashboards. The server side is Hermes itself (`hermes dashboard`, the `/api/ws` JSON-RPC protocol).
Published by Madd Technologies LLC under the MIT licence.

## Start here

- `docs/protocol.md`: the Hermes dashboard protocol as the app uses it. When adding any RPC or event, read the upstream
  contract at the server's release tag in `NousResearch/hermes-agent`, not old captures.
- `docs/DEVELOPMENT.md`: setup, the local dev server and fake model, smoke tests, checks.
- `docs/DEMO.md`: the demo Hermes (fictional bots, scripted model) that every screenshot, video and App Review sign-in
  is made against. Never film or screenshot a real server.
- `AGENTS.md`: Expo rules.
- Machine-specific or personal notes (your server, devices, simulators) go in `CLAUDE.local.md`, which is git-ignored.
  Never put them in this file or anywhere else in the repo.

## Non-negotiables

**Hermes data safety:**
- Never edit `~/.hermes/config.yaml` or write to `~/.hermes/plugins/` from a test or script.
- Never modify a real profile. Write tests use throwaway `zz-*` bots and clean up afterwards.

**Testing:**
- The real test is a real Hermes server, not only the local dev server (it is older and speaks an older protocol).
  Keep real-server tests harmless: no installs, no config edits, no restarts or updates.
- Hermes 0.21.5+ asks prompts as server requests, and Bot Screen exists: see `docs/protocol.md`.

**Secrets and privacy:**
- The dev token lives in `.env.local` (git-ignored). Never prefix it with `EXPO_PUBLIC_`, never log WebSocket URLs
  (they carry a token or ticket), and never store secret or sudo values.
- Sign-in passwords are never stored, logged or echoed; only the session tokens are kept (SecureStore).
- Never commit personal data: real hostnames or IPs, names of real bots or people, real messages, or screenshots taken
  against a real server. Tests use stand-ins (`home-server`, `100.64.0.1`, `/home/orion`).

**Expo:** follow `AGENTS.md`: check the versioned docs at docs.expo.dev/versions/v57.0.0 and use `npx expo install`.

**Commits:** `npm run check` (tsc + lint + tests) green after your last edit, then a detailed commit. Never amend.

## Design ("Card Stock")

- Source of truth: the tokens in `src/theme/tokens.ts` and the rules below.
- **Rules:**
  - Paper in four tonal levels (canvas, sheet, tone, raised); a bot's own screens tint every level toward its face color
    (4/5/6/7/8%, `tintPalette`/`tintLevel` in `src/theme/tokens.ts`, `BotPaper`/`BotTint`). Blob faces tint by their body color.
  - Only what you must act on rises (`Raised`: a 1 px lighter top edge and a soft shadow): approval and question cards,
    the Needs-you card, the deck's top card, a dashboard's first panel that needs you, the composer and action trays,
    sheets. One raised card per moment plus the tray. No per-row shadows.
  - Color comes only from the faces, their tint, and one amber "needs you" accent (dots, never fills or badges).
  - Geist (700 for titles) with Geist Mono, and mono only for commands.
  - Bot replies have no bubble (16/25); your messages are a compact tonal bubble.
  - No glass or blur, no borders, no badge pills, no uppercase section labels, no tab bar.
  - One quiet line per tool step. One white primary pill per moment; secondary pills are pressed in.
  - Motion: press springs (0.97), cards rise in with a haptic, sheets follow the drag; transform and opacity only.
  - Dark is the default theme.
- No generic "AI-slop" UI. When in doubt, quieter.
