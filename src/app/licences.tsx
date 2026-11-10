import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { GroupedList, Row } from '@/components/ui/GroupedList'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import notices from '@/features/licences/notices.json'
import { openLink } from '@/lib/openLink'

interface Notice {
  name: string
  version: string
  licence: string
  url: string
  /** Index into `texts`, or -1 when the package ships no licence file. */
  text: number
}

const PACKAGES = notices.packages as Notice[]
const TEXTS = notices.texts as string[]
const SOURCE_URL = 'https://github.com/Madd-Technologies/blobs'

/**
 * Settings → Licences: Blobs's own licence and every open-source package inside the app (written by `npm run build:licences`),
 * each with its licence text. noVNC (MPL-2.0) and the other copyleft parts say where their source is, as their licences ask.
 */
export default function Licences() {
  const [open, setOpen] = useState<Notice | null>(null)

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Licences" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <T variant="body">Blobs is open source under the MIT licence, published by Madd Technologies LLC.</T>
          <T variant="secondary" color="text2">
            It is built on the open-source packages below. Each one’s source is at its link; noVNC (MPL-2.0) and elkjs (EPL-2.0) are
            used unchanged, from their published releases.
          </T>
        </View>

        <GroupedList>
          <Row label="Blobs source" value="MIT" onPress={() => void openLink(SOURCE_URL)} />
        </GroupedList>

        <GroupedList>
          {PACKAGES.map(notice => (
            <Row key={notice.name} label={notice.name} value={notice.licence} onPress={() => setOpen(notice)} />
          ))}
        </GroupedList>
      </ScrollView>

      <Sheet visible={open !== null} onClose={() => setOpen(null)} label={open ? `${open.name} licence` : 'Licence'}>
        {open ? (
          <View style={styles.sheet}>
            <T variant="heading">{open.name}</T>
            <T variant="secondary" color="text2">
              {open.version} · {open.licence}
            </T>
            <ScrollView style={styles.text} showsVerticalScrollIndicator>
              <T variant="meta" color="text2" selectable>
                {open.text >= 0 ? TEXTS[open.text] : `Licensed under ${open.licence}. The package ships no licence file of its own; its terms are at its source.`}
              </T>
            </ScrollView>
            {open.url ? (
              <GroupedList>
                <Row label="Source" onPress={() => void openLink(open.url)} />
              </GroupedList>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 16 },
  intro: { gap: 8, paddingHorizontal: 4 },
  sheet: { gap: 8, paddingBottom: 24 },
  text: { maxHeight: 420, marginVertical: 8 },
})
