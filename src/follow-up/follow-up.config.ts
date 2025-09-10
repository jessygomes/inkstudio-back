// Configuration pour les délais de suivi
export interface FollowUpConfig {
  delayMinutes: number; // Délai en minutes après la fin du RDV
  delayDays?: number; // Délai en jours (pour usage futur)
}

// Configuration par défaut
export const DEFAULT_FOLLOWUP_CONFIG: FollowUpConfig = {
  delayMinutes: 5, // 5 minutes après la fin du RDV
  delayDays: 5, // 5 jours (pour usage futur)
};

// Types de prestations qui nécessitent un suivi
export const PRESTATIONS_WITH_FOLLOWUP = [
  'TATTOO',
  'RETOUCHE',
  'PIERCING',
] as const;

export type PrestationWithFollowUp = (typeof PRESTATIONS_WITH_FOLLOWUP)[number];
