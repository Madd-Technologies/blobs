import { BotFace } from '@/components/bots/BotFace'
import type { PromptItem } from '@/features/transcript/types'
import { useRoster } from '@/stores/roster'
import { sessions } from '@/stores/sessions'

import { ApprovalCard, QuestionCard, SecretCard, SudoCard } from './ActionCards'

/** The small face that leads a card the bot raised. */
function CardFace({ profile }: { profile: string }) {
  const meta = useRoster(state => state.rows.find(row => row.name === profile)?.ui_meta?.['hermes-bots'])

  return <BotFace name={profile} meta={meta} size={22} />
}

interface Props {
  item: PromptItem
  profile: string
  botName: string
  /** What rises in only once; the request id by default. A second place showing the same card (a call) passes its own. */
  riseKey?: string
}

/** What a bot asks you in its chat (approve a command, answer a question, a secret, sudo) as its raised card, answered there. */
export function PromptCard({ item, profile, botName, riseKey }: Props) {
  const lead = <CardFace profile={profile} />
  const rise = riseKey ?? item.requestId

  switch (item.kind) {
    case 'approval':
      return (
        <ApprovalCard
          lead={lead}
          riseKey={rise}
          command={item.command}
          description={item.description}
          choices={item.choices}
          state={item.state}
          choice={item.choice}
          onChoose={choice => sessions.respondApproval(profile, item.requestId, choice)}
        />
      )

    case 'question':
      return <QuestionCard lead={lead} riseKey={rise} questions={item.questions} state={item.state} answer={item.answer} onAnswer={answers => sessions.respondClarify(profile, item.requestId, answers)} />

    case 'secret':
      return <SecretCard lead={lead} riseKey={rise} prompt={item.prompt} envVar={item.envVar} botName={botName} state={item.state} onSubmit={value => sessions.respondSecret(profile, item.requestId, value)} />

    case 'sudo':
      return <SudoCard lead={lead} riseKey={rise} botName={botName} state={item.state} onSubmit={password => sessions.respondSudo(profile, item.requestId, password)} />
  }
}
