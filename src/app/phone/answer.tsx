import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import { Screen } from '@/components/ui/Screen'
import { Spinner } from '@/components/ui/Spinner'
import type { CallReply } from '@/lib/hermes/phone'
import { haptic } from '@/lib/haptics'
import { useConnection } from '@/stores/connection'
import { usePhone } from '@/stores/phone'
import { toast } from '@/stores/toast'

/** How long a push button's answer waits for the app to find its server after a cold start. */
const CONNECT_WAIT_MS = 10_000

/** Resolves once the app has its server (signed in), or after the wait. */
function whenConnected(): Promise<boolean> {
  return new Promise(resolve => {
    if (useConnection.getState().config) {
      resolve(true)

      return
    }

    const timer = setTimeout(() => {
      stop()
      resolve(false)
    }, CONNECT_WAIT_MS)
    const stop = useConnection.subscribe(state => {
      if (state.config) {
        clearTimeout(timer)
        stop()
        resolve(true)
      }
    })
  })
}

/**
 * A call question's push button (Allow, Deny, or one of its choices): sends that answer through the signed-in dashboard, pinned
 * to the question's random id so a stale or made-up link answers nothing, then shows the call.
 */
export default function PhoneAnswerLink() {
  const params = useLocalSearchParams<{ profile: string; errand: string; call: string; ask?: string; approved?: string; choice?: string }>()
  const router = useRouter()
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) {
      return
    }

    sent.current = true
    const { profile, errand, call, ask, approved, choice } = params
    const reply: CallReply | null = approved === '1' || approved === '0' ? { approved: approved === '1' } : choice ? { choice } : null

    void (async () => {
      if (reply && ask && (await whenConnected())) {
        const error = await usePhone.getState().answer(errand, call, { ...reply, ask })

        if (error) {
          toast(error)
        } else {
          haptic('approved' in reply && !reply.approved ? 'reject' : 'confirm')
          toast('approved' in reply ? (reply.approved ? 'Allowed' : 'Denied') : `Answered: ${choice}`)
        }
      }

      router.replace({ pathname: '/bot/[profile]/errand-call', params: { profile, errand, call } })
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
