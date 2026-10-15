import { Fragment, memo, useMemo } from 'react'
import { View } from 'react-native'
import { useMarkdown, type MarkedStyles } from 'react-native-marked'

import { DiagramTile } from './DiagramTile'
import { MathBlock } from './MathView'
import { QuietRenderer } from './QuietRenderer'

import { splitMarkdownBlocks } from '@/features/transcript/markdown'
import { parseBlock, type MathItem } from '@/features/transcript/richMarkdown'
import { fileName, type ServerTarget } from '@/features/viewer/kind'
import { openDocument } from '@/stores/documents'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius, type Palette } from '@/theme/tokens'

/** `reply` is a bot's words in a chat, 16/25 with no bubble; `body` is 15/21 everywhere else (a record, a panel, a file). */
export type MarkdownSize = 'reply' | 'body'

function stylesFor(c: Palette, size: MarkdownSize): MarkedStyles {
  const reply = size === 'reply'
  const body = { fontFamily: fonts.regular, fontSize: reply ? 16 : 15, lineHeight: reply ? 25 : 21, color: c.text }
  // No underline rules or big margins: the blocks are spaced by the Markdown column's own gap.
  const heading = (size: number, line: number) => ({
    fontFamily: fonts.semibold,
    fontSize: size,
    lineHeight: line,
    color: c.text,
    fontWeight: 'normal' as const,
    marginVertical: 0,
    paddingBottom: 0,
    borderBottomWidth: 0,
  })

  return {
    text: body,
    paragraph: { paddingVertical: 0 },
    li: { ...body, marginVertical: 0 },
    strong: { fontFamily: fonts.semibold, fontWeight: 'normal' },
    em: { fontStyle: 'italic' },
    // The library's own link style is italic; Quiet links are upright and underlined.
    link: { color: c.text, textDecorationLine: 'underline', fontStyle: 'normal' },
    // Inline spans get their chip (on the tone) from QuietRenderer; a block of code sits on the sheet, one level up from the paper.
    // The library's default code span is italic and weight 300. Geist Mono has neither, and Android then draws the span in
    // another font, wider or narrower than the chip measured for it, so the chip covers the next letters.
    codespan: { fontFamily: fonts.mono, fontSize: reply ? 14 : 13.5, color: c.text, fontStyle: 'normal', fontWeight: '400' },
    code: { backgroundColor: c.sheet, borderRadius: radius.block, padding: 12 },
    codeText: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, color: c.text },
    blockquote: { borderLeftWidth: 2, borderLeftColor: c.tone, paddingLeft: 12 },
    h1: heading(reply ? 21 : 20, reply ? 28 : 26),
    h2: heading(reply ? 19 : 18, reply ? 26 : 24),
    h3: heading(reply ? 17 : 16, reply ? 24 : 22),
    h4: heading(reply ? 16 : 15, reply ? 25 : 21),
    h5: heading(reply ? 16 : 15, reply ? 25 : 21),
    h6: heading(reply ? 16 : 15, reply ? 25 : 21),
    hr: { backgroundColor: c.tone, height: 1 },
  }
}

const Block = memo(function Block({ text, math, size }: { text: string; math: MathItem[]; size: MarkdownSize }) {
  const { c, scheme } = useTheme()
  const styles = useMemo(() => stylesFor(c, size), [c, size])
  const theme = useMemo(() => ({ colors: { code: c.sheet, link: c.text, text: c.text, border: c.tone } }), [c])
  const renderer = useMemo(() => new QuietRenderer({ selectable: true, lineColor: c.tone, chipColor: c.tone, textColor: c.text, math, onServerLink: openServerLink }), [c.tone, c.text, math])
  const elements = useMarkdown(text, { colorScheme: scheme, styles, theme, renderer })

  return (
    <>
      {elements.map((element, index) => (
        <Fragment key={index}>{element}</Fragment>
      ))}
    </>
  )
})

/** A link in a reply to a file on the server, or to something a server plugin serves: open it in the viewer. */
function openServerLink(target: ServerTarget, label: string) {
  openDocument(target.kind === 'file' ? { kind: 'file', path: target.path, name: fileName(target.path) } : { kind: 'route', href: target.href, name: label })
}

/**
 * Renders a markdown message. It is split into blocks at blank lines and each block is memoized, so
 * while a reply streams only its last block is re-parsed.
 */
export const Markdown = memo(function Markdown({ text, size = 'body' }: { text: string; size?: MarkdownSize }) {
  const { c } = useTheme()
  const blocks = useMemo(() => splitMarkdownBlocks(text).map(parseBlock), [text])

  return (
    <View style={{ gap: size === 'reply' ? 10 : 8 }}>
      {blocks.map((block, index) =>
        block.kind === 'math' ? (
          <MathBlock key={index} tex={block.tex} color={c.text} />
        ) : block.kind === 'diagram' ? (
          <DiagramTile key={index} source={block.source} />
        ) : (
          <Block key={index} text={block.text} math={block.math} size={size} />
        ),
      )}
    </View>
  )
})

