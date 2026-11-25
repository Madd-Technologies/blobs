import { describeError } from '../../lib/hermes/errors.ts'
import { RpcCode } from '../../lib/hermes/protocol.ts'
import { call, isRpcCode, type RpcClient } from '../../lib/hermes/rpc.ts'
import { dispatchOf, parseSlash, REWRITES_CHAT, stripAnsi } from '../../lib/hermes/slash.ts'
import { appendError, appendOutput, finishOutput, startOutput } from '../transcript/reduce.ts'
import type { TranscriptState } from '../transcript/types.ts'
import { skillInvocation } from '../transcript/userContent.ts'
import type { BotSession } from './types.ts'

const UNKNOWN_COMMAND = /not a quick\/plugin\/(?:bundle\/)?skill command/i

interface SlashRunnerContext {
  client: RpcClient
  get: (profile: string) => BotSession
  open: (profile: string, options?: { silent?: boolean }) => Promise<void>
  send: (profile: string, text: string, files?: [], options?: { wire?: string; voiceContext?: string }) => Promise<boolean>
  patchTranscript: (profile: string, change: (transcript: TranscriptState) => TranscriptState) => void
}

export function createSlashRunner(ctx: SlashRunnerContext) {
  async function runCommand(
    profile: string,
    name: string,
    arg: string,
    run: 'exec' | 'dispatch',
    typed: string,
    aliasDepth = 0,
  ): Promise<{ ok: boolean; prefill?: string }> {
    if (!ctx.get(profile).liveId) {
      await ctx.open(profile)
    }

    const resync = async () => {
      if (REWRITES_CHAT.has(name)) {
        await ctx.open(profile, { silent: true })
      }
    }

    const apply = async (raw: unknown, fromRunner: boolean): Promise<{ ok: boolean; prefill?: string }> => {
      const answer = dispatchOf(raw)

      if (!answer) {
        const plain = (raw ?? {}) as { output?: unknown; warning?: unknown }
        const output = typeof plain.output === 'string' ? plain.output : ''
        const warning = typeof plain.warning === 'string' && plain.warning ? `${plain.warning}\n` : ''

        if (fromRunner) {
          await resync()
          ctx.patchTranscript(profile, transcript => appendOutput(transcript, typed, stripAnsi(`${warning}${output}`)))

          return { ok: true }
        }

        ctx.patchTranscript(profile, transcript => appendError(transcript, `The server answered /${name} in a way this app does not understand.`))

        return { ok: false }
      }

      if (answer.type === 'exec' || answer.type === 'plugin') {
        await resync()
        ctx.patchTranscript(profile, transcript => appendOutput(transcript, typed, stripAnsi(answer.output)))

        return { ok: true }
      }

      if (answer.type === 'alias') {
        const target = parseSlash(`/${answer.target.replace(/^\//, '')}${arg ? ` ${arg}` : ''}`)

        if (!target || aliasDepth > 0) {
          ctx.patchTranscript(profile, transcript => appendError(transcript, `/${name} points at /${answer.target}, which can’t be run from here.`))

          return { ok: false }
        }

        return runCommand(profile, target.name, target.arg, 'dispatch', typed, aliasDepth + 1)
      }

      await resync()

      if (answer.notice) {
        ctx.patchTranscript(profile, transcript => appendOutput(transcript, typed, stripAnsi(answer.notice as string)))
      }

      if (answer.type === 'prefill') {
        return { ok: true, prefill: answer.message }
      }

      const message = answer.message.trim()

      if (!message) {
        ctx.patchTranscript(profile, transcript => appendError(transcript, `/${name} had nothing to send.`))

        return { ok: false }
      }

      const shown = answer.display || skillInvocation(message) || (answer.type === 'skill' ? typed : message)

      return { ok: await ctx.send(profile, shown, [], { wire: message }) }
    }

    let runnerError: string | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      const liveId = ctx.get(profile).liveId

      if (!liveId) {
        return { ok: false }
      }

      try {
        if (run === 'exec' && runnerError === null) {
          ctx.patchTranscript(profile, transcript => startOutput(transcript, typed))

          let answered: unknown

          try {
            answered = await call(ctx.client, 'slash.exec', { session_id: liveId, command: `/${name}${arg ? ` ${arg}` : ''}` })
          } catch (error) {
            ctx.patchTranscript(profile, finishOutput)

            if (isRpcCode(error, RpcCode.StaleSession)) {
              throw error
            }

            runnerError = describeError(error)
          }

          if (runnerError === null) {
            ctx.patchTranscript(profile, finishOutput)

            return await apply(answered, true)
          }
        }

        return await apply(await call(ctx.client, 'command.dispatch', { session_id: liveId, name, arg }), false)
      } catch (error) {
        if (attempt === 0 && isRpcCode(error, RpcCode.StaleSession)) {
          runnerError = null
          await ctx.open(profile, { silent: true })
          continue
        }

        const reason = describeError(error)
        const message = stripAnsi(UNKNOWN_COMMAND.test(reason) ? (runnerError ?? `There is no command called /${name}.`) : reason)

        ctx.patchTranscript(profile, transcript => appendError(transcript, message))

        return { ok: false }
      }
    }

    return { ok: false }
  }

  return runCommand
}
