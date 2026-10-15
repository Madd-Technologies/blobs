import * as Speech from 'expo-speech'
import { create } from 'zustand'

import { speechChunks, speechText } from '@/lib/speech'

interface SpeechState {
  /** The id of the message being read aloud; null when nothing is. */
  speaking: string | null
  /** Reads `markdown` aloud as the message `id` (anything already being read stops first). */
  read: (id: string, markdown: string) => void
  stop: () => void
}

/** What a system voice can take at once: Android refuses longer, and a shorter piece starts speaking sooner on a long reply. */
const CHUNK = Math.min(3000, Speech.maxSpeechInputLength || 3000)

/**
 * Reading a reply aloud with the phone's own voice (expo-speech: no network, nothing leaves the phone). The reply is cleaned of markup
 * and cut into pieces the voice queues; `speaking` goes back to null when the last piece ends or the reading is stopped.
 */
export const useSpeech = create<SpeechState>((set, get) => ({
  speaking: null,
  read: (id, markdown) => {
    void Speech.stop()
    const pieces = speechChunks(speechText(markdown), CHUNK)

    if (!pieces.length) {
      set({ speaking: null })

      return
    }

    set({ speaking: id })

    // A reading that has been replaced or stopped must not clear the one that replaced it.
    const stillMine = () => get().speaking === id
    const end = () => {
      if (stillMine()) {
        set({ speaking: null })
      }
    }

    pieces.forEach((piece, index) => {
      const last = index === pieces.length - 1

      Speech.speak(piece, { onDone: last ? end : undefined, onStopped: last ? end : undefined, onError: end })
    })
  },
  stop: () => {
    void Speech.stop()
    set({ speaking: null })
  },
}))
