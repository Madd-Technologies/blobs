/**
 * Scrubs captured protocol frames before they are committed as fixtures: home directories become
 * `~`, and anything shaped like a credential is replaced. Pure.
 */

/** macOS per-user temp roots: /var/folders/<hash>/<hash>/T/ -> /tmp/ */
const MAC_TMP = /\/var\/folders\/[^/\s"'\\]+\/[^/\s"'\\]+\/T\//g
const HOME_DIR = /\/(?:Users|home)\/[^/\s"'\\]+/g
const URL_TOKEN = /(\b(?:token|ticket|access_token|display_ticket)=)[^&\s"'\\]+/gi
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g
const KEY_VALUE = /("(?:token|access_token|refresh_token|api_key|password|secret|authorization|ticket)"\s*:\s*")[^"]*(")/gi

/** Sanitizes one string. */
export function sanitizeText(text: string): string {
  return text.replace(MAC_TMP, '/tmp/').replace(HOME_DIR, '~').replace(URL_TOKEN, '$1<redacted>').replace(BEARER, '$1<redacted>').replace(KEY_VALUE, '$1<redacted>$2')
}

/** Sanitizes any JSON-serializable value by walking its strings; keys named like credentials are redacted. */
export function sanitizeValue<T>(value: T): T {
  return JSON.parse(sanitizeText(JSON.stringify(value))) as T
}
