import { escapeEmailHtml as escape, renderInkeraEmail } from './email-layout';

/** E-mail envoyé au client d'un salon pour qu'il rejoigne Inkera et relie son compte à sa fiche. */
export function renderClientInvitationEmail(data: {
  clientFirstName: string;
  salonName: string;
  invitationUrl: string;
  expiresAt: Date;
}) {
  const subject = `${data.salonName} vous invite à suivre vos rendez-vous sur Inkera`;
  const expires = data.expiresAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const html = renderInkeraEmail(
    `
    <h1 class="greeting">Retrouvez ${escape(data.salonName)} sur Inkera</h1>
    <p class="message">Bonjour ${escape(data.clientFirstName)},</p>
    <p class="message">${escape(data.salonName)} vous invite à rejoindre Inkera. Votre espace client est gratuit et vous donne la main sur votre projet :</p>
    <div class="details-card">
      • <strong>Vos rendez-vous</strong> : retrouvez-les tous au même endroit, avec leurs rappels, et gérez-les vous-même<br>
      • <strong>La messagerie Inkera</strong> : échangez directement avec votre tatoueur, photos comprises<br>
      • <strong>Vos moodboards</strong> : rassemblez vos inspirations et partagez-les avec l’artiste<br>
      • <strong>Votre suivi</strong> : dessins à valider et conseils de cicatrisation envoyés par le salon<br>
      • <strong>L’inspiration</strong> : découvrez des salons, des flashs et des réalisations, et gardez vos favoris
    </div>
    <a href="${escape(data.invitationUrl)}" class="cta-button">Rejoindre Inkera</a>
    <p class="message" style="font-size:13px;">Vous avez déjà un compte ? Le même lien vous permet de retrouver vos rendez-vous avec ${escape(data.salonName)} en un clic. Utilisez l’adresse e-mail à laquelle vous avez reçu ce message. Le salon ne voit ni vos favoris, ni vos moodboards privés, ni vos rendez-vous dans d’autres salons.</p>
    <p class="message" style="font-size:13px;">Ce lien est personnel et valable jusqu’au ${escape(expires)}. Si vous ne connaissez pas ${escape(data.salonName)}, ignorez simplement cet e-mail.</p>
  `,
    subject,
    data.salonName,
  );
  return { subject, html };
}
