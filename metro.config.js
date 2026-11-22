const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'html', 'txt'])]
config.resolver.sourceExts = config.resolver.sourceExts.filter(ext => ext !== 'html' && ext !== 'txt')
config.transformer.getTransformOptions = async () => ({
  transform: { experimentalImportSupport: false, inlineRequires: true },
})

module.exports = config
