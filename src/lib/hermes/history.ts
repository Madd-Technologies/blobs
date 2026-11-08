/**
 * A chat's history read light, through hermes-bot-mobile 0.3+ (`/api/plugins/hermes-bot-mobile/history`): the newest turns of
 * the person's, without what the app never draws (the prompt as the model saw it, stored reasoning) and with each long tool
 * output cut to its end. A row that was cut carries `omitted`; its whole row comes from `fetchWholeRows` when its step is near
 * the screen. Without the plugin (or on a server that cannot serve it), Hermes's own `/api/sessions/{id}/messages` is read
 * as before. Pure: no React Native imports.
 */

import { listSessionMessages, type MessagesPage, type MessagesQuery, type StoredMessage } from './rest.ts'
import { HermesHttpError, restJson, type ServerConfig } from './server.ts'

const BASE = '/api/plugins/hermes-bot-mobile/history'

/** A page holds the person's newest this many turns, each with every reply and tool step in it. */
export const LIGHT_TURNS = 20

const enc = encodeURIComponent

/**
 * One page of a chat's history, newest first by `offset` (the rows already held), light. A 404 (a plugin without the route,
 * or one that could not read this Hermes) falls back to Hermes's own route, which also answers a chat that is not there.
 */
export async function listLightMessages(config: ServerConfig, storedId: string, profile: string, query: MessagesQuery = {}): Promise<MessagesPage> {
  try {
    return await restJson<MessagesPage>(config, `${BASE}/${enc(storedId)}?bot=${enc(profile)}&turns=${LIGHT_TURNS}&offset=${query.offset ?? 0}`, {}, { timeoutMs: 30_000 })
  } catch (error) {
    if (error instanceof HermesHttpError && error.status === 404) {
      return listSessionMessages(config, storedId, profile, query)
    }

    throw error
  }
}

/** The most rows asked for whole at once (the plugin's own bound). */
export const WHOLE_MAX = 100

/** Rows of a chat whole, by their ids: a tool step's full output, for when the step is about to be read. */
export async function fetchWholeRows(config: ServerConfig, storedId: string, profile: string, ids: readonly (string | number)[]): Promise<StoredMessage[]> {
  const wanted = [...new Set(ids.map(String))].slice(0, WHOLE_MAX)

  if (!wanted.length) {
    return []
  }

  const answer = await restJson<{ messages?: StoredMessage[] }>(config, `${BASE}/${enc(storedId)}/rows?bot=${enc(profile)}&ids=${wanted.map(enc).join(',')}`, {}, { timeoutMs: 30_000 })

  return Array.isArray(answer?.messages) ? answer.messages : []
}

/** Whether a page says there is more before it: the plugin says so; Hermes's own route only by filling the page. */
export function hasOlder(page: MessagesPage, pageSize: number): boolean {
  return typeof page.pagination.has_older === 'boolean' ? page.pagination.has_older : page.pagination.returned >= pageSize
}
