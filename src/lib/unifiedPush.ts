import { Platform } from 'react-native'

import type { NativePush, PushEvent } from '@/features/push/setup'

/**
 * The phone's UnifiedPush library, or null where there is none: iPhone, the web, and Expo Go (which does not
 * contain the native module, so importing it throws). Loaded lazily so those builds still start.
 */
export function loadNativePush(): NativePush | null {
  if (Platform.OS !== 'android') {
    return null
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lib = require('expo-unified-push') as typeof import('expo-unified-push')
    const native = lib.default

    return {
      getDistributors: () => native.getDistributors(),
      getSavedDistributor: () => native.getSavedDistributor(),
      saveDistributor: id => native.saveDistributor(id),
      // The library throws unless the VAPID key is well formed (87 base64url characters), so the server's is used.
      register: (instance, vapid) => native.registerDevice(vapid, instance),
      unregister: instance => native.unregisterDevice(instance),
      requestPermissions: () => lib.requestPermissions(),
      subscribe: listener => lib.subscribeDistributorMessages(event => listener(event as unknown as PushEvent)),
    }
  } catch {
    return null
  }
}

/** "google Pixel 8": enough to tell phones apart in the server's list. */
export function deviceName(): string {
  const constants = Platform.constants as { Brand?: string; Model?: string }

  return [constants.Brand, constants.Model].filter(Boolean).join(' ') || 'Android phone'
}
