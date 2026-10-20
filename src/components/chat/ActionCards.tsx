import Feather from '@expo/vector-icons/Feather'
import { useState, type ReactNode } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

import { GroupedList, Row } from '@/components/ui/GroupedList'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Raised, useOnRaised } from '@/components/ui/Raised'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import type { ClarifyAnswer, RespondResult } from '@/features/sessions/store'
import type { PromptState } from '@/features/transcript/types'
import { haptic } from '@/lib/haptics'
import type { ApprovalChoice, ClarifyQuestion } from '@/lib/hermes/protocol'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/**
 * The cards a bot uses to ask you something: approve a command, answer a question, hand over a secret.
 * One anatomy for all of them. In the chat each is a raised card (the one thing that rises there) that rises in once; in
 * Needs you and a room's list the card around them is raised already, so they draw only what is inside.
 * Cards exist only while you must act; once handled they shrink to one quiet line.
 */

type Responder<T> = (value: T) => Promise<RespondResult> | RespondResult | void

/** Where a card draws: `card` raised in a chat (16/21 title), `deck` inside Needs you's top card (22/28 title). */
export type CardSize = 'card' | 'deck'

function useFills() {
  const { c } = useTheme()
  const onRaised = useOnRaised()

  return {
    c,
    /** Fields are pressed into the raised card, like its secondary pills. */
    fill: onRaised ? c.pressedIn : c.control,
    /** The command block is the paper under the card. */
    block: c.canvas,
  }
}

/** Reports a send result the same way everywhere: quietly, and only when something needs saying. */
function report(result: RespondResult | void) {
  if (result === 'failed') {
    toast("Couldn't send that. Try again.")
  } else if (result === 'expired') {
    toast('That request had already expired.')
  }
}

interface FrameProps {
  framed: boolean
  /** What rises in only once (the prompt's request id), so scrolling back to a card does not raise it again. */
  riseKey?: string
  /** The face before the title in a chat's card. */
  lead?: ReactNode
  title: ReactNode
  size: CardSize
  children: ReactNode
}

function Frame({ framed, riseKey, lead, title, size, children }: FrameProps) {
  const heading = typeof title === 'string' ? <T variant={size === 'deck' ? 'display' : 'heading'} style={size === 'card' ? styles.cardTitle : undefined}>{title}</T> : title

  if (!framed) {
    return (
      <View style={styles.stack}>
        {heading}
        {children}
      </View>
    )
  }

  return (
    <Raised radius={radius.card} rise={riseKey} style={[styles.stack, styles.frame]}>
      <View style={styles.head}>
        {lead}
        <View style={styles.flex}>{heading}</View>
      </View>
      {children}
    </Raised>
  )
}

/** The one line a handled card turns into. */
function Handled({ icon, text }: { icon: 'check' | 'x' | 'clock'; text: string }) {
  const { c } = useTheme()

  return (
    <View style={styles.handled}>
      <Feather name={icon} size={14} color={c.text2} />
      <T variant="label" color="text2" numberOfLines={2} style={styles.flex}>
        {text}
      </T>
    </View>
  )
}

const CHOICE_LINE: Record<ApprovalChoice, string> = {
  once: 'Allowed',
  session: 'Allowed for this session',
  always: 'Always allowed',
  deny: 'Denied',
}

// ── approval ─────────────────────────────────────────────────────────────────────────────────────

interface CardProps {
  framed?: boolean
  size?: CardSize
  lead?: ReactNode
  riseKey?: string
}

interface ApprovalProps extends CardProps {
  command: string
  /** Why it was flagged, from the server. */
  description?: string
  /** What it is for, when that isn't the chat's own turn (a kanban card). */
  about?: string
  choices: ApprovalChoice[]
  state: PromptState
  choice?: ApprovalChoice
  onChoose: Responder<ApprovalChoice>
}

export function ApprovalCard({ command, description, about, choices, state, choice, framed = true, size = 'card', lead, riseKey, onChoose }: ApprovalProps) {
  const { c, block } = useFills()
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(false)

  if (state !== 'pending') {
    return (
      <View style={framed ? styles.handledPad : undefined}>
        <Handled icon={state === 'expired' ? 'clock' : choice === 'deny' ? 'x' : 'check'} text={state === 'expired' ? 'Approval expired' : CHOICE_LINE[choice ?? 'once']} />
      </View>
    )
  }

  async function choose(next: ApprovalChoice) {
    setBusy(true)
    setMore(false)
    haptic(next === 'deny' ? 'reject' : 'confirm')

    try {
      report(await onChoose(next))
    } finally {
      setBusy(false)
    }
  }

  const extra = choices.filter(option => option === 'session' || option === 'always')

  return (
    <Frame framed={framed} size={size} lead={lead} riseKey={riseKey} title="Run this command?">
      {about ? (
        <T variant="secondary" color="text2">
          {about}
        </T>
      ) : null}
      <View style={[styles.block, { backgroundColor: block }]}>
        <T variant="mono" selectable>
          {command}
        </T>
      </View>
      {description ? (
        <T variant="label" color="text2" style={styles.reason}>
          {description}
        </T>
      ) : null}
      <View style={[styles.row, styles.buttons]}>
        <Pill label="Allow" variant="primary" flex height={size === 'deck' ? 46 : 44} disabled={busy} onPress={() => void choose('once')} />
        <Pill label="Deny" variant="secondary" flex height={size === 'deck' ? 46 : 44} disabled={busy} onPress={() => void choose('deny')} />
        {extra.length ? <IconCircle icon="more-horizontal" label="More options: allow for this session or always" diameter={44} disabled={busy} onPress={() => setMore(true)} /> : null}
      </View>

      <Sheet visible={more} onClose={() => setMore(false)} label="Approval options">
        <GroupedList>
          {extra.includes('session') ? <Row label="Allow for this session" chevron={false} onPress={() => void choose('session')} /> : null}
          {extra.includes('always') ? <Row label="Always allow this" chevron={false} onPress={() => void choose('always')} /> : null}
        </GroupedList>
        <T variant="label" color="text2" style={{ marginTop: 10, color: c.text2 }}>
          Applies to commands like this one, not to every command.
        </T>
      </Sheet>
    </Frame>
  )
}

// ── question ─────────────────────────────────────────────────────────────────────────────────────

interface QuestionProps extends CardProps {
  questions: ClarifyQuestion[]
  state: PromptState
  /** The answers given, for the handled line. */
  answer?: string
  onAnswer: Responder<ClarifyAnswer[]>
}

export function QuestionCard({ questions, state, answer, framed = true, size = 'card', lead, riseKey, onAnswer }: QuestionProps) {
  const { c, fill } = useFills()
  const [index, setIndex] = useState(0)
  const [given, setGiven] = useState<ClarifyAnswer[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [reply, setReply] = useState('')
  const [typing, setTyping] = useState(false)
  const [busy, setBusy] = useState(false)

  if (state !== 'pending') {
    return (
      <View style={framed ? styles.handledPad : undefined}>
        <Handled icon={state === 'expired' ? 'clock' : 'check'} text={state === 'expired' ? 'Question expired' : answer ? `You answered: ${answer}` : 'Answered'} />
      </View>
    )
  }

  const question = questions[index]

  if (!question) {
    return null
  }

  const choices = question.choices ?? []
  const free = choices.length === 0 || typing
  const last = index === questions.length - 1

  async function give(text: string) {
    const next = [...given, { questionId: question?.qid, answer: text }]
    haptic('tick')

    if (!last) {
      setGiven(next)
      setIndex(index + 1)
      setPicked([])
      setReply('')
      setTyping(false)

      return
    }

    setBusy(true)

    try {
      report(await onAnswer(next))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame framed={framed} size={size} lead={lead} riseKey={riseKey} title={question.question}>
      {questions.length > 1 ? (
        <T variant="label" color="text2">
          Question {index + 1} of {questions.length}
        </T>
      ) : null}

      {choices.length ? (
        <View style={styles.choices}>
          {choices.map(choice => {
            const on = picked.includes(choice)

            return (
              <Pill
                key={choice}
                label={choice}
                variant={on ? 'primary' : 'secondary'}
                height={42}
                wrap
                disabled={busy}
                onPress={() => (question.multi_select ? setPicked(on ? picked.filter(item => item !== choice) : [...picked, choice]) : void give(choice))}
              />
            )
          })}
          {!typing ? <Pill label="Reply…" variant="ghost" onPress={() => setTyping(true)} /> : null}
        </View>
      ) : null}

      {question.multi_select && picked.length ? <Pill label="Done" variant="primary" disabled={busy} onPress={() => void give(JSON.stringify(picked))} /> : null}

      {free ? (
        <View style={styles.row}>
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder="Your answer"
            placeholderTextColor={c.text2}
            style={[styles.input, { backgroundColor: fill, color: c.text }]}
            accessibilityLabel="Your answer"
            returnKeyType="send"
            onSubmitEditing={() => reply.trim() && void give(reply.trim())}
            editable={!busy}
          />
          <Pill label="Send" variant="primary" disabled={busy || !reply.trim()} onPress={() => void give(reply.trim())} />
        </View>
      ) : null}
    </Frame>
  )
}

// ── secret and sudo ──────────────────────────────────────────────────────────────────────────────

interface SecretProps extends CardProps {
  /** What it is for, from the server ("Needs NOTION_API_KEY…"). */
  prompt: string
  envVar: string
  /** The bot's name, for the privacy note. */
  botName: string
  state: PromptState
  onSubmit: Responder<string>
}

export function SecretCard({ prompt, envVar, botName, state, framed = true, size = 'card', lead, riseKey, onSubmit }: SecretProps) {
  if (state !== 'pending') {
    return (
      <View style={framed ? styles.handledPad : undefined}>
        <Handled icon={state === 'expired' ? 'clock' : 'check'} text={state === 'expired' ? 'Secret request expired' : 'Saved'} />
      </View>
    )
  }

  return (
    <Frame
      framed={framed}
      size={size}
      lead={lead}
      riseKey={riseKey}
      title={
        <T variant={size === 'deck' ? 'display' : 'heading'} style={size === 'card' ? styles.cardTitle : undefined}>
          {prompt || 'A secret is needed'}
          {envVar ? <T variant="mono"> {envVar}</T> : null}
        </T>
      }
    >
      <MaskedField placeholder="Paste secret" label="Secret value" action="Save" note={`Stored on your server. ${botName} never sees the value.`} onSubmit={onSubmit} />
    </Frame>
  )
}

interface SudoProps extends CardProps {
  botName: string
  state: PromptState
  onSubmit: Responder<string>
}

export function SudoCard({ botName, state, framed = true, size = 'card', lead, riseKey, onSubmit }: SudoProps) {
  if (state !== 'pending') {
    return (
      <View style={framed ? styles.handledPad : undefined}>
        <Handled icon={state === 'expired' ? 'clock' : 'check'} text={state === 'expired' ? 'Password request expired' : 'Sent'} />
      </View>
    )
  }

  return (
    <Frame framed={framed} size={size} lead={lead} riseKey={riseKey} title="A command needs your sudo password.">
      <MaskedField placeholder="Password" label="Sudo password" action="Send" note={`Sent to your server. ${botName} never sees it.`} onSubmit={onSubmit} />
    </Frame>
  )
}

/** A password-style field plus its one action. The value lives in this component only, and is cleared on send. */
function MaskedField({ placeholder, label, action, note, onSubmit }: { placeholder: string; label: string; action: string; note: string; onSubmit: Responder<string> }) {
  const { c, fill } = useFills()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!value) {
      return
    }

    const sending = value
    setBusy(true)
    haptic('confirm')

    try {
      const result = await onSubmit(sending)
      report(result)

      if (result !== 'failed') {
        setValue('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <View style={styles.row}>
        <View style={[styles.field, { backgroundColor: fill }]}>
          <Feather name="lock" size={15} color={c.text2} />
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={c.text2}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            // Keep the value out of autofill, suggestions and the keyboard's learning.
            autoComplete="off"
            textContentType="oneTimeCode"
            importantForAutofill="no"
            accessibilityLabel={label}
            style={[styles.bare, { color: c.text }]}
            editable={!busy}
            onSubmitEditing={() => void send()}
          />
        </View>
        <Pill label={action} variant="primary" disabled={busy || !value} onPress={() => void send()} />
      </View>
      <T variant="label" color="text2">
        {note}
      </T>
    </>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: 12 },
  frame: { padding: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { lineHeight: 21 },
  block: { borderRadius: radius.block, padding: 12 },
  buttons: { paddingTop: 2 },
  reason: { marginTop: -4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  handled: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  handledPad: { paddingHorizontal: 4 },
  input: { flex: 1, height: 42, borderRadius: radius.pill, paddingHorizontal: 16, fontFamily: fonts.regular, fontSize: 15 },
  field: { flex: 1, height: 42, borderRadius: radius.pill, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bare: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 15, padding: 0 },
})
