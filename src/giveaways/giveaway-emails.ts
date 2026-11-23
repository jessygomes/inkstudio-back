import { escapeEmailHtml as escape, renderInkeraEmail } from '../email/email-layout';

/**
 * E-mails de service des concours (jamais de marketing : aucun envoi ne dépend
 * d'un consentement commercial, et aucun n'en demande).
 */

const formatDate = (d: Date) =>
  d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

const footer = `<p class="message" style="font-size:12px;">Message de service lié à votre participation. Vous ne recevrez pas d'e-mail commercial à cause de ce concours.</p>`;

export function entryConfirmationEmail(d: { name: string; title: string; url: string; drawAt: Date; rulesVersion: number }) {
  const subject = `Participation enregistrée : ${d.title}`;
  const html = renderInkeraEmail(
    `<h1 class="greeting">Votre participation est enregistrée</h1>
    <p class="message">Bonjour ${escape(d.name)},</p>
    <p class="message">Votre participation au concours « ${escape(d.title)} » est bien enregistrée (règlement version ${d.rulesVersion}). Le tirage est prévu le ${escape(formatDate(d.drawAt))}.</p>
    <p class="message">Votre profil doit rester complet et public jusqu'à la clôture : l'éligibilité est vérifiée une seconde fois à ce moment-là.</p>
    <a href="${escape(d.url)}" class="cta-button">Voir ma participation</a>${footer}`,
    subject,
  );
  return { subject, html };
}

export function winnerEmail(d: { name: string; title: string; prize: string; url: string; deadline: Date | null }) {
  const subject = `Vous avez gagné : ${d.title}`;
  const html = renderInkeraEmail(
    `<h1 class="greeting">Félicitations !</h1>
    <p class="message">Bonjour ${escape(d.name)},</p>
    <p class="message">Vous avez été tiré·e au sort au concours « ${escape(d.title)} ». Votre lot : <strong>${escape(d.prize)}</strong>.</p>
    <p class="message">Pour le recevoir, acceptez-le depuis votre espace${d.deadline ? ` avant le ${escape(formatDate(d.deadline))}` : ''}. Vous pourrez aussi choisir, séparément, si votre nom peut apparaître dans les résultats publics.</p>
    <p class="message">Aucune carte bancaire n'est demandée et aucun paiement ne sera prélevé pour ce lot.</p>
    <a href="${escape(d.url)}" class="cta-button">Accepter mon lot</a>${footer}`,
    subject,
  );
  return { subject, html };
}

export function alternateEmail(d: { name: string; title: string; url: string }) {
  const subject = `Concours ${d.title} : vous êtes suppléant·e`;
  const html = renderInkeraEmail(
    `<h1 class="greeting">Vous êtes sur la liste des suppléants</h1>
    <p class="message">Bonjour ${escape(d.name)},</p>
    <p class="message">Le tirage du concours « ${escape(d.title)} » a eu lieu. Vous n'êtes pas parmi les gagnants, mais vous figurez sur la liste des suppléants : si un lot n'est pas attribué, nous vous recontacterons.</p>
    <a href="${escape(d.url)}" class="cta-button">Voir ma participation</a>${footer}`,
    subject,
  );
  return { subject, html };
}

export function acceptanceEmail(d: { name: string; title: string; prize: string }) {
  const subject = `Lot accepté : ${d.title}`;
  const html = renderInkeraEmail(
    `<h1 class="greeting">Votre lot est accepté</h1>
    <p class="message">Bonjour ${escape(d.name)},</p>
    <p class="message">Merci, nous avons bien reçu votre acceptation du lot « ${escape(d.prize)} ». L'équipe Inkera va l'activer sur votre compte ; vous recevrez un e-mail à ce moment-là.</p>${footer}`,
    subject,
  );
  return { subject, html };
}

export function activationEmail(d: { name: string; title: string; plan: string; startsAt: Date; endsAt: Date; stripeResumes: boolean }) {
  const subject = `Votre abonnement ${d.plan} offert est programmé`;
  const resume = d.stripeResumes
    ? `<p class="message">Vous avez déjà un abonnement payant : votre période déjà réglée est conservée, l'offre commence le ${escape(formatDate(d.startsAt))} et aucun prélèvement n'aura lieu jusqu'au ${escape(formatDate(d.endsAt))}. Votre abonnement reprendra ensuite aux conditions que vous aviez choisies ; vous pouvez le résilier à tout moment depuis la page Abonnement, sans frais.</p>`
    : `<p class="message">Votre compte bénéficie du plan ${escape(d.plan)} du ${escape(formatDate(d.startsAt))} au ${escape(formatDate(d.endsAt))}, sans carte bancaire. À la fin, il repassera simplement en offre gratuite : rien ne sera facturé sans votre accord.</p>`;
  const html = renderInkeraEmail(
    `<h1 class="greeting">Votre lot est activé</h1>
    <p class="message">Bonjour ${escape(d.name)},</p>
    <p class="message">Votre lot du concours « ${escape(d.title)} » est maintenant en place.</p>
    ${resume}${footer}`,
    subject,
  );
  return { subject, html };
}

export function adminNotificationEmail(d: { title: string; event: string; details: string[] }) {
  const subject = `[Concours] ${d.title} : ${d.event}`;
  const html = renderInkeraEmail(
    `<h1 class="greeting">${escape(d.event)}</h1>
    <p class="message">Concours « ${escape(d.title)} »</p>
    <div class="details-card">${d.details.map((l) => escape(l)).join('<br>')}</div>`,
    subject,
  );
  return { subject, html };
}
