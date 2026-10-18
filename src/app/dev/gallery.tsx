import { Redirect, useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { ApprovalCard, QuestionCard } from '@/components/chat/ActionCards'
import { AssistantBubble, UserBubble } from '@/components/chat/Bubble'
import { ActivityLine } from '@/components/chat/ActivityLine'
import { Composer } from '@/components/chat/Composer'
import { PanelMenu } from '@/components/dashboard/PanelMenu'
import { NumbersBlock, ViewBlock } from '@/components/dashboard/ViewBlock'
import { BotFace } from '@/components/bots/BotFace'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { Hairline } from '@/components/ui/Hairline'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Raised } from '@/components/ui/Raised'
import { Screen } from '@/components/ui/Screen'
import { Sheet } from '@/components/ui/Sheet'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import type { Step } from '@/features/transcript/types'
import { AVATAR_SHAPES } from '@/lib/hermes/identity'
import type { View as DashboardView } from '@/lib/hermes/dashboard'
import { usePrefs, type ThemePref } from '@/stores/prefs'
import { BotTint, useTheme } from '@/theme/ThemeProvider'
import { radius, typeScale, type TypeVariant } from '@/theme/tokens'

const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'dark', dark: 'light', light: 'system' }

const SWATCHES = ['canvas', 'sheet', 'tone', 'raised', 'text', 'text2', 'needsYou', 'danger', 'connected'] as const

const TYPE_SAMPLES: [TypeVariant, string][] = [
  ['title', 'Needs you'],
  ['display', 'Reply to Sam Lee?'],
  ['heading', 'Forge'],
  ['reply', 'Mostly old build caches: 41 GB in the cache folder.'],
  ['rowTitle', 'Concierge'],
  ['body', 'Update the photo server to the latest image.'],
  ['secondary', '3 left, oldest first'],
  ['label', 'Ran 4 steps · 1m 12s'],
  ['meta', 'Today 9:38 AM'],
  ['mono', 'docker compose pull'],
]

/** Steps as a stored chat holds them: a search, a page read, a headless browser step and a dashboard read through tool search. */
const SAMPLE_STEPS: Step[] = [
  { toolId: 's1', name: 'web_search', context: 'site:example.com release schedule', state: 'done', durationS: 2, resultLine: 'Releases ship on Tuesdays; fixes any day.' },
  { toolId: 's2', name: 'web_extract', context: 'https://www.example.com/changelog', state: 'done', durationS: 3, resultLine: 'Changelog: 4 releases this month, 2 fixes.' },
  { toolId: 's3', name: 'browser_navigate', context: 'https://example.com/status', state: 'done', durationS: 4, resultLine: 'Opened the status page (headless).' },
  { toolId: 's4', name: 'tool_call', context: '', args: { calls: [{ name: 'dashboard_query', arguments: { collection: 'orders' } }] }, state: 'done', durationS: 1, resultLine: '{"rows": 8, "needs_you": 1}' },
  { toolId: 's5', name: 'terminal', context: 'python3 -m unittest discover -s tests', state: 'done', durationS: 2, resultLine: 'OK' },
]

/** The chat in miniature: your bubble, a reply with no bubble, the raised approval card and the composer tray. */
function ChatSample() {
  const { c } = useTheme()

  return (
    <View style={[styles.paper, { backgroundColor: c.canvas, paddingHorizontal: 20 }]}>
      <UserBubble text="Update the photo server on my-server to the latest image. Keep my settings." />
      <AssistantBubble text={'Image pulled: 5.1.2 → 5.2.0. Your settings live in the `photos_config` volume, so they survive the recreate.'} />
      <ActivityLine item={{ kind: 'activity', id: 'g-a1', steps: SAMPLE_STEPS }} botName="Forge" browserShows={false} onOpenScreen={() => undefined} />
      <ActivityLine item={{ kind: 'activity', id: 'g-a2', steps: [{ toolId: 's6', name: 'computer_use', context: '', state: 'done', durationS: 6 }] }} botName="Forge" onOpenScreen={() => undefined} />
      <View style={{ marginHorizontal: -4 }}>
        <ApprovalCard
          lead={<BotFace name="forge" meta={{ shape: 'hexagon', color: '#F97352' }} size={22} />}
          command="docker compose up -d --force-recreate photos"
          description="Restarts the photo server. Uploads pause for about 10 seconds."
          choices={['once', 'session', 'always', 'deny']}
          state="pending"
          onChoose={() => undefined}
        />
      </View>
      <View style={{ marginHorizontal: -4 }}>
        <QuestionCard
          lead={<BotFace name="courier" meta={{ shape: 'blobatar:courier-6j:droplet' }} size={22} />}
          questions={[
            {
              question: 'The release is ready but two customer requests are still open. What goes out today?',
              choices: ['Ship the release and email the notes to everyone now', 'Ship the release quietly; send the notes next week', 'Neither'],
            },
          ]}
          state="pending"
          onAnswer={() => undefined}
        />
      </View>
      <View style={{ marginHorizontal: -32 }}>
        <Composer botName="Forge" running={false} onSend={() => undefined} onStop={() => undefined} />
      </View>
    </View>
  )
}

/** The sample panel's clock: its meta lines are fixed text, so any time will do. */
const SAMPLE_NOW_S = Date.now() / 1000

/** A panel whose rows carry signals (hermes-dashboard 0.4.0): green once an order shipped, amber while not, red when due today. */
const SIGNAL_PANEL: DashboardView = {
  id: 'g-orders',
  title: 'Orders · shipping this week',
  kind: 'list',
  collection: 'courier/orders',
  open: 6,
  needs_you: 1,
  rows: [
    { id: 'r1', done: false, needs_you: true, signal: 'bad', title: { key: 'order', type: 'text', value: 'Order 1081 · Mia' }, subtitle: { key: 'shipping', type: 'text', value: 'Express · Not packed yet' }, meta: { key: 'due', type: 'text', value: 'Today 4 PM' } },
    { id: 'r2', done: false, needs_you: false, signal: 'good', title: { key: 'order', type: 'text', value: 'Order 1077 · Lena' }, subtitle: { key: 'shipping', type: 'text', value: 'Gift wrap · Shipped Wed' }, meta: { key: 'due', type: 'text', value: 'Sat' } },
    { id: 'r3', done: false, needs_you: false, signal: 'warn', title: { key: 'order', type: 'text', value: 'Order 1079 · Theo' }, subtitle: { key: 'shipping', type: 'text', value: 'Standard · Not packed yet' }, meta: { key: 'due', type: 'text', value: 'Sun' } },
    { id: 'r4', done: false, needs_you: false, title: { key: 'order', type: 'text', value: 'Order 1080 · Pickup' }, subtitle: { key: 'shipping', type: 'text', value: 'In store · Nothing to ship' }, meta: { key: 'due', type: 'text', value: 'Wed' } },
  ],
}

/** Number tiles over a money field, a percent field and a count: the plugin names the unit (hermes-dashboard 0.5.1). */
const NUMBER_PANELS: DashboardView[] = [
  { id: 'g-spend', title: 'Spend', kind: 'number', collection: 'courier/purchases', value: 1240, previous: 1200, period: 'week', unit: { type: 'money', currency: 'USD' } },
  { id: 'g-disk', title: 'Disk used', kind: 'number', collection: 'courier/disks', value: 96, previous: 91, period: 'month', unit: { type: 'percent' } },
  { id: 'g-orders-n', title: 'Orders', kind: 'number', collection: 'courier/orders', value: 9 },
]

/** A checklist whose rows carry a subtitle, and one a link (show.subtitle, show.link). */
const CHECKLIST_PANEL: DashboardView = {
  id: 'g-chores',
  title: 'This week',
  kind: 'checklist',
  collection: 'courier/chores',
  open: 3,
  needs_you: 1,
  rows: [
    { id: 'c1', done: false, needs_you: true, title: { key: 'task', type: 'text', value: 'Restock the printer' }, subtitle: { key: 'note', type: 'text', value: 'Black toner and a ream of paper' }, meta: { key: 'due', type: 'text', value: '11 AM' } },
    { id: 'c2', done: false, needs_you: false, title: { key: 'task', type: 'text', value: 'Check the backup log' }, subtitle: { key: 'note', type: 'text', value: 'Last night\'s run on home-server' }, link: { key: 'log', type: 'url', value: 'https://example.com/backups' } },
    { id: 'c3', done: false, needs_you: false, title: { key: 'task', type: 'text', value: 'Replace the smoke detector battery' }, meta: { key: 'due', type: 'text', value: 'Sun' } },
    { id: 'c4', done: true, needs_you: false, title: { key: 'task', type: 'text', value: 'Clear old Docker images' }, subtitle: { key: 'note', type: 'text', value: 'Freed 12 GB' }, meta: { key: 'due', type: 'text', value: '10 AM' } },
  ],
}

/** A live panel whose latest read failed (its rows are from the last good read), and one that never read. */
const STALE_PANEL: DashboardView = {
  id: 'g-downloads',
  title: 'Downloads',
  kind: 'list',
  collection: null,
  kept: { how: 'live', kind: 'script', ttl: 60 },
  live: { as_of: SAMPLE_NOW_S - 17 * 60, error: 'the script failed: Traceback (most recent call last):\n  File "scripts/downloads.py", line 9, in <module>\nConnectionRefusedError: [Errno 111] Connection refused' },
  open: 1,
  rows: [{ id: 'live:0', done: false, needs_you: false, title: { key: 'name', type: 'text', value: 'Ubuntu 26.04 desktop' }, subtitle: { key: 'progress', type: 'text', value: '84% · 3 min left' } }],
}

const NEVER_READ_PANEL: DashboardView = { id: 'g-sensors', title: 'Sensors', kind: 'list', collection: null, kept: { how: 'live', kind: 'sqlite', ttl: 60 }, live: { as_of: null, error: 'no file at data/sensors.db' }, open: 0, rows: [] }

/** A live table: its rows are `live:N`, not records, so a tap opens nothing. */
const LIVE_TABLE: DashboardView = {
  id: 'g-disks',
  title: 'Disks',
  kind: 'table',
  collection: null,
  kept: { how: 'live', kind: 'json', ttl: 300 },
  live: { as_of: SAMPLE_NOW_S - 60 },
  open: 2,
  columns: [
    { key: 'mount', label: 'Mount', type: 'text' },
    { key: 'used', label: 'Used', type: 'percent' },
    { key: 'free', label: 'Free', type: 'text' },
  ],
  rows: [
    { id: 'live:0', done: false, needs_you: false, cells: [{ key: 'mount', type: 'text', value: '/' }, { key: 'used', type: 'percent', value: 71 }, { key: 'free', type: 'text', value: '58 GB' }] },
    { id: 'live:1', done: false, needs_you: false, cells: [{ key: 'mount', type: 'text', value: '/mnt/media' }, { key: 'used', type: 'percent', value: 96 }, { key: 'free', type: 'text', value: '160 GB' }] },
  ],
}

/** The four levels of paper, then an approval card raised over them: the same in neutral and in a bot's tint. */
function Paper() {
  const { c } = useTheme()

  return (
    <View style={[styles.paper, { backgroundColor: c.canvas }]}>
      <View style={styles.swatches}>
        {SWATCHES.slice(0, 4).map(key => (
          <View key={key} style={styles.level}>
            <View style={[styles.chip, { backgroundColor: c[key] }]} />
            <T variant="monoSmall" color="text2">
              {c[key]}
            </T>
          </View>
        ))}
      </View>
      <Raised radius={radius.card} style={styles.card}>
        <T variant="heading">Run this command?</T>
        <View style={[styles.command, { backgroundColor: c.canvas }]}>
          <T variant="mono">docker compose up -d</T>
        </View>
        <View style={styles.buttons}>
          <Pill label="Allow" variant="primary" height={44} flex />
          <Pill label="Deny" height={44} flex />
          <IconCircle icon="more-horizontal" label="More" diameter={44} />
        </View>
      </Raised>
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <T variant="heading" color="text2">
        {title}
      </T>
      {children}
    </View>
  )
}

/** Dev-only: every primitive and bot face, for checking the design system at a glance. */
/** Two small pictures for the attachment tiles (a wide and a tall one), made up here so the gallery needs no files. */
const PHOTO_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAABaCAYAAABzAJLvAAABu0lEQVR4Ae3BAQ0DQAgEsB5Bx4RN+7Q880Fo8/n+pox4yihPjDLKE6M8ZcRTRhnxlFGeGGWUJ0Z5yoinjDLiKaM8McooT4zylBFPGWXEU0Z5YpRRnhjlKSOeMsqIp4zyxCijPDHKU0Y8ZZQRTxnliVGeMmKUp4x4yigjnjLKE6OM8sQoTxnxlFFGPGWUJ0YZ5YlRnjLiKaOMeMooT4wyyhOjPGXEU0YZ8ZRRnhhllCdGecqIp8VZrMVZrMVZrMVZrJzVWpzFWpzFWpzFWpzFWpzFWpzFWpzFWpzFylmtxVmsxVmsxVmsxVmsxVmsxVmsxVmsxVmsnNVanMVanMVanMVanMVanMVanMVanMVanMXKWa3FWazFWazFWazFWazFWazFWazFWazFWayc1VqcxVqcxVqcxVqcxVqcxVqcxVqcxVqcxcpZrcVZrMVZrMVZrMVZrMVZrMVZrMVZrMVZrJzVWpzFWpzFWpzFWpzFWpzFWpzFWpzFWpzFylmtxVmsxVmsxVmsxVmsxVmsxVmsxVmsxVmsnNVanMVanMVanMVanMVanMVanMVanMVanMXKWa3FWazFWazFWewPYxp7EfU6YHwAAAAASUVORK5CYII='
const PHOTO_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFoAAAB4CAYAAAByzOU/AAAB5ElEQVR4Ae3BUY0DUBRCwcMNslZsJdYBTfZp4I8ZfT9/QTwCxCNAPALEI0A8AsQjQDwCxCNAPALEI0A8AsQjQDwCxCNAPALEI0A8AsQjQDwCxCNAPALEI0A8AsQjQDwCxCNAPALEI0A8AsQ/BzF9Dsf0OYjpcxDT5yCmz+GYPgcxfQ5i+hzE9Dkc0+cgps9BTJ+DmD6HY/ocxPQ5iOlzENPncEyfg5g+BzF9DmL6HI7pcxDT5yCmz0FMn8MxfQ5i+hzE9DmI6XM4ps9BTJ+DmD4HMX0Ox/Q5iOlzENPnIKbP4Zg+BzF9DmL6HMT0ORzT5yCmz0FMn4OYPodj+hzE9DmI6XMQ0+dwTJ+DmD4HMX0OYvocjulzENPnIKbPQUyfwzF9DmL6HMT0OYjpczimz0FMn4OYPgcxfQ7H9DmI6XMQ0+cgps/hmD4HMX0OYvocxPQ5HNPnIKbPQUyfg5g+h2P6HMT0OYjpcxDT53BMn4OYPgcxfQ5i+hyO6XMQ0+cgps9BTJ/DMX0OYvocxPQ5iOlzOKbPQUyfg5g+BzF9Dsf0OYjpcxDT5yCmz+GYPgcxfQ5i+hzE9Dkc0+cgps9BTJ+DmD6HY/ocxPQ5iOlzENPncEyfg5g+BzF9DmL6HI7pcxDT9wN/HHwCP4vr4gAAAABJRU5ErkJggg=='

export default function Gallery() {
  const { c, scheme } = useTheme()
  const router = useRouter()
  const theme = usePrefs(s => s.theme)
  const setTheme = usePrefs(s => s.setTheme)
  const [toggle, setToggle] = useState(true)
  const [sheet, setSheet] = useState(false)
  const [panelMenu, setPanelMenu] = useState<DashboardView | null>(null)
  const [tapped, setTapped] = useState('')

  if (!__DEV__) {
    return <Redirect href="/" />
  }

  return (
    <Screen>
      <View style={styles.header}>
        <IconCircle icon="chevron-left" label="Back" bare onPress={() => router.back()} />
        <View style={styles.fill} />
        <Pill label={`Theme: ${theme} (${scheme})`} onPress={() => setTheme(NEXT_THEME[theme])} variant="secondary" height={40} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <T variant="title">Card Stock</T>
        <T variant="secondary" color="text2" style={styles.lead}>
          The design system. Paper tinted per bot; only what you must act on rises.
        </T>

        <Section title="Paper · neutral, then Forge">
          <Paper />
          <BotTint color="#F97352">
            <Paper />
          </BotTint>
        </Section>

        <Section title="Color">
          <View style={styles.swatches}>
            {SWATCHES.map(key => (
              <View key={key} style={styles.swatch}>
                <View style={[styles.chip, { backgroundColor: c[key] }]} />
                <View>
                  <T variant="label">{key}</T>
                  <T variant="monoSmall" color="text2">
                    {c[key]}
                  </T>
                </View>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Type · Geist / Geist Mono">
          {TYPE_SAMPLES.map(([variant, sample]) => (
            <View key={variant} style={styles.typeRow}>
              <T variant="label" color="text2" style={styles.typeName}>
                {variant} {typeScale[variant].fontSize}/{typeScale[variant].lineHeight}
              </T>
              <T variant={variant} color={variant === 'secondary' || variant === 'meta' ? 'text2' : 'text'} style={styles.fill}>
                {sample}
              </T>
            </View>
          ))}
        </Section>

        <Section title="Bot faces · Hermes avatar shapes">
          <View style={styles.faces}>
            {AVATAR_SHAPES.map((shape, i) => (
              <BotFace key={shape} name={`gallery-${i}`} meta={{ shape, color: `hsl(${(i * 47) % 360} 68% 58%)` }} size={52} />
            ))}
          </View>
          <View style={styles.faces}>
            <BotFace name="zz-alpha" meta={{ shape: 'blob' }} size={52} />
            <BotFace name="zz-alpha" meta={{ shape: 'blobatar' }} size={52} />
            <BotFace name="zz-beta" meta={{ shape: 'blobatar' }} size={52} />
            <BotFace name="forge" meta={{ shape: 'blobatar::sun' }} size={52} />
            <BotFace name="zz-alpha" meta={{ shape: 'sigil-3' }} size={52} />
            <BotFace name="default" size={52} />
            <BotFace name="ember" size={52} />
          </View>
          <View style={styles.faces}>
            {(['idle', 'work', 'off'] as const).map(mood => (
              <View key={mood} style={styles.mood}>
                <BotFace name="zz-alpha" meta={{ shape: 'circle', color: '#8B5CF6' }} size={32} mood={mood} />
                <T variant="label" color="text2">
                  {mood === 'off' ? 'Off / paused' : mood === 'work' ? 'Working' : 'Idle'}
                </T>
              </View>
            ))}
            <View style={styles.mood}>
              <View>
                <BotFace name="zz-alpha" meta={{ shape: 'circle', color: '#8B5CF6' }} size={32} />
                <AttentionDot size={8} ring style={styles.faceDot} />
              </View>
              <T variant="label" color="text2">
                Needs you
              </T>
            </View>
          </View>
          <T variant="secondary" color="text2">
            Shapes, colors and moods come from Hermes Bot Mode, so a bot looks the same on desktop and phone. Bot colors never use amber.
          </T>
        </Section>

        <Section title="Buttons">
          <View style={styles.buttons}>
            <Pill label="Primary" variant="primary" />
            <Pill label="Secondary" variant="secondary" />
            <IconCircle icon="plus" label="Add" />
            <Pill label="Delete bot" variant="danger" />
          </View>
          <View style={styles.buttons}>
            <Pill label="Loading" variant="primary" loading />
            <Pill label="Disabled" variant="secondary" disabled />
            <Pill label="With icon" variant="secondary" icon="monitor" />
          </View>
        </Section>

        <Section title="Grouped list">
          <GroupedList>
            <Row label="Model" value="claude-opus-4.6" onPress={() => {}} />
            <Row label="Skills" value="12" onPress={() => {}} />
            <Row label="Notifications" right={<Switch value={toggle} onValueChange={setToggle} label="Notifications" />} />
            <Row label="Open a sheet" onPress={() => setSheet(true)} />
            <Row label="Delete bot" destructive onPress={() => {}} />
          </GroupedList>
        </Section>

        <Section title="Chat · Forge, waiting for you">
          <BotTint color="#F97352">
            <ChatSample />
          </BotTint>
        </Section>

        <Section title="Dashboard rows · signals">
          <ViewBlock view={SIGNAL_PANEL} nowS={SAMPLE_NOW_S} onOpenRecord={() => undefined} onToggle={() => undefined} onMenu={() => undefined} onOpenFull={() => undefined} />
        </Section>

        <Section title="Dashboard panels · units, checklists, live reads">
          <NumbersBlock views={NUMBER_PANELS} onMenu={() => undefined} />
          <ViewBlock view={CHECKLIST_PANEL} nowS={SAMPLE_NOW_S} onOpenRecord={id => setTapped(`record ${id}`)} onToggle={() => undefined} onMenu={() => undefined} onOpenFull={() => undefined} />
          <ViewBlock view={STALE_PANEL} nowS={SAMPLE_NOW_S} onOpenRecord={id => setTapped(`record ${id}`)} onToggle={() => undefined} onMenu={() => setPanelMenu(STALE_PANEL)} onOpenFull={() => undefined} />
          <ViewBlock view={NEVER_READ_PANEL} nowS={SAMPLE_NOW_S} onOpenRecord={id => setTapped(`record ${id}`)} onToggle={() => undefined} onMenu={() => setPanelMenu(NEVER_READ_PANEL)} onOpenFull={() => undefined} />
          <ViewBlock view={LIVE_TABLE} nowS={SAMPLE_NOW_S} onOpenRecord={id => setTapped(`record ${id}`)} onToggle={() => undefined} onMenu={() => setPanelMenu(LIVE_TABLE)} onOpenFull={() => undefined} />
          <T variant="label" color="text2">
            {tapped ? `Last tap opened ${tapped}` : 'Nothing opened yet'}
          </T>
        </Section>

        <Section title="Chat bubbles">
          <UserBubble text="Give me a markdown summary" />
          <UserBubble text="What colour is this?" attachments={[{ kind: 'image', name: 'IMG_4821.jpg', uri: PHOTO_A }]} />
          <UserBubble text="" attachments={[{ kind: 'image', name: 'IMG_4822.jpg', uri: PHOTO_B }]} />
          <UserBubble text="Compare these two, and the notes" attachments={[{ kind: 'image', name: 'IMG_4821.jpg', uri: PHOTO_A }, { kind: 'image', name: 'IMG_4822.jpg', uri: PHOTO_B }, { kind: 'file', name: 'notes-from-the-meeting-on-tuesday.txt' }, { kind: 'pdf', name: 'invoice.pdf' }, { kind: 'image', name: 'IMG_4823.jpg', uri: PHOTO_A }]} />
          <UserBubble text="Sending…" pending attachments={[{ kind: 'pdf', name: 'invoice.pdf' }]} />
          <AssistantBubble text={'# A heading\n\nSome **bold**, some *italic* and `inline code`.'} />
          <AssistantBubble text={'- one\n- two\n- three'} />
          <AssistantBubble text={'| name | value |\n| --- | --- |\n| a | 1 |'} />
          <AssistantBubble text={'```bash\ndocker compose pull\n```'} />
          <AssistantBubble text="Plain reply, then a stopped one." interrupted />
          <AssistantBubble text={'The mean is $\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i$ and the variance is $\\sigma^2$, so a **bold $\\alpha$** works too. It costs $5 and $10, not math.'} />
          <AssistantBubble text={'Euler:\n\n$$e^{i\\pi} + 1 = 0$$\n\nThe quadratic formula:\n\n```math\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n```\n\nA wide one:\n\n$$\\int_0^\\infty \\frac{x^{3}}{e^{x}-1}\\,dx = \\frac{\\pi^4}{15} + \\sum_{k=1}^{\\infty} \\frac{1}{k^2} + \\prod_{j=1}^{m} (1 + y_j)$$\n\nBroken: $\\frac{a}{$ stays as written.'} />
          <AssistantBubble text={'Alone: $a^2$'} />
          <AssistantBubble text={'The flow:\n\n```mermaid\ngraph TD\n  A[Phone] -->|Tailscale| B(Hermes)\n  B --> C{Needs you?}\n  C -->|yes| D[Push to ntfy]\n  C -->|no| E[Keep working]\n```\n\nAnd the order:\n\n```mermaid\nsequenceDiagram\n  participant P as Phone\n  participant H as Hermes\n  P->>H: prompt.submit\n  H-->>P: message.complete\n```'} />
          <AssistantBubble text={'| formula | value |\n| --- | --- |\n| $a^2$ | 1 |\n\n- item with $x_1$\n- another $y^2$'} />
        </Section>

        <Section title="Hairline">
          <Hairline />
        </Section>
      </ScrollView>

      <PanelMenu view={panelMenu} profile="forge" botName="Forge" onClose={() => setPanelMenu(null)} onAsk={() => setPanelMenu(null)} onCheck={() => setPanelMenu(null)} />

      <Sheet visible={sheet} onClose={() => setSheet(false)} label="Approval options">
        <GroupedList>
          <Row label="Allow for this session" onPress={() => setSheet(false)} chevron={false} />
          <Row label="Always allow" onPress={() => setSheet(false)} chevron={false} />
        </GroupedList>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 8 },
  body: { paddingHorizontal: 20, paddingBottom: 48, gap: 32, paddingTop: 8 },
  lead: { marginTop: -24 },
  section: { gap: 14 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  swatch: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '45%' },
  chip: { width: 36, height: 36, borderRadius: 10 },
  paper: { borderRadius: radius.group, padding: 14, gap: 16 },
  level: { alignItems: 'center', gap: 6 },
  card: { padding: 16, gap: 12 },
  command: { borderRadius: radius.block, padding: 12 },
  typeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  typeName: { width: 104 },
  faces: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'center' },
  mood: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  faceDot: { position: 'absolute', top: -3, right: -4 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
})
