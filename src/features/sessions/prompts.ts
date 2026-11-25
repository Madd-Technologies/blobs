import { call, type RpcClient } from '../../lib/hermes/rpc.ts'
import type { RequestBridge, PromptAnswer } from '../../lib/hermes/server-requests.ts'
import { answerPrompt, expirePrompt } from '../transcript/reduce.ts'
import type { TranscriptState } from '../transcript/types.ts'
import type { BotSession, ClarifyAnswer, RespondResult } from './types.ts'

interface PromptResponderContext {
  client: RpcClient
  requests?: Pick<RequestBridge, 'answer'>
  get: (profile: string) => BotSession
  patchTranscript: (profile: string, change: (transcript: TranscriptState) => TranscriptState) => void
}

export function createPromptResponder(ctx: PromptResponderContext) {
  async function answerViaBridgeOrRpc(
    profile: string,
    requestId: string,
    bridgeAnswer: PromptAnswer,
    optimisticAnswer: { choice?: 'once' | 'session' | 'always' | 'deny'; text?: string },
    fallbackRpc: (liveId: string) => Promise<RespondResult>,
  ): Promise<RespondResult> {
    const liveId = ctx.get(profile).liveId

    if (!liveId) {
      return 'failed'
    }

    const sent = ctx.requests?.answer(requestId, bridgeAnswer)

    if (sent === 'sent') {
      ctx.patchTranscript(profile, transcript => answerPrompt(transcript, requestId, optimisticAnswer))

      return 'answered'
    }

    if (sent === 'failed') {
      return 'failed'
    }

    try {
      return await fallbackRpc(liveId)
    } catch {
      return 'failed'
    }
  }

  function respondApproval(profile: string, requestId: string, choice: 'once' | 'session' | 'always' | 'deny'): Promise<RespondResult> {
    return answerViaBridgeOrRpc(profile, requestId, { kind: 'approval', choice }, { choice }, async liveId => {
      const { resolved } = await call(ctx.client, 'approval.respond', { session_id: liveId, request_id: requestId, choice })
      ctx.patchTranscript(profile, transcript => (resolved ? answerPrompt(transcript, requestId, { choice }) : expirePrompt(transcript, requestId)))

      return resolved ? 'answered' : 'expired'
    })
  }

  function respondClarify(profile: string, requestId: string, answers: ClarifyAnswer[]): Promise<RespondResult> {
    if (!answers.length) {
      return Promise.resolve('failed')
    }

    const summaryText = answers.map(entry => entry.answer).join(' · ')

    return answerViaBridgeOrRpc(profile, requestId, { kind: 'clarify', answers }, { text: summaryText }, async liveId => {
      for (const { questionId, answer } of answers) {
        const result = await call(ctx.client, 'clarify.respond', {
          session_id: liveId,
          request_id: requestId,
          answer,
          ...(questionId ? { question_id: questionId } : {}),
        })

        if (result.status === 'expired') {
          ctx.patchTranscript(profile, transcript => expirePrompt(transcript, requestId))

          return 'expired'
        }
      }

      ctx.patchTranscript(profile, transcript => answerPrompt(transcript, requestId, { text: summaryText }))

      return 'answered'
    })
  }

  function respondSecret(profile: string, requestId: string, value: string): Promise<RespondResult> {
    return answerViaBridgeOrRpc(profile, requestId, { kind: 'value', value }, {}, async liveId => {
      await call(ctx.client, 'secret.respond', { session_id: liveId, request_id: requestId, value })
      ctx.patchTranscript(profile, transcript => answerPrompt(transcript, requestId, {}))

      return 'answered'
    })
  }

  function respondSudo(profile: string, requestId: string, password: string): Promise<RespondResult> {
    return answerViaBridgeOrRpc(profile, requestId, { kind: 'value', value: password }, {}, async liveId => {
      await call(ctx.client, 'sudo.respond', { session_id: liveId, request_id: requestId, password })
      ctx.patchTranscript(profile, transcript => answerPrompt(transcript, requestId, {}))

      return 'answered'
    })
  }

  return { respondApproval, respondClarify, respondSecret, respondSudo }
}
