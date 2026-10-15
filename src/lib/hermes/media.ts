/**
 * Pictures and files that live on the server: a bot's `MEDIA:` lines in a reply, and the pictures you sent. A bot's pictures are
 * drawn in the chat as it scrolls to them (see `stores/pictures.ts`); the ones you sent are named chips, opened when tapped. Pure: no
 * React Native imports.
 */

import { HermesHttpError, restJson, type ServerConfig } from './server.ts'

/** The server will not hand back more than this as one data URL. */
export const MAX_VIEW_BYTES = 16 * 1024 * 1024

export interface MediaRef {
  /** A path on the server, or (for a picture a tool made) an https URL. */
  path: string
  name: string
  /** Found in the reply's own words rather than on a `MEDIA:` line: shown when it can be loaded, dropped without a word when not. */
  stated?: boolean
}

const basename = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/**
 * Hermes bots point at files they made with a line `MEDIA:/path/to/file.png` in the reply. Those lines are not for
 * reading: they are lifted out of the text and shown as attachments.
 */
const MEDIA_LINE = /(^|\n)[ \t]*[`"']?MEDIA:[ \t]*(\S+?)[`"']?[ \t]*(?=\n|$)/g

const IMAGE_EXT = 'png|jpe?g|gif|webp|bmp'
/**
 * An absolute path to a picture, written out in a reply: `/home/orion/.hermes/profiles/x/images/a.png`. Where the server tells a bot there
 * is no attachment channel (it does, for chats it counts as a terminal), "stating the file's absolute path" is how it delivers one.
 * The path has no spaces, is not part of a longer word or of a URL (`https://host/a.png`), and may sit in backticks, quotes or a link.
 */
const STATED_PATH = new RegExp(String.raw`(?<![\w:/.~-])(/(?:[^\s\`"'<>()\[\]{}*]+/)*[^\s\`"'<>()\[\]{}*/]+\.(?:${IMAGE_EXT}))(?![\w/-])`, 'gi')
/** A line that is nothing but one such path (with a bullet, backticks or a full stop around it): the picture says it, so the line goes. */
const PATH_LINE = new RegExp(String.raw`^[ \t]*(?:[-*•][ \t]+)?[\`"']?(/(?:[^\s\`"'<>()\[\]{}*]+/)*[^\s\`"'<>()\[\]{}*/]+\.(?:${IMAGE_EXT}))[\`"']?[.,:;]?[ \t]*$`, 'i')

/** The most pictures drawn from one reply. */
const MAX_PICTURES = 6

/**
 * A bot's files, lifted out of its reply: the `MEDIA:` lines, and absolute picture paths it states in its words. `hide` names pictures
 * already drawn (by a tool's result earlier in the turn): they are left out here, and a line that only said where one was goes too.
 */
export function splitMedia(text: string, hide?: ReadonlySet<string>): { text: string; media: MediaRef[] } {
  const media: MediaRef[] = []
  const seen = new Set<string>()
  const hidden = (path: string) => !!hide?.has(path)
  let cleaned = text.replace(MEDIA_LINE, (_whole, _lead: string, path: string) => {
    if (!seen.has(path) && !hidden(path)) {
      seen.add(path)
      media.push({ path, name: basename(path) })
    }

    // The line goes with the newline before it, so no blank line is left behind.
    return ''
  })

  // Paths stated in the words. Lines that are only a path go; a path in a sentence stays where it is.
  const kept: string[] = []
  let removedLine = false

  for (const line of cleaned.split('\n')) {
    const only = PATH_LINE.exec(line)?.[1]

    if (only) {
      removedLine = true

      if (!seen.has(only) && !hidden(only) && media.length < MAX_PICTURES) {
        seen.add(only)
        media.push({ path: only, name: basename(only), stated: true })
      }

      continue
    }

    for (const match of line.matchAll(STATED_PATH)) {
      const path = match[1] as string

      if (!seen.has(path) && !hidden(path) && media.length < MAX_PICTURES) {
        seen.add(path)
        media.push({ path, name: basename(path), stated: true })
      }
    }

    kept.push(line)
  }

  if (removedLine) {
    cleaned = kept.join('\n')
  }

  return media.length || removedLine || cleaned !== text ? { text: cleaned.replace(/\n{3,}/g, '\n\n').trim(), media } : { text, media }
}

/**
 * The picture an `image_generate` tool made, from its result (an object, or the JSON text a stored result is): its `host_image` (a path the
 * server can read) or `image` (a path or an https URL). Nothing for a failed run or any other tool.
 */
export function imageOfResult(result: unknown): string | undefined {
  let record = result

  if (typeof record === 'string') {
    try {
      record = JSON.parse(record)
    } catch {
      return undefined
    }
  }

  if (!record || typeof record !== 'object' || Array.isArray(record) || (record as { success?: unknown }).success === false) {
    return undefined
  }

  for (const field of ['host_image', 'image'] as const) {
    const value = (record as Record<string, unknown>)[field]

    if (typeof value === 'string' && /^(?:\/|https?:\/\/)\S+$/.test(value.trim())) {
      return value.trim()
    }
  }

  return undefined
}

/** Whether a picture's source is an address on the web rather than a file on the server. */
export const isRemote = (source: string): boolean => /^https?:\/\//i.test(source)

/** Whether a path is a picture the app can show (the server reads others as files, which are not shown here). */
export const isPicture = (path: string): boolean => /\.(png|jpe?g|gif|webp|bmp)$/i.test(path)

/**
 * The picture at `path` on the server, as a `data:` URL for an `Image`. Reads it with the bot's own scope (a picture
 * you sent lives under that bot's folder). The older media route, which only serves the server's shared image
 * folders, is tried when the file route will not.
 */
export async function fetchPicture(config: ServerConfig, path: string, profile?: string): Promise<string> {
  const query = `path=${encodeURIComponent(path)}`

  try {
    const body = await restJson<{ dataUrl?: string }>(config, `/api/fs/read-data-url?${query}${profile ? `&profile=${encodeURIComponent(profile)}` : ''}`)

    if (body.dataUrl) {
      return body.dataUrl
    }
  } catch (error) {
    // Too large, or not found, will not be different on the other route.
    if (error instanceof HermesHttpError && (error.status === 413 || error.status === 404)) {
      throw error
    }
  }

  const body = await restJson<{ data_url?: string }>(config, `/api/media?${query}`)

  if (!body.data_url) {
    throw new Error('The server did not send the picture.')
  }

  return body.data_url
}

/** A short reason for a failed fetch, for the viewer. */
export function viewError(error: unknown): string {
  if (error instanceof HermesHttpError) {
    return error.status === 413 ? 'That picture is too large to open here.' : error.status === 404 ? 'That file is no longer on the server.' : error.status === 403 ? 'The server will not open that file.' : 'Could not load the picture.'
  }

  return error instanceof Error ? error.message : 'Could not load the picture.'
}
