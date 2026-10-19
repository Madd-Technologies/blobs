import { cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'
import { PixelRatio, Platform, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native'
import { Renderer, type RendererOptions } from 'react-native-marked'

import { splitMath, type MathItem } from '@/features/transcript/richMarkdown'
import { serverTarget, type ServerTarget } from '@/features/viewer/kind'
import { openLink } from '@/lib/openLink'
import { fonts } from '@/theme/tokens'

import { InlineMath } from './MathView'

/** An inline code span up to this long is drawn as a chip; longer ones would not fit on one line. */
const CHIP_MAX = 28
const CHIP_PAD = 5
/** Geist Mono's advance width for every printable ASCII character, in em (600 of 1000 units). */
const MONO_ADVANCE = 0.6
const MONO_SAFE = /^[\x20-\x7e]+$/

/**
 * The library's code block and table sit in horizontal ScrollViews that stretch vertically inside a
 * chat bubble (a bubble with a table ended in a screenful of empty surface). These versions do not
 * grow, have no scrollbars, and draw a table as quiet rows with hairlines instead of a bordered grid.
 */
export class QuietRenderer extends Renderer {
  private readonly line: string
  private readonly chip: string
  private readonly math: MathItem[]
  private readonly textColor: string
  private readonly onServerLink?: (target: ServerTarget, label: string) => void

  constructor(options: RendererOptions & { lineColor: string; chipColor: string; textColor: string; math: MathItem[]; onServerLink?: (target: ServerTarget, label: string) => void }) {
    super(options)
    this.line = options.lineColor
    this.chip = options.chipColor
    this.textColor = options.textColor
    this.math = options.math
    this.onServerLink = options.onServerLink
  }

  /**
   * Puts each formula that was lifted out of the text (see `parseBlock`) back where it stood, as an inline picture. The words around
   * it stay text, so they wrap as they always do. Text with no formula in it is returned as it came.
   */
  private withMath(children: string | ReactNode[], size: number): string | ReactNode[] {
    if (!this.math.length) {
      return children
    }

    const expand = (value: string): ReactNode[] =>
      splitMath(value).map((part, index) => {
        const item = typeof part === 'number' ? this.math[part] : undefined

        return item ? <InlineMath key={`m${index}`} tex={item.tex} display={item.display} fontSize={size} color={this.textColor} /> : typeof part === 'number' ? '' : part
      })

    if (typeof children === 'string') {
      const parts = expand(children)

      return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts
    }

    return children.flatMap((child, index): ReactNode[] => (typeof child === 'string' ? expand(child).map((part, at) => (typeof part === 'string' ? part : <Fragment key={`f${index}-${at}`}>{part}</Fragment>)) : [child]))
  }

  override text(text: string | ReactNode[], styles?: TextStyle): ReactNode {
    return super.text(this.withMath(text, styles?.fontSize ?? 15), styles)
  }

  override strong(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    return super.strong(this.withMath(children, styles?.fontSize ?? 15), styles)
  }

  override em(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    return super.em(this.withMath(children, styles?.fontSize ?? 15), styles)
  }

  override del(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    return super.del(this.withMath(children, styles?.fontSize ?? 15), styles)
  }

  override heading(text: string | ReactNode[], styles?: TextStyle): ReactNode {
    return super.heading(this.withMath(text, styles?.fontSize ?? 18), styles)
  }

  /**
   * A link to a file on the server (an absolute path) or to something a server plugin serves (`/api/plugins/...`, such as a Paperless
   * document) opens in the viewer, read with your sign-in. Any other link opens outside the app: in its own app when it has one
   * (a mail in its mail app), else as the system decides.
   */
  override link(children: string | ReactNode[], href: string, styles?: TextStyle, title?: string): ReactNode {
    const target = this.onServerLink ? serverTarget(href) : null
    const content = this.withMath(children, styles?.fontSize ?? 15)
    const open = this.onServerLink
    const label = title || (typeof children === 'string' ? children : '') || href
    const inViewer = target && open

    return (
      <Text
        key={this.getKey()}
        selectable
        accessibilityRole="link"
        accessibilityHint={inViewer ? 'Opens in the viewer' : 'Opens outside the app'}
        accessibilityLabel={label}
        onPress={() => (inViewer ? open(target, label) : void openLink(href))}
        style={styles}
      >
        {content}
      </Text>
    )
  }

  /**
   * Inline `code`. The design draws a small rounded chip, which React Native can only do with an inline
   * view, and a view cannot wrap. So short spans get the chip and long ones stay plain mono: a background
   * on wrapped text draws a ragged box per line.
   *
   * Android reserves room in the line for an inline view as if its size were text, multiplied by the system font scale (React Native
   * 0.86's TextLayoutManager converts it with toPixelFromSP), while the view itself is drawn at its real size: at a font size below 100%
   * the chip covered the letters after it, more for longer chips. Geist Mono draws every printable ASCII character 0.6 em wide, so
   * the chip's width is known, and an invisible outer view is sized so that, once scaled, it reserves exactly that. Anything else
   * stays plain mono text on Android rather than overlap.
   */
  override codespan(text: string, textStyle?: TextStyle): ReactNode {
    const plain = { ...textStyle, backgroundColor: undefined }
    const chipText = { ...plain, lineHeight: 18 }
    const android = Platform.OS === 'android'

    if (text.length > CHIP_MAX || (android && !MONO_SAFE.test(text))) {
      return super.codespan(text, plain)
    }

    const chip = (
      <View key={this.getKey()} style={[styles.chip, { backgroundColor: this.chip }]}>
        <Text selectable style={chipText}>
          {text}
        </Text>
      </View>
    )
    const scale = PixelRatio.getFontScale()

    // At a font size of 100% or more the room reserved is at least the chip: a little gap at worst, nothing covered.
    if (!android || scale >= 1) {
      return chip
    }

    // The chip sizes itself to its text; the outer view only claims the room. A pixel or two over the estimate is a gap, not an overlap.
    const width = text.length * MONO_ADVANCE * (plain.fontSize ?? 13.5) * scale + 2 * CHIP_PAD + 2

    return (
      <View key={this.getKey()} style={[styles.claim, { width: width / scale }]}>
        {chip}
      </View>
    )
  }

  override code(text: string, _language?: string, containerStyle?: ViewStyle, textStyle?: TextStyle): ReactNode {
    return (
      <ScrollView key={this.getKey()} horizontal style={styles.fit} showsHorizontalScrollIndicator={false} contentContainerStyle={containerStyle}>
        <Text selectable style={textStyle}>
          {text}
        </Text>
      </ScrollView>
    )
  }

  /**
   * A list as a marker column and an item, a few points apart. The library's own list leaves a gap of
   * about half a line between items that nothing in its styles controls.
   */
  override list(ordered: boolean, li: ReactNode[], _listStyle?: ViewStyle, textStyle?: TextStyle, startIndex = 1): ReactNode {
    return (
      <View key={this.getKey()} style={styles.list}>
        {li.map((item, index) => (
          <View key={index} style={styles.item}>
            <Text style={[textStyle, ordered ? styles.number : styles.bullet]}>{ordered ? `${startIndex + index}.` : '•'}</Text>
            <View style={styles.itemBody}>{item}</View>
          </View>
        ))}
      </View>
    )
  }

  override table(header: ReactNode[][], rows: ReactNode[][][], _tableStyle?: ViewStyle, _rowStyle?: ViewStyle, cellStyle?: ViewStyle): ReactNode {
    const row = (cells: ReactNode[][], key: string, last: boolean) => (
      <View key={key} style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: this.line }]}>
        {cells.map((cell, index) => (
          // A formula in a cell is taller than a line of text and its top is cut off by the table's own scroll view: room above it.
          <View key={index} style={[styles.cell, cellStyle, this.math.length ? styles.cellWithMath : null]}>
            {cell}
          </View>
        ))}
      </View>
    )

    return (
      <ScrollView key={this.getKey()} horizontal style={styles.fit} showsHorizontalScrollIndicator={false}>
        <View>
          {row(header.map(cell => cell.map(semibold)), 'head', rows.length === 0)}
          {rows.map((cells, index) => row(cells, `r${index}`, index === rows.length - 1))}
        </View>
      </ScrollView>
    )
  }
}

/** The same node in the semibold face (a table's header cells). */
function semibold(node: ReactNode): ReactNode {
  return isValidElement<{ style?: TextStyle }>(node) ? cloneElement(node as ReactElement<{ style?: TextStyle }>, { style: [(node.props as { style?: TextStyle }).style, { fontFamily: fonts.semibold }] as unknown as TextStyle }) : node
}

const styles = StyleSheet.create({
  list: { gap: 4, paddingLeft: 2 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  // flexShrink, not flex: 1. A bubble is as wide as its content (up to a cap), and a flex: 1 body counts as no width at all,
  // so a bubble that is mostly a list would collapse to its widest line that is not part of one.
  itemBody: { flexShrink: 1 },
  bullet: { width: 12, textAlign: 'center' },
  number: { minWidth: 22, textAlign: 'right' },
  // flexGrow 0 is the point: a ScrollView defaults to growing to fill its parent.
  fit: { flexGrow: 0 },
  chip: { borderRadius: 6, paddingHorizontal: CHIP_PAD },
  claim: { alignItems: 'flex-start' },
  row: { flexDirection: 'row' },
  cell: { minWidth: 88, maxWidth: 240, paddingVertical: 6, paddingRight: 16 },
  cellWithMath: { paddingTop: 10, paddingBottom: 8 },
})
