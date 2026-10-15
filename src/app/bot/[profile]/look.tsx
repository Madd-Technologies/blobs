import Feather from '@expo/vector-icons/Feather'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { BotFace } from '@/components/bots/BotFace'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { T } from '@/components/ui/T'
import { AVATAR_SHAPES, PROFILE_SWATCHES } from '@/lib/hermes/identity'
import { mergeBotMeta } from '@/lib/hermes/profiles'
import { useBotView } from '@/stores/bots'
import { saveBotMeta } from '@/stores/profiles'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'

const randomSeed = () => Math.random().toString(36).slice(2, 8)

/** A bot's shape and color. A change shows at once and is saved; if the server says no, it goes back. */
export default function BotLook() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const { c } = useTheme()
  const view = useBotView(profile)
  // What was just picked, until the roster catches up with it.
  const [picked, setPicked] = useState<Record<string, unknown>>({})
  const meta = mergeBotMeta(view?.meta, picked)
  const swatches = PROFILE_SWATCHES

  async function choose(patch: Record<string, unknown>) {
    const before = picked
    setPicked({ ...picked, ...patch, custom: true })
    const error = await saveBotMeta(profile, { ...patch, custom: true })

    if (error) {
      setPicked(before)
      toast(error)
    }
  }

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title="Look" />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <BotFace name={profile} meta={meta} size={112} />
          </View>

          <T variant="meta" color="text2" style={styles.section}>
            Shape
          </T>
          <View style={styles.grid}>
            {AVATAR_SHAPES.map(shape => (
              <Pressable
                key={shape}
                accessibilityRole="button"
                accessibilityLabel={shape}
                accessibilityState={{ selected: meta.shape === shape }}
                onPress={() => void choose({ shape })}
                style={[styles.cell, { backgroundColor: meta.shape === shape ? c.raised : c.sheet }]}
              >
                <BotFace name={profile} meta={{ ...meta, shape }} size={36} />
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Shuffle a new shape"
              onPress={() => void choose({ shape: `blobatar:${randomSeed()}` })}
              style={[styles.cell, { backgroundColor: meta.shape?.startsWith('blobatar') ? c.raised : c.sheet }]}
            >
              <Feather name="shuffle" size={20} color={c.text} />
            </Pressable>
          </View>

          <T variant="meta" color="text2" style={styles.section}>
            Color
          </T>
          <View style={styles.grid}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Automatic color"
              accessibilityState={{ selected: !meta.color }}
              onPress={() => void choose({ color: null })}
              style={[styles.swatch, { backgroundColor: c.tone }]}
            >
              <T variant="meta">{meta.color ? 'Auto' : '✓'}</T>
            </Pressable>
            {swatches.map(color => (
              <Pressable
                key={color}
                accessibilityRole="button"
                accessibilityLabel={`Color ${color}`}
                accessibilityState={{ selected: meta.color === color }}
                onPress={() => void choose({ color })}
                style={[styles.swatch, { backgroundColor: color }]}
              >
                {meta.color === color ? <Feather name="check" size={18} color="#0A0A0A" /> : null}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  hero: { alignItems: 'center', paddingVertical: 24 },
  section: { paddingHorizontal: 4, paddingTop: 12, paddingBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
})
