/**
 * Splits a markdown message into blocks at blank lines (never inside a code fence), so a finished
 * block can be rendered once and kept while only the last block changes as tokens stream in. Pure.
 */
export function splitMarkdownBlocks(text: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let fence: string | null = null

  for (const line of text.split('\n')) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1]

    if (marker) {
      fence = fence === null ? marker : fence === marker ? null : fence
    }

    if (fence === null && !marker && line.trim() === '') {
      if (current.length) {
        blocks.push(current.join('\n'))
        current = []
      }

      continue
    }

    current.push(line)
  }

  if (current.length) {
    blocks.push(current.join('\n'))
  }

  return blocks
}

/**
 * A reply as plain text, for sharing into apps that do not draw markdown (Messages, mail): the words and code stay, the marks go.
 * `**bold**` and `_em_` lose their stars, `` `code` `` its backticks, headings and quotes their markers, a fence its fence lines, and
 * a link reads "words (address)".
 */
export function plainText(markdown: string): string {
  return markdown
    .split('\n')
    .filter(line => !/^\s*(```|~~~)/.test(line))
    .map(line =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s{0,3}>\s?/, '')
        .replace(/^(\s*)[*+-]\s+/, '$1• ')
        .replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, (_all, words: string, href: string) => (words && words !== href ? `${words} (${href})` : href))
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
        .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1$2')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1'),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
