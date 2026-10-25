import { escapeEmailHtml, renderInkeraEmail } from './email-layout';

export const PROJECT_PROPOSAL_EMAIL_THRESHOLDS = [1, 5, 11] as const;

export function renderProjectProposalEmail(
  projectName: string,
  threshold: number,
) {
  const title =
    threshold === 1
      ? 'Vous avez reçu une proposition pour votre projet'
      : threshold === 5
        ? 'Votre projet a reçu 5 propositions'
        : 'Votre projet a reçu plus de 10 propositions';
  const description =
    threshold === 1
      ? 'Un professionnel souhaite réaliser votre projet.'
      : threshold === 5
        ? 'Cinq professionnels ont proposé leurs services pour votre projet.'
        : 'Plus de dix professionnels ont proposé leurs services pour votre projet.';
  // Public client app, never the professional Studio URL.
  const base = (
    process.env.FRONTEND_PUBLIC_URL ||
    process.env.FRONTENDPUBLIC_URL ||
    'https://theinkera.com'
  ).replace(/\/+$/, '');
  const url = `${base}/mon-profil?tab=messagerie`;
  const html = renderInkeraEmail(
    `
    <h1 class="greeting">${escapeEmailHtml(title)}</h1>
    <p class="message">${description}</p>
    <div class="details-card"><strong>${escapeEmailHtml(projectName)}</strong></div>
    <p class="message">Consultez les premiers messages des professionnels et choisissez d’accepter ou de refuser leurs demandes. Votre conversation sera créée ou réutilisée uniquement après votre acceptation.</p>
    <a href="${escapeEmailHtml(url)}" class="cta-button">Consulter mes propositions</a>
  `,
    title,
    'Inkera People',
  );
  return { subject: title, html };
}
