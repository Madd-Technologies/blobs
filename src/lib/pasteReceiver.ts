import { requireOptionalNativeModule } from 'expo'

type EventSubscription = { remove(): void }

/** A picture the keyboard (or a paste) put into a text field, copied into the app's cache; or why it could not be read. */
export type PastedPicture = { viewTag: number; uri?: string; mime?: string; size?: number; error?: string }

interface PasteReceiver {
  enable(viewTag: number): Promise<boolean>
  addListener(event: 'onPicture', listener: (picture: PastedPicture) => void): EventSubscription
}

/** The local Android module (modules/paste-receiver); absent on iOS and in Expo Go, where these do nothing. */
const native = requireOptionalNativeModule<PasteReceiver>('PasteReceiver')

/** Lets the text field with this native tag take pictures from the keyboard. */
export function enablePictures(viewTag: number | null): void {
  if (native && viewTag != null) {
    void native.enable(viewTag).catch(() => undefined)
  }
}

/** Calls back with each picture a field took; remove the subscription when done. */
export function onPastedPicture(listener: (picture: PastedPicture) => void): EventSubscription | null {
  return native?.addListener('onPicture', listener) ?? null
}
