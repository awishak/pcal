'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { SupabaseLike } from './api'

export interface SurveyConfig {
  /** Your app's existing Supabase client. This feature never creates one. */
  client: SupabaseLike
  /** localStorage key for the device id. Override to isolate environments. */
  deviceStorageKey?: string
}

const SurveyContext = createContext<SurveyConfig | null>(null)

export function SurveyProvider({
  client,
  deviceStorageKey,
  children,
}: SurveyConfig & { children: ReactNode }) {
  const value = useMemo(
    () => ({ client, deviceStorageKey }),
    [client, deviceStorageKey],
  )
  return <SurveyContext.Provider value={value}>{children}</SurveyContext.Provider>
}

export function useSurveyConfig(): SurveyConfig {
  const ctx = useContext(SurveyContext)
  if (!ctx) {
    throw new Error('Survey components must be rendered inside <SurveyProvider client={supabase}>')
  }
  return ctx
}
