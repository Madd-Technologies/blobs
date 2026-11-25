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

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

const documentNode = mathjax.document('', {
  InputJax: new TeX({
    packages: ['base', 'ams', 'newcommand', 'boldsymbol', 'cancel', 'color'],
    formatError: (_jax, error) => {
      throw error
    },
  }),
  OutputJax: new SVG({ fontCache: 'none' }),
})

function post(payload) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(payload))
}

window.__renderMath = (key, tex, display) => {
  try {
    const svg = adaptor.innerHTML(documentNode.convert(tex, { display: !!display }))
    post({ key, svg })
  } catch {
    post({ key, svg: null })
  }
}

post({ ready: true })
