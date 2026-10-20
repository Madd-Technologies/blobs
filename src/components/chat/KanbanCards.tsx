import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useStore } from 'zustand'

import { BotFace } from '@/components/bots/BotFace'
import { kanbanAbout, kanbanForChat } from '@/features/inbox/pushed'
import { displayName } from '@/lib/hermes/identity'
import { answerKanban } from '@/stores/actions'
import { inbox } from '@/stores/inbox'
import { useRoster } from '@/stores/roster'

import { ApprovalCard } from './ActionCards'

interface Props {
  profile: string
  /** The chat's own ids (its stored id, and for the main chat the bot's canonical ids). */
  ids: readonly (string | null | undefined)[]
  isMain: boolean
}

/**
 * The approvals this bot's kanban workers wait on, in the chat they belong to (the one the card was created from, else the
 * bot's main chat), at the newest end of the chat. A worker runs on its own, so these are not the chat's own turn: each
 * says which card it is for.
 */
export function KanbanCards({ profile, ids, isMain }: Props) {
  const all = useStore(inbox.store, state => state.kanban)
  const rows = useRoster(state => state.rows)
  const meta = rows.find(row => row.name === profile)?.ui_meta?.['hermes-bots']
  const [a, b, c] = ids
  const here = useMemo(() => kanbanForChat(all, profile, [a, b, c], isMain), [all, profile, a, b, c, isMain])

  if (!here.length) {
    return null
  }

  const nameOf = (other: string) => {
    const row = rows.find(candidate => candidate.name === other)

    return row ? displayName(row, row.ui_meta?.['hermes-bots']) : null
  }

  return (
    <View style={styles.stack}>
      {here.map(approval => (
        <ApprovalCard
          key={approval.id}
          lead={<BotFace name={profile} meta={meta} size={22} />}
          riseKey={approval.id}
          command={approval.command}
          description={approval.description}
          about={kanbanAbout(approval, nameOf)}
          choices={approval.choices}
          state="pending"
          onChoose={choice => answerKanban(approval.id, choice)}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 12, paddingVertical: 8, alignSelf: 'stretch' },
})
