import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

/**
 * Keychain (iOS) / Keystore-backed (Android) storage for credentials.
 * Web has no SecureStore; fall back to localStorage there (dev-only target).
 */
export const secure = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null
    return SecureStore.getItemAsync(key)
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') return void globalThis.localStorage?.setItem(key, value)
    await SecureStore.setItemAsync(key, value)
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') return void globalThis.localStorage?.removeItem(key)
    await SecureStore.deleteItemAsync(key)
  },
}
