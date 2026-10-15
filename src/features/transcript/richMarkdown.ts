/**
 * What in a reply is more than markdown: formulas and diagrams. A reply is split into blocks at blank lines; each block is a
 * display formula, a diagram, or markdown whose inline formulas have been lifted out and left as placeholders (marked would
 * otherwise read `a_b*c` as emphasis and eat the backslashes). Pure.
 */

export interface MathItem {
  tex: string
  /** `$$…$$` and `\[…\]` written inside a sentence: drawn inline, in the larger display style. */
  display: boolean
}

export type RichBlock =
  /** A formula on its own. */
  | { kind: 'math'; tex: string }
  /** A Mermaid diagram (a ```mermaid fence). */
  | { kind: 'diagram'; source: string }
  /** Markdown, with each inline formula replaced by a placeholder for `math[n]`. */
  | { kind: 'markdown'; text: string; math: MathItem[] }

/** Private-use characters: they mean nothing to markdown, so it leaves them alone. */
const OPEN = '\uE000'
const CLOSE = '\uE001'

const FENCE = /^(```|~~~)[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)\n?[ \t]*\1[ \t]*$/
const MATH_LANGUAGES = new Set(['math', 'latex', 'tex', 'katex'])
const DISPLAY_DOLLARS = /^\$\$([\s\S]+?)\$\$$/
const DISPLAY_BRACKETS = /^\\\[([\s\S]+?)\\\]$/

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char)
const isDigit = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9'

/**
 * Finds the formulas written inside a paragraph. `$…$` follows the rule that keeps prices from being formulas: the first `$` is followed
 * by something that is not a space, the second is preceded by something that is not a space and not followed by a digit ("costs $5 and
 * $10" is not math). `\(…\)`, `\[…\]` and `$$…$$` are formulas wherever they are. Code (`…`) is left alone, and so is `\$`.
 */
function liftInline(text: string, math: MathItem[]): string {
  let out = ''
  let i = 0

  const put = (tex: string, display: boolean) => {
    math.push({ tex: tex.trim(), display })
    out += `${OPEN}${math.length - 1}${CLOSE}`
  }

  while (i < text.length) {
    const char = text[i] as string
    const next = text[i + 1]

    if (char === '`') {
      // A code span runs to the next run of backticks as long as this one.
      let run = 1

      while (text[i + run] === '`') {
        run++
      }

      const close = text.indexOf('`'.repeat(run), i + run)

      if (close >= 0) {
        out += text.slice(i, close + run)
        i = close + run

        continue
      }

      out += text.slice(i, i + run)
      i += run

      continue
    }

    if (char === '\\') {
      if (next === '(' || next === '[') {
        const end = text.indexOf(next === '(' ? '\\)' : '\\]', i + 2)

        if (end > i + 2) {
          put(text.slice(i + 2, end), next === '[')
          i = end + 2

          continue
        }
      }

      // Any other escape (`\$`, `\*`) stays as it is, with the character it escapes.
      out += char + (next ?? '')
      i += 2

      continue
    }

    if (char === '$') {
      if (next === '$') {
        const end = text.indexOf('$$', i + 2)

        if (end > i + 2) {
          put(text.slice(i + 2, end), true)
          i = end + 2

          continue
        }
      } else if (!isSpace(next)) {
        let end = i + 1

        // The closing dollar: not after a space or a backslash, not before a digit, and on the same line.
        for (; end < text.length; end++) {
          const here = text[end]

          if (here === '\n') {
            end = text.length

            break
          }

          if (here === '\\') {
            end++

            continue
          }

          if (here === '$') {
            // A formula holds no bare dollar, so one that cannot close it means this was not an opening ("$5 for $x$").
            if (isSpace(text[end - 1]) || isDigit(text[end + 1])) {
              end = text.length
            }

            break
          }
        }

        if (end < text.length && end > i + 1) {
          put(text.slice(i + 1, end), false)
          i = end + 1

          continue
        }
      }
    }

    out += char
    i++
  }

  return out
}

/** What one block of a reply is. */
export function parseBlock(block: string): RichBlock {
  const trimmed = block.trim()
  const fence = FENCE.exec(trimmed)

  if (fence) {
    const language = (fence[2] ?? '').toLowerCase()

    if (language === 'mermaid') {
      return { kind: 'diagram', source: (fence[3] ?? '').trim() }
    }

    if (MATH_LANGUAGES.has(language)) {
      return { kind: 'math', tex: (fence[3] ?? '').trim() }
    }

    // Any other code block is for the markdown renderer, which must not see formulas in it.
    return { kind: 'markdown', text: block, math: [] }
  }

  const alone = DISPLAY_DOLLARS.exec(trimmed) ?? DISPLAY_BRACKETS.exec(trimmed)

  // `$$a$$ and $$b$$` is two formulas in a sentence, not one formula.
  if (alone && !(alone[1] ?? '').includes('$$') && !(alone[1] ?? '').includes('\\]')) {
    return { kind: 'math', tex: (alone[1] ?? '').trim() }
  }

  const math: MathItem[] = []
  const text = liftInline(block, math)

  return { kind: 'markdown', text, math }
}

/** A rendered string cut into its words and the formulas that stood in them: strings, and indexes into `math`. */
export function splitMath(text: string): (string | number)[] {
  if (!text.includes(OPEN)) {
    return [text]
  }

  const parts: (string | number)[] = []
  let rest = text

  for (;;) {
    const open = rest.indexOf(OPEN)
    const close = open >= 0 ? rest.indexOf(CLOSE, open) : -1

    if (open < 0 || close < 0) {
      break
    }

    const index = Number(rest.slice(open + 1, close))

    if (open > 0) {
      parts.push(rest.slice(0, open))
    }

    // A placeholder that does not name a formula is left as the characters it is.
    parts.push(Number.isInteger(index) ? index : rest.slice(open, close + 1))
    rest = rest.slice(close + 1)
  }

  return rest ? [...parts, rest] : parts
}
