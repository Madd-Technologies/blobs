import Constants from 'expo-constants'
import { Platform } from 'react-native'

import { resolveNotificationResponseUrl } from '@/features/push/expoResponse'

type NotificationsLib = typeof import('expo-notifications')

let cachedLib: NotificationsLib | null | undefined
let configured = false
let handledInitialId: string | null = null

function getLib(): NotificationsLib | null {
  if (Platform.OS === 'web') {
    return null
  }
  if (cachedLib !== undefined) {
    return cachedLib
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedLib = require('expo-notifications') as NotificationsLib
    return cachedLib
  } catch {
    cachedLib = null
    return null
  }
}

export function isExpoPushSupported(): boolean {
  return getLib() !== null
}

/** Configures foreground presentation, APPROVAL action buttons, and Android channels once. */
export async function configureExpoNotifications(): Promise<void> {
  const Notifications = getLib()
  if (!Notifications || configured) {
    return
  }
  configured = true

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })

  try {
    await Notifications.setNotificationCategoryAsync('APPROVAL', [
      {
        identifier: 'ALLOW_ONCE',
        buttonTitle: 'Allow once',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'DENY',
        buttonTitle: 'Deny',
        options: { isDestructive: true, opensAppToForeground: true },
      },
    ])
  } catch {
    // Some environments (e.g. web or partial hosts) may not support categories.
  }

  if (Platform.OS === 'android') {
    const imp = Notifications.AndroidImportance
    const channels: [string, string, number][] = [
      ['Approvals', 'Approvals', imp.MAX],
      ['Questions', 'Questions', imp.HIGH],
      ['Calls', 'Calls', imp.MAX],
      ['Routines', 'Routines', imp.DEFAULT],
      ['Replies', 'Replies', imp.DEFAULT],
      ['Results', 'Results', imp.LOW],
    ]
    await Promise.all(
      channels.map(([id, name, importance]) =>
        Notifications.setNotificationChannelAsync(id, {
          name,
          importance,
          sound: 'default',
        }).catch(() => undefined),
      ),
    )
  }
}

function friendlyRegistrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/Default FirebaseApp is not initialized|fcm|google-services/i.test(message)) {
    return 'Android Firebase push credentials are missing from this build. Use UnifiedPush (ntfy) below or install an official Play build.'
  }
  if (/simulator|entitlement|aps-environment/i.test(message)) {
    return 'Apple Push requires a physical iPhone with a TestFlight or App Store build.'
  }
  return message || 'Failed to register for push notifications.'
}

export async function registerForExpoPushToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const Notifications = getLib()
  if (!Notifications) {
    return { ok: false, error: 'Push notifications require an iOS or Android native build.' }
  }

  await configureExpoNotifications()

  try {
    const existing = await Notifications.getPermissionsAsync()
    let status = existing.status
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync()
      status = requested.status
    }
    if (status !== 'granted') {
      return { ok: false, error: 'Notifications are disabled in system Settings.' }
    }

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId

    const result = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    if (!result?.data) {
      return { ok: false, error: 'Expo Push returned an empty token.' }
    }
    return { ok: true, token: result.data }
  } catch (error) {
    return { ok: false, error: friendlyRegistrationError(error) }
  }
}

export function subscribeExpoNotificationResponses(onUrl: (url: string) => void): () => void {
  const Notifications = getLib()
  if (!Notifications) {
    return () => {}
  }

  const sub = Notifications.addNotificationResponseReceivedListener(response => {
    const id = response.notification.request.identifier
    if (handledInitialId && id === handledInitialId) {
      return
    }
    const data = response.notification.request.content.data as Record<string, unknown> | undefined
    const url = resolveNotificationResponseUrl(response.actionIdentifier, data)
    if (url) {
      handledInitialId = id
      onUrl(url)
    }
  })

  return () => sub.remove()
}

export function consumeInitialExpoNotificationUrl(): string | null {
  const Notifications = getLib()
  if (!Notifications) {
    return null
  }
  try {
    const response = Notifications.getLastNotificationResponse()
    if (!response) {
      return null
    }
    const id = response.notification.request.identifier
    if (id && id === handledInitialId) {
      return null
    }
    const data = response.notification.request.content.data as Record<string, unknown> | undefined
    const url = resolveNotificationResponseUrl(response.actionIdentifier, data)
    if (url && id) {
      handledInitialId = id
    }
    return url
  } catch {
    return null
  }
}

export function expoDeviceName(): string {
  if (Platform.OS === 'ios') {
    const constants = Platform.constants as { interfaceIdiom?: string }
    return constants.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone'
  }
  const constants = Platform.constants as { Brand?: string; Model?: string }
  return [constants.Brand, constants.Model].filter(Boolean).join(' ') || 'Android phone'
}
