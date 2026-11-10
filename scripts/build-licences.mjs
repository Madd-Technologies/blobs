#!/usr/bin/env node
// Writes src/features/licences/notices.json: every open-source package that ships inside the app, with its licence text, for
// Settings → Licences. "Ships" means the app's runtime dependencies plus the libraries bundled into its web views at build time
// (noVNC, Mermaid, pdf.js), each with everything they pull in. Identical licence texts are kept once.
//
// Run `npm run build:licences` after changing dependencies.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/features/licences/notices.json')
const BUNDLED = ['@novnc/novnc', 'mermaid', 'pdfjs-dist']

function tree(args) {
  const out = execFileSync('npm', ['ls', '--all', '--json', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  return JSON.parse(out)
}

const found = new Map()

function walk(node) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    if (!found.has(name) && child.version) {
      found.set(name, child.version)
      walk(child)
    }
  }
}

walk(tree(['--omit=dev']))

// The whole tree, dev included: `npm ls <name>` would print only the path to it, not what it pulls in.
const everything = tree([])

for (const name of BUNDLED) {
  const node = everything.dependencies?.[name]
  if (node?.version) {
    found.set(name, node.version)
    walk(node)
  }
}

function licenceOf(pkg) {
  const field = pkg.license ?? pkg.licenses
  if (typeof field === 'string') return field
  if (Array.isArray(field)) return field.map(entry => entry.type ?? entry).join(' OR ')
  if (field && typeof field === 'object') return field.type ?? 'See text'
  return 'See text'
}

function repoOf(pkg) {
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  const url = (repo ?? pkg.homepage ?? '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://')
  if (/^github:/.test(url)) return `https://github.com/${url.slice(7)}`
  if (/^[\w-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`
  return /^https?:\/\//.test(url) ? url : ''
}

const texts = []
const textIndex = new Map()
const packages = []

for (const [name, version] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
  const dir = join(ROOT, 'node_modules', name)
  if (!existsSync(join(dir, 'package.json'))) continue
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (pkg.private) continue

  const files = readdirSync(dir).filter(file => /^(licen[cs]e|copying|notice)/i.test(file)).sort()
  const text = files.map(file => readFileSync(join(dir, file), 'utf8').trim()).filter(Boolean).join('\n\n')
  let index = -1

  if (text) {
    index = textIndex.get(text) ?? texts.length
    if (index === texts.length) {
      texts.push(text)
      textIndex.set(text, index)
    }
  }

  packages.push({ name, version, licence: licenceOf(pkg), url: repoOf(pkg), text: index })
}

writeFileSync(OUT, `${JSON.stringify({ packages, texts })}\n`)
console.log(`${packages.length} packages, ${texts.length} licence texts → ${OUT.slice(ROOT.length + 1)}`)
