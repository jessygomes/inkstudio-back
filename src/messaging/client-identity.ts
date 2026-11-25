/**
 * Conversation ouverte par un professionnel après qu'un client a mis en favori l'une de ses réalisations ou l'un de ses
 * flashs : tant que le client n'a pas accepté la demande d'accès, le professionnel ne voit que son pseudo (ni nom,
 * ni e-mail, ni téléphone, ni photo). `clientAccess` = null : conversation ordinaire (accès normal).
 */
export type ClientAccess = 'HIDDEN' | 'REQUESTED' | 'GRANTED' | 'DECLINED';

const HIDDEN_STATES = new Set<string>(['HIDDEN', 'REQUESTED', 'DECLINED']);

export function isClientIdentityHidden(conversation: { clientAccess?: string | null } | null | undefined): boolean {
  return !!conversation?.clientAccess && HIDDEN_STATES.has(conversation.clientAccess);
}

export function clientAliasOf(conversation: { clientAlias?: string | null } | null | undefined): string {
  return conversation?.clientAlias?.trim() || 'Client Inkera';
}

/** Remplace les informations personnelles d'un compte client par son pseudo. */
export function maskClientUser<T extends Record<string, unknown>>(user: T, alias: string): T {
  const masked: Record<string, unknown> = { ...user, firstName: alias, lastName: null };
  for (const key of ['email', 'image', 'phone', 'profileImage', 'birthDate', 'address', 'city', 'postalCode']) {
    if (key in masked) masked[key] = key === 'email' ? '' : null;
  }
  return masked as T;
}

/** Masque le client d'une conversation pour le professionnel si l'accès n'est pas accordé. */
export function maskConversationClient<
  C extends { clientAccess?: string | null; clientAlias?: string | null; clientUser?: Record<string, unknown> | null },
>(conversation: C): C {
  if (!isClientIdentityHidden(conversation) || !conversation.clientUser) return conversation;
  return { ...conversation, clientUser: maskClientUser(conversation.clientUser, clientAliasOf(conversation)) };
}

/** Pseudo d'un compte client : pseudo du profil People, sinon pseudo du compte. */
export function pseudoOf(user: { nickname?: string | null; clientProfile?: { pseudo?: string | null } | null } | null | undefined): string | null {
  return user?.clientProfile?.pseudo?.trim() || user?.nickname?.trim() || null;
}
