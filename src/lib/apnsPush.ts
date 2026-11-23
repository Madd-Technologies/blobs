import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

type EventSubscription = { remove(): void }

export interface ApnsPushNative {
  requestPermissionsAndRegister(): Promise<boolean>
  getToken(): string | null
  getEnvironment(): 'sandbox' | 'production'
  consumePendingAction(): string | null
  addListener(event: 'onToken', listener: (ev: { token: string }) => void): EventSubscription
  addListener(event: 'onAction', listener: (ev: { url: string }) => void): EventSubscription
  addListener(event: 'onError', listener: (ev: { message: string }) => void): EventSubscription
}

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<ApnsPushNative>('ApnsPush') : null

export function loadApnsPush(): ApnsPushNative | null {
  return native
}

export function iosDeviceName(): string {
  const constants = Platform.constants as { interfaceIdiom?: string; osVersion?: string }
  return constants.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone'
}
