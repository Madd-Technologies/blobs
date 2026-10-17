/**
 * Telling a picture pasted into the message field from text. The field takes only text, so Android hands it the picture
 * the only way it can: its bytes read as text (a burst of garbage) or its address. Pure.
 */

/** What a change put into the field: the part of `after` that was not in `before` (replacing any selection). */
export function inserted(before: string, after: string): string {
  let start = 0

  while (start < before.length && start < after.length && before[start] === after[start]) {
    start++
  }

  let endBefore = before.length
  let endAfter = after.length

  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--
    endAfter--
  }

  return after.slice(start, endAfter)
}

/** The first bytes of common picture formats, as they read once decoded as text. */
const PICTURE_HEADER = /\u0089?PNG\r?\n|JFIF|Exif|GIF8[79]a|WEBPVP8|ftyp(heic|heix|avif|mif1)/

/** True for an insert that is a picture rather than words: never for typing, a pasted message or a pasted link. */
export function looksLikePastedPicture(chunk: string): boolean {
  const text = chunk.trim()

  if (/^(content|file):\/\/\S+$/i.test(text) || /^data:image\/[a-z+.-]+;base64,/i.test(text)) {
    return true
  }

  if (text.length < 16) {
    return false
  }

  let odd = 0

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0

    // Bytes that are not text decode to the replacement character or to control characters.
    if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      odd++
    }
  }

  return (odd > 0 && PICTURE_HEADER.test(text.slice(0, 64))) || odd / text.length > 0.1
}
