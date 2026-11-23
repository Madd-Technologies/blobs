import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import { Screen } from '@/components/ui/Screen'
import { Spinner } from '@/components/ui/Spinner'
import { parseApproveParams, type ApprovalChoice } from '@/features/push/approveLink'
import { haptic } from '@/lib/haptics'
import { answerMobileApproval } from '@/lib/hermes/station'
import { waitForConnection } from '@/lib/waitForConnection'
import { useConnection } from '@/stores/connection'
import { toast } from '@/stores/ui'

const CHOICE_LABELS: Record<ApprovalChoice, string> = {
  once: 'Allowed once',
  session: 'Allowed for session',
  always: 'Always allowed',
  deny: 'Denied',
}

/**
 * Handles one-tap notification approval actions (`hermesbot://approve?id=...&choice=once|deny&profile=...&kind=...`).
 */
export default function ApproveDeepLink() {
  const params = useLocalSearchParams<{ id?: string; choice?: string; profile?: string; kind?: string }>()
  const router = useRouter()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) {
      return
    }
    handled.current = true

    const parsed = parseApproveParams(params)

    void (async () => {
      if (parsed && (await waitForConnection())) {
        const config = useConnection.getState().config
        if (config) {
          try {
            const res = await answerMobileApproval(config, parsed.id, parsed.choice, {
              profile: parsed.profile,
              kind: parsed.kind,
            })
            if (res?.answered) {
              haptic(parsed.choice === 'deny' ? 'reject' : 'confirm')
              toast(CHOICE_LABELS[parsed.choice])
            } else {
              toast('Approval already expired or answered')
            }
          } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not answer approval')
          }
        }
      } else if (!parsed) {
        toast('Invalid approval link')
      }

      if (parsed?.profile) {
        router.replace({ pathname: '/bot/[profile]', params: { profile: parsed.profile } })
      } else {
        router.replace('/inbox')
      }
    })()
  }, [params, router])

  return (
    <Screen>
      <View style={styles.center}>
        <Spinner size={16} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
