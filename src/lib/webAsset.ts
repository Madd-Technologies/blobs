import { Asset } from 'expo-asset'
import { File } from 'expo-file-system'
import { Platform } from 'react-native'

const cache = new Map<number, Promise<string>>()

/**
 * Reads a large bundled text asset (Mermaid, pdf.js, noVNC) on first use instead of embedding megabytes of JS string
 * literals in the startup bundle. Cached in memory once loaded; failed reads evict themselves so a retry works.
 */
export function loadTextAsset(moduleId: number): Promise<string> {
  const hit = cache.get(moduleId)

  if (hit) {
    return hit
  }

  const read = (async () => {
    const asset = Asset.fromModule(moduleId)

    if (Platform.OS === 'web') {
      const response = await fetch(asset.uri)

      if (!response.ok) {
        throw new Error(`Could not load asset (${response.status}).`)
      }

      return response.text()
    }

    await asset.downloadAsync()
    const uri = asset.localUri ?? asset.uri

    if (!uri) {
      throw new Error('Asset could not be resolved.')
    }

    return new File(uri).text()
  })()

  const guarded = read.catch(error => {
    cache.delete(moduleId)
    throw error
  })

  cache.set(moduleId, guarded)

  return guarded
}
