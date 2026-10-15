/**
 * The page the Bot Screen viewer runs inside a WebView: noVNC, plus a small message bridge to the app.
 * Built into `src/components/screen/novncHtml.ts` by `scripts/build-novnc.mjs`. Plain browser JavaScript.
 *
 * App -> page: `window.__rn(message)` (the app calls it with injectJavaScript)
 *   connect {url, viewOnly}   open the display websocket and start viewing
 *   viewOnly {value}          watch (true) or drive (false)
 *   key {keysym, code, down}  one key event; `down` omitted = press and release
 *   paste {text}              put text on the remote clipboard
 *   fit {value}               fit the whole screen to the view (true) or show it at its own size
 *   disconnect {}
 * Page -> app: `ReactNativeWebView.postMessage(JSON)`
 *   ready, connected, desktopname {name}, securityfailure {reason}, error {message}
 *   disconnected {clean, code, reason}   `code` is the server's close code (4000 control taken,
 *                                        4001 screen gone, 4401 ticket spent), which noVNC itself hides
 */
import RFB from '@novnc/novnc'

const post = message => {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message))
  }
}

const target = document.getElementById('screen')
let rfb = null
// Bumped on every connect and teardown. A connection that has been replaced or closed on purpose reports
// nothing, so its late "disconnected" cannot be mistaken for the new connection dropping.
let generation = 0

function teardown() {
  generation++

  if (rfb) {
    try {
      rfb.disconnect()
    } catch (error) {
      // Already gone.
    }
  }

  rfb = null
}

function connect(url, viewOnly) {
  teardown()
  const mine = generation
  let closed = null

  try {
    // Our own socket, so the close code is ours to read. noVNC takes it as its channel; it must be handed over
    // while still connecting, or its open handler never fires.
    const socket = new WebSocket(url)
    socket.addEventListener('close', event => {
      closed = { code: event.code, reason: event.reason || '' }
    })
    rfb = new RFB(target, socket, {})
  } catch (error) {
    post({ type: 'error', message: String((error && error.message) || error) })

    return
  }

  rfb.scaleViewport = true
  rfb.resizeSession = false
  rfb.clipViewport = false
  rfb.background = '#2B2E34'
  rfb.viewOnly = viewOnly
  // Lighter on a phone connection: slightly lossy, well compressed.
  rfb.qualityLevel = 6
  rfb.compressionLevel = 4

  rfb.addEventListener('connect', () => post({ type: 'connected' }))
  rfb.addEventListener('desktopname', event => post({ type: 'desktopname', name: event.detail && event.detail.name }))
  rfb.addEventListener('securityfailure', event => post({ type: 'securityfailure', reason: event.detail && event.detail.reason }))
  rfb.addEventListener('disconnect', event => {
    if (mine !== generation) {
      return
    }

    rfb = null
    post({ type: 'disconnected', clean: Boolean(event.detail && event.detail.clean), code: closed ? closed.code : undefined, reason: closed ? closed.reason : undefined })
  })
}

window.__rn = message => {
  switch (message && message.type) {
    case 'connect':
      connect(message.url, message.viewOnly !== false)
      break

    case 'viewOnly':
      if (rfb) {
        rfb.viewOnly = Boolean(message.value)
      }

      break

    case 'key':
      if (rfb) {
        rfb.sendKey(message.keysym, message.code, message.down)
      }

      break

    case 'paste':
      if (rfb) {
        rfb.clipboardPasteFrom(String(message.text || ''))
      }

      break

    case 'fit':
      if (rfb) {
        // Fit shows the whole screen; otherwise it is shown at its own size and a drag pans around it.
        rfb.scaleViewport = Boolean(message.value)
        rfb.clipViewport = !message.value
        rfb.dragViewport = !message.value
      }

      break

    case 'disconnect':
      teardown()
      break
  }
}

post({ type: 'ready' })
