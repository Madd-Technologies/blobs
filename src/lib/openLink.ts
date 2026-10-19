import { requireOptionalNativeModule } from 'expo'
import { Linking, Platform } from 'react-native'

import { appRoute, type AppRoute } from '@/features/links/apps'
import { toast } from '@/stores/toast'

interface AppLinks {
  open(packageName: string, url: string | null): Promise<boolean>
}

/** The local Android module (modules/app-links); absent on iOS and in Expo Go, where Android links open as the system decides. */
const native = requireOptionalNativeModule<AppLinks>('AppLinks')

/**
 * Opens a link outside the app: from a reply, a dashboard value or a page a bot made. A link that belongs to an app on the phone
 * (a mail in Gmail, Outlook, Yahoo and the others in `features/links/apps.ts`) opens in that app when it is installed; anything
 * else, or an app that is not there, opens as the system decides (the browser, the dialer, the mail app).
 */
export async function openLink(href: string): Promise<void> {
  const route = appRoute(href)

  if (route && (await openInApp(route))) {
    return
  }

  await Linking.openURL(href.trim()).catch(() => toast('That link can’t be opened from here.'))
}

async function openInApp(route: AppRoute): Promise<boolean> {
  if (Platform.OS === 'android') {
    const app = route.android

    if (!native || !app) {
      return false
    }

    const tried = (url: string | null) => native.open(app, url).catch(() => false)

    return (await tried(route.url)) || (await tried(null))
  }

  // iOS opens another app's scheme without asking, and fails when no app has it, so no LSApplicationQueriesSchemes are needed.
  for (const url of route.ios) {
    if (await Linking.openURL(url).then(() => true, () => false)) {
      return true
    }
  }

  return false
}
