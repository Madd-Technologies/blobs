import { Redirect } from 'expo-router'

import { ConnectForm } from '@/components/connect/ConnectForm'
import { usePrefs } from '@/stores/prefs'

export default function Connect() {
  const tourSeen = usePrefs(state => state.tourSeen)

  if (!tourSeen) {
    return <Redirect href="/tour" />
  }

  return <ConnectForm mode="initial" />
}
