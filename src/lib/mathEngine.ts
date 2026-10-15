/**
 * The MathJax end of `math.ts`: the imports are heavy (and MathJax is not needed until a formula appears), so the app loads this file
 * only when it first has one to draw. Only the TeX packages a chat needs are loaded: each package pulls in code.
 */

import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js'
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js'
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js'
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js'
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js'
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js'
import { SVG } from 'mathjax-full/js/output/svg.js'

export type Converter = { convert: (tex: string, display: boolean) => string }

export function createConverter(): Converter {
  const adaptor = liteAdaptor()

  RegisterHTMLHandler(adaptor)

  const document = mathjax.document('', {
    InputJax: new TeX({
      packages: ['base', 'ams', 'newcommand', 'boldsymbol', 'cancel', 'color'],
      // A formula MathJax cannot read is an error here, not a red message drawn into the picture: the caller shows the TeX as it was written.
      formatError: (_jax: unknown, error: Error) => {
        throw error
      },
    }),
    OutputJax: new SVG({ fontCache: 'none' }),
  })

  return { convert: (tex, display) => adaptor.innerHTML(document.convert(tex, { display })) }
}
