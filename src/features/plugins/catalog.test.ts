import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { installCommand, installMessage, PLUGINS_COMMIT, RELEASES } from './catalog.ts'

describe('plugin install messages', () => {
  it('pins every install to one exact commit of the public repo', () => {
    assert.match(PLUGINS_COMMIT, /^[0-9a-f]{40}$/)
    assert.equal(installCommand('hermes-drive'), `hermes plugins install Madd-Technologies/blobs-hermes-bot-plugins/hermes-drive --ref ${PLUGINS_COMMIT} --force --enable`)
  })

  it('one message for several plugins, in catalog order, with each one’s check and the move from hermes-push', () => {
    const message = installMessage(['hermes-drive', 'hermes-bot-mobile', 'hermes-paperless'])
    assert.match(message, new RegExp(`hermes-bot-mobile ${RELEASES['hermes-bot-mobile']}, hermes-paperless ${RELEASES['hermes-paperless']}, hermes-drive ${RELEASES['hermes-drive']}`))
    assert.ok(message.indexOf('/hermes-bot-mobile --ref') < message.indexOf('/hermes-drive --ref'))
    assert.match(message, /hermes plugins disable hermes-push/)
    assert.match(message, /paperless\/scripts\/find\.py recent --limit 1/)
    assert.match(message, /drive\/scripts\/find\.py recent --limit 1/)
    assert.match(message, /Do NOT restart/)
    assert.doesNotMatch(message, /BEGIN|base64/)
  })

  it('a per-bot plugin is installed in the default profile and in each pinned bot, with -p', () => {
    const message = installMessage(['hermes-dashboard'], PLUGINS_COMMIT, ['default', 'concierge', 'orion-two', 'Bad Name'])
    assert.match(message, new RegExp(`   hermes plugins install Madd-Technologies/blobs-hermes-bot-plugins/hermes-dashboard --ref ${PLUGINS_COMMIT}`))
    assert.match(message, /hermes -p concierge plugins install Madd-Technologies\/blobs-hermes-bot-plugins\/hermes-dashboard/)
    assert.match(message, /hermes -p orion-two plugins install/)
    assert.doesNotMatch(message, /-p default|Bad Name/)
    assert.match(message, /installed once for each bot/)
    assert.match(message, /Dashboard check/)
  })

  it('hermes-bot-mobile also updates the copies other bots already have, and adds none', () => {
    const message = installMessage(['hermes-bot-mobile'])
    assert.match(message, new RegExp(`hermes -p <profile> plugins install Madd-Technologies/blobs-hermes-bot-plugins/hermes-bot-mobile --ref ${PLUGINS_COMMIT} --force --enable`))
    assert.match(message, /Do not add it to a profile that does not have it/)
  })

  it('a plugin that is not per bot ignores the bots', () => {
    const message = installMessage(['hermes-drive'], PLUGINS_COMMIT, ['concierge'])
    assert.doesNotMatch(message, /-p concierge/)
  })

  it('a single plugin gets only its own steps', () => {
    const message = installMessage(['hermes-drive'])
    assert.match(message, /this HermesBot plugin/)
    assert.doesNotMatch(message, /hermes-push/)
    assert.doesNotMatch(message, /Paperless check/)
    assert.match(message, /Drive check/)
    assert.ok(message.length < 4000, `short enough to paste anywhere (${message.length})`)
  })

  it('hermes-voice goes in the default profile only and checks for the sign-in without showing it', () => {
    const message = installMessage(['hermes-voice'], PLUGINS_COMMIT, ['default', 'concierge'])
    assert.match(message, new RegExp(`hermes-voice ${RELEASES['hermes-voice']}`))
    assert.match(message, new RegExp(`   hermes plugins install Madd-Technologies/blobs-hermes-bot-plugins/hermes-voice --ref ${PLUGINS_COMMIT} --force --enable`))
    assert.doesNotMatch(message, /-p concierge/)
    assert.match(message, /Voice check, without showing any token/)
    assert.doesNotMatch(message, /Drive check|Dashboard check/)
  })

  it('hermes-phone goes in the default profile, updates only copies other bots have, and never asks for the Twilio keys', () => {
    const message = installMessage(['hermes-phone'], PLUGINS_COMMIT, ['default', 'concierge'])
    assert.match(message, new RegExp(`hermes-phone ${RELEASES['hermes-phone']}`))
    assert.match(message, new RegExp(`   hermes plugins install Madd-Technologies/blobs-hermes-bot-plugins/hermes-phone --ref ${PLUGINS_COMMIT} --force --enable`))
    assert.doesNotMatch(message, /-p concierge/)
    assert.match(message, /already shows hermes-phone, update that copy/)
    assert.match(message, /Phone check, without showing any secret/)
    assert.match(message, /Never ask me to paste a Twilio key/)
    // The plugin's own key names: Hermes's SMS channel turns on from the plain TWILIO_ ones.
    assert.match(message, /are HERMES_PHONE_TWILIO_ACCOUNT_SID, HERMES_PHONE_TWILIO_AUTH_TOKEN and HERMES_PHONE_TWILIO_PHONE_NUMBER set/)
    assert.match(message, /Is the plain TWILIO_ACCOUNT_SID set there too/)
    assert.match(message, /set nothing up until I say so/)
    assert.match(message, /hermes-phone\.service, if it runs/)
    assert.doesNotMatch(message, /Voice check|Drive check|Dashboard check/)
    assert.ok(message.length < 4000, `short enough to paste anywhere (${message.length})`)
  })
})
