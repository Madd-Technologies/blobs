/**
 * Sending files to a bot with a message. Pure: no React Native imports.
 *
 * Hermes takes them as session state that the next `prompt.submit` picks up: images and PDF pages are queued on the
 * live session (`image.attach_bytes`, `pdf.attach`), and any other file is staged into the session's workspace and
 * comes back as an `@file:` reference that goes into the message text (`file.attach`). So the app keeps picked files on
 * the phone, uploads them when you press send, and puts the references in the message. Nothing is queued server-side
 * before then, so a dropped connection or a removed attachment leaves nothing behind.
 */

import { call, isRpcCode, type RpcClient } from './rpc.ts'

/** The server's per-file cap for images (PDFs allow more, other files are capped by the server's file policy). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

export type AttachmentKind = 'image' | 'pdf' | 'file'

/** A file picked on the phone, waiting to be sent. */
export interface PendingFile {
  id: string
  kind: AttachmentKind
  name: string
  mime: string
  /** Where it is on the phone (a cache copy the app owns). */
  uri: string
  /** Bytes, when the picker said. */
  size?: number
}

/** What the server did with one file: how to mention it, and anything to put in the message. */
export interface Uploaded {
  kind: AttachmentKind
  name: string
  /** `@file:path` for a file the bot should open. */
  refText?: string
  /** What the server calls it, for a message with no words ("[User attached image: upload_1.png]"). */
  hint: string
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.')

  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

/** Images go to the model as pictures, PDFs as rendered pages, anything else as a file the bot can open. */
export function kindOf(name: string, mime?: string): AttachmentKind {
  const type = (mime ?? '').toLowerCase()

  if (type === 'application/pdf' || extensionOf(name) === '.pdf') {
    return 'pdf'
  }

  // HEIC and similar are not in the server's list; the photo picker is asked to hand over JPEG (see lib/pickers.ts).
  if (IMAGE_EXTENSIONS.has(extensionOf(name)) || (type.startsWith('image/') && IMAGE_EXTENSIONS.has(`.${type.slice(6)}`))) {
    return 'image'
  }

  return 'file'
}

/**
 * A photo's name. The library picker is asked for the compatible form (HEIC converted to JPEG) but may keep the old name, and a
 * library asset can come with no name at all: the file the app holds is what is sent, so its extension wins.
 */
export function photoName(fileName: string | null | undefined, uri: string, mime?: string | null): string {
  const fromUri = cleanName(uri.split('?')[0] ?? '', '')
  const uriExt = extensionOf(fromUri)
  const given = cleanName(fileName ?? '', '')
  const base = given || fromUri || 'photo'
  const typeExt = mime?.toLowerCase().startsWith('image/') ? `.${mime.slice(6).replace('jpeg', 'jpg')}` : ''
  const ext = IMAGE_EXTENSIONS.has(uriExt) ? uriExt : IMAGE_EXTENSIONS.has(typeExt === '.jpg' ? '.jpg' : typeExt) ? typeExt : extensionOf(base)

  if (!ext) {
    return base
  }

  const stem = extensionOf(base) ? base.slice(0, base.length - extensionOf(base).length) : base

  return `${stem}${ext}`
}

/** A name safe to send: no folders, no control characters, never empty. */
export function cleanName(name: string, fallback = 'file'): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f]+/g, '_').trim().replace(/^\.+/, '')

  return base || fallback
}

export function describeSize(bytes: number | undefined): string {
  if (bytes === undefined) {
    return ''
  }

  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Why a file cannot be sent, before spending an upload on it; null when it can. */
export function refusal(file: Pick<PendingFile, 'name' | 'size' | 'kind'>): string | null {
  if (file.size !== undefined && file.size <= 0) {
    return `${file.name} is empty.`
  }

  if (file.size !== undefined && file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} is ${describeSize(file.size)}; the limit is ${describeSize(MAX_ATTACHMENT_BYTES)}.`
  }

  // The server reads png, jpg, gif, webp and bmp pictures. A photo the phone kept as HEIC would be refused there after the upload.
  if (file.kind === 'image' && !IMAGE_EXTENSIONS.has(extensionOf(file.name))) {
    return `${file.name} is in a format the server cannot read as a picture${/\.hei[cf]$/i.test(file.name) ? ' (HEIC)' : ''}. Send it as a JPEG.`
  }

  return null
}

const asDataUrl = (mime: string, base64: string) => `data:${mime || 'application/octet-stream'};base64,${base64}`

/** Uploads one file to a live session. `base64` is the file's bytes. */
export async function uploadAttachment(client: RpcClient, sessionId: string, file: Pick<PendingFile, 'kind' | 'name' | 'mime'>, base64: string): Promise<Uploaded> {
  const name = cleanName(file.name, file.kind === 'image' ? 'photo.jpg' : 'file')

  if (file.kind === 'image') {
    const result = await call(client, 'image.attach_bytes', { session_id: sessionId, content_base64: base64, filename: name })

    if (!result.attached) {
      throw new Error(result.message || `The server did not accept ${name}.`)
    }

    return { kind: 'image', name, hint: result.text || `[User attached image: ${name}]` }
  }

  if (file.kind === 'pdf') {
    try {
      const result = await call(client, 'pdf.attach', { session_id: sessionId, content_base64: base64, filename: name })

      return { kind: 'pdf', name, hint: result.text || `[User attached PDF: ${name}]` }
    } catch (error) {
      // 5028: the server has no `pdftoppm` (poppler). The bot can still open the PDF as a file.
      if (!isRpcCode(error, 5028)) {
        throw error
      }
    }
  }

  const result = await call(client, 'file.attach', { session_id: sessionId, name, data_url: asDataUrl(file.kind === 'pdf' ? 'application/pdf' : file.mime, base64) })

  return { kind: file.kind === 'pdf' ? 'pdf' : 'file', name, refText: result.ref_text, hint: result.ref_text }
}

/**
 * The message to send: references to staged files first, then your words. With no words, what the server says each
 * attachment is, so the bot is never handed an empty message.
 */
export function messageFor(text: string, uploads: Uploaded[]): string {
  const refs = uploads.flatMap(upload => (upload.refText ? [upload.refText] : []))
  const words = text.trim()

  if (words) {
    return [...refs, words].join('\n')
  }

  return uploads.map(upload => upload.hint).join('\n')
}

/** What the bubble shows for an attachment while and after it is sent. */
export interface AttachmentChip {
  kind: AttachmentKind
  name: string
  /** A thumbnail on the phone, for pictures just sent from here. */
  uri?: string
  /** Where the server keeps it: a picture is fetched from here when you tap it. */
  path?: string
}

export const chipOf = (file: Pick<PendingFile, 'kind' | 'name' | 'uri'>): AttachmentChip => ({ kind: file.kind, name: cleanName(file.name), ...(file.kind === 'image' ? { uri: file.uri } : {}) })

/** Bytes as base64, in chunks so a large photo does not blow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(binary)
}
