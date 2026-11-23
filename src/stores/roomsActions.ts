import type { ClarifyAnswer, RespondResult } from '@/features/sessions/store'
import type { RoomData } from '@/features/rooms/view'
import { describeError } from '@/lib/hermes/errors'
import type { RoomMember, RoomPendingAction } from '@/lib/hermes/protocol'
import {
  approveRoomAction,
  createRoom,
  disbandRoom,
  mergeEvents,
  renameRoom,
  retryRoomTask,
  sendRoomMessage,
  stopRoom,
  type RoomQuestion,
} from '@/lib/hermes/rooms'
import { call } from '@/lib/hermes/rpc'
import { gateway, requests } from '@/stores/connection'

type Outcome = Promise<string | null>

interface Bridge {
  getRoom: (id: string) => RoomData | undefined
  setRoom: (id: string, data: RoomData) => void
  removeRoomLocal: (id: string) => void
  refreshRoom: (id: string) => void
  markAnswered: (requestId: string) => void
  markDisbanded: (id: string) => void
}

export function createRoomActions(bridge: Bridge) {
  async function makeRoom(name: string, members: RoomMember[]): Promise<{ id: string } | { error: string }> {
    try {
      const room = await createRoom(gateway, name, members)
      bridge.setRoom(room.room_id, { room, events: [], cursor: 0, status: null })
      bridge.refreshRoom(room.room_id)

      return { id: room.room_id }
    } catch (error) {
      return { error: describeError(error) }
    }
  }

  async function sendToRoom(id: string, text: string): Outcome {
    try {
      const event = await sendRoomMessage(gateway, id, text)
      const current = bridge.getRoom(id)

      if (current) {
        bridge.setRoom(id, { ...current, events: mergeEvents(current.events, [event]), cursor: Math.max(current.cursor, event.seq) })
      }

      bridge.refreshRoom(id)

      return null
    } catch (error) {
      return describeError(error)
    }
  }

  async function stopRoomWork(id: string): Outcome {
    try {
      await stopRoom(gateway, id)
      bridge.refreshRoom(id)

      return null
    } catch (error) {
      return describeError(error)
    }
  }

  async function answerRoomApproval(id: string, action: RoomPendingAction, choice: 'once' | 'deny'): Promise<RespondResult> {
    try {
      await approveRoomAction(gateway, id, action, choice)
      bridge.refreshRoom(id)

      return 'answered'
    } catch (error) {
      bridge.refreshRoom(id)

      return /no longer pending/i.test(describeError(error)) ? 'expired' : 'failed'
    }
  }

  async function answerRoomQuestion(id: string, question: RoomQuestion, answers: ClarifyAnswer[]): Promise<RespondResult> {
    if (!answers.length) {
      return 'failed'
    }

    const sent = requests.answer(question.requestId, { kind: 'clarify', answers })
    let result: RespondResult = 'answered'

    if (sent === 'failed') {
      return 'failed'
    }

    if (sent === 'unknown') {
      try {
        for (const { questionId, answer } of answers) {
          const reply = await call(gateway, 'clarify.respond', { session_id: question.sessionId, request_id: question.requestId, answer, ...(questionId ? { question_id: questionId } : {}) })

          if (reply.status === 'expired') {
            result = 'expired'
            break
          }
        }
      } catch {
        return 'failed'
      }
    }

    bridge.markAnswered(question.requestId)
    bridge.refreshRoom(id)

    return result
  }

  async function retryRoomWork(id: string, taskId: string, who = 'The bot'): Outcome {
    try {
      await retryRoomTask(gateway, id, taskId)
      bridge.refreshRoom(id)

      return null
    } catch (error) {
      bridge.refreshRoom(id)
      const message = describeError(error)

      if (/still active/i.test(message)) {
        return `${who} is still finishing that reply. Try again in a minute.`
      }

      return /no retryable room task/i.test(message) ? null : message
    }
  }

  async function renameRoomTo(id: string, name: string): Outcome {
    try {
      const room = await renameRoom(gateway, id, name)
      const current = bridge.getRoom(id)

      if (current) {
        bridge.setRoom(id, { ...current, room })
      }

      return null
    } catch (error) {
      return describeError(error)
    }
  }

  async function removeRoom(id: string): Outcome {
    try {
      await disbandRoom(gateway, id)
      bridge.markDisbanded(id)
      bridge.removeRoomLocal(id)

      return null
    } catch (error) {
      return describeError(error)
    }
  }

  return { makeRoom, sendToRoom, stopRoomWork, answerRoomApproval, answerRoomQuestion, retryRoomWork, renameRoomTo, removeRoom }
}
