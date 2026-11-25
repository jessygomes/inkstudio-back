/**
 * Besoins qu'un client peut afficher sur un moodboard partagé dans Explorer ; les professionnels filtrent dessus.
 * Mêmes libellés sur le site People, l'app People, le site Studio et l'app Studio.
 */
export const PROJECT_NEEDS = {
  URGENT: 'À faire rapidement',
  NEED_HELP: "J'ai besoin d'aide",
  WANT_DRAWING: 'Je veux un dessin',
  HAVE_DRAWING: "J'ai déjà mon dessin",
  FIRST_TATTOO: 'Premier tatouage',
  COVER_UP: 'Recouvrement',
  NOT_IN_A_HURRY: 'Pas pressé',
} as const;

export type ProjectNeed = keyof typeof PROJECT_NEEDS;
export const PROJECT_NEED_KEYS = Object.keys(PROJECT_NEEDS) as ProjectNeed[];

/** Garde les besoins connus, sans doublon, dans l'ordre du catalogue. */
export function normalizeProjectNeeds(values: readonly string[] | undefined | null): ProjectNeed[] {
  const wanted = new Set((values ?? []).map((v) => String(v).trim().toUpperCase()));
  return PROJECT_NEED_KEYS.filter((key) => wanted.has(key));
}

/**
 * Les propositions des professionnels sur un projet partagé sont suspendues (tous les abonnements) :
 * ils peuvent seulement mettre les projets en favori. EXPLORER_PROPOSALS_ENABLED=true les rouvre.
 */
export function explorerProposalsEnabled(): boolean {
  return process.env.EXPLORER_PROPOSALS_ENABLED === 'true';
}
