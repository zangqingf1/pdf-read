/**
 * Generate a UUID v4 string.
 * Uses crypto.randomUUID() when available (secure contexts: HTTPS, localhost),
 * falls back to crypto.getRandomValues() for plain HTTP deployments.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback: manual UUID v4 via crypto.getRandomValues()
  // crypto.getRandomValues() is available in all browsing contexts (including HTTP)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> (c === 'x' ? 0 : 3);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
