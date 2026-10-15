import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { documentPaths, fileName, hidePaths, routeLinks, serverTarget, viewerKind } from './kind.ts'

describe('which viewer a file opens in', () => {
  it('goes by the extension first', () => {
    assert.equal(viewerKind('/home/orion/q3.PDF'), 'pdf')
    assert.equal(viewerKind('/a/notes.md'), 'markdown')
    assert.equal(viewerKind('/a/page.html'), 'html')
    assert.equal(viewerKind('/a/run.py'), 'code')
    assert.equal(viewerKind('/a/data.csv'), 'text')
    assert.equal(viewerKind('/a/shot.png'), 'image')
  })

  it('then by the type the server reports', () => {
    assert.equal(viewerKind('/api/plugins/hermes-paperless/documents/15/preview', 'application/pdf'), 'pdf')
    assert.equal(viewerKind('/x', 'image/jpeg'), 'image')
    assert.equal(viewerKind('/x', 'text/plain; charset=utf-8'), 'text')
    assert.equal(viewerKind('/x', 'application/octet-stream'), 'other')
  })

  it('names a file by its last part', () => {
    assert.equal(fileName('/home/orion/reports/q3.pdf'), 'q3.pdf')
  })
})

describe('documents a reply names', () => {
  it('finds absolute document paths, in backticks, quotes or a sentence, each once', () => {
    const text = 'Saved to `/home/orion/reports/q3.pdf`. The notes are in /home/orion/notes/plan.md, and again `/home/orion/reports/q3.pdf`.'
    assert.deepEqual(documentPaths(text), ['/home/orion/reports/q3.pdf', '/home/orion/notes/plan.md'])
  })

  it('leaves pictures, URLs, relative paths and words alone', () => {
    assert.deepEqual(documentPaths('See https://host/docs/a.pdf, ./b.md, /tmp/shot.png and readme.md'), [])
  })

  it('stops at four', () => {
    assert.equal(documentPaths('/a/1.txt /a/2.txt /a/3.txt /a/4.txt /a/5.txt').length, 4)
  })
})

describe('where a link points on the server', () => {
  it('opens absolute file paths and file URLs in the viewer', () => {
    assert.deepEqual(serverTarget('/home/orion/a.pdf'), { kind: 'file', path: '/home/orion/a.pdf' })
    assert.deepEqual(serverTarget('file:///home/orion/My%20Notes.md'), { kind: 'file', path: '/home/orion/My Notes.md' })
  })

  it('opens plugin routes with your sign-in', () => {
    assert.deepEqual(serverTarget('/api/plugins/hermes-paperless/documents/15/preview'), { kind: 'route', href: '/api/plugins/hermes-paperless/documents/15/preview' })
  })

  it('does not open web addresses, other API paths, or directories', () => {
    assert.equal(serverTarget('https://example.com/a.pdf'), null)
    assert.equal(serverTarget('/api/env'), null)
    assert.equal(serverTarget('/api/fs/read-text?path=/etc/passwd'), null)
    assert.equal(serverTarget('/home/orion/'), null)
    assert.equal(serverTarget('/home/orion/projects'), null)
  })
})

describe('plugin links in a reply', () => {
  it('lists each linked plugin document once, with its label', () => {
    const text = 'Found it: [Gift card](/api/plugins/hermes-paperless/documents/15/preview). Also [the receipt](/api/plugins/hermes-paperless/documents/9/preview) and again [voucher](/api/plugins/hermes-paperless/documents/15/preview).'
    assert.deepEqual(routeLinks(text), [
      { label: 'Gift card', href: '/api/plugins/hermes-paperless/documents/15/preview' },
      { label: 'the receipt', href: '/api/plugins/hermes-paperless/documents/9/preview' },
    ])
  })

  it('ignores links elsewhere', () => {
    assert.deepEqual(routeLinks('[site](https://example.com) [api](/api/env)'), [])
  })
})

describe('paths shown as chips are not shown again in the words', () => {
  const pdf = '/home/orion/.hermes/cache/scratch/2026-01-15-Hardware-Receipt.pdf'

  it('drops a line that only gives the path, with a short label', () => {
    const text = `**Total:** $12.00\n\nPDF: \`${pdf}\``
    assert.equal(hidePaths(text, [pdf]), '**Total:** $12.00')
    assert.equal(hidePaths(`Done.\n- \`${pdf}\`\n- Saved to /tmp/zz/notes.md`, [pdf, '/tmp/zz/notes.md']), 'Done.')
  })

  it('keeps a sentence, with the file’s name where the path was', () => {
    assert.equal(hidePaths(`The receipt is at \`${pdf}\` and covers the parts you bought.`, [pdf]), 'The receipt is at 2026-01-15-Hardware-Receipt.pdf and covers the parts you bought.')
  })

  it('leaves code blocks and link targets alone', () => {
    const code = '```\ncat /tmp/zz/notes.md\n```'
    assert.equal(hidePaths(code, ['/tmp/zz/notes.md']), code)
    assert.equal(hidePaths('[notes](/tmp/zz/notes.md) are ready for review by the whole team today', ['/tmp/zz/notes.md']), '[notes](/tmp/zz/notes.md) are ready for review by the whole team today')
  })

  it('does not make chips for paths in code', () => {
    assert.deepEqual(documentPaths('Run this:\n```\nless /var/log/app.log\n```\nThen read /home/orion/out.txt'), ['/home/orion/out.txt'])
  })
})
