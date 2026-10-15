import { useCallback, useEffect, useRef, useState } from 'react'

import type { KeyEvent } from '@/features/display/keys'
import { decideAfterClose, displayWsUrl, type ViewerEvent } from '@/features/display/viewer'
import { useConnection } from '@/stores/connection'
import { display } from '@/stores/display'

import type { ScreenViewHandle } from './ScreenView'

/** How long a screen may look stopped before the viewer lets go of it. */
const STOPPED_GRACE_MS = 3000

/** Where the connection to the screen is. */
export type ViewerPhase = 'off' | 'connecting' | 'live' | 'reconnecting' | 'gone' | 'failed'

interface Options {
  /** The screen is on screen and wanted. */
  active: boolean
  /** The bot's screen is running (otherwise there is nothing to connect to). */
  running: boolean
  /** This device holds the lease: send input. False watches. */
  driving: boolean
}

/**
 * Runs one viewer connection to a bot's screen: a fresh single-use ticket for every dial, a decision on each
 * way the connection can end (see `decideAfterClose`), and a redial when the gateway reconnects, because the
 * viewer id the ticket carried died with that connection.
 */
export function useScreenViewer(profile: string, { active, running, driving }: Options) {
  const view = useRef<ScreenViewHandle | null>(null)
  /** Pass to `<ScreenView ref={…}>`: the hook keeps the handle itself. */
  const attach = useCallback((handle: ScreenViewHandle | null) => {
    view.current = handle
  }, [])
  const baseUrl = useConnection(state => state.config?.baseUrl ?? '')
  const generation = useConnection(state => state.generation)
  const [phase, setPhase] = useState<ViewerPhase>('off')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pageReady = useRef(false)
  const attempts = useRef(0)
  /** Whether a connection is open or being opened, so that asking to connect again does not redial it. */
  const connection = useRef<'none' | 'dialing' | 'live'>('none')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const grace = useRef<ReturnType<typeof setTimeout> | null>(null)
  const want = useRef(false)
  const drivingNow = useRef(driving)
  const baseUrlNow = useRef(baseUrl)

  // `dial` runs later (after a ticket arrives, or on a timer), so it reads these rather than a stale closure.
  useEffect(() => {
    drivingNow.current = driving
    baseUrlNow.current = baseUrl
  })

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  const clearGrace = () => {
    if (grace.current) {
      clearTimeout(grace.current)
      grace.current = null
    }
  }

  const dial = useCallback(async () => {
    if (!pageReady.current || !want.current) {
      return
    }

    connection.current = 'dialing'
    setPhase(attempts.current > 0 ? 'reconnecting' : 'connecting')
    setError(null)

    try {
      const { ticket, path } = await display.observe(profile)

      // The screen may have been left, or stopped, while the ticket was on its way.
      if (want.current) {
        view.current?.connect(displayWsUrl(baseUrlNow.current, path, ticket), !drivingNow.current)
      }
    } catch (failure) {
      connection.current = 'none'

      if (!want.current) {
        return
      }

      setPhase('failed')
      setError(failure instanceof Error ? failure.message : 'Could not open the screen.')
      void display.refresh(profile)
    }
  }, [profile])

  const onEvent = useCallback(
    (event: ViewerEvent) => {
      switch (event.type) {
        case 'ready':
          pageReady.current = true

          if (want.current) {
            void dial()
          }

          return

        case 'connected':
          attempts.current = 0
          connection.current = 'live'
          setPhase('live')
          setError(null)

          return

        case 'securityfailure':
        case 'error':
          setError(event.type === 'error' ? event.message : event.reason || 'The screen refused the connection.')

          return

        case 'disconnected': {
          connection.current = 'none'

          if (!want.current) {
            return
          }

          const decision = decideAfterClose({ code: event.code, clean: event.clean }, { attempts: attempts.current })

          if (decision.kind === 'reconnect') {
            // Losing control is not a failure, so it does not count against the redials.
            if (decision.viewOnly === undefined) {
              attempts.current += 1
            }

            if (decision.notice) {
              setNotice(decision.notice)
            }

            setPhase('reconnecting')
            clearTimer()
            timer.current = setTimeout(() => void dial(), decision.delayMs)

            if (decision.viewOnly) {
              // Someone else drives now: refresh who holds the lease.
              void display.refresh(profile)
            }

            return
          }

          setPhase(decision.kind === 'gone' ? 'gone' : 'failed')
          setError(decision.message)
          void display.refresh(profile)
        }
      }
    },
    [dial, profile],
  )

  const letGo = useCallback(() => {
    clearTimer()
    connection.current = 'none'
    view.current?.disconnect()
  }, [])

  // Connect while the screen is wanted and running; let go when it is not. Closing the connection hands control
  // back (the server treats it as the viewer leaving), so a brief "not running" in a status snapshot must not
  // close it: wait a few seconds, and let the server's own close code (4001: the screen is gone) speak first.
  useEffect(() => {
    clearGrace()

    if (!active) {
      want.current = false
      letGo()

      return
    }

    if (running) {
      want.current = true

      if (connection.current === 'none') {
        attempts.current = 0
        void dial()
      }

      return
    }

    grace.current = setTimeout(() => {
      want.current = false
      letGo()
    }, STOPPED_GRACE_MS)

    return clearGrace
  }, [active, running, dial, letGo])

  // A new gateway connection means a new viewer id: the old ticket's identity is dead, so dial again.
  const firstGeneration = useRef(generation)

  useEffect(() => {
    if (generation !== firstGeneration.current && want.current) {
      firstGeneration.current = generation
      attempts.current = 0
      void dial()
    }
  }, [generation, dial])

  // Watching and driving differ only in whether input is sent; the server enforces the lease either way.
  useEffect(() => {
    view.current?.setViewOnly(!driving)
  }, [driving])

  useEffect(
    () => () => {
      want.current = false
      clearTimer()
      clearGrace()
    },
    [],
  )

  const send = useCallback((events: KeyEvent[]) => {
    for (const { keysym, down } of events) {
      view.current?.key(keysym, undefined, down)
    }
  }, [])
  const paste = useCallback((text: string) => view.current?.paste(text), [])
  const setFit = useCallback((fit: boolean) => view.current?.setFit(fit), [])

  // When the screen is not wanted or not running there is no connection, whatever the last phase was.
  return { send, paste, setFit, attach, phase: active && running ? phase : ('off' as ViewerPhase), notice, error, onEvent, clearNotice: () => setNotice(null) }
}
