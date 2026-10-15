// The website's interactions: the crowd you can poke, scenes that play once as they scroll into view, tiles that move
// only while visible, and "make your blob". The page reads fine without this script; it only adds motion and play.

import { blobatar } from './vendor/blobatar.js'

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Trait positions of the ten silhouettes, as in src/lib/hermes/blob.ts.
const SHAPE = { round: 0.11, organic: 0.35, boxy: 0.54, capsule: 0.65, nub: 0.745, cloud: 0.825, droplet: 0.8875, hexagon: 0.9325, sun: 0.965, triangle: 0.99 }
const LOOKS = Object.values(SHAPE)

// The crowd: the same five faces scripts/build-site.mjs draws for the README and the favicon.
const CROWD = {
  scout: { name: 'Scout', seed: 'blobs-1', shape: 'cloud', hue: 175 },
  courier: { name: 'Courier', seed: 'blobs-2', shape: 'droplet', hue: 215 },
  forge: { name: 'Forge', seed: 'blobs-3', shape: 'hexagon', hue: 20 },
  scribe: { name: 'Scribe', seed: 'blobs-4', shape: 'boxy', hue: 330 },
  ember: { name: 'Ember', seed: 'blobs-5', shape: 'round', hue: 265 },
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

/** A blobatar as an element whose eyes can blink and move on their own, plus its body colour. */
function faceElement(svg) {
  const open = /^<svg[^>]*>/.exec(svg)?.[0]
  const groups = svg.match(/<g\b[^>]*>[\s\S]*?<\/g>/g)
  const template = document.createElement('template')

  if (!open || groups?.length !== 2) {
    template.innerHTML = svg
    return { svg: template.content.firstElementChild, eyes: null, color: null }
  }

  const color = /fill="(#[0-9a-fA-F]{3,8})"/.exec(groups[0])?.[1] ?? null
  template.innerHTML = `${open.replace('<svg ', '<svg aria-hidden="true" focusable="false" ')}${groups[0]}<g class="eyes-blink">${groups[1].replace('<g ', '<g class="eyes" ')}</g></svg>`
  const element = template.content.firstElementChild
  return { svg: element, eyes: element.querySelector('.eyes'), color }
}

/** Replays a one-shot animation class, alternating between two identical ones so it restarts every time. */
function replay(element, names, count) {
  element.classList.remove(...names.flat())
  void element.offsetWidth
  element.classList.add(names[count % 2])
}

// ── The crowd ────────────────────────────────────────────────────────────────────────────────────

function setupCrowd() {
  const crowd = document.querySelector('[data-crowd]')
  const stage = document.querySelector('[data-stage]')
  if (!crowd || !stage) return

  const pop = stage.querySelector('[data-pop]')
  const hint = stage.querySelector('[data-hint]')
  const faces = {}
  let selected = null
  let presses = 0
  let approval = 'ask'
  let emberAwake = false
  let emberTimer = 0
  let emberRunning = false
  let happyUntil = 0
  let pointer = null

  for (const button of crowd.querySelectorAll('[data-bot]')) {
    const id = button.dataset.bot
    const spec = CROWD[id]
    const face = faceElement(blobatar(spec.seed, { hue: spec.hue, tone: 0.5, traits: { shape: SHAPE[spec.shape] } }))
    const img = button.querySelector('img')
    img.replaceWith(face.svg)
    const blink = face.svg.querySelector('.eyes-blink')
    if (blink) blink.style.animationDelay = `${-((Object.keys(faces).length * 1.7) % 5.2)}s`
    faces[id] = { ...face, ...spec, id, button, squish: button.querySelector('.squish'), dot: button.querySelector('[data-dot]') }
    button.addEventListener('click', () => select(id))
  }
  faces.courier.button.classList.add('needs')

  // Eye heights from the app's face motions (src/features/face/motion.ts): dozing shut, working alert, needing you wide.
  function eyeScale(id) {
    if (id === 'ember' && !emberAwake) return 0.12
    if (id === 'courier' && Date.now() < happyUntil) return 0.5
    if (id === 'courier' && approval === 'ask') return 1.22
    if (id === selected && (id === 'scout' || id === 'forge')) return 1.08
    return 1
  }

  function drawEyes() {
    for (const face of Object.values(faces)) {
      if (!face.eyes) continue
      let dx = 0
      let dy = 0
      if (pointer && !reduceMotion) {
        const box = face.svg.getBoundingClientRect()
        dx = clamp((pointer.x - (box.left + box.width / 2)) / 360, -1, 1) * 3.2
        dy = clamp((pointer.y - (box.top + box.height / 2)) / 280, -1, 1) * 2.4
      }
      face.eyes.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scaleY(${eyeScale(face.id)})`
    }
  }

  let frame = 0
  window.addEventListener('pointermove', event => {
    pointer = { x: event.clientX, y: event.clientY }
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; drawEyes() })
  }, { passive: true })

  // Layout positions, not screen boxes: they ignore the hover lift, the bob and any page zoom.
  function place() {
    if (!selected || pop.hidden) return
    const button = faces[selected].button
    const center = button.offsetLeft + button.offsetWidth / 2 - stage.offsetLeft
    const width = pop.offsetWidth
    const left = clamp(center - width / 2, 0, Math.max(0, stage.clientWidth - width))
    pop.style.setProperty('--x', `${left}px`)
    pop.style.setProperty('--notch', `${clamp(center - left - 7, 14, width - 28)}px`)
  }
  window.addEventListener('resize', place)

  function showStates() {
    for (const block of pop.querySelectorAll('[data-state]')) {
      const state = block.dataset.state
      block.hidden = selected === 'courier' ? state !== approval : state !== (emberRunning ? 'running' : 'woke')
    }
  }

  function renderPop() {
    if (!selected) {
      pop.hidden = true
      hint.hidden = false
      return
    }

    const face = faces[selected]
    const head = document.createElement('div')
    head.className = 'pop-head'
    head.append(document.createElement('i'), Object.assign(document.createElement('b'), { textContent: face.name }), Object.assign(document.createElement('span'), { textContent: 'now' }))
    pop.replaceChildren(head, document.querySelector(`template[data-card="${selected}"]`).content.cloneNode(true))
    showStates()
    hint.hidden = true
    pop.hidden = false
    replay(pop, ['rise-a', 'rise-b'], presses)
    place()
    tick()
  }

  // A running step's time ticks up, as on the app's activity line ("· 38s", "· 1m 5s").
  let ticker = 0
  function tick() {
    clearInterval(ticker)
    const clocks = pop.querySelectorAll('[data-elapsed]')
    if (!clocks.length) return
    ticker = setInterval(() => {
      if (pop.hidden) return clearInterval(ticker)
      for (const clock of clocks) {
        const seconds = Number(clock.dataset.elapsed) + 1
        clock.dataset.elapsed = String(seconds)
        clock.textContent = ` · ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}`
      }
    }, 1000)
  }

  pop.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action
    if (action === 'allow' || action === 'deny') {
      approval = action === 'allow' ? 'allowed' : 'denied'
      faces.courier.dot?.classList.add('gone')
      faces.courier.button.classList.remove('needs')
      if (action === 'allow') {
        happyUntil = Date.now() + 900
        replay(faces.courier.squish, ['hop', 'hop'], 0)
        setTimeout(drawEyes, 950)
      }
      showStates()
      drawEyes()
    }
    if (action === 'run') {
      emberRunning = true
      showStates()
    }
  })

  function select(id) {
    selected = selected === id ? null : id
    presses += 1
    for (const face of Object.values(faces)) face.button.setAttribute('aria-pressed', String(face.id === selected))
    if (selected) {
      replay(faces[id].squish, ['pa', 'pb'], presses)
      // Like the app: a tap wakes a dozing face for a minute, then it nods off again.
      if (id === 'ember') {
        emberAwake = true
        clearTimeout(emberTimer)
        emberTimer = setTimeout(() => { emberAwake = false; drawEyes() }, 60_000)
      }
    }
    const color = selected ? faces[selected].color : null
    document.body.style.setProperty('--tint', color ?? '')
    document.body.style.setProperty('--tint-amt', color ? '5%' : '0%')
    renderPop()
    drawEyes()
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && selected) select(selected)
  })

  drawEyes()
}

// ── Scenes and live tiles ──────────────────────────────────────────────────────────────────────

function setupScenes() {
  const scenes = document.querySelectorAll('[data-scene]')
  if (reduceMotion || !('IntersectionObserver' in window)) return

  for (const scene of scenes) scene.classList.add('armed')
  const play = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('play')
      play.unobserve(entry.target)
    }
  }, { threshold: 0.4 })
  for (const scene of scenes) play.observe(scene)
}

function setupLiveTiles() {
  const tiles = document.querySelectorAll('[data-live]')
  if (!('IntersectionObserver' in window)) {
    for (const tile of tiles) tile.classList.add('live')
    return
  }

  const counted = new WeakSet()
  const live = new IntersectionObserver(entries => {
    for (const entry of entries) {
      entry.target.classList.toggle('live', entry.isIntersecting)
      const number = entry.target.querySelector('[data-count]')
      if (entry.isIntersecting && number && !counted.has(number) && !reduceMotion) {
        counted.add(number)
        countUp(number, Number(number.dataset.count))
      }
    }
  }, { threshold: 0.25 })
  for (const tile of tiles) live.observe(tile)
}

function countUp(element, target) {
  const start = performance.now()
  const step = now => {
    const progress = Math.min(1, (now - start) / 600)
    element.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))))
    if (progress < 1) requestAnimationFrame(step)
  }
  element.textContent = '0'
  requestAnimationFrame(step)
}

// ── Make your blob ─────────────────────────────────────────────────────────────────────────────

const GALLERY = ['nova', 'atlas', 'pixel', 'juno', 'biscuit', 'maple', 'echo', 'zephyr', 'pepper', 'orbit', 'tango', 'widget']

/** The bot name Hermes would use: lower case, spaces and underscores as dashes, nothing else but letters and digits. */
function slugify(text) {
  return text.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'bot'
}

function setupMaker() {
  const maker = document.querySelector('[data-maker]')
  if (!maker) return

  const input = maker.querySelector('[data-name]')
  const slugLine = maker.querySelector('[data-slug]')
  const stage = maker.querySelector('[data-face]')
  const speech = maker.querySelector('[data-speech]')
  const shareButton = maker.querySelector('[data-share]')
  const gallery = maker.querySelector('[data-gallery]')
  let look = 0
  let changes = 0
  let shownKey = ''
  let eyes = null
  let squish = null
  let happyTimer = 0
  let shareTimer = 0

  const fromLink = new URLSearchParams(location.search).get('blob')
  if (fromLink) input.value = fromLink.slice(0, 40)

  for (const name of GALLERY) {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', `Try the name ${name}`)
    button.dataset.name = name
    button.append(faceElement(blobatar(name)).svg)
    button.addEventListener('click', () => {
      input.value = name
      look = 0
      render()
    })
    gallery.append(button)
  }

  function eyesTo(dy, scale) {
    if (eyes) eyes.style.transform = `translateY(${dy}px) scaleY(${scale})`
  }

  function render() {
    const slug = slugify(input.value)
    const key = `${slug}|${look}`
    slugLine.textContent = slug

    if (key !== shownKey) {
      const face = faceElement(look ? blobatar(slug, { traits: { shape: LOOKS[look - 1] } }) : blobatar(slug))
      squish = document.createElement('span')
      squish.className = 'squish'
      squish.style.display = 'block'
      squish.append(face.svg)
      stage.replaceChildren(squish)
      eyes = face.eyes
      maker.style.setProperty('--maker', face.color ?? 'var(--text2)')
      changes += 1
      if (shownKey) replay(squish, ['pop-a', 'pop-b'], changes)
      shownKey = key
      for (const button of gallery.children) button.setAttribute('aria-current', String(button.dataset.name === slug && !look))
    } else if (squish) {
      replay(squish, ['nudge-a', 'nudge-b'], changes++)
    }

    eyesTo(document.activeElement === input ? 2.5 : 0, 1)
  }

  input.addEventListener('input', () => {
    look = 0
    render()
  })
  input.addEventListener('focus', () => eyesTo(2.5, 1))
  input.addEventListener('blur', () => eyesTo(0, 1))

  maker.querySelector('[data-hi]').addEventListener('click', () => {
    const name = input.value.trim() || 'your bot'
    speech.textContent = `Hi, I'm ${name}.`
    speech.hidden = false
    if (squish) replay(squish, ['hop', 'hop'], 0)
    eyesTo(-2, 0.5)
    clearTimeout(happyTimer)
    happyTimer = setTimeout(() => {
      speech.hidden = true
      eyesTo(0, 1)
    }, 2200)
  })

  maker.querySelector('[data-look]').addEventListener('click', () => {
    look = (look % LOOKS.length) + 1
    render()
  })

  shareButton.addEventListener('click', async () => {
    const url = new URL(location.href)
    url.search = `?blob=${encodeURIComponent(slugify(input.value))}`
    url.hash = 'make'
    let label = 'Link copied'
    try {
      await navigator.clipboard.writeText(url.toString())
    } catch {
      history.replaceState(null, '', url)
      label = 'Link is in the address bar'
    }
    shareButton.textContent = label
    clearTimeout(shareTimer)
    shareTimer = setTimeout(() => { shareButton.textContent = 'Share' }, 1800)
  })

  render()
  if (fromLink) document.getElementById('make')?.scrollIntoView({ block: 'center' })
}

setupCrowd()
setupScenes()
setupLiveTiles()
setupMaker()
