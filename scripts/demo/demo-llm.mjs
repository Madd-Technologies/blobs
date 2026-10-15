#!/usr/bin/env node
/**
 * The demo Hermes's model: an OpenAI-compatible chat server that plays fixed stories.
 *
 * Every screenshot, video and App Review sign-in is made against the demo Hermes (docs/DEMO.md), so
 * the words and tool choices must come out the same on every run. Hermes itself still produces every
 * protocol frame (tool steps, approvals, questions, routines); only the model is scripted here.
 *
 * A story is picked by the latest user message (case and punctuation ignored, matched anywhere in
 * the message, so a routine's wrapper around it is fine; in a group room only the person's newest line
 * counts). Its steps play in order: the step is the number of tool results since that message.
 * Anything else gets a short, friendly reply.
 *
 *   DEMO_LLM_PORT       port (default 9220)
 *   DEMO_WORKSPACE      the bots' project folder (default /Users/Shared/blobs-demo)
 *   DEMO_LLM_CHUNK_MS   delay between streamed words (default 35)
 *   DEMO_LLM_LOG        append one JSON line per request to this file
 */
import { appendFileSync } from 'node:fs'
import http from 'node:http'

const PORT = Number(process.env.DEMO_LLM_PORT ?? 9220)
const WORKSPACE = (process.env.DEMO_WORKSPACE ?? '/Users/Shared/blobs-demo').replace(/\/+$/, '')
const PROJECT = `${WORKSPACE}/storefront`
const CHUNK_MS = Number(process.env.DEMO_LLM_CHUNK_MS ?? 35)
const LOG = process.env.DEMO_LLM_LOG
export const MODEL_ID = 'hermes-4-405b'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ── stories ──────────────────────────────────────────────────────────────────────────────────────
//
// A step is { say, tool, args } (a tool call, `say` streamed first) or { say } (the final reply).
// `say` may be a function of the latest tool result, for replies that depend on what you answered.

const RELEASE_NOTES = `# Storefront 1.4

## New
- **Saved carts.** A cart now survives closing the tab, on every device you sign in on.
- **Dark mode.** Follows your system setting, or pick it in Settings.

## Faster
- Checkout loads in half the time: the payment form is fetched while you review your cart.

## Fixed
- Coupon codes with lowercase letters are accepted again.
- The order page no longer jumps when a photo loads.
`

const PLANS = [
  '| Plan | Price | Support | Storage |',
  '| --- | --- | --- | --- |',
  '| Basic | $5/mo | Email, 2 days | 10 GB |',
  '| Plus | $12/mo | Chat, 1 hour | 50 GB |',
  '| Pro | $29/mo | Phone, 24/7 | 250 GB |',
].join('\n')

function hostingAnswer(result) {
  const answer = result.toLowerCase()

  if (answer.includes('price')) {
    return `${PLANS}\n\n**Basic** is the one: $5 a month covers the site with room to spare. Move up only if checkout traffic doubles.`
  }

  if (answer.includes('support')) {
    return `${PLANS}\n\n**Plus** is the one: chat support answers within the hour, for $7 more than Basic.`
  }

  return `${PLANS}\n\n**Pro** is the one if you expect to grow: 25 times Basic's storage and support around the clock.`
}

function pushResult(result) {
  const text = result.toLowerCase()

  if (/blocked|denied|declined|not approved|cancel/.test(text)) {
    return "Okay, I didn't push. `main` on the remote is unchanged; say the word when you want it out."
  }

  return 'Pushed. `main` on the remote is now **v1.4.0**, with the two fixups folded in.'
}

export const STORIES = [
  {
    // Forge, the storyboard's "See every step".
    match: 'clear the cache and run the tests',
    steps: [
      { say: 'On it.', tool: 'read_file', args: { path: `${PROJECT}/package.json` } },
      { tool: 'terminal', args: { command: 'npm run clean' } },
      { tool: 'terminal', args: { command: 'npm test' } },
      { say: 'All **214 tests pass** in 2.4 s. I cleared `.cache` and `dist` first, so that was a cold run.' },
    ],
  },
  {
    // Forge's seeded state: a long run that keeps it busy for hours.
    match: 'run the full test suite on every browser',
    steps: [
      { say: 'Starting the full run.', tool: 'read_file', args: { path: `${PROJECT}/package.json` } },
      { tool: 'terminal', args: { command: 'npm run test:browsers', timeout: 43200 } },
      { say: 'Every browser passes: 214 tests on Chromium, Firefox and WebKit.' },
    ],
  },
  {
    // Courier: a push it has to ask about (Hermes asks before any force push).
    match: 'push the release to main',
    steps: [
      { say: 'Checking the branch first.', tool: 'terminal', args: { command: 'git log --oneline -3' } },
      {
        say: "I squashed two fixup commits, so `main` needs a force push. It's the careful kind: it stops if anyone else pushed since.",
        tool: 'terminal',
        args: { command: 'git push --force-with-lease origin main' },
      },
      { say: pushResult },
    ],
  },
  {
    // Scout: a question with options.
    match: 'compare the three hosting plans',
    steps: [
      {
        say: 'Before I dig in:',
        tool: 'clarify',
        args: { questions: [{ question: 'What matters most for the new site?', choices: ['Lowest price', 'Fastest support', 'Room to grow'] }] },
      },
      { say: hostingAnswer },
    ],
  },
  {
    // Scribe: a finished reply with a file.
    match: 'write the release notes for 1.4',
    steps: [
      { say: 'Reading the changelog.', tool: 'read_file', args: { path: `${PROJECT}/CHANGELOG.md` } },
      { tool: 'write_file', args: { path: `${PROJECT}/release-notes-1.4.md`, content: RELEASE_NOTES } },
      {
        // The headline first (it is what Home previews); the path last, which the app turns into a file chip.
        say: `The release notes for 1.4 are ready. Three headlines: saved carts, dark mode and a checkout that loads twice as fast.\n\n${PROJECT}/release-notes-1.4.md`,
      },
    ],
  },
  {
    // The routine's output, handed to Ember's chat to sum up (Hermes's own wrapper, so it comes first).
    match: 'cronjob morning brief output',
    steps: [{ say: 'Morning brief is in: 12 new orders overnight and 2 refunds on the board. One thing needs you: Courier is waiting for your OK to push 1.4.' }],
  },
  {
    // Ember's 7:00 AM routine.
    match: 'write my morning brief',
    steps: [
      {
        say: [
          'Good morning. Here is today.',
          '',
          '**Overnight:** 12 new orders and 2 refund requests. Courier has both refunds on the board.',
          '',
          '**Today**',
          '- 10:00 design review for the checkout page',
          '- 14:30 call with the print shop about the new labels',
          '',
          '**Needs you:** Courier wants your OK to push the 1.4 release.',
        ].join('\n'),
      },
    ],
  },
  // The group room.
  { match: 'is the build green', steps: [{ say: 'Yes. The build passed and all 214 tests are green.' }] },
  {
    match: 'draft the announcement',
    steps: [{ say: 'Draft: "Storefront 1.4 is out, with saved carts, dark mode and a faster checkout." Want a longer one for the blog?' }],
  },
  { match: 'check the feeds', steps: [{ say: 'Checked. Three mentions overnight, all happy. One asks for dark mode on the mobile site, which 1.4 has.' }] },
  // A hello for anyone poking around.
  { match: 'what can you do', steps: [{ say: 'I can run commands, read and write files, and keep a dashboard for you. Try asking me to run the tests.' }] },
]

// ── picking a step ───────────────────────────────────────────────────────────────────────────────

function text(content) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'string' ? part : (part?.text ?? ''))).join(' ')
  }

  return ''
}

const normalize = value => value.toLowerCase().replace(/[^a-z0-9.@ ]+/g, ' ').replace(/\s+/g, ' ')

/** What the "model" does for this request. */
export function plan(body) {
  const messages = body.messages ?? []
  const system = text(messages.find(m => m.role === 'system')?.content)
  const lastUserIndex = messages.findLastIndex(m => m.role === 'user')
  const lastUser = lastUserIndex >= 0 ? text(messages[lastUserIndex].content) : ''
  const tools = new Set((body.tools ?? []).map(t => t?.function?.name).filter(Boolean))

  // The smart-approval guardian (only if a bot's approvals are set to smart): always leave it to you.
  if (system.includes('security reviewer')) {
    return { kind: 'text', text: 'ESCALATE', story: 'guardian' }
  }

  let heard = lastUser

  // A group room hands each member everything new since its last turn; answer the person's newest line.
  if (heard.startsWith('[Discussion: "')) {
    const fromPerson = [...heard.matchAll(/^ {2}User \(user\): (.*)$/gm)].at(-1)?.[1]

    if (!fromPerson) {
      return { kind: 'text', text: '(pass)', story: 'room: nothing from the person' }
    }

    heard = fromPerson
  }

  const said = normalize(heard)
  const story = STORIES.find(s => said.includes(s.match))

  if (!story) {
    return { kind: 'text', text: "Happy to help. I'm a demo bot, so I only know a few tricks today.", story: null }
  }

  const done = messages.slice(lastUserIndex + 1).filter(m => m.role === 'tool').length
  const step = story.steps[Math.min(done, story.steps.length - 1)]
  const lastTool = text([...messages].reverse().find(m => m.role === 'tool')?.content)
  const say = typeof step.say === 'function' ? step.say(lastTool) : step.say

  if (step.tool && done < story.steps.length - 1) {
    if (!tools.has(step.tool)) {
      return { kind: 'text', text: say ?? 'Done.', story: story.match, step: done, note: `no ${step.tool} tool offered` }
    }

    return { kind: 'tool', name: step.tool, args: step.args, preface: say, story: story.match, step: done }
  }

  return { kind: 'text', text: say ?? 'Done.', story: story.match, step: done }
}

// ── OpenAI-compatible wire format ────────────────────────────────────────────────────────────────

function chunk(model, delta, finish = null, extra = {}) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-demo',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  })}\n\n`
}

const words = content => content.match(/\S+\s*|\s+/g) ?? [content]

async function stream(req, res, body, decision) {
  const model = body.model ?? MODEL_ID
  let open = true
  res.on('close', () => {
    open = false
  })
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const write = data => open && res.write(data)

  write(chunk(model, { role: 'assistant', content: '' }))

  const spoken = decision.kind === 'tool' ? decision.preface : decision.text

  for (const piece of words(spoken ?? '')) {
    if (!open) {
      return res.end()
    }

    write(chunk(model, { content: piece }))
    await sleep(CHUNK_MS)
  }

  if (decision.kind === 'tool') {
    const args = JSON.stringify(decision.args)
    write(chunk(model, { tool_calls: [{ index: 0, id: `call_demo_${Date.now()}`, type: 'function', function: { name: decision.name, arguments: '' } }] }))

    for (let i = 0; i < args.length; i += 48) {
      write(chunk(model, { tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 48) } }] }))
    }
  }

  const tokens = Math.max(1, Math.round((spoken ?? '').length / 4))
  write(chunk(model, {}, decision.kind === 'tool' ? 'tool_calls' : 'stop', { usage: { prompt_tokens: 400, completion_tokens: tokens, total_tokens: 400 + tokens } }))
  write('data: [DONE]\n\n')
  res.end()
}

function completion(body, decision) {
  const message =
    decision.kind === 'tool'
      ? {
          role: 'assistant',
          content: decision.preface ?? null,
          tool_calls: [{ id: `call_demo_${Date.now()}`, type: 'function', function: { name: decision.name, arguments: JSON.stringify(decision.args) } }],
        }
      : { role: 'assistant', content: decision.text }

  return {
    id: 'chatcmpl-demo',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? MODEL_ID,
    choices: [{ index: 0, message, finish_reason: decision.kind === 'tool' ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 400, completion_tokens: 40, total_tokens: 440 },
  }
}

function log(body, decision) {
  if (!LOG) {
    return
  }

  const messages = body.messages ?? []
  const lastUser = text([...messages].reverse().find(m => m.role === 'user')?.content)
  const entry = {
    at: new Date().toISOString(),
    stream: !!body.stream,
    tools: (body.tools ?? []).length,
    system: text(messages.find(m => m.role === 'system')?.content).slice(0, 120),
    user: lastUser.slice(-240),
    story: decision.story,
    step: decision.step,
    kind: decision.kind,
    ...(decision.note ? { note: decision.note } : {}),
  }
  appendFileSync(LOG, `${JSON.stringify(entry)}\n`)
}

const server = http.createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0]
  const json = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }

  if (req.method === 'GET' && /\/models$/.test(path)) {
    return json(200, { object: 'list', data: [{ id: MODEL_ID, object: 'model', context_length: 131072 }] })
  }

  if (req.method === 'POST' && /\/chat\/completions$/.test(path)) {
    let raw = ''

    for await (const part of req) {
      raw += part
    }

    let body

    try {
      body = JSON.parse(raw)
    } catch {
      return json(400, { error: { message: 'bad json' } })
    }

    const decision = plan(body)
    log(body, decision)

    return body.stream ? stream(req, res, body, decision) : json(200, completion(body, decision))
  }

  return json(404, { error: { message: `demo model: no route for ${req.method} ${path}` } })
})

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`demo model: listening on http://127.0.0.1:${PORT}/v1 (${STORIES.length} stories)`)
  })
}
