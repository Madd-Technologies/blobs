import { create } from 'zustand'

import { fetchPicture, viewError } from '@/lib/hermes/media'
import { createLimiter, createWants, evictions, MAX_CACHED_CHARS } from '@/lib/hermes/pictureCache'
import { useConnection } from '@/stores/connection'

type Entry =
  | { status: 'loading' }
  | { status: 'ready'; url: string; size: number; used: number; /** Width over height, once the picture has been measured. */ ratio?: number }
  | { status: 'failed'; error: string }

interface PicturesState {
  byKey: Record<string, Entry | undefined>
  /** Asks for a picture (fetched unless it is here or on its way). Every call is matched by a `release` when the asker goes away. */
  ensure: (profile: string | undefined, path: string) => void
  /** Lets go of a picture: one nobody wants, and that has not started downloading, never does. */
  release: (profile: string | undefined, path: string) => void
  /** Tries a failed picture again. */
  retry: (profile: string | undefined, path: string) => void
  setRatio: (key: string, ratio: number) => void
}

export const pictureKey = (profile: string | undefined, path: string) => `${profile ?? ''}|${path}`

/** Three at a time: a chat that scrolls past a dozen pictures does not open a dozen connections to the server. */
const limit = createLimiter(3)
const wants = createWants()
let clock = 0

class Unwanted extends Error {}

/**
 * The pictures bots send, fetched when a chat first draws them and kept (up to a memory limit) so scrolling back does not fetch
 * them again. One store, so the picture in the chat and the full-screen viewer share a fetch.
 */
export const usePictures = create<PicturesState>((set, get) => {
  async function load(profile: string | undefined, path: string) {
    const key = pictureKey(profile, path)
    const config = useConnection.getState().config

    if (!config) {
      set(state => ({ byKey: { ...state.byKey, [key]: { status: 'failed', error: 'Not connected to the server.' } } }))

      return
    }

    set(state => ({ byKey: { ...state.byKey, [key]: { status: 'loading' } } }))

    try {
      const url = await limit(() => {
        // Its turn came, but nobody is looking any more (it scrolled away while waiting): do not download it.
        if (!wants.isWanted(key)) {
          throw new Unwanted()
        }

        return fetchPicture(config, path, profile)
      })

      set(state => {
        const next = { ...state.byKey, [key]: { status: 'ready' as const, url, size: url.length, used: ++clock } }
        const ready = Object.fromEntries(Object.entries(next).flatMap(([name, entry]) => (entry?.status === 'ready' ? [[name, entry]] : [])))

        for (const dropped of evictions(ready, MAX_CACHED_CHARS, key)) {
          delete next[dropped]
        }

        return { byKey: next }
      })
    } catch (error) {
      if (error instanceof Unwanted) {
        // Not a failure: it is simply not here, and is fetched when it is wanted again.
        set(state => {
          const { [key]: _gone, ...rest } = state.byKey

          return { byKey: rest }
        })

        return
      }

      set(state => ({ byKey: { ...state.byKey, [key]: { status: 'failed', error: viewError(error) } } }))
    }
  }

  return {
    byKey: {},
    ensure: (profile, path) => {
      wants.want(pictureKey(profile, path))
      const entry = get().byKey[pictureKey(profile, path)]

      if (!entry) {
        void load(profile, path)
      } else if (entry.status === 'ready') {
        // Drawn again: it is the freshest, so it is the last to go.
        set(state => ({ byKey: { ...state.byKey, [pictureKey(profile, path)]: { ...entry, used: ++clock } } }))
      }
    },
    release: (profile, path) => wants.release(pictureKey(profile, path)),
    retry: (profile, path) => {
      if (get().byKey[pictureKey(profile, path)]?.status === 'failed') {
        void load(profile, path)
      }
    },
    setRatio: (key, ratio) => {
      const entry = get().byKey[key]

      if (entry?.status === 'ready' && entry.ratio !== ratio) {
        set(state => ({ byKey: { ...state.byKey, [key]: { ...entry, ratio } } }))
      }
    },
  }
})
