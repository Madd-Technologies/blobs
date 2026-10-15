import { StyleSheet, View } from 'react-native'

import { ApprovalCard } from '@/components/chat/ActionCards'
import { Pill } from '@/components/ui/Pill'
import { T } from '@/components/ui/T'
import type { HostedRoom, RoomPendingAction } from '@/lib/hermes/protocol'
import { memberName } from '@/lib/hermes/rooms'
import { answerRoomApproval, retryRoomWork } from '@/stores/rooms'
import { toast } from '@/stores/toast'

interface Props {
  room: HostedRoom
  actions: RoomPendingAction[]
  /** Raised cards inside the room; bare inside Needs you's card, which is raised already. */
  framed: boolean
}

/** What a room is holding for you: a bot's command to approve, or a turn that did not finish and can be retried. */
export function RoomActions({ room, actions, framed }: Props) {
  return (
    <View style={styles.stack}>
      {actions.map(action => {
        const name = memberName(room, action.member_id ?? '')

        if (action.kind === 'approval') {
          return (
            <View key={`${action.task_id}-${action.request_id}`} style={styles.item}>
              <T variant="label" color="text2" style={styles.who}>
                {name} wants to run a command
              </T>
              <ApprovalCard
                framed={framed}
                riseKey={`room:${action.task_id}:${action.request_id}`}
                command={action.approval?.command ?? ''}
                description={action.approval?.description}
                choices={['once', 'deny']}
                state="pending"
                onChoose={choice => answerRoomApproval(room.room_id, action, choice === 'deny' ? 'deny' : 'once')}
              />
            </View>
          )
        }

        return (
          <View key={action.task_id} style={styles.item}>
            <T variant="body">{action.member_id ? `${name}’s reply didn’t finish.` : 'A reply didn’t finish.'} Retry runs it again.</T>
            <Pill
              label="Retry"
              variant="secondary"
              height={40}
              onPress={() => void retryRoomWork(room.room_id, action.task_id, action.member_id ? name : undefined).then(error => error && toast(error))}
              style={styles.retry}
            />
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  item: { gap: 6 },
  who: { paddingHorizontal: 4 },
  retry: { alignSelf: 'flex-start' },
})
