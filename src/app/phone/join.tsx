import { Redirect, useLocalSearchParams } from 'expo-router'

/** A call question's "Join the call" push button: the call's own screen, which listens in and takes the call over. */
export default function PhoneJoinLink() {
  const { profile, errand, call } = useLocalSearchParams<{ profile: string; errand: string; call: string }>()

  return <Redirect href={{ pathname: '/bot/[profile]/errand-call', params: { profile, errand, call, join: '1' } }} />
}
