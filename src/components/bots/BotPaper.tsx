import type { ReactNode } from 'react'

import { useFaceColor } from '@/stores/bots'
import { BotTint } from '@/theme/ThemeProvider'

/** A bot's own screen: everything inside is drawn on paper mixed toward its face color (Card Stock). */
export function BotPaper({ profile, children }: { profile: string; children: ReactNode }) {
  return <BotTint color={useFaceColor(profile)}>{children}</BotTint>
}
