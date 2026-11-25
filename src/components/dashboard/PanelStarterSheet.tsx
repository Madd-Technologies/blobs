import Feather from '@expo/vector-icons/Feather'
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'

import { GroupedList } from '@/components/ui/GroupedList'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import { dashboardSetupMessage } from '@/features/transcript/injected'
import { useTheme } from '@/theme/ThemeProvider'

interface Template {
  key: string
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  subtitle: string
  what: string
  cadence: string
}

const TEMPLATES: Template[] = [
  {
    key: 'followups',
    icon: 'check-square',
    title: 'Follow-ups & action items',
    subtitle: 'Due dates, commitments, and what waits on you',
    what: 'Track action items, follow-ups, and deadlines I need to decide on in a prioritized checklist.',
    cadence: 'every morning and whenever we finish a task',
  },
  {
    key: 'inbox',
    icon: 'inbox',
    title: 'Inbox triage',
    subtitle: 'Flag urgent messages that need a reply or approval',
    what: 'Summarize incoming messages or emails that need my response, highlighting deadlines and suggested next actions.',
    cadence: 'every few hours during the day',
  },
  {
    key: 'numbers',
    icon: 'bar-chart-2',
    title: 'Weekly numbers',
    subtitle: 'KPI tiles and a trend chart over time',
    what: 'Track my key weekly metrics as number tiles and a chart showing progress over recent weeks.',
    cadence: 'daily',
  },
  {
    key: 'projects',
    icon: 'columns',
    title: 'Project tracker',
    subtitle: 'Board grouped by stage with blockers surfaced',
    what: 'Keep a board of active projects and deliverables grouped by status, flagging anything blocked on me.',
    cadence: 'twice a day',
  },
  {
    key: 'briefing',
    icon: 'sun',
    title: 'Daily briefing',
    subtitle: 'Concise morning summary kept fresh automatically',
    what: 'Write a concise summary panel of what matters today: schedule highlights, open blockers, and top priorities.',
    cadence: 'every morning at 8 AM',
  },
]

interface Props {
  visible: boolean
  botName: string
  onClose: () => void
  onPick: (draft: string) => void
  onCustom: () => void
}

/**
 * Curated panel templates plus a custom prompt entry point so users can add useful dashboard panels in one tap.
 */
export function PanelStarterSheet({ visible, botName, onClose, onPick, onCustom }: Props) {
  const { c } = useTheme()
  const { height } = useWindowDimensions()
  const maxListHeight = Math.max(260, Math.round(height * 0.56))

  return (
    <Sheet visible={visible} onClose={onClose} label={`New panel for ${botName}`}>
      <T variant="heading" style={styles.title} accessibilityRole="header">
        Add a panel
      </T>
      <T variant="secondary" color="text2" style={styles.lead}>
        Pick a template to send to {botName}, or write your own.
      </T>

      <ScrollView style={{ maxHeight: maxListHeight }} showsVerticalScrollIndicator={false} bounces={false}>
        <GroupedList>
          {TEMPLATES.map(template => (
            <Pressable
              key={template.key}
              accessibilityRole="button"
              accessibilityLabel={`${template.title}: ${template.subtitle}`}
              onPress={() => onPick(dashboardSetupMessage(template.title, template.what, template.cadence))}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.tone }]}
            >
              <View style={[styles.iconBox, { backgroundColor: c.tone }]}>
                <Feather name={template.icon} size={17} color={c.text} />
              </View>
              <View style={styles.words}>
                <T variant="rowTitle">{template.title}</T>
                <T variant="secondary" color="text2" numberOfLines={2}>
                  {template.subtitle}
                </T>
              </View>
              <Feather name="chevron-right" size={16} color={c.text2} />
            </Pressable>
          ))}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Custom panel"
            onPress={onCustom}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.tone }]}
          >
            <View style={[styles.iconBox, { backgroundColor: c.tone }]}>
              <Feather name="edit-3" size={17} color={c.text} />
            </View>
            <View style={styles.words}>
              <T variant="rowTitle">Custom panel…</T>
              <T variant="secondary" color="text2" numberOfLines={2}>
                Describe any table, board, chart, or checklist in chat
              </T>
            </View>
            <Feather name="chevron-right" size={16} color={c.text2} />
          </Pressable>
        </GroupedList>
      </ScrollView>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: 4, paddingTop: 4 },
  lead: { paddingHorizontal: 4, paddingTop: 4, paddingBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  iconBox: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  words: { flex: 1, minWidth: 0, gap: 2 },
})
