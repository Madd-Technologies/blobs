/**
 * Google Drive links in replies (the hermes-drive plugin's `/api/plugins/hermes-drive/files/<id>/preview`). A Google Doc, Sheet
 * or Slides deck is not a file: it lives in Google's own apps, so it opens there (Android hands Google's link to the Sheets, Docs
 * or Drive app, else the browser) instead of being exported into the viewer. Any other file (a PDF, a picture) streams into the
 * viewer as it is. Pure.
 */

const DRIVE_ROUTE = /^\/api\/plugins\/hermes-drive\/files\/([A-Za-z0-9_-]{10,200})\/(?:preview|original)$/

/** The Drive file id a hermes-drive file link is for, or null for any other link. */
export function driveFileId(href: string): string | null {
  return DRIVE_ROUTE.exec(href.trim())?.[1] ?? null
}

/** What the plugin's `GET /files/<id>` answers (the fields used here). */
export interface DriveFile {
  mime_type?: string
  web_link?: string | null
}

const GOOGLE_APPS: Record<string, string> = {
  'application/vnd.google-apps.spreadsheet': 'Google Sheets',
  'application/vnd.google-apps.document': 'Google Docs',
  'application/vnd.google-apps.presentation': 'Google Slides',
  'application/vnd.google-apps.drawing': 'Google Drawings',
  'application/vnd.google-apps.form': 'Google Forms',
}

/** Only Google's own pages are opened outside the app, whatever the server says. */
const GOOGLE_HOSTS = /^https:\/\/(docs|drive|sheets|slides|forms)\.google\.com\//i

/**
 * Where to open this Drive file outside the app: Google's link and the app it belongs to, when it is a Google file. Null for a
 * file the viewer shows itself.
 */
export function openInGoogle(file: DriveFile): { url: string; app: string } | null {
  const mime = file.mime_type ?? ''
  const url = file.web_link ?? ''

  if (!mime.startsWith('application/vnd.google-apps.') || !GOOGLE_HOSTS.test(url)) {
    return null
  }

  return { url, app: GOOGLE_APPS[mime] ?? 'Google Drive' }
}
