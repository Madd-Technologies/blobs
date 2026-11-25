import { useRouter } from 'expo-router'

import { ConnectForm } from '@/components/connect/ConnectForm'

export default function AddServer() {
  const router = useRouter()

  return <ConnectForm mode="add" onDone={() => router.back()} />
}
