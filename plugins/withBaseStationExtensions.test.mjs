import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const plugin = require('./withBaseStationExtensions.js')

describe('withBaseStationExtensions', () => {
  it('sets iOS App Group + APNs entitlements without clobbering production values', () => {
    const dev = plugin.applyEntitlements({})
    assert.deepEqual(dev['com.apple.security.application-groups'], [plugin.APP_GROUP])
    assert.equal(dev['aps-environment'], 'development')

    const prod = plugin.applyEntitlements({
      'com.apple.security.application-groups': [plugin.APP_GROUP],
      'aps-environment': 'production',
    })
    assert.deepEqual(prod['com.apple.security.application-groups'], [plugin.APP_GROUP])
    assert.equal(prod['aps-environment'], 'production')
  })

  it('enables Live Activities and remote-notification + audio background modes in Info.plist', () => {
    const plist = plugin.applyInfoPlist({ UIBackgroundModes: ['audio'] })
    assert.equal(plist.NSSupportsLiveActivities, true)
    assert.equal(plist.NSSupportsLiveActivitiesFrequentUpdates, true)
    assert.deepEqual(plist.UIBackgroundModes, ['audio', 'remote-notification'])
  })

  it('adds SEND and SEND_MULTIPLE intent filters to Android MainActivity idempotently', () => {
    const manifest = {
      manifest: {
        application: [
          {
            activity: [
              {
                $: { 'android:name': '.MainActivity' },
                'intent-filter': [],
              },
            ],
          },
        ],
      },
    }

    plugin.applyAndroidManifest(manifest)
    plugin.applyAndroidManifest(manifest)

    const filters = manifest.manifest.application[0].activity[0]['intent-filter']
    assert.equal(filters.length, 2)
    assert.equal(filters[0].action[0].$['android:name'], 'android.intent.action.SEND')
    assert.equal(filters[1].action[0].$['android:name'], 'android.intent.action.SEND_MULTIPLE')
  })
})
