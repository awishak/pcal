/**
 * Respondent identity for anonymous surveys.
 *
 * A random device id lives in localStorage. It is never sent anywhere.
 * What we send is sha256(deviceId + ':' + slug), a key that is stable
 * for this device on this survey, but that cannot be used to link the same
 * device across two different surveys. That gets us a duplicate guard
 * without a login, and without building a cross-survey identifier.
 *
 * This is honest-but-not-bulletproof by design: clearing site data or
 * opening a private window gets you a new key. If you need stronger
 * guarantees, gate the survey behind auth and set one_response_per_device
 * plus your own check on user_id.
 */

const DEVICE_KEY = 'surveys.device-id'

function randomId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Stable per-browser id. Regenerated if storage is cleared or blocked. */
export function getDeviceId(storageKey: string = DEVICE_KEY): string {
  try {
    const existing = localStorage.getItem(storageKey)
    if (existing && existing.length >= 16) return existing
    const fresh = randomId()
    localStorage.setItem(storageKey, fresh)
    return fresh
  } catch {
    // private mode / storage disabled, per-session key, so the duplicate
    // guard degrades to "once per page load" rather than failing outright
    return randomId()
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The value to pass to submitResponse() / getResults(). */
export async function getRespondentKey(
  slug: string,
  storageKey: string = DEVICE_KEY,
): Promise<string> {
  return sha256Hex(`${getDeviceId(storageKey)}:${slug}`)
}

/** Forget this browser's identity, it will look like a new respondent. */
export function resetDeviceId(storageKey: string = DEVICE_KEY): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {
    /* nothing to clear */
  }
}
