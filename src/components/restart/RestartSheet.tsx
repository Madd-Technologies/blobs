import Feather from '@expo/vector-icons/Feather'
import { Pressable, StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { useWaitingPlugin } from '@/components/restart/RestartRow'
import { GroupedList } from '@/components/ui/GroupedList'
import { Pill } from '@/components/ui/Pill'
import { Sheet } from '@/components/ui/Sheet'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { bots, busyRows, clockLabel, defaultChoice, gatewayRestartable, lastRestarted, underWay, uptime, workingLine, type BusyRow, type RestartChoice } from '@/features/restart/model'
import type { RestartEntry, RestartStatus } from '@/lib/hermes/restart'
import { useNowMs } from '@/lib/useNow'
import { botName, useRestart } from '@/stores/restart'
import { useRoster } from '@/stores/roster'
import { useTheme } from '@/theme/ThemeProvider'

const CHOICE_LABEL: Record<RestartChoice, string> = { dashboard: 'Dashboard', gateway: 'Gateway', both: 'Both' }

/** Restart Hermes: what to restart, who is in the middle of a turn, and when (canvas row 24). Lives at the app's root. */
export function RestartSheet() {
  const open = useRestart(state => state.sheet.open)
  const status = useRestart(state => state.status)

  return (
    <Sheet visible={open} onClose={() => useRestart.getState().close()} label="Restart Hermes">
      {status ? <Body status={status} /> : <View style={styles.loading}>{status === undefined ? <Spinner size={16} /> : null}</View>}
    </Sheet>
  )
}

function Body({ status }: { status: RestartStatus }) {
  const going = underWay(status)
  const rows = busyRows(status.busy, botName)

  if (going?.outcome === 'waiting') {
    return <Waiting status={status} entry={going} rows={rows} />
  }

  if (status.last?.outcome === 'timed_out' && !going && rows.length) {
    return <TimedOut entry={status.last} rows={rows} />
  }

  return <Choose status={status} rows={rows} />
}

function Header({ title, line }: { title: string; line?: string }) {
  return (
    <View style={styles.header}>
      <T variant="heading">{title}</T>
      {line ? (
        <T variant="label" color="text2">
          {line}
        </T>
      ) : null}
    </View>
  )
}

/** The chats a restart would stop, each with its bot's face. */
function BusyList({ rows }: { rows: BusyRow[] }) {
  const rosterRows = useRoster(state => state.rows)

  return (
    <View style={styles.busy}>
      {rows.map(row => {
        const meta = rosterRows.find(entry => entry.name === row.profile)?.ui_meta?.['hermes-bots']

        return (
          <View key={row.id} style={styles.busyRow} accessible accessibilityLabel={`${row.name}, ${row.line}`}>
            <BotFace name={row.profile ?? row.name} meta={meta} size={28} mood="work" />
            <View style={styles.flex}>
              <T variant="rowTitle" numberOfLines={1}>
                {row.name}
              </T>
              <T variant="label" color="text2" numberOfLines={1}>
                {row.waitingOnYou ? `Waiting for your OK · ${row.line}` : row.line}
              </T>
            </View>
          </View>
        )
      })}
    </View>
  )
}

/** One of the three things to restart, drawn as a choice row. */
function ChoiceRow({ title, lines, selected, disabled, onPress }: { title: string; lines: string[]; selected: boolean; disabled?: boolean; onPress: () => void }) {
  const { c } = useTheme()

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={`${title}. ${lines.join('. ')}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, { backgroundColor: pressed ? c.tone : 'transparent', opacity: disabled ? 0.4 : 1 }]}
    >
      <View style={styles.flex}>
        <T variant="body">{title}</T>
        {lines.map((line, index) => (
          <T key={line} variant="label" color={index === 0 ? 'text2' : 'text'}>
            {line}
          </T>
        ))}
      </View>
      {selected ? (
        <View style={[styles.check, { backgroundColor: c.text }]}>
          <Feather name="check" size={14} color={c.canvas} />
        </View>
      ) : (
        <Feather name="circle" size={22} color={c.text2} />
      )}
    </Pressable>
  )
}

function Choose({ status, rows }: { status: RestartStatus; rows: BusyRow[] }) {
  const { c } = useTheme()
  const waiting = useWaitingPlugin()
  const picked = useRestart(state => state.sheet.choice)
  const sending = useRestart(state => state.sending)
  const refused = useRestart(state => state.refused)
  const retryUntil = useRestart(state => state.retryUntil)
  // Ticks once a second while a wait may still run, for the countdown and the uptime.
  const nowMs = useNowMs(retryUntil > 0, 1000)
  const gateway = gatewayRestartable(status)
  const choice = picked && (picked === 'dashboard' || gateway) ? picked : defaultChoice(status, waiting)
  const wait = Math.max(0, Math.ceil(retryUntil - nowMs / 1000))
  const restarted = lastRestarted(status)
  const { restart, choose } = useRestart.getState()
  const failed = status.last && ['failed', 'not_restarted', 'interrupted'].includes(status.last.outcome) ? status.last : null
  const affected = choice === 'gateway' ? [] : rows

  return (
    <View style={styles.body}>
      <Header title="Restart Hermes" line={restarted ? `Last restarted ${clockLabel(restarted)}` : undefined} />
      {failed?.detail ? (
        <T variant="label" color="text2">
          The last restart didn’t happen: {failed.detail}
        </T>
      ) : null}

      <GroupedList>
        <ChoiceRow title="Dashboard" lines={[`What this app talks to${status.started_at ? ` · ${uptime(status.started_at, nowMs / 1000)}` : ''}`]} selected={choice === 'dashboard'} onPress={() => choose('dashboard')} />
        <ChoiceRow title="Gateway" lines={[gateway ? 'Messaging and routines' : 'Not on this Hermes version']} selected={choice === 'gateway'} disabled={!gateway} onPress={() => choose('gateway')} />
        <ChoiceRow
          title="Both"
          lines={gateway ? ['What a plugin install needs', ...(waiting ? [`${waiting.title}${waiting.version ? ` ${waiting.version}` : ''} is waiting to load`] : [])] : ['Needs the gateway restart']}
          selected={choice === 'both'}
          disabled={!gateway}
          onPress={() => choose('both')}
        />
      </GroupedList>

      {choice === 'gateway' ? (
        <T variant="label" color="text2">
          The gateway lets its running turns finish before it restarts. This app stays connected.
        </T>
      ) : status.busy === null ? (
        <T variant="label" color="text2">
          This dashboard can’t see which chats are running, so it can only restart now.
        </T>
      ) : affected.length ? (
        <>
          <T variant="secondary" color="text2">
            Working right now
          </T>
          <BusyList rows={affected} />
          <T variant="label" color="text2">
            Restarting now would stop {affected.length === 1 ? 'it' : 'them'} mid-turn. Waiting gives {affected.length === 1 ? 'it' : 'them'} up to 10 min to finish.
          </T>
        </>
      ) : (
        <View style={styles.quietBlock}>
          <T variant="secondary" color="text2">
            Working right now
          </T>
          <T variant="label" color="text2">
            No bot is in the middle of a turn, so nothing gets cut off.
          </T>
        </View>
      )}

      {wait > 0 ? (
        <View style={styles.inline}>
          <Feather name="clock" size={14} color={c.text2} />
          <T variant="label" color="text2">
            Restarted a moment ago · try again in {wait} s
          </T>
        </View>
      ) : null}

      <View style={styles.buttons}>
        {choice === 'gateway' ? (
          <Pill label="Restart the gateway" variant="primary" height={52} loading={sending} disabled={wait > 0} onPress={() => void restart('gateway', 'now')} />
        ) : affected.length ? (
          <>
            <Pill label="Restart when they’re done" variant="primary" height={52} loading={sending} disabled={wait > 0} onPress={() => void restart(choice, 'idle')} />
            <Pill label="Restart now anyway" variant="secondary" height={48} disabled={sending || wait > 0} onPress={() => void restart(choice, 'now')} />
          </>
        ) : (
          <Pill label="Restart now" variant="primary" height={52} loading={sending} disabled={wait > 0} onPress={() => void restart(choice, 'now')} />
        )}
      </View>
      {refused ? (
        <T variant="label" color="text2">
          {refused}
        </T>
      ) : null}
    </View>
  )
}

function Waiting({ status, entry, rows }: { status: RestartStatus; entry: RestartEntry; rows: BusyRow[] }) {
  const choice: RestartChoice = entry.include_gateway ? 'both' : 'dashboard'
  const minutes = Math.round((entry.idle_timeout_s ?? 600) / 60)
  const count = status.busy?.length ?? 0
  const { cancel, restart } = useRestart.getState()

  return (
    <View style={styles.body}>
      <Header title="Restart Hermes" line={`${CHOICE_LABEL[choice]} · when they’re done · asked ${clockLabel(entry.requested_at)}`} />
      <View style={styles.statusLine}>
        <Spinner size={16} />
        <View style={styles.flex}>
          <T variant="body">
            {count ? `Waiting for ${bots(count)} to finish` : 'Waiting for the chats to finish'}
            <T variant="body" color="text2">
              {' '}
              · up to {minutes} min
            </T>
          </T>
          <T variant="label" color="text2">
            {entry.include_gateway ? 'Then the dashboard and the gateway restart by themselves.' : 'Then the dashboard restarts by itself.'}
          </T>
        </View>
      </View>
      <BusyList rows={rows} />
      <T variant="label" color="text2">
        You can close this: the Settings row keeps the wait. Nothing needs you until it’s done.
      </T>
      <View style={styles.pair}>
        <Pill label="Cancel" variant="secondary" height={48} flex onPress={() => void cancel()} />
        <Pill label="Restart now" variant="secondary" height={48} flex onPress={() => void restart(choice, 'now')} />
      </View>
    </View>
  )
}

function TimedOut({ entry, rows }: { entry: RestartEntry; rows: BusyRow[] }) {
  const { c } = useTheme()
  const choice: RestartChoice = entry.include_gateway ? 'both' : 'dashboard'
  const minutes = Math.round((entry.idle_timeout_s ?? 600) / 60)
  const names = rows.map(row => row.name)
  const sending = useRestart(state => state.sending)
  const { restart } = useRestart.getState()

  return (
    <View style={styles.body}>
      <Header title="Restart Hermes" line={`${CHOICE_LABEL[choice]} · when they’re done · asked ${clockLabel(entry.requested_at)}`} />
      <View style={styles.statusLine}>
        <View style={[styles.dot, { backgroundColor: c.needsYou }]} />
        <View style={styles.flex}>
          <T variant="body">Still busy after {minutes} min</T>
          <T variant="label" color="text2">
            {workingLine(names)}.
          </T>
        </View>
      </View>
      <BusyList rows={rows} />
      <T variant="label" color="text2">
        Restarting now stops {names.length === 1 ? names[0] : 'them'} mid-turn. Keep waiting gives {names.length === 1 ? 'it' : 'them'} another {minutes} min.
      </T>
      <View style={styles.buttons}>
        <Pill label="Restart now" variant="primary" height={52} loading={sending} onPress={() => void restart(choice, 'now')} />
        <Pill label="Keep waiting" variant="secondary" height={48} disabled={sending} onPress={() => void restart(choice, 'idle')} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  loading: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  body: { gap: 14, paddingBottom: 8 },
  header: { gap: 2 },
  flex: { flex: 1, minWidth: 0 },
  choice: { minHeight: 60, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  busy: { gap: 12 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quietBlock: { gap: 2 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttons: { gap: 10 },
  pair: { flexDirection: 'row', gap: 10 },
  statusLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
})
