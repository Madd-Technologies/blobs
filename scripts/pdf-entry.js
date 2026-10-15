/**
 * The PDF page the app shows in a WebView (bundled by scripts/build-pdfjs.mjs into src/components/viewer/pdfHtml.ts).
 *
 * The document is read straight from the Hermes server with HTTP range requests, so only the parts of the file the pages on
 * screen need are fetched: a long PDF opens on its first page without being downloaded, and nothing is saved. Pages are drawn
 * as they come near the screen and let go when they are far away.
 *
 * App -> page: `window.__rn({type: 'open', url, headers, background})`
 * Page -> app: `ReactNativeWebView.postMessage(JSON)`: {type: 'ready'} | {type: 'loaded', pages} | {type: 'page', page, pages} |
 *              {type: 'progress', loaded, total} | {type: 'error', message}
 */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'

function send(message) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message))
  }
}

// The worker's code sits in the page (a script tag the build fills): no network for it.
const workerSource = document.getElementById('pdf-worker').textContent
GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })), { type: 'module' })

const pagesBox = document.getElementById('pages')
/** Draw at most this sharp: a phone screen gains nothing beyond it, and canvases are memory. */
const MAX_RATIO = 2.5
/** Pages within this many screens of the view are drawn; farther ones are let go. */
const NEAR = 1.5

let doc = null
const slots = []

async function draw(slot) {
  if (slot.canvas || slot.drawing) {
    return
  }

  slot.drawing = true

  try {
    const page = await doc.getPage(slot.number)
    const width = pagesBox.clientWidth
    const base = page.getViewport({ scale: 1 })
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_RATIO)
    const viewport = page.getViewport({ scale: (width / base.width) * ratio })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    slot.element.style.height = `${(viewport.height / ratio).toFixed(1)}px`
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    slot.element.appendChild(canvas)
    slot.canvas = canvas
  } catch (error) {
    send({ type: 'error', message: `Page ${slot.number}: ${error && error.message ? error.message : String(error)}` })
  } finally {
    slot.drawing = false
  }
}

function forget(slot) {
  if (slot.canvas) {
    slot.canvas.width = 0
    slot.canvas.remove()
    slot.canvas = null
  }
}

let current = 0

function update() {
  const top = window.scrollY
  const height = window.innerHeight
  let visible = 0

  for (const slot of slots) {
    const box = slot.element.getBoundingClientRect()
    const near = box.bottom > -height * NEAR && box.top < height * (1 + NEAR)

    if (near) {
      void draw(slot)
    } else {
      forget(slot)
    }

    if (!visible && box.bottom > height * 0.35) {
      visible = slot.number
    }
  }

  if (visible && visible !== current) {
    current = visible
    send({ type: 'page', page: visible, pages: slots.length })
  }

  return top
}

let pending = false

window.addEventListener('scroll', () => {
  if (!pending) {
    pending = true
    requestAnimationFrame(() => {
      pending = false
      update()
    })
  }
})

async function open({ url, headers, background }) {
  if (background) {
    document.body.style.background = background
  }

  try {
    const task = getDocument({ url, httpHeaders: headers, rangeChunkSize: 128 * 1024, disableAutoFetch: true, isEvalSupported: false })
    task.onProgress = ({ loaded, total }) => send({ type: 'progress', loaded, total })
    doc = await task.promise

    // Every page gets a slot sized like the first, so the scroll length is right before any is drawn.
    const first = await doc.getPage(1)
    const base = first.getViewport({ scale: 1 })
    const guess = (pagesBox.clientWidth * base.height) / base.width

    for (let number = 1; number <= doc.numPages; number += 1) {
      const element = document.createElement('div')
      element.className = 'page'
      element.style.height = `${guess.toFixed(1)}px`
      pagesBox.appendChild(element)
      slots.push({ number, element, canvas: null, drawing: false })
    }

    send({ type: 'loaded', pages: doc.numPages })
    update()
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    send({ type: 'error', message: /401|403/.test(message) ? 'Not allowed to read this file.' : /404/.test(message) ? 'The file is not there.' : message })
  }
}

window.__rn = message => {
  if (message && message.type === 'open') {
    void open(message)
  }
}

send({ type: 'ready' })
