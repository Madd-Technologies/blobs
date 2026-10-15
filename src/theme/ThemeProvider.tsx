import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'

import { usePrefs } from '@/stores/prefs'

import { palettes, tintPalette, type ColorScheme, type Palette } from './tokens'

interface Theme {
  scheme: ColorScheme
  /** The palette for what is drawn here: a bot's tint on that bot's own screens, else neutral paper. */
  c: Palette
  /** Neutral paper, for what sits on a bot's screen but is not that bot's (another bot's card). */
  neutral: Palette
  /** The face color tinting this subtree, or null on neutral paper. */
  tint: string | null
}

const ThemeContext = createContext<Theme>({ scheme: 'dark', c: palettes.dark, neutral: palettes.dark, tint: null })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const pref = usePrefs(s => s.theme)
  const scheme: ColorScheme = pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref

  const value = useMemo(() => ({ scheme, c: palettes[scheme], neutral: palettes[scheme], tint: null }), [scheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** A bot's own screens: everything below is drawn on paper mixed toward its face color. `null` keeps neutral paper. */
export function BotTint({ color, children }: { color: string | null | undefined; children: ReactNode }) {
  const { scheme, neutral } = useContext(ThemeContext)
  const tint = color ?? null

  const value = useMemo(() => ({ scheme, neutral, tint, c: tint ? tintPalette(scheme, tint) : neutral }), [scheme, neutral, tint])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
