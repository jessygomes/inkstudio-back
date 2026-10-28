import { escapeEmailHtml as escape, renderInkeraEmail } from './email-layout';

export function renderDrawingVersionEmail(data: {
  clientName: string,
  salonName: string,
  title: string,
  version: number,
  imageUrl: string,
  caption?: string | null,
  conversationUrl?: string,
}) {
  const subject = `${data.salonName} attend votre retour sur votre dessin`;
  const html = renderInkeraEmail(
    `
    <h1 class="greeting">Votre dessin est prêt à être découvert</h1>
    <p class="message">Bonjour ${escape(data.clientName)},</p>
    <p class="message">${escape(data.salonName)} vous partage une nouvelle version de votre dessin et attend votre retour avant de poursuivre votre projet.</p>
    <div class="details-card"><strong>${escape(data.title)}</strong><br>Version ${data.version}</div>
    <a href="${escape(data.imageUrl)}" style="display:block;text-align:center;">
      <img src="${escape(data.imageUrl)}" alt="Dessin de votre projet — version ${data.version}" width="520" style="display:block;width:100%;max-width:520px;height:auto;margin:0 auto;border:0;border-radius:12px;">
    </a>
    ${data.caption ? `<p class="message">${escape(data.caption).replace(/\n/g, '<br>')}</p>` : ''}
    <p class="message">Le dessin vous plaît ou vous souhaitez des modifications ? ${data.conversationUrl ? 'Répondez dans votre messagerie Inkera ou directement à cet email' : 'Répondez directement à cet email'} pour transmettre votre avis au salon.</p>
    ${data.conversationUrl ? `<a href="${escape(data.conversationUrl)}" class="cta-button">Donner mon avis sur Inkera</a>` : ''}
    <p class="message" style="font-size:13px;">Si l’image ne s’affiche pas, <a href="${escape(data.imageUrl)}">ouvrez votre dessin ici</a>.</p>
  `,
    subject,
    data.salonName,
  );
  return { subject, html };
}
