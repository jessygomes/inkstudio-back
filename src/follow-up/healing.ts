/** État de la cicatrisation déclaré par le client dans son suivi (distinct de la note de satisfaction). */
export const HEALING_STATUSES = ['GOOD', 'NORMAL', 'REDNESS', 'WORRIED'] as const;
export type HealingStatus = (typeof HEALING_STATUSES)[number];

export const HEALING_LABELS: Record<HealingStatus, string> = {
  GOOD: 'Tout se passe bien',
  NORMAL: 'Ça démange ou ça pèle',
  REDNESS: 'Rougeur ou gonflement',
  WORRIED: 'Je suis inquiet·e',
};

/** Le salon doit regarder ce suivi en priorité. */
export const isHealingConcern = (status?: string | null): boolean => status === 'REDNESS' || status === 'WORRIED';

export const FOLLOW_UP_MAX_PHOTOS = 3;

/** Canaux de la réponse du salon à un suivi. */
export const FOLLOW_UP_REPLY_CHANNELS = ['EMAIL', 'EMAIL_AND_INKERA'] as const;
export type FollowUpReplyChannel = (typeof FOLLOW_UP_REPLY_CHANNELS)[number];
