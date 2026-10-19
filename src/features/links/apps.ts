/**
 * Web links that belong to an app on the phone: a mail in Gmail, Outlook or another provider's web mail opens in that app, not on its
 * website. The systems do this alone only for an app that claims its links, and mail apps mostly do not. iOS hands a link to an app
 * only when the app claims it as a Universal Link: Gmail claims none (mail.google.com's association file is a redirect, which iOS
 * ignores), and Outlook, Yahoo and AOL claim only redirect and sign-in paths. Android hands it over only when the app's App Links are
 * verified and switched on for that path. So each app here says how to reach it directly: on Android its package, which is handed
 * the link itself; on iOS its own URL scheme. An app that claims its links on both (Superhuman) needs no entry.
 *
 * When the app cannot open the exact page, its front door still beats the website: you asked for the app, a mail is a scroll or a
 * search away there, and the website on a phone means signing in again. An app that is not installed leaves the link to the
 * browser. Pure.
 */

/** An https link in parts. Parsed here, not with `URL`: React Native's cuts a hash at its first slash, and Gmail's has slashes. */
export interface WebPage {
  host: string
  path: string
  /** Without its `?`. */
  query: string
  /** Without its `#`. Gmail keeps the open mail here (`inbox/<id>`). */
  hash: string
}

/** Where to open a link that belongs to an app. */
export interface AppRoute {
  /** The app's name. */
  app: string
  /** The link itself. */
  url: string
  /**
   * Android: the app's package, or null when it has no Android app. It is handed the link; if none of its filters takes it, its
   * front door opens.
   */
  android: string | null
  /** iOS: the app's own links to try in turn, the exact page first and the front door last. Empty leaves the link to the browser. */
  ios: string[]
}

interface App {
  name: string
  hosts: RegExp
  /** The paths that are the app's (not, say, a public booking page on the same host). */
  paths: RegExp
  /** The Android package, read from the host's `/.well-known/assetlinks.json` where it has one. */
  android?: string
  /**
   * The app's front door on iOS. Left out when the app has no scheme that opens it as it is: AOL and Zoho have none known, and
   * Proton's opens a new message.
   */
  scheme?: string
  /** iOS: the app's own link for this exact page, or null when it has none (the front door opens). */
  ios?: (page: WebPage) => string | null
}

// Only a plain host: a link with a user name (`https://mail.google.com@elsewhere/`) or another port is not the app's.
const WEB = /^https:\/\/([a-z0-9.-]+)(?::443)?(\/[^?#\s]*)?(?:\?([^#\s]*))?(?:#(\S*))?$/i

export function webPage(href: string): WebPage | null {
  const match = WEB.exec(href.trim())

  return match ? { host: match[1]!.toLowerCase(), path: match[2] ?? '/', query: match[3] ?? '', hash: match[4] ?? '' } : null
}

/** A query value, decoded (`+` is a space), or '' when it is not there. */
export function param(query: string, key: string): string {
  for (const pair of query.split('&')) {
    const at = pair.indexOf('=')

    if (decode(at < 0 ? pair : pair.slice(0, at)) === key) {
      return at < 0 ? '' : decode(pair.slice(at + 1))
    }
  }

  return ''
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/** A query for an app's link, leaving out empty values. Spaces are `%20`: an app's own parser may not read `+` as one. */
export function query(values: Record<string, string>): string {
  const pairs = Object.entries(values)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)

  return pairs.length ? `?${pairs.join('&')}` : ''
}

/**
 * The Gmail app's own link (iOS) for a page of Gmail on the web, or null to open the app at its inbox.
 *
 * Compose on the web (`/mail/?view=cm&fs=1&to=…&su=…&body=…`, `su` being the subject) is the app's compose screen,
 * `googlegmail:///co?to=…&subject=…&body=…`, a long-standing link that Google does not document. A mail (`/mail/u/<n>/#inbox/<id>`)
 * opens the inbox: the app has no supported link to one mail. An unofficial one (`googlegmail:///cv=<id>/…`) works only for some ids
 * and can land on an error screen, which is worse than the inbox.
 */
function gmailLink(page: WebPage): string | null {
  if (param(page.query, 'view') !== 'cm') {
    return null
  }

  const value = (key: string) => param(page.query, key)

  return `googlegmail:///co${query({ to: value('to'), cc: value('cc'), bcc: value('bcc'), subject: value('su'), body: value('body') })}`
}

/** Outlook's compose link on the web (`/mail/deeplink/compose?to=…`) is its app's compose screen; it has no app link to a mail. */
function outlookLink(page: WebPage): string | null {
  if (!/^\/mail\/(?:\d+\/)?deeplink\/compose\/?$/i.test(page.path)) {
    return null
  }

  const value = (key: string) => param(page.query, key)

  return `ms-outlook://compose${query({ to: value('to'), cc: value('cc'), bcc: value('bcc'), subject: value('subject'), body: value('body') })}`
}

const APPS: App[] = [
  {
    name: 'Gmail',
    hosts: /^(?:mail\.google\.com|(?:www\.)?gmail\.com)$/,
    paths: /^\/(?:mail(?:\/|$)|$)/,
    android: 'com.google.android.gm',
    scheme: 'googlegmail://',
    ios: gmailLink,
  },
  {
    name: 'Outlook',
    hosts: /^outlook\.(?:live\.com|office\.com|office365\.com|cloud\.microsoft)$/,
    // Mail and calendar, and the `/owa/?ItemID=…` links Microsoft Graph gives a mail. Not `/owa/calendar/…` or `/bookwithme/…`:
    // published calendars and booking pages are for the browser.
    paths: /^\/(?:(?:mail|calendar)(?:\/|$)|owa\/?$)/i,
    android: 'com.microsoft.office.outlook',
    scheme: 'ms-outlook://',
    ios: outlookLink,
  },
  {
    name: 'Yahoo Mail',
    hosts: /^mail\.yahoo\.com$/,
    paths: /^\//,
    android: 'com.yahoo.mobile.client.android.mail',
    scheme: 'ymail://',
  },
  {
    name: 'AOL',
    hosts: /^mail\.aol\.com$/,
    paths: /^\//,
    android: 'com.aol.mobile.aolapp',
  },
  {
    name: 'Proton Mail',
    hosts: /^mail\.(?:proton\.me|protonmail\.com)$/,
    paths: /^\//,
    android: 'ch.protonmail.android',
  },
  {
    name: 'Fastmail',
    hosts: /^(?:app|www)\.fastmail\.com$/,
    paths: /^\/(?:mail|calendar)(?:\/|$)/,
    android: 'com.fastmail.app',
    scheme: 'fastmail://',
  },
  {
    name: 'Zoho Mail',
    // Zoho keeps each region's accounts on its own host.
    hosts: /^mail\.zoho\.(?:com|eu|in|com\.au|jp|ca|sa|uk|com\.cn)$/,
    paths: /^\//,
    android: 'com.zoho.mail',
  },
  {
    // iCloud Mail is read in the iPhone's own Mail app; it has no Android app.
    name: 'Mail',
    hosts: /^(?:www\.)?icloud\.com$/,
    paths: /^\/mail(?:\/|$)/,
    scheme: 'message://',
  },
]

/** The app a link belongs to and how to reach it, or null for a link the system should open as it always does. */
export function appRoute(href: string): AppRoute | null {
  const page = webPage(href)
  const app = page && APPS.find(entry => entry.hosts.test(page.host) && entry.paths.test(page.path))

  if (!page || !app) {
    return null
  }

  const exact = app.ios?.(page)
  const ios = [exact, app.scheme].filter((url): url is string => !!url)

  return { app: app.name, url: href.trim(), android: app.android ?? null, ios: [...new Set(ios)] }
}
