#!/usr/bin/env node
/**
 * A tiny OpenAI-compatible chat server for developing HermesBot offline and for free.
 *
 * Why it exists: a dev machine's Hermes may have no usable LLM credentials, and tests
 * shouldn't spend money. scripts/dev-server.sh points ONLY the dev `hermes serve`
 * process at this server via OPENROUTER_BASE_URL, so no Hermes config file is touched. Hermes itself
 * still produces every protocol frame (events, approvals, prompts), which is what the app consumes;
 * only the model's words and tool choices are scripted here.
 *
 * Scenarios are chosen from the last user message:
 *   "approval" / a `backticked command`  -> calls the terminal tool (a risky command; the smart-approval
 *                                           guardian is told ESCALATE so the user must decide)
 *   "clarify"                            -> calls the clarify tool with two choices
 *   "slow" / "long task"                 -> streams for ~40 s (to test Stop)
 *   "forever"                            -> streams for ~10 minutes (a bot that stays busy)
 *   "think"                              -> emits reasoning, then an answer
 *   "markdown"                           -> a reply with headings, lists, a table and code
 *   "fail"                               -> HTTP 500 (to test error handling)
 *   anything else                        -> a short greeting
 * After a tool result it replies with a short wrap-up.
 */
import http from 'node:http'

const PORT = Number(process.env.FAKE_LLM_PORT ?? 9120)
const CHUNK_MS = Number(process.env.FAKE_LLM_CHUNK_MS ?? 30)
const verbose = process.env.FAKE_LLM_VERBOSE === '1'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function text(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => (typeof part === 'string' ? part : (part?.text ?? ''))).join(' ')
  return ''
}

function pickTool(tools, pattern) {
  return (tools ?? []).map(t => t?.function?.name).find(name => name && pattern.test(name))
}

/** Decide what the "model" does for this request. */
function plan(body) {
  const messages = body.messages ?? []
  const system = text(messages.find(m => m.role === 'system')?.content)
  const last = messages.at(-1)
  const lastUser = text([...messages].reverse().find(m => m.role === 'user')?.content)
  const lower = lastUser.toLowerCase()

  // The smart-approval guardian: a one-word verdict.
  if (system.includes('security reviewer')) {
    const command = /<command>\n([\s\S]*?)\n<\/command>/.exec(lastUser)?.[1] ?? ''
    if (command.includes('hermesbot-safe')) return { kind: 'text', text: 'APPROVE' }
    if (command.includes('hermesbot-deny')) return { kind: 'text', text: 'DENY' }
    return { kind: 'text', text: 'ESCALATE' }
  }

  if (last?.role === 'tool') {
    return { kind: 'text', text: `Done. (fake model) The tool said: ${text(last.content).slice(0, 80)}` }
  }

  if (lower.includes('fail')) return { kind: 'error' }

  if (lower.includes('approval') || /`[^`]+`/.test(lastUser)) {
    const terminal = pickTool(body.tools, /^terminal$/) ?? pickTool(body.tools, /terminal|shell|bash/)
    if (terminal) {
      const command = /`([^`]+)`/.exec(lastUser)?.[1] ?? 'rm -r /tmp/hermesbot-fake-approval'
      return { kind: 'tool', name: terminal, args: { command }, preface: 'Running that now.' }
    }
  }

  if (lower.includes('clarify')) {
    const clarify = pickTool(body.tools, /^clarify$/)
    if (clarify) {
      return {
        kind: 'tool',
        name: clarify,
        args: { questions: [{ question: 'Which option do you want?', choices: ['Option A', 'Option B'] }] },
        preface: 'I need a decision.',
      }
    }
  }

  if (lower.includes('forever')) {
    return { kind: 'text', text: Array.from({ length: 1200 }, (_, i) => `still working on step ${i + 1}. `).join(''), chunkMs: 500 }
  }

  if (lower.includes('slow') || lower.includes('long task')) {
    return { kind: 'text', text: Array.from({ length: 80 }, (_, i) => `step ${i + 1} of the long task. `).join(''), chunkMs: 500 }
  }

  if (lower.includes('think')) {
    return { kind: 'text', reasoning: 'Let me think about this carefully. The user wants an answer.', text: 'After thinking: the answer is 42.' }
  }

  if (lower.includes('markdown')) {
    return {
      kind: 'text',
      text: [
        '# A heading',
        '',
        'Some **bold**, some *italic* and `inline code`.',
        '',
        '- one',
        '- two',
        '',
        '| name | value |',
        '| --- | --- |',
        '| a | 1 |',
        '',
        '```bash',
        'docker compose pull',
        '```',
      ].join('\n'),
    }
  }

  return { kind: 'text', text: 'Hi from the fake model, happy to help.' }
}

function chunk(model, delta, finish = null, extra = {}) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  })}\n\n`
}

function words(content) {
  return content.match(/\S+\s*|\s+/g) ?? [content]
}

async function stream(req, res, body, decision) {
  const model = body.model ?? 'fake'
  let open = true
  req.on('close', () => {
    open = false
  })
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const write = data => open && res.write(data)
  const delay = decision.chunkMs ?? CHUNK_MS

  write(chunk(model, { role: 'assistant', content: '' }))

  if (decision.reasoning) {
    for (const piece of words(decision.reasoning)) {
      write(chunk(model, { reasoning_content: piece, reasoning: piece }))
      await sleep(delay)
    }
  }

  const spoken = decision.kind === 'tool' ? decision.preface : decision.text
  for (const piece of words(spoken ?? '')) {
    if (!open) return res.end()
    write(chunk(model, { content: piece }))
    await sleep(delay)
  }

  if (decision.kind === 'tool') {
    const args = JSON.stringify(decision.args)
    write(chunk(model, { tool_calls: [{ index: 0, id: 'call_fake_1', type: 'function', function: { name: decision.name, arguments: '' } }] }))
    for (let i = 0; i < args.length; i += 24) {
      write(chunk(model, { tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 24) } }] }))
      await sleep(delay)
    }
  }

  const tokens = Math.max(1, Math.round((spoken ?? '').length / 4))
  write(
    chunk(model, {}, decision.kind === 'tool' ? 'tool_calls' : 'stop', {
      usage: { prompt_tokens: 20, completion_tokens: tokens, total_tokens: 20 + tokens },
    }),
  )
  write('data: [DONE]\n\n')
  res.end()
}

function completion(body, decision) {
  const message =
    decision.kind === 'tool'
      ? {
          role: 'assistant',
          content: decision.preface ?? null,
          tool_calls: [{ id: 'call_fake_1', type: 'function', function: { name: decision.name, arguments: JSON.stringify(decision.args) } }],
        }
      : { role: 'assistant', content: decision.text }

  return {
    id: 'chatcmpl-fake',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? 'fake',
    choices: [{ index: 0, message, finish_reason: decision.kind === 'tool' ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  }
}

const server = http.createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0]
  const json = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }

  if (req.method === 'GET' && /\/models$/.test(path)) {
    return json(200, {
      object: 'list',
      data: [{ id: 'z-ai/glm-5.3-flash', object: 'model', context_length: 200000, pricing: { prompt: '0', completion: '0' } }],
    })
  }

  if (req.method === 'POST' && /\/chat\/completions$/.test(path)) {
    let raw = ''
    for await (const part of req) raw += part
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return json(400, { error: { message: 'bad json' } })
    }

    const decision = plan(body)
    if (verbose) {
      const tools = (body.tools ?? []).length
      const names = (body.tools ?? []).map(t => t?.function?.name).join(',')
      console.log(`[fake-llm] ${body.model} stream=${!!body.stream} tools=${tools} -> ${decision.kind}${tools ? ` [${names}]` : ''}`)
    }

    if (decision.kind === 'error') {
      return json(500, { error: { message: 'fake model failure (requested by the prompt)', type: 'server_error' } })
    }

    if (body.stream) {
      return stream(req, res, body, decision)
    }

    return json(200, completion(body, decision))
  }

  return json(404, { error: { message: `fake-llm: no route for ${req.method} ${path}` } })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake-llm: listening on http://127.0.0.1:${PORT}/v1 (OpenAI-compatible, scripted replies)`)
})
