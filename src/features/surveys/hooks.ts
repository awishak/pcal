'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSurvey, fetchResults, hasResponded, submitResponse } from './api'
import { useSurveyConfig } from './context'
import { getRespondentKey } from './respondent'
import { SurveyError, type AnswerInput, type Survey, type SurveyResults } from './types'

function asSurveyError(err: unknown): SurveyError {
  return err instanceof SurveyError ? err : new SurveyError('unknown', String(err))
}

export interface UseSurveyResult {
  survey: Survey | null
  /** per-survey hash of this device; needed to submit and to unlock results */
  respondentKey: string | null
  responded: boolean
  loading: boolean
  error: SurveyError | null
  reload: () => void
  /** call after a successful submit so `responded` flips without a refetch */
  markResponded: () => void
}

/** Load a survey and work out whether this device has already answered it. */
export function useSurvey(slug: string): UseSurveyResult {
  const { client, deviceStorageKey } = useSurveyConfig()
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [respondentKey, setRespondentKey] = useState<string | null>(null)
  const [responded, setResponded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<SurveyError | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const key = await getRespondentKey(slug, deviceStorageKey)
        const loaded = await fetchSurvey(client, slug)
        if (cancelled) return
        setRespondentKey(key)
        setSurvey(loaded)
        if (loaded) {
          const already = await hasResponded(client, slug, key)
          if (!cancelled) setResponded(already)
        }
      } catch (err) {
        if (!cancelled) setError(asSurveyError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, slug, deviceStorageKey, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const markResponded = useCallback(() => setResponded(true), [])

  return { survey, respondentKey, responded, loading, error, reload, markResponded }
}

export interface UseResultsResult {
  results: SurveyResults | null
  loading: boolean
  error: SurveyError | null
  reload: () => void
}

/**
 * Fetch tallies. Skipped entirely while `enabled` is false, so a survey set
 * to `after_response` does not fire a request that is guaranteed to 401.
 */
export function useSurveyResults(
  slug: string,
  respondentKey: string | null,
  enabled = true,
): UseResultsResult {
  const { client } = useSurveyConfig()
  const [results, setResults] = useState<SurveyResults | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<SurveyError | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchResults(client, slug, respondentKey ?? undefined)
      .then((data) => {
        if (!cancelled) setResults(data)
      })
      .catch((err) => {
        if (!cancelled) setError(asSurveyError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client, slug, respondentKey, enabled, nonce])

  return { results, loading, error, reload: () => setNonce((n) => n + 1) }
}

/**
 * Who is signed in, if anyone. Only needed for auth-gated surveys; on a client
 * without `.auth` (or in a plain-JS test double) this simply reports null.
 */
export function useViewerId(): { userId: string | null; loading: boolean } {
  const { client } = useSurveyConfig()
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(client.auth))

  useEffect(() => {
    if (!client.auth) {
      setUserId(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    Promise.resolve(client.auth.getUser())
      .then((result) => {
        if (!cancelled) setUserId(result?.data?.user?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setUserId(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    // keep in step when they sign in without leaving the page
    const listener = client.auth.onAuthStateChange?.((_event, session) => {
      const next = session as { user?: { id?: string } } | null
      if (!cancelled) setUserId(next?.user?.id ?? null)
    })

    return () => {
      cancelled = true
      listener?.data.subscription.unsubscribe()
    }
  }, [client])

  return { userId, loading }
}

export interface UseLiveResultsOptions {
  enabled?: boolean
  /** how often to refetch when no realtime channel is available (ms) */
  intervalMs?: number
  /** set false to always poll, even if realtime is wired up */
  realtime?: boolean
}

export interface UseLiveResultsResult extends UseResultsResult {
  /** true once a realtime channel is carrying updates, false while polling */
  live: boolean
}

/**
 * Results that keep themselves current.
 *
 * Prefers a Supabase broadcast channel (see realtime.sql) and falls back to
 * an interval when one is not available, so this works whether or not the
 * optional trigger is installed. Either way the refresh goes back through
 * survey_results(), so the survey's show_results gating still applies; the
 * broadcast is only a nudge, never the data.
 */
export function useLiveSurveyResults(
  slug: string,
  respondentKey: string | null,
  options: UseLiveResultsOptions = {},
): UseLiveResultsResult {
  const { enabled = true, intervalMs = 15_000, realtime = true } = options
  const { client } = useSurveyConfig()
  const base = useSurveyResults(slug, respondentKey, enabled)
  const [live, setLive] = useState(false)

  // reload identity changes each render, so keep it in a ref and let the
  // effects below depend only on things that actually matter
  const reloadRef = useRef(base.reload)
  reloadRef.current = base.reload

  useEffect(() => {
    if (!enabled || !realtime || typeof client.channel !== 'function') return

    const channel = client
      .channel(`survey:${slug}`)
      .on('broadcast', { event: 'response' }, () => reloadRef.current())
      .subscribe((status: string) => setLive(status === 'SUBSCRIBED'))

    return () => {
      setLive(false)
      if (typeof client.removeChannel === 'function') client.removeChannel(channel)
      else channel.unsubscribe()
    }
  }, [client, slug, enabled, realtime])

  useEffect(() => {
    if (!enabled || live || intervalMs <= 0) return
    const timer = setInterval(() => reloadRef.current(), intervalMs)
    return () => clearInterval(timer)
  }, [enabled, live, intervalMs])

  return { ...base, live }
}

export interface UseSubmitResult {
  submit: (answers: AnswerInput[]) => Promise<boolean>
  submitting: boolean
  error: SurveyError | null
}

export function useSurveySubmit(slug: string, respondentKey: string | null): UseSubmitResult {
  const { client } = useSurveyConfig()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<SurveyError | null>(null)
  const inFlight = useRef(false)

  const submit = useCallback(
    async (answers: AnswerInput[]) => {
      if (!respondentKey || inFlight.current) return false
      inFlight.current = true
      setSubmitting(true)
      setError(null)
      try {
        await submitResponse(client, slug, respondentKey, answers)
        return true
      } catch (err) {
        setError(asSurveyError(err))
        return false
      } finally {
        inFlight.current = false
        setSubmitting(false)
      }
    },
    [client, slug, respondentKey],
  )

  return { submit, submitting, error }
}
