import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { appRoute, param, query, webPage } from './apps.ts'

describe('webPage', () => {
  it('keeps the whole hash, slashes and all', () => {
    assert.deepEqual(webPage('https://mail.google.com/mail/u/0/#inbox/18f2c3d4e5a6b7c8'), { host: 'mail.google.com', path: '/mail/u/0/', query: '', hash: 'inbox/18f2c3d4e5a6b7c8' })
    assert.deepEqual(webPage(' https://Gmail.com '), { host: 'gmail.com', path: '/', query: '', hash: '' })
  })

  it('only takes a plain https link', () => {
    assert.equal(webPage('http://mail.google.com/mail/'), null)
    assert.equal(webPage('https://mail.google.com@elsewhere.example/mail/'), null)
    assert.equal(webPage('https://mail.google.com:8443/mail/'), null)
    assert.equal(webPage('mailto:alex@example.com'), null)
  })
})

describe('query values', () => {
  it('reads a value, decoded', () => {
    assert.equal(param('to=alex%40example.com&su=Lunch+Friday&body=See%20you', 'su'), 'Lunch Friday')
    assert.equal(param('to=alex%40example.com', 'to'), 'alex@example.com')
    assert.equal(param('to=alex%40example.com', 'cc'), '')
    assert.equal(param('body=100%', 'body'), '100%')
  })

  it('writes spaces as %20 and leaves out empty values', () => {
    assert.equal(query({ to: 'alex@example.com', cc: '', subject: 'Lunch Friday' }), '?to=alex%40example.com&subject=Lunch%20Friday')
    assert.equal(query({ to: '' }), '')
  })
})

describe('appRoute', () => {
  it('hands a Gmail link to Gmail, the app’s front door last', () => {
    const route = appRoute('https://mail.google.com/mail/u/0/#inbox/18f2c3d4e5a6b7c8')

    assert.equal(route?.app, 'Gmail')
    assert.equal(route?.android, 'com.google.android.gm')
    assert.equal(route?.url, 'https://mail.google.com/mail/u/0/#inbox/18f2c3d4e5a6b7c8')
    assert.deepEqual(route?.ios, ['googlegmail://'])
    assert.equal(appRoute('https://gmail.com')?.app, 'Gmail')
  })

  it('opens Gmail’s compose link on its compose screen', () => {
    assert.deepEqual(appRoute('https://mail.google.com/mail/?view=cm&fs=1&to=alex%40example.com&su=Lunch+Friday&body=Hi%20Alex')?.ios, [
      'googlegmail:///co?to=alex%40example.com&subject=Lunch%20Friday&body=Hi%20Alex',
      'googlegmail://',
    ])
  })

  it('hands an Outlook mail to Outlook, on every Outlook host', () => {
    for (const href of [
      'https://outlook.office.com/mail/inbox/id/AAQkADAwATM3ZmYAZS1hNDE2LWEyYjctMDACLTAwCgAQAHg%3D',
      'https://outlook.live.com/mail/0/inbox/id/AQQkADAwATM3ZmYAZS1hNDE2',
      'https://outlook.office365.com/owa/?ItemID=AAMkAGI2TG93AAA%3D&exvsurl=1&viewmodel=ReadMessageItem',
      'https://outlook.cloud.microsoft/calendar/view/week',
    ]) {
      assert.deepEqual(appRoute(href), { app: 'Outlook', url: href, android: 'com.microsoft.office.outlook', ios: ['ms-outlook://'] }, href)
    }
  })

  it('opens Outlook’s compose link on its compose screen', () => {
    assert.deepEqual(appRoute('https://outlook.office.com/mail/deeplink/compose?to=alex%40example.com&subject=Lunch+Friday&body=Hi%20Alex')?.ios, [
      'ms-outlook://compose?to=alex%40example.com&subject=Lunch%20Friday&body=Hi%20Alex',
      'ms-outlook://',
    ])
  })

  it('hands other providers’ mail to their apps, on whichever platform has a way in', () => {
    assert.deepEqual(appRoute('https://mail.yahoo.com/d/folders/1/messages/AJpGNDMkRyZ2'), {
      app: 'Yahoo Mail',
      url: 'https://mail.yahoo.com/d/folders/1/messages/AJpGNDMkRyZ2',
      android: 'com.yahoo.mobile.client.android.mail',
      ios: ['ymail://'],
    })
    assert.deepEqual(appRoute('https://app.fastmail.com/mail/Inbox/Tc1a2b3c4d5e6f7a8.Md9e8f7a6b5c4d3e2'), {
      app: 'Fastmail',
      url: 'https://app.fastmail.com/mail/Inbox/Tc1a2b3c4d5e6f7a8.Md9e8f7a6b5c4d3e2',
      android: 'com.fastmail.app',
      ios: ['fastmail://'],
    })
    assert.equal(appRoute('https://mail.aol.com/d/folders/1/messages/AHk3Zs1')?.android, 'com.aol.mobile.aolapp')
    assert.equal(appRoute('https://mail.zoho.eu/zm/#mail/folder/inbox/p/1710000000000100001')?.android, 'com.zoho.mail')
  })

  it('leaves iOS to the browser when an app has no way in there, and Android when it has no app', () => {
    // Proton's scheme opens a new message, not the inbox; AOL and Zoho have none known.
    assert.deepEqual(appRoute('https://mail.proton.me/u/0/inbox/aBcD1234')?.ios, [])
    assert.equal(appRoute('https://mail.proton.me/u/0/inbox/aBcD1234')?.android, 'ch.protonmail.android')
    assert.deepEqual(appRoute('https://mail.aol.com/d/folders/1')?.ios, [])
    assert.deepEqual(appRoute('https://www.icloud.com/mail/'), { app: 'Mail', url: 'https://www.icloud.com/mail/', android: null, ios: ['message://'] })
  })

  it('leaves public pages on an app’s host to the browser', () => {
    assert.equal(appRoute('https://outlook.office365.com/owa/calendar/abc@example.com/bookings/'), null)
    assert.equal(appRoute('https://outlook.office.com/bookwithme/user/abc'), null)
    assert.equal(appRoute('https://mail.google.com/chat/u/0/'), null)
    assert.equal(appRoute('https://www.fastmail.com/pricing/'), null)
    assert.equal(appRoute('https://www.icloud.com/photos/'), null)
  })

  it('leaves every other link alone', () => {
    assert.equal(appRoute('https://example.com/mail/'), null)
    assert.equal(appRoute('https://docs.google.com/document/d/abc/edit'), null)
    assert.equal(appRoute('https://mail.google.com.example/mail/'), null)
    assert.equal(appRoute('mailto:alex@example.com'), null)
    assert.equal(appRoute('/api/plugins/hermes-drive/files/abc/preview'), null)
  })
})
