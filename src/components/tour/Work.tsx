import { StyleSheet, View } from 'react-native'

import { ActivityLine } from '@/components/chat/ActivityLine'
import { AssistantBubble, UserBubble } from '@/components/chat/Bubble'
import type { Step } from '@/features/transcript/types'

import { Arrive, BotPanel, CrowdFace, Settle, useBeats } from './kit'

/** When each beat lands (ms after the page shows): the reply, then each step starting, the tests' progress, the result. */
const BEATS = [600, 1300, 2400, 3300, 4000, 4700, 5600] as const
const DONE = BEATS.length

const READ: Step = {
  toolId: 'tour-read',
  name: 'read_file',
  context: 'package.json',
  state: 'done',
  durationS: 0.2,
  output: '{\n  "name": "shop",\n  "scripts": {\n    "clean": "rm -rf .cache dist",\n    "test": "vitest run"\n  }\n}',
}
const CLEAN: Step = { toolId: 'tour-clean', name: 'terminal', context: 'npm run clean', state: 'done', durationS: 1.4, resultLine: 'Removed .cache and dist', output: '> shop@1.4.0 clean\n> rm -rf .cache dist' }
const TEST: Step = {
  toolId: 'tour-test',
  name: 'terminal',
  context: 'npm test',
  state: 'done',
  durationS: 6.1,
  resultLine: '214 passing',
  output: ' ✓ cart (38)\n ✓ coupons (17)\n ✓ checkout (52)\n ✓ orders (107)\n\n 214 passing (6.1s)',
}
/** What the test run prints while it goes, one line per beat. */
const PROGRESS = ['cart       38/214', 'checkout  107/214', 'orders    201/214']

/** The steps as they stand at a beat: done so far, and the one running with its clock. */
function stepsAt(beat: number, since: (beat: number) => number): Step[] {
  const running = (step: Step, from: number, line?: string): Step => ({ ...step, state: 'running', durationS: undefined, resultLine: line, startedAt: since(from) })

  if (beat <= 1) {
    return [running(READ, 1)]
  }

  if (beat === 2) {
    return [READ, running(CLEAN, 2)]
  }

  return beat < DONE ? [READ, CLEAN, running(TEST, 3, PROGRESS[beat - 4])] : [READ, CLEAN, TEST]
}

/**
 * Forge at work: you ask, it answers, and its steps tick by on one quiet line with a running clock and the command's newest
 * output under it. Once it is done the line folds into a summary; tap it to see every step, and a step for its output.
 */
export function Work({ active }: { active: boolean }) {
  const { beat, since } = useBeats(active, BEATS)
  const working = beat >= 1 && beat < DONE

  return (
    <View style={styles.fill}>
      <BotPanel id="forge" faceSize={84} status={working ? 'Working…' : beat >= DONE ? 'Done just now' : 'Idle'} face={<CrowdFace id="forge" size={84} motion={working ? 'work' : 'idle'} />}>
        <Settle>
          <UserBubble text="Clear the cache and run the tests" />
        </Settle>
        {beat >= 1 ? (
          <Arrive>
            <AssistantBubble text="On it." />
          </Arrive>
        ) : null}
        {beat >= 1 ? (
          <Settle>
            <ActivityLine item={{ kind: 'activity', id: 'tour-work', steps: stepsAt(beat, since) }} botName="Forge" />
          </Settle>
        ) : null}
        {beat >= DONE ? (
          <Arrive>
            <AssistantBubble text="All **214** tests pass, and the cache is clear." />
          </Arrive>
        ) : null}
      </BotPanel>
    </View>
  )
}

const styles = StyleSheet.create({
  // The panel grows upward from just above the words, like a chat.
  fill: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
})
