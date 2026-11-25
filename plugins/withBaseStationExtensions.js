const fs = require('node:fs')
const path = require('node:path')
const {
  withAndroidManifest,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
} = require('@expo/config-plugins')

const APP_GROUP = 'group.com.maddtechnologies.blobs'

function uniqueStrings(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(item => typeof item === 'string' && item))]
}

function applyEntitlements(entitlements) {
  const next = { ...(entitlements || {}) }
  const groups = uniqueStrings([...(next['com.apple.security.application-groups'] || []), APP_GROUP])
  next['com.apple.security.application-groups'] = groups
  return next
}

function applyGoogleServicesFile(config, projectRoot, env = process.env) {
  const envFile = typeof env.GOOGLE_SERVICES_JSON === 'string' ? env.GOOGLE_SERVICES_JSON.trim() : ''
  const localFile = projectRoot && fs.existsSync(path.join(projectRoot, 'google-services.json')) ? './google-services.json' : ''
  const target = envFile || localFile
  if (!target) {
    return config
  }
  return {
    ...config,
    android: {
      ...(config.android || {}),
      googleServicesFile: target,
    },
  }
}

function applyInfoPlist(infoPlist) {
  const next = { ...(infoPlist || {}) }
  next.NSSupportsLiveActivities = true
  next.NSSupportsLiveActivitiesFrequentUpdates = true
  next.UIBackgroundModes = uniqueStrings([...(next.UIBackgroundModes || []), 'remote-notification', 'audio'])
  return next
}

function hasSendAction(filter, actionName) {
  const actions = filter?.action || []
  return actions.some(item => item?.$?.['android:name'] === actionName)
}

function makeShareFilter(actionName, mimeTypes) {
  return {
    action: [{ $: { 'android:name': actionName } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: mimeTypes.map(mimeType => ({ $: { 'android:mimeType': mimeType } })),
  }
}

function applyAndroidManifest(manifest) {
  const application = manifest?.manifest?.application?.[0]
  if (!application || !Array.isArray(application.activity)) {
    return manifest
  }

  const main =
    application.activity.find(act => act?.$?.['android:name'] === '.MainActivity') || application.activity[0]
  if (!main) {
    return manifest
  }

  main['intent-filter'] = Array.isArray(main['intent-filter']) ? [...main['intent-filter']] : []
  const filters = main['intent-filter']

  if (!filters.some(f => hasSendAction(f, 'android.intent.action.SEND'))) {
    filters.push(makeShareFilter('android.intent.action.SEND', ['text/plain', 'image/*', '*/*']))
  }
  if (!filters.some(f => hasSendAction(f, 'android.intent.action.SEND_MULTIPLE'))) {
    filters.push(makeShareFilter('android.intent.action.SEND_MULTIPLE', ['image/*', '*/*']))
  }

  return manifest
}

function withBaseStationExtensions(config) {
  config = applyGoogleServicesFile(config, process.cwd())

  config = withEntitlementsPlist(config, mod => {
    mod.modResults = applyEntitlements(mod.modResults)
    return mod
  })

  config = withInfoPlist(config, mod => {
    mod.modResults = applyInfoPlist(mod.modResults)
    return mod
  })

  config = withAndroidManifest(config, mod => {
    mod.modResults = applyAndroidManifest(mod.modResults)
    return mod
  })

  config = withDangerousMod(config, [
    'ios',
    async mod => {
      const root = mod.modRequest.projectRoot
      const iosRoot = mod.modRequest.platformProjectRoot
      for (const dirName of ['ShareExtension', 'BlobsWidgets']) {
        const src = path.join(root, 'extensions', 'ios', dirName)
        const dest = path.join(iosRoot, dirName)
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.cpSync(src, dest, { recursive: true, force: true })
        }
      }
      return mod
    },
  ])

  return config
}

module.exports = withBaseStationExtensions
module.exports.APP_GROUP = APP_GROUP
module.exports.applyEntitlements = applyEntitlements
module.exports.applyGoogleServicesFile = applyGoogleServicesFile
module.exports.applyInfoPlist = applyInfoPlist
module.exports.applyAndroidManifest = applyAndroidManifest
