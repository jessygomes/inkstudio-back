export const REMINDER_CHANNELS = ['EMAIL', 'INKERA', 'BOTH'] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];
export type ReminderKind = 'FOLLOW_UP' | 'RETOUCH';
export const REMINDER_VARIABLES = [
  'prenom',
  'salon',
  'artiste',
  'date_rdv',
  'lien_suivi',
] as const;
export const DEFAULT_FOLLOW_UP_MESSAGE =
  'Bonjour {prenom},\n\nMerci pour votre visite chez {salon}. Comment se passe la cicatrisation depuis votre séance du {date_rdv} ?\n\nVous pouvez nous envoyer votre photo et votre avis ici : {lien_suivi}\n\nÀ bientôt,\n{salon}';
export const DEFAULT_RETOUCH_MESSAGE =
  'Bonjour {prenom},\n\nNous prenons de vos nouvelles après votre tatouage du {date_rdv} avec {artiste}. Si vous pensez qu’une retouche est nécessaire, contactez-nous pour en discuter et convenir d’un rendez-vous.\n\nÀ bientôt,\n{salon}';

export function renderReminderMessage(
  template: string,
  values: Record<string, string>,
  kind: ReminderKind,
): string {
  const text = template
    .replace(
      /\{(prenom|salon|artiste|date_rdv|lien_suivi)\}/g,
      (_, key: string) => values[key] || '',
    )
    .trim();
  return kind === 'FOLLOW_UP' &&
    values.lien_suivi &&
    !text.includes(values.lien_suivi)
    ? `${text}\n\nEnvoyer mon suivi : ${values.lien_suivi}`
    : text;
}
