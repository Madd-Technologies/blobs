import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { ApprovalCard } from '@/components/chat/ActionCards'
import { ActivityLine } from '@/components/chat/ActivityLine'
import { AssistantBubble, UserBubble } from '@/components/chat/Bubble'
import type { FaceMotion } from '@/features/face/motion'
import type { Step } from '@/features/transcript/types'
import type { ApprovalChoice } from '@/lib/hermes/protocol'

import { Arrive, BotPanel, CrowdFace, Settle, useBeats } from './kit'

/** The card rises in a moment after the page shows. */
const BEATS = [700] as const
/** After you answer, Courier works this long before it replies. */
const THINK_MS = 1100

const TESTS: Step = { toolId: 'tour-tests', name: 'terminal', context: 'npm test', state: 'done', durationS: 6.1, resultLine: '214 passing' }
const PUSH = 'git push --force-with-lease origin main'

const REPLY: Record<'once' | 'deny', string> = {
  once: 'Pushed. The release branch is up to date.',
  deny: 'Understood. I’ll open a pull request instead.',
}

/**
 * Courier asks before something risky: the real approval card rises in, and it is yours to answer. Courier hops with wide
 * eyes while it waits, works for a moment once you answer, then replies to whichever you picked.
 */
export function Ask({ active }: { active: boolean }) {
  const { beat } = useBeats(active, BEATS)
  const [choice, setChoice] = useState<'once' | 'deny' | null>(null)
  const [replied, setReplied] = useState(false)
  const [was, setWas] = useState(active)
  const [visit, setVisit] = useState(0)

  // Each visit asks again, with a card that rises in again.
  if (was !== active) {
    setWas(active)
    setChoice(null)
    setReplied(false)
    setVisit(count => count + 1)
  }

  useEffect(() => {
    if (!choice) {
      return
    }

    const timer = setTimeout(() => setReplied(true), THINK_MS)

    return () => clearTimeout(timer)
  }, [choice])

  const asking = beat >= 1 && !choice
  const motion: FaceMotion = asking ? 'needs' : replied ? 'idle' : 'work'
  const status = asking ? 'Waiting for you' : replied ? 'Done just now' : 'Working…'

  return (
    <View style={styles.fill}>
      <BotPanel id="courier" faceSize={84} status={status} waiting={asking} face={<CrowdFace id="courier" size={84} motion={motion} />}>
        <Settle>
          <UserBubble text="Push the release to main" />
        </Settle>
        <Settle>
          <ActivityLine item={{ kind: 'activity', id: 'tour-ask', steps: [TESTS] }} botName="Courier" />
        </Settle>
        {beat >= 1 ? (
          <Settle>
            <ApprovalCard
              lead={<CrowdFace id="courier" size={22} />}
              riseKey={`tour-approval-${visit}`}
              command={PUSH}
              description="Force push to a shared branch"
              choices={['once', 'deny']}
              state={choice ? 'answered' : 'pending'}
              choice={choice ?? undefined}
              onChoose={(next: ApprovalChoice) => setChoice(next === 'deny' ? 'deny' : 'once')}
            />
          </Settle>
        ) : null}
        {choice && replied ? (
          <Arrive>
            <AssistantBubble text={REPLY[choice]} />
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
