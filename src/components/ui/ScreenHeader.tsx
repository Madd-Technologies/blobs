import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { IconCircle } from './IconCircle'
import { T } from './T'

interface Props {
  title: string
  /** A quiet line under the title ("3 left, oldest first", the bot a page is about). */
  subtitle?: string
  /** Controls on the right of the back button. */
  right?: ReactNode
  /** One centered 16/20 line instead of the 30/36 page title (a file being read, where the page is the content). */
  compact?: boolean
  /** Compact only: what stands under the title in place of `subtitle` (a progress line with its own Cancel). */
  line?: ReactNode
  /** Compact only: how wide `right` is (40 for one button, 88 for two); the left side matches so the title stays centered. */
  sideWidth?: number
}

/** The header of a plain page: a bare back chevron, then the page's title large and left-aligned below it. */
export function ScreenHeader({ title, subtitle, right, compact, line, sideWidth = 40 }: Props) {
  const router = useRouter()
  const back = <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />

  if (compact) {
    return (
      <View style={styles.compact}>
        {back}
        {sideWidth > 40 ? <View style={{ width: sideWidth - 40 }} /> : null}
        <View style={styles.titles}>
          <T variant="heading" style={styles.centered} numberOfLines={1} accessibilityRole="header">
            {title}
          </T>
          {line ??
            (subtitle ? (
              <T variant="secondary" color="text2" style={styles.centered} numberOfLines={1}>
                {subtitle}
              </T>
            ) : null)}
        </View>
        <View style={[styles.side, { width: sideWidth }]}>{right}</View>
      </View>
    )
  }

  return (
    <View>
      <View style={styles.bar}>
        {back}
        <View style={styles.fill} />
        {right}
      </View>
      <View style={styles.large}>
        <T variant="title" numberOfLines={2} accessibilityRole="header">
          {title}
        </T>
        {subtitle ? (
          <T variant="secondary" color="text2" numberOfLines={1}>
            {subtitle}
          </T>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 4, minHeight: 52 },
  fill: { flex: 1 },
  large: { paddingHorizontal: 20, paddingTop: 4, gap: 2 },
  compact: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 10 },
  titles: { flex: 1 },
  centered: { textAlign: 'center' },
  side: { alignItems: 'flex-end' },
})
