/**
 * Catalogue des notifications : chaque type appartient à une catégorie (réglable par l'utilisateur)
 * et à une audience (Studio = professionnels, People = clients).
 */
export type NotificationAudience = 'studio' | 'people' | 'both';

export const NOTIFICATION_CATEGORIES = [
  'appointments',
  'messages',
  'stock',
  'followups',
  'aftercare',
  'salons',
  'explorer',
  'reviews',
  'team',
  'account',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationTypeDef = {
  category: NotificationCategory;
  audience: NotificationAudience;
  /** Ne peut pas être coupée par l'utilisateur (ex. paiement échoué, annulation). */
  critical?: boolean;
};

export const NOTIFICATION_TYPES = {
  // ---- Studio : rendez-vous
  'appointment.created': { category: 'appointments', audience: 'studio' },
  'appointment.cancelled_by_client': { category: 'appointments', audience: 'studio', critical: true },
  'appointment.updated': { category: 'appointments', audience: 'studio' },
  'appointment.day_summary': { category: 'appointments', audience: 'studio' },
  'appointment.reminder': { category: 'appointments', audience: 'studio' },
  'appointment.pending_stale': { category: 'appointments', audience: 'studio' },
  'appointment.no_show_check': { category: 'appointments', audience: 'studio' },
  'appointment.conflict': { category: 'appointments', audience: 'studio' },
  'appointment.payment_due': { category: 'appointments', audience: 'studio' },
  // ---- Studio : messages
  'message.unanswered': { category: 'messages', audience: 'studio' },
  'contact.new': { category: 'messages', audience: 'studio' },
  'thread.assigned': { category: 'messages', audience: 'studio' },
  // ---- Studio : stock
  'stock.low': { category: 'stock', audience: 'studio' },
  'stock.expiring': { category: 'stock', audience: 'studio' },
  // ---- Studio : clients et suivis
  'followup.reply': { category: 'followups', audience: 'studio' },
  'drawing.client_feedback': { category: 'followups', audience: 'studio' },
  // ---- Studio : avis et Explorer
  'review.new': { category: 'reviews', audience: 'studio' },
  'explorer.proposal_reply': { category: 'explorer', audience: 'studio' },
  // ---- Studio : équipe
  'team.invitation_received': { category: 'team', audience: 'studio' },
  'team.invitation_accepted': { category: 'team', audience: 'studio' },
  'team.permission_request': { category: 'team', audience: 'studio' },
  // ---- Studio : compte et abonnement
  'account.trial_ending': { category: 'account', audience: 'studio' },
  'account.payment_failed': { category: 'account', audience: 'studio', critical: true },
  'account.invoice': { category: 'account', audience: 'studio' },
  'account.profile_incomplete': { category: 'account', audience: 'studio' },
  'account.weekly_report': { category: 'account', audience: 'studio' },

  // ---- Commun
  // Chaque message reçu : push seulement (pas d'entrée dans le centre).
  'message.new': { category: 'messages', audience: 'both' },
  // Seuils de messages non lus dans une conversation (5, 10, 20) : entrée dans le centre de notifications.
  'message.unread_threshold': { category: 'messages', audience: 'both' },

  // ---- People
  'client.appointment_confirmed': { category: 'appointments', audience: 'people' },
  'client.appointment_declined': { category: 'appointments', audience: 'people', critical: true },
  'client.appointment_changed': { category: 'appointments', audience: 'people' },
  'client.appointment_cancelled': { category: 'appointments', audience: 'people', critical: true },
  'client.appointment_reminder': { category: 'appointments', audience: 'people' },
  'client.review_request': { category: 'reviews', audience: 'people' },
  'client.review_reply': { category: 'reviews', audience: 'people' },
  'client.aftercare_checkin': { category: 'aftercare', audience: 'people' },
  'client.aftercare_tip': { category: 'aftercare', audience: 'people' },
  'client.touchup_due': { category: 'aftercare', audience: 'people' },
  'client.drawing_to_validate': { category: 'aftercare', audience: 'people' },
  'client.salon_new_flash': { category: 'salons', audience: 'people' },
  'client.salon_new_portfolio': { category: 'salons', audience: 'people' },
  'client.explorer_proposal': { category: 'explorer', audience: 'people' },
  'client.explorer_reminder': { category: 'explorer', audience: 'people' },
} as const satisfies Record<string, NotificationTypeDef>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export function isNotificationType(value: string): value is NotificationType {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, value);
}

/** Catégories proposées dans les réglages selon le rôle (client = People, sinon Studio). */
export function categoriesForRole(role: string | null | undefined): NotificationCategory[] {
  const audience: NotificationAudience = role === 'client' ? 'people' : 'studio';
  const found = new Set<NotificationCategory>();
  for (const def of Object.values(NOTIFICATION_TYPES) as NotificationTypeDef[]) {
    if (def.audience === 'both' || def.audience === audience) found.add(def.category);
  }
  return NOTIFICATION_CATEGORIES.filter((c) => found.has(c));
}
