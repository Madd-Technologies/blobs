import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { driveFileId, openInGoogle } from './drive.ts'

describe('Drive links', () => {
  it('reads the file id from the plugin’s file links, and nothing else', () => {
    assert.equal(driveFileId('/api/plugins/hermes-drive/files/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789aBcDeFg/preview'), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789aBcDeFg')
    assert.equal(driveFileId('/api/plugins/hermes-drive/files/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/original'), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123')
    assert.equal(driveFileId('/api/plugins/hermes-paperless/documents/15/preview'), null)
    assert.equal(driveFileId('/api/plugins/hermes-drive/files/../../x/preview'), null)
  })

  it('opens a Google Sheet, Doc or deck in Google’s app', () => {
    assert.deepEqual(openInGoogle({ mime_type: 'application/vnd.google-apps.spreadsheet', web_link: 'https://docs.google.com/spreadsheets/d/abc/edit?usp=drivesdk' }), {
      url: 'https://docs.google.com/spreadsheets/d/abc/edit?usp=drivesdk',
      app: 'Google Sheets',
    })
    assert.equal(openInGoogle({ mime_type: 'application/vnd.google-apps.document', web_link: 'https://docs.google.com/document/d/abc/edit' })?.app, 'Google Docs')
    assert.equal(openInGoogle({ mime_type: 'application/vnd.google-apps.folder', web_link: 'https://drive.google.com/drive/folders/abc' })?.app, 'Google Drive')
  })

  it('leaves a real file (a PDF, a picture, an Office file) to the viewer, streamed as it is', () => {
    assert.equal(openInGoogle({ mime_type: 'application/pdf', web_link: 'https://drive.google.com/file/d/abc/view' }), null)
    assert.equal(openInGoogle({ mime_type: 'image/png', web_link: 'https://drive.google.com/file/d/abc/view' }), null)
  })

  it('never opens a link that is not Google’s', () => {
    assert.equal(openInGoogle({ mime_type: 'application/vnd.google-apps.spreadsheet', web_link: 'https://evil.example/spreadsheets/d/abc' }), null)
    assert.equal(openInGoogle({ mime_type: 'application/vnd.google-apps.spreadsheet', web_link: 'http://docs.google.com/spreadsheets/d/abc' }), null)
    assert.equal(openInGoogle({ mime_type: 'application/vnd.google-apps.spreadsheet', web_link: null }), null)
  })
})
