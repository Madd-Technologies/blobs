/**
 * What to say when a reply is read aloud: the words, without the markup. Code, links, formulas, tables and file lines would be spoken
 * as noise ("asterisk asterisk", the letters of a URL), so they are turned into a short word or left out. Pure.
 */

/** Plain text for speech from a markdown reply. */
export function speechText(markdown: string): string {
  let text = markdown.replace(/\r/g, '')

  // Fenced code: not read; a word says it was there.
  text = text.replace(/(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g, (_whole, lead: string) => `${lead}Code block.\n`)
  // Files the bot attached (`MEDIA:/path`) are shown, not said.
  text = text.replace(/(^|\n)[ \t]*[`"']?MEDIA:[^\n]*/g, '$1')
  // Formulas: a word. Display ones first, they contain dollar signs.
  text = text.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<![\\\w$])\$(?=\S)[^$\n]*?\S\$(?![\d\w])/g, ' formula ')
  // Images and links keep their words, not their addresses.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  text = text.replace(/<?https?:\/\/[^\s)>]+>?/g, ' link ')
  // Inline code keeps what it says.
  text = text.replace(/`([^`\n]+)`/g, '$1')
  // Tables: a row is its cells, one after another; the rule line under the header goes.
  text = text.replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '')
  text = text.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_row, cells: string) => `${cells.split('|').map(cell => cell.trim()).filter(Boolean).join(', ')}.`)
  text = text.replace(/\|/g, ', ')
  // Headings, quotes and list markers.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
  text = text.replace(/^[ \t]*>[ \t]?/gm, '')
  text = text.replace(/^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+/gm, '')
  text = text.replace(/^[ \t]*(?:---+|\*\*\*+|___+)[ \t]*$/gm, '')
  // Emphasis marks.
  text = text.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2').replace(/~~(.+?)~~/g, '$1')
  // Html tags and the escapes markdown uses.
  text = text.replace(/<\/?[a-z][^>]*>/gi, '').replace(/\\([\\`*_{}\[\]()#+\-.!$|<>])/g, '$1')

  return text
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The text cut into pieces of at most `max` characters, at paragraph, then sentence, then word breaks: a speech engine takes a limited length. */
export function speechChunks(text: string, max = 3000): string[] {
  const chunks: string[] = []
  let current = ''

  const flush = () => {
    if (current.trim()) {
      chunks.push(current.trim())
    }

    current = ''
  }

  const add = (piece: string) => {
    if ((current + piece).length > max) {
      flush()
    }

    current += piece
  }

  for (const paragraph of text.split(/\n{2,}/)) {
    if (paragraph.length <= max) {
      add(`${paragraph}\n\n`)

      continue
    }

    // A paragraph longer than a chunk: by sentence, and a sentence longer than a chunk by word.
    for (const sentence of paragraph.match(/[^.!?\n]+[.!?]*\s*/g) ?? [paragraph]) {
      if (sentence.length <= max) {
        add(sentence)

        continue
      }

      for (const word of sentence.split(/(?<=\s)/)) {
        add(word.length > max ? word.slice(0, max) : word)
      }
    }

    add('\n\n')
  }

  flush()

  return chunks
}
