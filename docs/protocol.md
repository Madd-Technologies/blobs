# Hermes gateway protocol (v0.21.0)

What HermesBot speaks to `hermes serve`. Everything marked **verified** was observed against a real v0.21.0
server by `npm run smoke` (captures in `docs/protocol-captures/`); everything marked *source* comes from
reading the Hermes source and has not been exercised yet. Types live in `src/lib/hermes/protocol.ts`,
`rpc.ts` and `rest.ts`.

## Transport and auth (verified)

- `ws://127.0.0.1:9119/api/ws?token=<HERMES_DASHBOARD_SESSION_TOKEN>`: JSON-RPC 2.0, one object per frame.
- REST uses the header `X-Hermes-Session-Token`. The Host header must be `127.0.0.1` or `localhost`.
- Gated mode (any non-loopback bind, e.g. a Tailscale address) has no fixed token: see **Signing in to a
  gated server** below. The websocket takes a 30 s single-use ticket (`POST /api/auth/ws-ticket` with the
  bearer) instead of `?token=`.
- Never log WebSocket URLs: they contain the token or ticket.

## Signing in to a gated server (verified against Hermes 0.21.0)

`GET /api/status` is public and reports `auth_required`. It is **false on a loopback bind** (the fixed
session token applies there, and `/api/auth/providers` answers 401) and true on any other bind, so a login
can only be exercised on a non-loopback address. `src/lib/hermes/auth.ts` implements the RFC 8252 native
flow with PKCE, the same one Hermes Desktop uses:

1. `GET /auth/native/authorize?provider=&code_challenge=&code_challenge_method=S256&redirect_uri=&state=`
   starts a pending login and answers 302 → `/login` with a `hermes_session_pkce` cookie (10 min). It is
   `SameSite=Lax`, `Path=/`, and `Secure` only over HTTPS. `redirect_uri` must be a loopback literal
   (`http://127.0.0.1:<port>/…`), but nothing ever listens on it: the app only parses it.
2. `POST /auth/password-login {provider, username, password}` with that cookie answers
   `{ok, next}`, where `next` is the redirect carrying a one-time `code` and our `state`. 401 is a wrong
   username or password (the same answer for either), 429 is rate limiting.
3. `POST /auth/native/token {code, code_verifier}` answers `{access_token, refresh_token, expires_at (epoch
   s), provider, user_id}`. The code is single use.
4. `GET /api/auth/providers` lists the options (`name`, `supports_password`). The password provider is
   `basic`; OAuth-only servers (e.g. Nous) are not supported by the app yet.

After that REST takes `Authorization: Bearer <access token>` and the websocket takes a ticket. Verified by
`npm run smoke:auth` (a throwaway gated server, see below): a bearer that has expired is refused with **401**
(the app renews and retries once on that), `POST /auth/native/refresh {refresh_token, provider}` gives new
tokens (401 → the session is over: sign in again), and tokens are stateless and signed from their
timestamps, so two issued in the same second are identical. The `basic` provider's access tokens last 12 h
by default (60 s minimum), its refresh tokens 30 days, and it does not invalidate an old refresh token on
use; other providers may, so the app shares one refresh between all callers (`keeper.ts`).
- Server pushes are `{"method":"event","params":{type, session_id?, seq?, payload}}`. On **0.21.0** every prompt
  (approval, question, secret, sudo) is an event answered by an RPC. On **0.21.5** they are server→client
  *requests* instead: see **Server requests** below. The app supports both.
- `seq` increases per session and is absent on broadcasts (`sessions.changed`, `cron.changed`,
  `skin.changed`). The vendored client keeps a watermark per session and replays missed events with
  `session.events.since` after a reconnect.
- The client pings every 15 s and treats 45 s of silence as a dead socket.

## Roster (verified)

`profiles.list {include_sessions?}` → `{profiles: ProfileRow[], bot_mode_protocol: boolean}`.

A row: `name, path, is_default, model, provider, description, display_name, skill_count, last_session,
worker_session, canonical_session{id, resolved_id, root_title, title, preview, started_at, last_active,
message_count}, ui_meta{'hermes-bots': BotMeta}, ui_meta_revisions, has_avatar`. `path` contains the user's home
directory: scrub it before saving anything.

Display name, in order: `ui_meta['hermes-bots'].title`, then `display_name`, then "Hermes" for `default`,
then the title-cased slug (`identity.ts`).

## Sessions

Two ids exist for every session. Do not mix them up:

| | example | used by |
| --- | --- | --- |
| live id | `3cb1c144` | every RPC (`prompt.submit`, `approval.respond`, …) |
| stored id | `20261008_184526_cc0004` | REST (`/api/sessions/{id}`), `canonical_session.id`, `session.resume` |

- `session.create {profile, title, hidden, model, provider, cwd, follow_profile_config}` → `{session_id (live),
  stored_session_id, message_count, messages, info}` (verified). The session is `lazy` (`info.lazy`) until its
  first prompt builds the agent.
- `session.resume {session_id: storedId, profile, omit_messages: true}` (verified):
  - Re-key by the returned `session_id`: it is the same live id if the session was still live (`resumed` is the
    stored id), a new one after `session.close`.
  - Fields: `session_key` (stored id), `running`, `status`, `started_at`, `turn_started_at`, `messages_omitted`,
    `message_count`, `inflight`, `info`.
  - `inflight` is present **even when idle**: after a failed turn it holds the error (`status:'error'`,
    `recoverable`, `error_surface`). Only treat it as in-flight work when `running` is true.
  - *Source:* resume also restores `pending_approval` and `pending_clarify`, but not secret or sudo prompts.
  - *Source:* errors 4007 (not found: recreate Bot Chat), 4130 (too large), 4009 (settling: retry with
    backoff), 4001 on any call with a stale live id (re-resume), 4090 (refused: read `data.reason`).
- `session.close {session_id}` → `{closed:true}`. **Deleting a stored session over REST does not close its live
  session**; close first or the agent leaks until the server restarts.
- `session.interrupt` → `{status:'interrupted'}` (verified).
- `session.active_list {}` → `{sessions: [{id (live), session_key (stored), status, current, model, last_active,
  started_at, message_count, preview, title}]}` (verified). There is **no profile field**: map rows to bots by
  matching `session_key` / `id` against each roster row's `canonical_session.id` / `resolved_id`. `status` is
  `idle | starting | working | waiting`; `waiting` means clarify, sudo or secret on older servers, and on 0.21.6 also
  a held approval (found on the demo Hermes), so the inbox asks `approval.pending` for both `working` and `waiting`.
- Bot Chat: open `canonical_session.resolved_id || id`. If a bot has none: `session.list {profile, title:'Bot
  Chat', include_hidden:true}`, else `session.create {profile, title:'Bot Chat', hidden:true,
  follow_profile_config:true}` then `session.title`. *Source.*

### Model pinning and dev safety (verified)

- `session.create {model, provider}` pins the model for that session only (it is not a config write), and
  `info.model` / `info.provider` report it immediately. The pin **survives close and cold resume** for such
  sessions.
- `config.set {session_id, key:'model', value:'<model> --provider <p> --session'}` on a session with no agent
  yet reports success but **does not take effect**: the first turn ran on the profile's own model. Do not
  rely on it before the first prompt.
- So: pin at `session.create`, check `info.model` with `assertPinnedModel` before the first `prompt.submit`.
  Bot Chat sessions (`follow_profile_config`) follow the profile's config instead.

### Tools depend on the session's directory (verified)

If the session's `cwd` looks like a code workspace, Hermes collapses to a coding-only toolset that has no
`clarify`. The dev server runs from this repo, so smoke sessions pass `cwd` pointing at a plain temp directory.
The `clarify` toolset is also off by default per profile (`tools.configure {profile, action:'enable',
names:['clarify']}` turns it on and writes that profile's config).

## Transcript over REST (verified)

`GET /api/sessions/{storedId}/messages?profile=<p>&order=latest&limit=200&include_compacted=true` →
`{session_id, messages, pagination:{limit, offset, order, returned}}`. Page back with `offset`. Rows are
oldest-first within a page.

A row: `id, role, content, tool_calls[{id, function{name, arguments}}], tool_call_id, tool_name, timestamp,
finish_reason, compacted, active`, plus `display_content` / `display_kind` / reasoning when present. Skip
`display_kind:'hidden'`, prefer `display_content`, and pair a `tool` row to its call by `tool_call_id`.

## A turn (verified)

`prompt.submit {session_id, text}` → `{status:'streaming'}`. Events, in this order:

1. `message.start`
2. any of `message.delta {text}`, `message.interim {text, already_streamed}`, `thinking.delta {text}` (often
   empty), `reasoning.available {text}`, `status.update {kind, text}`, `tool.generating {name}`, `tool.start
   {tool_id, name, context, args}`, `tool.complete {tool_id, name, args, duration_s, result}`, `session.usage
   {usage}`, `session.title {session_id, title}`, plus a prompt event
3. `message.complete {text, usage, status:'complete'|'interrupted'|'error', error?}`
4. `session.info {running:false, …}`

Details:

- The concatenated `message.delta` text equals the final `message.complete.text` for a plain turn.
- A tool call runs `tool.generating` → `tool.start` → (prompt?) → `tool.complete`. A denied approval completes with
  `result: {status:'blocked', exit_code:-1, error:'BLOCKED: Command denied by user…'}`.
- `message.interim` with `already_streamed:true` repeats text the deltas already drew; skip it.
- Interrupted: `message.complete.status` is `'interrupted'` and `text` holds the partial reply.
- Failed: the server retries three times with backoff, emitting `status.update {kind:'lifecycle', text:'⏳ Retrying…'}`,
  then `message.complete {status:'error', error:'HTTP 500: …'}`. A failure can take 10 s or more.
- If a turn is already running, `prompt.submit` applies `busy_input_mode` (default `interrupt`): the result
  status is `redirected`, `queued` or `steered` instead of `streaming`. *Source.*
- Deltas are batched about every 33 ms.

### Routing

A session's live events go to whichever connection last called `create`, `resume` or `submit`. Two clients on one
session fight over the stream (the loser may see error 4090). Quit Hermes.app while developing.

## Prompts (all verified except secret and sudo)

| Event | Answer | Result |
| --- | --- | --- |
| `approval.request {command, description, request_id, choices, allow_session, allow_permanent, pattern_key}` | `approval.respond {session_id, request_id, choice:'once'\|'session'\|'always'\|'deny'}` | `{resolved: 1}`; **`{resolved: 0}` if already answered or expired** (the server times out after 300 s) |
| `clarify.request {request_id, questions:[{qid, question, choices, multi_select}]}` | `clarify.respond {session_id, request_id, answer, question_id}`, **one call per question**; a multi-select answer is a JSON array string | `{status:'ok', remaining:[qids]}`; the tool resumes when none remain; `{status:'expired'}` if it timed out *(source)* |
| `secret.request {request_id, prompt, env_var}` *source* | `secret.respond {request_id, value}` | |
| `sudo.request {request_id}` *source* | `sudo.respond {request_id, password}` | |

- Each also emits a `*.expire {request_id}` event when it times out (*source*).
- `approval.pending {session_id}` → `{approvals:[…]}` lists open approvals **without `choices` and with the
  command unredacted**. Build the choices client-side, show the command but never log or persist it. It can block
  for up to 30 s, so only call it for sessions whose `status` is `working`.
- The question text is user-visible but the server appends "(Recommended)" to the first choice.
- Per-question answers (`question_id`) and the multi-select JSON format are *source*; the smoke test answers a single question without a `question_id`.
- Approval mode is in `session.info.approval_mode`: `manual` asks for every risky command, `off` never asks,
  `smart` (the default here) first asks a guardian model, which answers APPROVE, DENY or ESCALATE, and only
  ESCALATE reaches the user.

## Methods that do not exist yet

`display.*` (Bot Screen) is absent in v0.21.0 (the server answers `-32601`) but **present in 0.21.5**: see **Bot
Screen** below. The app feature-detects with `display.status`. Cron has no RPC beyond `cron.manage`; routines use
REST (`/api/cron/jobs`).

## The dev model: why a fake LLM

A development machine's Hermes often has no model credentials it can use, and tests shouldn't spend money or
depend on a model's mood. So
`scripts/dev-server.sh` starts `scripts/fake-llm.mjs`, an OpenAI-compatible server with scripted replies, and
sets `OPENROUTER_BASE_URL` / `OPENROUTER_API_KEY` **for the dev `hermes serve` process only**. No Hermes config
or `.env` file is touched; the session still reports the dev model `z-ai/glm-5.3-flash` on `openrouter`. Hermes
itself produces every protocol frame; the fake only decides the model's words and tool calls, chosen by keywords
in the last user message (`approval`, a `` `backticked command` ``, `clarify`, `slow`, `think`, `markdown`,
`fail`; see the header of `scripts/fake-llm.mjs`).

Set `HERMES_DEV_REAL_LLM=1` to skip the fake and use whatever Hermes is configured with (add an OpenRouter key
to `~/.hermes/.env` yourself first).

## Server requests (Hermes 0.21.5, verified on a real server)

Source: upstream `tui_gateway/contracts/server_requests.py` at tag `v2026.9.24` (tags are date-named; 0.21.5 is
`v2026.9.24`), and a real 0.21.5 gateway.

On 0.21.5 the agent asks the person by sending a JSON-RPC **request** (`{id:"srq-…", method, params:{session_id,…}}`)
and waits for the **response** frame with the same id. This replaces the `*.request` events and `*.respond` RPCs.

- **A client must opt in.** `client.capabilities {server_requests: true}`, once per connection, returns the request
  methods the server may send (home-server: `approval, clarify, sudo, secret, display.install.sudo, vault.*, tour,
  preview.*, terminal.read, window.read`). A client that never says so is treated as too old and every prompt is
  **withdrawn at once** ("the attached client cannot answer approval requests"): it can read a chat but never
  answer anything. An older server has no such method (`-32601`); ignore that.
- A client must answer a request it cannot handle with error `-32601`, or the agent waits its full deadline.
- `approval` params `{request_id, command (redacted), description, choices, allow_session, allow_permanent,
  smart_denied?, tool_name?}` → result `{choice: once|session|always|deny, all?}`. The `request_id` is the server's
  queue id; `approval.respond {session_id, request_id, choice}` still exists as an RPC and answers the same prompt.
- `clarify` params `{question, choices?, multi_select?}` or `{questions:[{qid, question, choices, multi_select}]}`
  → result `{answer}` or, for a batch, `{answers:{qid: answer}}` (`clarify.lock {request_id, question_id, answer}`
  locks one early). A multi-select answer is a JSON array string.
- `sudo {command}` and `secret {env_var, prompt, metadata?}` → result `{value}`; `''` means skipped.
- `request.cancel {id, method, reason}` is an **event** that withdraws an open request (timeout, answered
  elsewhere, interrupt): clear that card. It replaces the per-kind `*.expire` events.
- `session.resume`, `session.activate` and `session.events.since` return **`open_requests`**: requests still waiting
  (`{id, method, params}`), to re-deliver after a reconnect.
- Verified live: a `clarify` asked by a real bot appeared as a card and the answer reached the bot. Not yet
  verified live: `approval` and `sudo`.

`src/lib/hermes/server-requests.ts` turns each request into the event the transcript already understands and
answers it as the response; `gateway-client.ts` no longer treats an `id`+`method` frame as an answer to our own
call (that was how prompts were silently dropped).

## Bot Screen (Hermes 0.21.5; contract from upstream `tui_gateway/contracts/display.py`)

Exists at 0.21.5 (`tools/bot_desktop/`). On a fresh host it can be `supported` but **not installed** (host packages
missing). Every method takes `profile` and answers for that bot's screen.

- `display.status` → `{profile, supported, installed, missing[], running, pid?, display?, socket?, geometry
  ("1440x900"), install_command?, browser?, blocker? (why start would refuse), memory_available_mb?,
  memory_limit_mb?, lease, profile_key}`; `lease = {holder: agent|human, viewer_hash?, since, epoch, reason}`.
- `display.start` (idempotent, blocks until up) / `display.stop {force?}` (refused with 5300 `viewer_mismatch`
  while a human holds the lease). `display.thumbnail` → `{data_url|null, suppressed?: "human_has_control"}`.
- `display.observe {viewer_id?}` → `{ticket, path:"/api/display/ws", viewer_id, …status}`: a single-use 30 s ticket
  for the raw RFB websocket, plus a **viewer id minted per connection** (a reconnect gets a new one).
- `display.lease.acquire {viewer_id, reason?}` / `display.lease.release {viewer_id?, force?}` → `{lease}`. Take
  over / hand back. The agent's `computer_use` refuses to act while a human holds the lease.
- `display.install` runs the distro package install **on the host**: it asks for sudo through the server request
  `display.install.sudo {profile_key}` (answer `{value}`), streams `display.install.log {profile_key, line}`, and
  ends with `display.install.done {profile_key, code, status}` (0 ok, -1 cancelled, -2 no sudo).
- Events: `display.status` (screen started/stopped, even from outside) and `display.lease {profile_key, lease}`.
- Errors use code **5300**, with `data.code: "viewer_mismatch"` for lease/viewer problems.

Verified on home-server (0.21.5) with the app (`features/display`, `components/screen`):
- `display.install` ran the host's package install (on a host where sudo did not prompt, so no `display.install.sudo` ask),
  streamed `display.install.log`, and ended `display.install.done {code: 0}`; `display.start` then brought the
  Xvnc + Xfce desktop up (1440x900).
- The display websocket is `/api/display/ws?display_ticket=` (single-use, 30 s, from `display.observe`). It speaks
  raw RFB (binary). noVNC's own `disconnect` event hides the close code, so the viewer page opens the `WebSocket`
  itself and hands it to noVNC (`new RFB(target, socket)`) to read it: 4000 control taken, 4001 screen gone,
  4401 ticket spent, 4403 policy, 1003 protocol.
- The **server** enforces who may send input: the bridge drops key, pointer and clipboard messages unless the
  connection's viewer id holds the lease (`rfb_filter.py`), so noVNC's `viewOnly` is only a UI hint. Pointer and
  keys both pass once the lease is held; both are dropped before.
- Viewer ids are per websocket connection to `/api/ws`; the lease names its holder by `sha256(id)[:12]`
  (`viewer_hash`), computed client-side to recognise "mine". Take over: `display.observe` (mints the id) then
  `display.lease.acquire`. Each Take over / Hand back is a new lease `epoch`.
- A viewer that drops (app killed) keeps the human's lock by design, so the bot stays paused; any client can take
  over, or release with `display.lease.release {force: true}` ("Give control back" in the app).
- Closing the viewer websocket hands control back (the server treats it as the viewer leaving), so the app must
  not close it for a momentary `running: false` in a status snapshot.

## Why the bot's browser may not be on its screen (Hermes 0.21.5, from source at tag v2026.9.24)

A bot's browser tool only appears on its Bot Screen when ALL of these hold; verified against home-server, where
`browser.headed: true` alone did nothing:
1. **Headed mode**: `browser.headed: true` in the profile config or `AGENT_BROWSER_HEADED=true`. Default is
   headless (no window on any display).
2. **No CDP override.** Session creation is `CDP override > hybrid local sidecar > cloud > local`, and `--headed`
   is only added on the local branch. An override is `BROWSER_CDP_URL` (env, wins) or `browser.cdp_url`: the tool
   then attaches to that already-running Chrome (`--cdp`) and `headed` is ignored. For example, it can
   point at a pre-started headless Chrome (`--ozone-platform=headless`, port 9222).
3. **The screen is running when the browser process starts.** `desktop_env` merges the screen's DISPLAY, profile
   and browser executable only then; a daemon started earlier keeps its old environment until it restarts.

With 1-3 met, Hermes launches Chromium on the screen using the SAME `--user-data-dir` as the dock's Browser icon
(`<HERMES_HOME>/bot-desktop/browser-profile`), so what you log in to when you take over is what the bot uses. A
hand-launched Chrome attached over CDP (a workaround the bot may choose) has its own profile, e.g. under `/tmp`.

The lease fence applies only to LOCAL sessions: while a person holds the screen every browser action AND read is
refused with `{success: false, code: "human_has_control"}`, as is every `computer_use` call. A CDP-override
session is unfenced. So once the browser is on the screen, a held screen (a stale lease, a viewer left open)
will block the bot: the app shows those steps as "Waiting for you to hand back the screen".

A bot's chat claim that a page "loaded" comes from the browser tool (CDP), not from looking at the screen. Trust the
picture.

## Reading a tool step's exit code

`terminal` results carry `exit_code`. A non-zero code is not always a failure: `pgrep`/`grep`/`diff`/`test`/`which`
exit 1 for "no match", and Hermes reports a command ended by a signal as a negative code (a `pkill -f` that
matches its own shell ends it with -15 after doing its job). The app treats those as finished steps (keeping the
code, shown quietly as `exit 1` / `signal 15`), and a run reads as failed only when it ENDS on a real failure.

## Captures

`npm run smoke` regenerates `docs/protocol-captures/*.jsonl` (sanitized: home paths become `~`, credentials are
redacted, only the `default` and throwaway rows of the roster are kept): `basic`, `approval`, `interrupt`,
`clarify`, `failure`, `profiles-list`, `session-create`, `active-list`, `resume-live`, `resume-cold`, plus
`messages.json`. Each line is `{"kind":"rpc", method, params, result}` or `{"kind":"event", event}`.
`src/lib/hermes/protocol.test.ts` checks them, and the transcript reducer replays them.

## Side chats (other than Bot Chat)

A bot has one main chat: its Bot Chat, the session titled exactly "Bot Chat". Hermes and Grok Bot both treat it as the bot's one
long conversation, and the server enforces it: renaming the canonical row (`PATCH /api/sessions/{id}` with a new title) answers
400 "This is the bot's canonical Bot Chat - its name is its identity, and renaming it would orphan the conversation. To start
fresh, create a new bot instead." So nothing can replace it. The app's **side chats** are ordinary sessions next to it, and are
temporary: they are scratch space, never what Home previews or what tapping the bot opens.

- **New side chat:** `session.create {profile}` with no `title`/`hidden`/`follow_profile_config`. It has no stored row until its
  first prompt, so `session.list` does not show it yet, and `GET /api/sessions/{id}/messages` is a 404 for it: that is an empty
  chat, not an error.
- **History:** `session.list {profile, limit}` -> `{id, resolved_id?, title, preview, started_at, message_count, source}`, newest
  first (no `last_active`). `source: "cron"` rows are routines and are left out (resuming one would disturb it).
- **Open one:** `session.resume {session_id: <stored id>, profile}`, as for Bot Chat.
- **Delete:** `session.delete {session_id: <stored id>, profile}`. The server refuses while the session is live on this
  connection, so `session.close` the live id first. Never the Bot Chat.
- **In memory only:** which side chat a bot is showing is not saved. Leaving the bot (or restarting the app) returns it to its
  main chat. The side chat stays on the server, in the list, until it is deleted. (An earlier version saved a pointer in
  `hermesbot.chats`; it is deleted at startup.)
- Capability changes (skills, toolsets, MCP, SOUL.md, the roster) are re-applied to a **Bot Chat** at the start of each turn
  (`_sync_bot_capabilities`, which only acts on a session titled "Bot Chat"). A side chat does not get that, so a new side chat
  (a freshly built agent) is how it picks up changes; `.env` edits need `reload.env`, and credential or provider changes a fresh
  agent (`/new`).

### The inbox ("Between bots")

With hermes-bot-fixes 0.5 on the server, a message from another bot runs in the bot's **inbox**, a session titled "Bot Inbox",
instead of its Bot Chat, so the main chat is never busy with other bots and never shows what they said to each other.

- **Find it:** `session.list {profile, title: "Bot Inbox", include_hidden: true}`, an exact lookup outside the newest-80 window.
  Open the row's `resolved_id` (the chat Hermes continued it into after compressing it, titled "Bot Inbox #2" and so on).
  A server without the plugin answers no rows, and the app shows no inbox row.
- **Chats list:** "Between bots", right under Main chat. Inbox rows, continued ones too, are never listed as side chats.
- **Read only:** it opens in the past-chat view with every turn shown (all of it is between bots, so the "show bot chatter"
  preference does not apply) and no "Continue this chat". Writing in it would hold it live, and the next bot's message would be
  turned away as busy.

## Routines (cron jobs), verified on Hermes 0.21.6 (home-server)

A bot's routines live in its own profile, so every REST call names the bot with `?profile=` (omitting it lists every
profile's). The router is `hermes_cli/web_routers/cron.py`; the app's typed calls are `src/lib/hermes/cron.ts`.

- `GET /api/cron/jobs?profile=<bot>` → a bare array of jobs: `{id, name, prompt, schedule{kind: once|interval|cron, expr |
  minutes | run_at, display}, schedule_display, enabled, state (scheduled|paused|completed|error), next_run_at,
  last_run_at (ISO strings with the server's offset), last_status (ok|error|null), last_error, last_delivery_error,
  failure_streak, ...}`. A paused job has `enabled: false` and `state: "paused"`.
- `GET /api/cron/jobs/{id}/runs?profile=&limit=20` → `{runs: [session rows], limit}`, newest first. A run is an
  ordinary session whose id is `cron_<job id>_<timestamp>` and `source: "cron"`. **On 0.21.6 the row has no
  `end_reason`** (keys: `id, title, preview, source, started_at, last_active, ended_at, input_tokens, output_tokens,
  message_count (0), tool_call_count, model, cwd, archived, is_active`), so a run carries no outcome of its own: an
  older source version booked `cron_complete` / `cron_incomplete_no_output`, which the app honours when present.
  A run in progress has no `ended_at`; duration is `ended_at - started_at`. The only success/failure signal is the
  JOB's `last_status` (`ok`/`error`) and `last_error`, which describe its newest run. Never `session.resume` a run.
- `POST /api/cron/jobs/{id}/pause` and `/resume` → the updated job. `DELETE /api/cron/jobs/{id}` → `{ok: true}`.
- `POST /api/cron/jobs/{id}/trigger` ("Run now") holds the request until the run **finishes**, so the app waits ~10 s,
  aborts its own request and polls the history; the run carries on server-side. A job that is already running
  answers **409**. Triggering a paused job resumes it.
- There is no create-routine call the app uses: a routine is set up by asking the bot in chat ("Set up a routine that
  ..."); the bot's `cronjob` tool creates it (it refuses, for example, a `script` that does not exist). The tool
  call shows as failed in the chat when the server refuses.
- The server's schedule text is raw (`0 2 * * *`, `every 30m`); the app words common shapes itself
  (`describeCron`) and falls back to the raw text.

## Group rooms (`groups.*`), verified on Hermes 0.21.6 (home-server)

Read from upstream at the server's tag `v2026.9.24` (`tui_gateway/methods_groups.py`, `gateway/hosted_rooms.py`,
`gateway/hosted_room_discussion.py`), not the newer local copy. The server runs rooms itself: bots keep replying with
the app closed. Typed calls and the log reader are in `src/lib/hermes/rooms.ts`.

- `groups.capabilities` → `{protocol_version: 2, driver, max_log_limit: 500, ...}`. `driver: false` means the room
  worker is not running (create/send answer 4123). The app hides "New room" unless `driver` is true.
- `groups.create {room_id, name, members[{member_id, profile, handle, display_name?}]}`: **2 to 6 members**, profiles
  local to this server, handles unique ignoring case and never `all`/`everyone`. Ids match
  `^[A-Za-z0-9][A-Za-z0-9._:-]*$`. Idempotent by `room_id`. The app uses `r-<base36>`, `m-<profile>` and the bot's
  display name slug as the handle (`@zz-room-a`).
- `groups.list` → `{rooms, next_offset}`; `groups.state {room_id}` → `{room, driver_status}` where `room.latest_seq` is
  the newest event number and `driver_status = {running, working, blocked, counts, pending_actions}`.
- `groups.send {room_id, event_id, payload: {text, thread_id}}`: the server stores its own id for your `event_id`
  (a retry key), the actor is always `{kind: "user", id: "desktop"}`. One thread is enough: the app uses `t-main`.
- `groups.log {room_id, since_seq, limit}` → `{events, cursor, latest_seq, has_more}`; `since_seq` ahead of the log is
  an error, so read `latest_seq` from `groups.state` first. Poll: 2 s in an open room, 5 s for the list.
- **Who answers:** the user's message selects round 0: every member if it mentions nobody, else only the `@handle`s it
  names (`@all`/`@everyone` mean all). Later rounds (max 3) are only bots a bot has `@`-cited and that have not
  spoken since. A bot may say nothing (`turn.settled {passed: true}`, then `room.activity {status: settled,
  reason_code: silent_round}`).
- Events (`kind`): `message.user`, `message.member` (payload `{member_id, text, thread_id, turn_id, ...}`),
  `turn.settled|failed|cancelled|deferred`, `room.activity`, `room.stop_requested`, `room.created|renamed|...`.
  There is no "turn started" event at this tag (`turn.started` is a known kind but never written): "replying" is
  `driver_status.working` (`counts` has running/queued). **Who** is replying: each member answers a room in its own
  hidden session titled `Group: <room_id>` (source `bot_room`, made on its first turn there), found with `session.list
  {profile, title, include_hidden: true}`; `session.active_list` rows for it (`session_key` = that stored id) say
  `working` while it replies (verified on 0.21.6). For a member with no session here (another server) the app reads the
  log instead: the bots the latest user message asked (its `@handles`, or everyone), plus any a bot `@`-mentioned that had
  not spoken yet, until each has a `turn.*` end event. A member that already spoke is not asked again by a mention.
- **Needs you:** there is no server flag. A bot addresses you with `@you` (or `@user`) in its text; the app treats
  the latest `message.member` with it, with no `message.user` after, as waiting. Approvals are real:
  `driver_status.pending_actions[] = {kind: "approval", task_id, member_id, execution_generation, request_id,
  approval: {command, description, choices}}` answered with `groups.approve {room_id, member_id, task_id,
  execution_generation, request_id, choice: "once"|"deny"}` (no session/always for rooms; error 5119 "no longer
  pending" means it was already answered). `kind: "retry"` rows (indeterminate/deferred tasks) use `groups.retry`.
  The approval path is unit-tested but not yet seen live.
- `groups.stop {room_id}` cancels queued/running work; `groups.disband {room_id}` tombstones the room for good (the
  bots' own chats are untouched); `groups.rename {room_id, event_id, name}`.
- Rooms made in Hermes Desktop on this server show up here (same `groups.list`); Desktop also mirrors its rooms in
  `ui_meta['hermes-bots-groups']`, which the app does not use.

## Rows stored as user turns that the user did not write (verified on Hermes 0.21.6)

The transcript has `role: "user"` rows that are not the person: the app draws them apart (`features/transcript/injected.ts`).

- **A bot waking up** because a background process finished: `[IMPORTANT: Background process proc_x completed normally
  (exit code 0).\nCommand: ...\nOutput: ...]` (also `matched watch pattern`, `exited`, `terminated by ...`, `marked
  lost ...`, `failed to start`; wording in `tools/process_registry.py`). In one bot's own chat the row has
  `display_kind: "process_complete"` and `display_metadata: {display_text}` (the command line, long); in **another
  bot's chat the same row has no `display_kind` at all**, so the app also recognises it by its `[IMPORTANT:` wording. Shown
  as one quiet line ("Background process finished"), never the command, paths or session ids.
- **Typed bookkeeping rows** (`display_kind`): `async_delegation_complete`, `model_switch`, `personality_switch`,
  `auto_continue`, `internal_notification`, `failed_turn` become quiet lines (the row's `display_metadata.display_text`
  when there is one). `steer` and `skill_invocation` are things the person did and stay as their bubble; `hidden` rows
  stay hidden.
- **Another bot's message** (`message_agent`): `Message from 🤖 juniper (@juniper): <body>`, or the older `Message from
  agent 'juniper': ...`, stored as a user turn with no `display_kind` in the receiving bot's Bot Chat. Drawn as that bot's
  bubble with its face and name; `@hermes` is the default profile.

### Conversations between bots

Hermes stores a bot's conversations with other bots in the person's one chat with it (there is no separate inbox), so
the app works out which turns are between bots and leaves them out (`itemsFromHistory` marks them `chatter`; Settings →
"Show messages between bots" brings them back). Read from the real rows on home-server:

- **A turn another bot started** (`Message from 🤖 juniper (@juniper): ...` as a user-role row) and everything the bot did
  until the next user-role row is between bots. While it is still running, `session.resume` gives the text that started
  it in `inflight.user`, so a turn that is running when the chat opens is recognised too.
- **A bot's own message to another bot** is a `message_agent` tool call (`target` is a profile name, `hermes` for the
  default profile). The answer comes back as a wake-up user row: `[IMPORTANT: Background process ... completed
  normally ... Command: .../bot_mode_dm.py --run-delivery ... hermes -p <target> chat ...]`, which names the bot it was
  sent to. That wake-up starts the turn where the bot reports to the person, and it is always shown, even when the
  message was sent while answering another bot: `bot_mode_dm.py` hands the sender only the reply of the turn its message
  started, so nothing the bot says after a wake-up reaches another bot. (Carrying "between bots" over to wake-up turns
  once hid hours of a bot's work, its questions to the person included, after one message from another bot: each
  wake-up passed it on to the messages sent in its turn, and how much was hidden depended on where the page read began.)
- Peer and relay deliveries (`tools/bot_relay.py`) wake the bot the same way.
- Home's preview and age, and the unread dot, use the last message the chat would show, not the server's preview (which
  counts everything). It is read from the newest 60 stored messages whenever the roster says a chat's last activity or
  message count changed (`message_count` is the cheap tell: the activity time can move before the message is readable).
- `status.update` text for the wake-up is "Background Process Finished: <command>", so the header status is blanked.

## Attachments, media and voice (Hermes 0.21.6, verified on home-server)

Contracts read at the server's tag (`tui_gateway/contracts/prompt_voice.py`, `hermes_cli/web_routers/{audio,files}.py`).

- **Sending files** (`src/lib/hermes/attachments.ts`): the app keeps picked files on the phone and uploads them when you
  press send, then submits one message. Images: `image.attach_bytes {session_id, content_base64, filename}` queues the
  image on the live session for the next `prompt.submit` (25 MB). PDFs: `pdf.attach` renders pages to images (needs
  `pdftoppm` on the server, else error 5028: the app falls back to `file.attach`). Other files: `file.attach {session_id,
  name, data_url}` stages the file in the session workspace and returns `ref_text` (`@file:attachments/notes.txt`),
  which goes into the message text before your words. A message with no words is sent as the server's own hint
  (`[User attached image: upload_….png]`). Queued uploads live on the *live* session, so a stale session id means
  uploading again on the re-attached one.
- **How it is stored:** the stored user row is what the model saw: `@file:attachments/notes.txt\n<your words>\n\n---
  Attached Context ---\n\n📄 @file:attachments/notes.txt (10 tokens)\n```\n<the file's contents>\n```\n@image:/home/orion/
  .hermes/profiles/<bot>/images/upload_<ts>_1.png\n[screenshot]`. REST rows have no `display_content`; Desktop
  (`lib/chat-messages/hydration.ts`) splits at `--- Attached Context ---`, and so does the app
  (`features/transcript/userContent.ts`): your words, plus a chip per `@file:`/`@image:` reference. A PDF shows once by
  name, not as its rendered pages.
- **Seeing a picture:** `GET /api/fs/read-data-url?path=<abs path>&profile=<bot>` → `{dataUrl}` (16 MB, any regular
  file the server user can read, auth-gated). `GET /api/media?path=` → `{data_url}` only serves the *server's* shared
  `images/`, `screenshots/` and `cache/` folders, not a bot's own `profiles/<bot>/images/`, so it is only the fallback.
  A bot sends a file back with a line `MEDIA:/abs/path.png` in its reply; the app lifts those lines out of the text,
  shows a chip, and fetches the picture only when you tap it.
- **Voice** (`src/lib/hermes/audio.ts`, `useVoiceNote`): `POST /api/audio/transcribe?profile=<bot>` with
  `{data_url: "data:audio/m4a;base64,…", mime_type}` → `{ok, transcript, provider}` using that profile's speech-to-text
  (25 MB). Silence is `transcript: ""`, not an error. The server's own `voice.record` listens on the *host's*
  microphone, so it is not used. The phone records m4a with `expo-audio`'s `HIGH_QUALITY` preset.

## Slash commands and skills (Hermes 0.21.6, verified on home-server)

Contracts read at the server's tag (`tui_gateway/methods_tools.py`, `methods_slash.py`, `agent/skill_commands.py`).

- **`commands.catalog {session_id}`** → `{pairs, canon, skills, categories, commands, sub, warning}`. `pairs` is every
  `["/name", "description"]`: the built-in commands first, then the bot's own quick commands and plugin commands, then one
  per skill (a skill whose name is a built-in is left out). `canon` maps every built-in name and alias to its canonical name
  (`/reset` → `/new`). `skills` maps `/name` → `{usage, origin}` (`usage` = times used; the picker ranks by it).
  `categories` lists "User commands" and "Plugin commands". Bundles are not in it (they only resolve when dispatched).
  The catalog follows the *session's* profile and workspace, so ask through that bot's live chat.
- **`command.dispatch {session_id, name, arg}`** → one of `{type:'exec'|'plugin', output}`, `{type:'alias', target}`,
  `{type:'send'|'skill', message, notice?, display?}`, `{type:'prefill', message, notice?}`. It only serves quick, plugin,
  bundle and skill commands plus a few built-ins (`plan learn init goal loop steer queue retry undo compress moa focus`);
  anything else is error 4018 `not a quick/plugin/bundle/skill command: <name>`. For `send`/`skill`, `message` is what the
  model gets (a skill's whole body) and `display` is what to show. The app sends `message` with `prompt.submit` and shows
  `display`, falling back to the invocation read from the skill text, then to the typed words.
- **`slash.exec {session_id, command}`** → `{output, warning?}` is the server's own runner, the one Hermes Desktop and the TUI
  use for every built-in command. It takes the same words the terminal does. It answers a few commands with a dispatch-shaped
  result instead (`/goal`, `/steer`, `/undo`, `/retry`, `/plan`, `/learn`, `/queue`, `/compress`…, and bundles), and fails with
  `skill command: use command.dispatch for /x` for a skill. The server mirrors the side effects of `/approvals`, `/personality`,
  `/prompt`, `/fast`, `/reload-mcp`, `/stop`, `/model` and `/compress` into the live chat.
- **What the phone offers** (`src/lib/hermes/slash.ts`): everything `commands.catalog` lists (every built-in command the server does
  not hide, the bot's own quick and plugin commands, and its skills), with no allow-list, by design: `/restart`, `/update`,
  `/pause`, `/yolo` and the rest are there and run as typed. Hermes Desktop hides about thirty of them as "terminal-only"; the app
  does not. How one runs: a built-in goes to `slash.exec` first and, if the runner fails, to `command.dispatch` (the same order
  Desktop uses); a skill or one of the bot's own commands goes straight to `command.dispatch`; a word the catalog has not heard of is
  tried with `command.dispatch` (it may be a bundle) and, on 4018, says "There is no command called /x" and gives the words back.
  When `command.dispatch` says "not a quick/plugin/bundle/skill command" only because the runner had already failed, the runner's
  error is shown, as Desktop does. A built-in the server hides from the catalog (`/approve`) still runs, through `slash.exec`.
- **The server's slash worker (home-server, Hermes 0.21.6):** most built-ins are run by a separate worker process that the first one
  spawns, and the server waits 45 s for each answer (`HERMES_TUI_SLASH_TIMEOUT_S`). `/status`, `/usage`, `/context`, `/tools`, `/help`,
  `/history`, `/prompt`, `/review` and a bare `/model` are answered from the live chat without it. In my test on a fresh bot, `/reasoning`
  and `/help` both failed with `slash worker timed out` after 45 s, while `/status` answered at once and `/undo` (dispatch) worked, so
  the worker was not starting on that server. The app shows a "Running…" line while it waits and the server's error when it fails.
  Not tried live, on purpose: `/restart`, `/update`, `/pause`, `/yolo` and the other commands that change the server (the project rule
  is not to restart or update a real server while testing); they are unit-tested through the same path as the rest.
- **Which commands exist where.** `commands.catalog.pairs` leaves out the `gateway_only` commands: `/restart`, `/pause`, `/start`, `/topic`,
  `/platform`, `/approve`, `/deny`, `/sethome`, `/commands`. They belong to Hermes's *messaging* gateway (Telegram, Discord…), and the
  terminal runner (`cli.process_command`) has no handler for them, so typed over an app connection they only produce "Unknown command".
  They are not an app-reachable way to restart the server (there is no RPC for that). The same catalog's `commands` map still names them,
  so a typed one is sent to the server rather than guessed at. `/update` is a normal built-in, listed, and Hermes Desktop marks it
  "terminal". `commands['/x'].desktop` says which commands Desktop keeps out of its list (`terminal`, `messaging`, `settings`,
  `advanced`, `hidden`, `composer-voice`); the picker lists them after the others when browsing and after equal matches when searching.
- **Presentation.** Descriptions end in `(usage: /name <args>)`; the picker shows the arguments dim beside the name and the sentence
  below. Terminal programs print colour codes (`ESC[1;31m…`), so anything a command prints is stripped of them. `/help` is a list of
  whole command names under dim category titles, laid out as a wrapping row so a name is never split across lines.
- **Four commands are the app's own screens**, because over a phone they are not text: `/new` (also `/reset`, `/clear`) starts a
  side chat (`sessions.newChat`; the name argument is not used), `/resume` and `/sessions` open the Chats list, `/quit` and
  `/exit` leave the chat, and `/help` is answered from the catalog the picker already holds (no worker, no wait): the commands by category, `/help skills` for the skills, `/help <word>` for the lines that mention it. `/title <name>` in a bot's *main* chat asks first, because Hermes finds Bot Chat by its title.
- **Commands that rewrite the chat** (`/undo`, `/retry`, `/rollback`, `/compress`, `/compact`): the server changes its stored history,
  so after one the app reads the chat again (`session.resume`) before showing the command's notice or resending: otherwise the
  transcript would still show turns the server has dropped, and `/retry` would show its message twice.
- **Output is local.** What a command prints is drawn in the chat as an `output` item and is not stored by the server, so a
  reload drops it. A `send`/`skill` turn is stored and comes back from history.
- **Stored skill turns:** `session.resume` projects them (`display_kind: 'skill_invocation'`), but
  `GET /api/sessions/{id}/messages` does *not*: the row's `content` is the whole scaffold,
  `[IMPORTANT: The user has invoked the "work" skill, indicating they want you to follow its instructions. The full skill
  content is loaded below.]` … skill body … `The user has provided the following instruction alongside the skill
  invocation: <your words>` (a bundle: `…"/a /b" stacked skill bundle…` and `User instruction: <your words>`). The app ports
  Hermes's `describe_skill_invocation` (`skillInvocation` in `features/transcript/userContent.ts`) and checks for it before
  the "injected `[IMPORTANT: …]` row" rule, which would otherwise draw a skill turn as a grey server note.

## Searching messages (Hermes 0.21.6, verified on home-server)

- **`GET /api/sessions/search?q=&limit=&profile=`** → `{results: [...]}`. One profile per call (no `profile` means the server's own
  default), so the app asks every bot on Home at once and merges the answers. It matches a session by id first, then by full-text
  over every message (prefix match: `4821` also finds `482129`). **One hit per chat**: results are de-duplicated by chat, and the
  first match found wins, so there is no list of every matching message. A hit has `session_id` (the newest segment of a chat that
  was compressed), `lineage_root` (its first), `title`, `source`, `role`, `snippet`, `last_active`, `message_count`, `profile`.
- The snippet is SQLite's: the words searched for sit between `>>>` and `<<<`, with `...` where it was cut. A hit inside a tool call
  or a tool's result comes back as JSON text (`{\"content\": \"…\"}`, `[{"id": "call-…`); the app unescapes it and shows it as it is.
- **What the app drops** (`worthShowing`): chats whose source is `cron` (routine runs have their own screen) and chats whose match is
  a line bots send each other or the server writes (`Message from 🤖`, `[IMPORTANT: Background process`, `[System:`). It cannot drop
  a *tool* match, or any role: with one hit per chat that would hide a whole chat whose other messages also match.
- **A hit opens read-only.** The bot's main chat (`canonical_session` by id, resolved id or lineage root) opens as the bot always
  does. Any other chat opens in `bot/[profile]/past`, which reads `GET /api/sessions/{id}/messages` and never calls
  `session.resume`: some sessions cannot be resumed from a phone (a Kanban worker's transcript: `⛔ Session … is a Kanban worker
  transcript. Resuming it here would create a writer the Kanban board cannot observe or supervise`). "Continue this chat" tries
  `openChat` and shows the server's reason in place when it is refused.

## How a bot's pictures reach the app (Hermes 0.21.6, verified on home-server)

A bot is told how to deliver a file by the *surface* the server thinks it is on (`agent/prompt_builder.py`, `PLATFORM_HINTS`), and the
surface comes from the server's environment (`_resolve_session_platform`: `HERMES_DESKTOP=1` is "desktop", anything else "tui"), not from
anything the client sends (`prompt.submit` only accepts `surface: "hud"|"voice-live"`). On "desktop" the model is told "deliver files by
writing `MEDIA:/absolute/path`"; on "tui" it is told `MEDIA:` tags are **not** intercepted and to "deliver a file by stating its absolute
path in plain text". home-server behaved as "tui": asked in plain words for a picture, the bot ended its reply with
`/home/orion/.hermes/profiles/zz-pics/images/green-triangle.png` and no `MEDIA:` line. So the app cannot rely on `MEDIA:`. It draws a
picture from any of three sources (`lib/hermes/media.ts`, `features/transcript/display.ts`):

1. a `MEDIA:/path` line (lifted out of the text);
2. an absolute picture path written in the reply's words (`/home/…/x.png`, bare, in backticks or quotes, or as a link): a line that is only
   the path is lifted out, a path inside a sentence is left in place; a path that cannot be loaded is dropped without a word;
3. the result of an `image_generate` tool (`host_image`, else `image`: a server path or an https URL), drawn under that tool's line, as
   Hermes Desktop does. A reply that also states the same path does not draw it twice (the display builder passes each reply the pictures
   its turn's tools already made).

Pictures are fetched when a chat first draws them (`GET /api/fs/read-data-url`, three at a time), kept in memory up to about 24 MB of
data-URL text (least recently used out first), and shared with the full-screen viewer. A picture you send stays a named chip. A stored
photo message with words is `words\n@image:/path\n[screenshot]` (no "Attached Context" marker), which `splitUserContent` now reads as the
words plus a chip.

- **HEIC photos (found live, Hermes 0.21.6):** `image.attach_bytes` answers `unsupported image extension: .heic` for an iPhone's own format: the server
  reads png, jpg, gif, webp and bmp. The library picker returns the original HEIC unless asked for the compatible form, so `pickPhotos` passes
  `preferredAssetRepresentationMode: Compatible` (converted to JPEG on the phone), and `refusal` stops a leftover HEIC before the upload with a
  plain message. Before this, a real iPhone photo could not be sent at all; only PNGs I had put in the simulator's library worked.

- **Pictures load only for rows that are on screen.** A chat can hold many photos and the server has no thumbnail route (`/api/fs/read-data-url` returns
  the whole file, base64), so a picture is not fetched until its row has been in view for 250 ms (`FlatList` `onViewableItemsChanged`, tracked in
  `stores/visibleRows.ts` and read with `useRowVisible`); a row that leaves lets go of it (`pictures.release`), and a download still waiting for one of the
  three connection slots when nobody wants it any more never starts. Measured on the simulator against home-server with 40 rows of 60 KB pictures:
  7 requests on opening (the 7 rows in view), 14 in total after one hard fling through all 40 rows, 21 after viewing 21 rows in three flicks; none for
  rows that only flew past. Loaded pictures stay in memory (about 24 MB, least recently used out first), so scrolling back does not fetch again.

## Tools (toolsets) (Hermes 0.21.6, verified on home-server)

- **`GET /api/tools/toolsets?profile=<bot>`** → `[{name, label, description, platform, platform_label, enabled, available, configured, tools[]}]`,
  the configurable toolsets (web, browser, terminal, file, code execution, vision, image and video generation, text-to-speech…) as the
  dashboard lists them. `description` is the server's list of the tools in it; `configured: false` means what it needs (an API key, a login)
  is not set up on the server; `platform` is where its switch lives (`cli` for most).
- **`PUT /api/tools/toolsets/<name>?profile=<bot>`** with `{enabled, profile}` → `{ok, name, platform, enabled, post_setup_started}`. It writes
  that bot's own config (`platform_toolsets.cli`); the bot has the change on its next message. Enabling one whose installer is missing starts
  the server's own background installer. **Always send `profile`**: an RPC alternative, `tools.configure {action, names}`, resolves the profile
  from a live `session_id` and, without one, edits the *server's default profile's* config, which the app never does.
- Seen live on a throwaway bot: 20 of 29 on; switching Text-to-Speech off persisted across an app restart (19 of 29).

## Keys (a bot's `.env`) (Hermes 0.21.0 to 0.22.2, from source at tags `v0.21.6` and `v0.22.2`, verified on a local 0.21.0)

Hermes's own web Keys page routes (`hermes_cli/web_routers/config_env.py`, the same at both tags). Details → Keys uses them, so a key
goes straight into the bot's `<home>/.env` with no model in the loop.

- **`GET /api/env?profile=<bot>`** → `{NAME: {is_set, redacted_value, description, url, category, is_password, advanced, tools,
  channel_managed, provider, provider_label, custom}}` for every name Hermes knows (about 350) plus whatever else the `.env` holds
  (`custom: true`, `category: "custom"`, always `is_password: true`). `redacted_value` is a preview, never the value: `«redacted:sk-a...wxyz»`
  from 0.21.5, a bare `sk-a...wxyz` before. `channel_managed` rows belong to Hermes's Channels page; Hermes's Keys page hides them and so
  does the app. An unknown bot is 404 `Profile '<bot>' does not exist.` A fresh bot's `.env` already holds a dozen non-secret settings
  (`TERMINAL_TIMEOUT`, `*_DEBUG`…), which come back as `custom`.
- **`PUT /api/env?profile=<bot>`** with `{key, value, profile}` → `{ok, key, config_updates}`. It also moves config.yaml mirrors of the old
  value and Hermes's credential pool over to the new one. 400 (with a string `detail`) for a denylisted name (PATH, LD_PRELOAD, HERMES_HOME…),
  an invalid name, a name an administrator pinned and, from 0.21.5, a value shaped like a preview; 0.21.0 would save a preview, so the app
  refuses one itself. Non-ASCII characters are stripped from any value without an error. **A 422 echoes the whole body, value included,
  in `detail[].input`**: the app never shows or logs a write's response text.
- **`DELETE /api/env?profile=<bot>`** with `{key, profile}` → `{ok, key, removed, pool_pruned, providers, config_scrubbed, found}`, from every
  store. 404 `<NAME> not found in .env` when it was not there (an unknown bot is also 404, told apart by its `detail`).
- **`POST /api/env/reveal`** returns a real value. The app never calls it.
- When a change takes effect: a bot other than the server's own builds its secret scope from its `.env` on each turn
  (`agent/secret_scope.py`, cached by file stat). The server's own profile uses its launch environment, frozen once the server hosts more
  than one bot (`_config_profile_scope`), so the app also calls `reload.env` (as Details → Reload settings does). A running chat keeps its
  provider credential pool; `/new` resolves fresh.

## Live work: background commands and helpers (Hermes 0.22.2, from source at tag `v0.22.2` and verified on a local 0.22.2)

**What there is not:** no event reports progress *inside* a running tool step, on 0.21 or 0.22. A foreground step is
`tool.start` … `tool.complete` and nothing in between (the app's `tool.progress` case is for older servers and never fires;
the gateway drops `tool.started` on purpose). No fraction is ever sent for a terminal command. What 0.22 does report is work
that **outlives** the step that started it, and the app follows that (`features/transcript/jobs.ts`).

The upstream contract is `tui_gateway/contracts/events.py` (events) and `contracts/tools_commands.py`,
`contracts/profiles_vault_complete_foreign_subagents.py` (RPCs). Read from source, 0.21.6 already has the same events, RPCs and
background behaviour (not exercised there). The app follows background commands only for a server whose `/api/status`
`version` is 0.22.0 or later (`LIVE_WORK_SINCE` in `lib/hermes/capabilities.ts`). It follows helpers from 0.21.5
(`LIVE_HELPERS_SINCE`; upstream tag `v2026.9.24`): its top-level `delegate_task` already always runs in the background and
returns `dispatched`, and its generated gateway contract has the same `subagent.*` payloads, `subagent.list` and
`delegation.status` as 0.22.2. On a 0.21.5 server a background command's line is exactly as before.

**Background commands.** A `terminal` call leaves a process running and returns at once when it asked for `background: true`,
when its `timeout` is over the foreground cap (`TERMINAL_MAX_FOREGROUND_TIMEOUT`, default 600 s; 0.22.0 runs it in the
background instead of refusing it, and adds `promoted_from_foreground`), or when you send a message mid-command (the command
is moved aside, `status: "yielded_to_background"`, with what it printed so far as `output`). Its `tool.complete` result:

```json
{"output": "Background process started", "session_id": "proc_380c75f424d9", "pid": 63439, "exit_code": 0, "error": null,
 "notify_on_complete": true}
```

`session_id` here is the **process** id, not a chat. Then, to the chat whose step started it (routed by the stored session, so a
re-attached chat still gets them):

- `agent.terminal.output {process_id, chunk}`: raw output as the process prints it (verified: one frame per line the test
  runner printed). This is the progress text the app shows: the newest line, with a `\r`-redrawn bar read as its last frame.
- When it ends: `status.update {kind: "process", text: "Background Process Finished: <command>"}` (or `"… Failed (exit -15):
  …"`), then the bot is woken for a turn (`message.start` … `message.complete`) with the result as a stored user row (the
  app's quiet "note"). Nothing carries the process id at the end; `terminal.close {process_id}` exists but only closes Hermes
  Desktop's terminal tab, it is **not** sent when a process exits (verified).
- `process.list {session_id: <live chat id>}` → `{processes: [{session_id, command, cwd, pid, owner_task_id, started_at,
  uptime_seconds, status: "running"|"exited", output_preview, output_tail, notify_on_complete, exit_code, exited_at,
  completion_reason, …}]}`, running and recently finished, owned by that chat. `uptime_seconds` keeps counting after exit
  (use `exited_at`, epoch seconds); `started_at` is the server's local time without a zone; `output_tail` is the last 4000
  characters. Hermes Desktop polls it for its status stack; the app reads it when a chat opens, when a `process` status
  arrives, and every 20 s while a job runs on screen (a job started without `notify_on_complete` sends no news at all).
- `heartbeat: N` (seconds, min 60) on a background `terminal` call wakes **the model** every N s with the output since the
  last one (only when there is new output), as a hidden user row (`display_kind: "hidden"`); the client sees a turn and a
  `status.update {kind: "process"}` whose text is the whole heartbeat message. It is model plumbing, not a progress event; the
  app keeps `process` statuses off the header when it follows live work.

**Helpers (subagents).** On 0.22 a top-level `delegate_task` always runs its children in the background. Verified order:
`tool.start` → one `subagent.start` per child → `tool.complete` with

```json
{"status": "dispatched", "mode": "background", "count": 3, "delegation_id": "deleg_1d34ef0b", "goals": ["…", "…", "…"],
 "subagent_ids": ["sa-0-d6dae026", "sa-1-4d132c81", "sa-2-14dfa1fd"], "note": "…", "live_transcripts": ["…"]}
```

then, after the turn ended, `subagent.tool` / `subagent.thinking` / `subagent.progress` and one `subagent.complete` per child.
Every `subagent.*` payload has `goal`, `task_count`, `task_index` and (0.22) `subagent_id`, `delegation_id`, `depth`, `model`,
`tool_count`; `subagent.complete` adds `status` (`completed`, `failed`, `error`, `timeout`, `interrupted`), `summary`,
`duration_seconds`, token counts and `output_tail`. `subagent.progress`'s `text` is preformatted (`"🔀 [set 1 · 2/3] terminal"`)
and not parsed. When the last child ends: `status.update {kind: "process", text: "Subagent Tasks Completed: … (3 tasks)"}` and a
turn with the results. `subagent.list {session_id}` → `{subagents: [{subagent_id, parent_id, depth, goal, delegation_id, model,
started_at, status, tool_count, last_tool, accepting_steer}], delegations: [failed ones]}` holds **only live children** (a
finished one drops out), so after a reopen the app knows who is still working but not how many there were until the next frame
brings `task_count`. Finished-of-`task_count` is the only fraction the server gives, and the only thing the app draws as a bar.

`delegation.status {}` → `{active: [{subagent_id, parent_id, depth, goal, delegation_id, model, started_at, status, tool_count,
owner_agent_session_id}], paused, max_spawn_depth, max_concurrent_children}` lists **every** running helper on the server, with
the stored session id of the chat whose bot sent it off (`owner_agent_session_id`). The inbox poll reads it (0.21.5+), so Home
can say "Background · <goal>" for a bot whose chat is not open. The results' title (`async_delegation_display_text`) says
"Incomplete" for a helper that hit its step limit (`max_iterations`); the app reads it as "stopped at its step limit".

**Kanban news.** A kanban task a chat queued wakes that chat with one line per event (`tui_gateway/session_notifications.py`,
the same in 0.21.5 and 0.22.2): a mark (✔ done, ⏸ blocked, ✖ gave up or crashed, ⏱ timed out, 🔄 status), maybe `[board]`
and `@assignee`, then `Kanban t_… <what happened>`. It comes as `status.update {kind: "process"}` and then as the stored user
row of the turn it wakes; the app shows the row as a quiet note without the mark and the names.

**Other progress frames, not tied to a step:** `moa.progress {label, refs_done, refs_total}` (mixture-of-agents is a model
mode in 0.22, not a tool), `browser.progress {message, level}` (connecting the browser), `session.resume_progress`,
`preview.restart.progress`, `pet.*.progress`. 0.22.1's "managed tool progress" is `tool.start`/`tool.complete` with only
`{tool_call_id, name}` for managed-worker turns (no arguments or results), not a progress event.

**What the app shows (Card Stock, one quiet line per run):** while a step's job runs, it keeps the run's line: "Running npm run
test:browsers · 14m 2s" with the newest output line under it in mono, or "3 helpers working · 1 of 3 done" with a 3 px bar in
the spinner's track colours. After the turn, the chat header's quiet line says that something still runs ("In the background ·
14m", "Helpers · 1 of 3 done", "2 in the background"); it has room for little more next to its buttons. A finished job folds away: the header line goes, and the run reads "Ran 2 steps · 1h
12m", counting the job's time; its output and exit code are in the expanded step. A step still running in the foreground keeps
the line as it always did. When the helpers' results wake the bot (the `Subagent Task…` status), the header and Home say
"Reading the result…" for that turn instead of "Working…". Home previews a bot that is idle while its helpers work as
"Background · <goal>".

## Where a bot runs ("Runs on") (Hermes 0.21.6 and 0.22.2, verified on local copies; hermes-bot-mobile 0.1.4)

**What Hermes reads.** A bot's terminal comes from its own scope (`build_profile_terminal_scope`): defaults ← that bot's
`.env` (`TERMINAL_*`) ← its `config.yaml` `terminal:` section, the last one winning, bound per turn. The keys are `backend`
(`local`, `docker`, `ssh`, or a cloud sandbox: `modal`, `daytona`, `vercel_sandbox`, `singularity`), `ssh_host`, `ssh_user`,
`ssh_port`, `ssh_key` (a full path: Hermes hands it to `ssh -i` without expanding `~`) and `cwd`. Its SSH backend always
connects with `-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10`, `-p` only when the port is not 22,
and `-i <ssh_key>` when one is set (`tools/environments/ssh.py`).

**What the app writes.** `GET`/`PUT /api/config?profile=<bot>` (the PUT deep-merges), as for approvals: `{terminal: {backend}}`
for this computer or a container, `{terminal: {backend: "ssh", ssh_host, ssh_user, ssh_port, ssh_key}}` for another computer.
A blank `ssh_key` is never written, since it would hide a key named in `.env`. Moving onto SSH also sets `cwd: "~"` when the
folder was a path on the server (anything but `~…`, `.`, `auto` or `cwd`); moving back does not restore it. Cloud sandboxes
need keys on the server, so the app only shows them.

**When it takes effect.** The terminal environment is cached per chat (`session:<key>`) and reused until it has been idle for
`TERMINAL_LIFETIME_SECONDS` (300 s; a cleanup thread checks every 60 s). A new chat runs in the new place at once; a chat that
already ran a command stays where it was until 5 quiet minutes have passed (verified on 0.22.2: an open chat kept running
locally, then moved). `session.info`'s `terminal_backend` is not reliable for named bots (it reports the launch profile's
backend), so the app never uses it for this.

**SSH set up by Hermes's own wizard** keeps the address in the bot's `.env` (`TERMINAL_SSH_HOST`, `_USER`, `_PORT`, `_KEY`), so
`config.yaml` can say `backend: ssh` with no host. `GET /api/env` only returns redacted values, but
`GET /api/tools/terminal/backends?profile=<bot>` (0.21.6+) has an `ssh` row whose `detail` is `user@host` (it reads `terminal.*`,
then `TERMINAL_SSH_*`). The app shows that read-only and writes nothing unless the person enters another computer.

**What SSH copies.** When it connects, Hermes uploads the bot's skills, cache files and credential files
(`get_credential_file_mounts`) to `~/.hermes` on the other computer, as one tar stream over SSH, and syncs back only those
files. The bot's home, `.env` and `.ssh` are not copied (verified: the bot's key was not on the other computer).

**hermes-bot-mobile 0.1.4** adds what a phone cannot do, under `/api/plugins/hermes-bot-mobile/runs-on/`:

- `GET /key?profile=` → `{public: "ssh-ed25519 … blobs-<profile>" | null, path}`; `POST /key {profile}` → `{public, path,
  created}`, idempotent (503 without `ssh-keygen`). The key is `<profile home>/.ssh/runs_on_ed25519` (ed25519, no passphrase,
  0600 in a 0700 folder). Hermes counts a profile's `.ssh` as a credential store, so exports leave it out, and deleting the bot
  deletes its key (verified on 0.21.6 and 0.22.2). Only the public line and the path reach the phone.
- `POST /check {profile, backend: "ssh"|"docker", host, user, port, key}` → `{ok: true, system}` (`uname -srm` over SSH with
  Hermes's options, or Docker's server version) or `{ok: false, reason, detail}`. `reason` is one of `auth`, `too_many_keys`,
  `host_key`, `unknown_host`, `refused`, `timeout`, `unreachable`, `key_missing`, `no_ssh`, `no_docker`, `docker_down` or
  `other`. An unknown bot is 404 `"No bot called <name> on this server."`, and a host or user that ssh could read as an option
  is 422.
- An older plugin answers these routes with a plain 404 `Not Found`; the app then asks for a key file on the server instead.
- `too_many_keys`: ssh offers the server's agent keys before `-i`, so a server whose agent holds many keys reaches the other
  computer's `MaxAuthTries` ("Too many authentication failures") before the bot's key, even when that key is trusted.
- Hermes's plugin install scan (0.21.6 and 0.22.2) reads the name of SSH's trusted-keys file in a plugin's README prose as a
  critical `ssh_backdoor` and blocks the install, even with `--force`. The plugin's docs leave the name out; the app's own
  words are not scanned.

## Chats the gateway owns (Hermes 0.22.4, from source at tag `v0.22.4` and verified on a local 0.22.4)

From 0.22 the messaging gateway owns local sessions through a "session authority". A standalone `hermes dashboard` (what
the app talks to) still runs chats in its own process, and every RPC and REST route the app uses is still there, with
additive changes only. The gateway reaches the app in three places:

- **A chat the gateway already has work for.** Routines, kanban results and other bots' messages are admitted into a chat
  by the gateway. Before each turn the dashboard checks state.db; while the gateway holds a queued or running turn there,
  `prompt.submit` is handed to the gateway's queue and answers `{status: 'queued', forwarded: true, admission_id}`. Only
  `message.start` and `message.complete` come back for it (the final reply in `text`, no deltas or tool steps), so the
  app reads the chat again once the forwarded turn completes. Otherwise the submit is refused with 4090 and
  `data.reason`: `SESSION_OWNER_BUSY`, `SESSION_OWNER_UNCONFIRMED` (it may still be queued: never resend blindly) or
  `SESSION_NOT_OWNED` (work the first gateway start marked `unknown`; only `hermes sessions discard` clears it). The app
  says each of these in words.
- **Plugin routes for another bot.** 0.22 reads a route's `profile` parameter (path or query) as "run as that profile" and
  refuses it for a plugin it did not ship, or forwards it to that bot's plugin host. hermes-dashboard 0.6.1 names it
  `bot` (URLs unchanged); hermes-voice 0.1.2 takes `?bot=`, which the app sends once the plugin's status says 0.1.2.
- **Rooms.** The gateway's own room service drives only rooms it owns (made through its own protocol), so rooms the app
  makes through the dashboard keep running in the dashboard, where their approvals and questions reach the app.

`DELETE /api/sessions/{id}` (and REST rename/import) now needs `request_id` and `expected_revision`; the app deletes with
the `session.delete` RPC, which is unchanged.
