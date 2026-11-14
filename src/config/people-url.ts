/**
 * Origine publique du site Inkera People (liens envoyés aux clients : invitation, suivi de cicatrisation…).
 * `INKERA_PEOPLE_BASE_URL` doit être une origine seule (sans chemin), en https en production.
 */
export function peopleOrigin(): string {
  const base = new URL(process.env.INKERA_PEOPLE_BASE_URL || 'https://theinkera.com');
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
    (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')
  )
    throw new Error('INKERA_PEOPLE_BASE_URL must be the public People origin');
  return base.origin;
}
