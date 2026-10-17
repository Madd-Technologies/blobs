import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import { cacheDirectory, writeAsStringAsync } from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'

import { cleanName, kindOf, photoName, type PendingFile } from '@/lib/hermes/attachments'

/** How many pictures one pick can add: a few at a time keeps uploads quick on a phone connection. */
const MAX_PHOTOS = 6

let counter = 0
const nextId = () => `f-${Date.now().toString(36)}-${++counter}`

/**
 * Photos from the library. iPhones keep photos as HEIC, which the server cannot read, and the picker hands back the original
 * unless asked for the "compatible" form, which converts it to JPEG. Re-encoded at 0.8, which also keeps them well under the
 * server's size limit.
 */
export async function pickPhotos(): Promise<PendingFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_PHOTOS,
    quality: 0.8,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  })

  return result.canceled ? [] : result.assets.map(asset => ({ id: nextId(), kind: 'image' as const, name: photoName(asset.fileName, asset.uri, asset.mimeType), mime: asset.mimeType ?? 'image/jpeg', uri: asset.uri, size: asset.fileSize }))
}

/** A photo taken now. Says why when there is no camera or no permission, instead of failing silently. */
export async function takePhoto(): Promise<PendingFile[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync()

  if (!permission.granted) {
    throw new Error('Camera access is off. Turn it on in Settings to take photos.')
  }

  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })

  return result.canceled ? [] : result.assets.map(asset => ({ id: nextId(), kind: 'image' as const, name: photoName(asset.fileName, asset.uri, asset.mimeType), mime: asset.mimeType ?? 'image/jpeg', uri: asset.uri, size: asset.fileSize }))
}

/** Any files from the phone's file browser (copied into the app's cache, which is what gets uploaded). */
export async function pickFiles(): Promise<PendingFile[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })

  return result.canceled
    ? []
    : result.assets.map(asset => {
        const name = cleanName(asset.name, 'file')

        return { id: nextId(), kind: kindOf(name, asset.mimeType), name, mime: asset.mimeType ?? 'application/octet-stream', uri: asset.uri, size: asset.size }
      })
}

/** Whether the clipboard holds a picture right now (for the attach menu's Paste picture). */
export async function clipboardHasPicture(): Promise<boolean> {
  return Clipboard.hasImageAsync().catch(() => false)
}

/**
 * The picture on the clipboard, written to the cache as a JPEG so it uploads like a picked photo. Says why when there is
 * none (the clipboard held something else, or the phone would not hand it over), instead of failing silently.
 */
export async function pastePicture(): Promise<PendingFile[]> {
  const image = (await Clipboard.hasImageAsync()) ? await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.85 }) : null
  const base64 = image?.data.replace(/^data:[^,]*,/, '') ?? ''

  if (!base64 || !cacheDirectory) {
    throw new Error('Couldn’t read a picture from the clipboard. Use + → Photo library instead.')
  }

  const uri = `${cacheDirectory}pasted-${Date.now().toString(36)}.jpg`
  await writeAsStringAsync(uri, base64, { encoding: 'base64' })

  return [{ id: nextId(), kind: 'image', name: 'Pasted picture.jpg', mime: 'image/jpeg', uri, size: Math.round((base64.length * 3) / 4) }]
}
