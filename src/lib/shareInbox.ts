import { requireOptionalNativeModule } from 'expo'

import { normalizeSharedPayload, type SharedPayload } from '@/features/share/inbox'

type EventSubscription = { remove(): void }

interface ShareInboxNative {
  consumePending(): Record<string, unknown> | null
  addListener(event: 'onShared', listener: (payload: Record<string, unknown>) => void): EventSubscription
}

const native = requireOptionalNativeModule<ShareInboxNative>('ShareInbox')

export function consumePendingShare(): SharedPayload | null {
  try {
    return normalizeSharedPayload(native?.consumePending() ?? null)
  } catch {
    return null
  }
}

export function onSharedInbox(listener: (payload: SharedPayload) => void): () => void {
  if (!native) {
    return () => {}
  }

  const sub = native.addListener('onShared', raw => {
    const parsed = normalizeSharedPayload(raw)
    if (parsed) {
      listener(parsed)
    }
  })

  return () => sub.remove()
}
