import { escapeEmailHtml, renderInkeraEmail } from './email-layout';

export interface MessageEmailData {
  recipientName: string;
  senderName: string;
  messageCount: number;
  conversationLink: string;
  latestMessages: { content: string, createdAt: Date | string }[];
}

export function renderMessageEmail(
  data: MessageEmailData,
  preferencesUrl: string,
): string {
  const {
    recipientName,
    senderName,
    messageCount,
    conversationLink,
    latestMessages,
  } = data;
  const messages = latestMessages
    .map(
      (message) => `
    <div style="padding:16px 0;border-bottom:1px solid #e5d8cf;">
      <p style="margin:0 0 6px;color:#74645b;font-size:12px;">${escapeEmailHtml(new Date(message.createdAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }))}</p>
      <p style="margin:0;white-space:pre-wrap;">${escapeEmailHtml(message.content)}</p>
    </div>`,
    )
    .join('');

  return renderInkeraEmail(
    `
    <div class="content">
      <h1 class="greeting">Un message pour votre projet</h1>
      <div class="message">
        <p>Bonjour ${escapeEmailHtml(recipientName)},</p>
        <p>${messageCount === 1 ? 'Vous avez reçu un nouveau message' : `Vous avez reçu <strong>${messageCount} nouveaux messages</strong>`} de <strong>${escapeEmailHtml(senderName)}</strong>.</p>
      </div>
      <div class="details-card">
        <h2 class="details-title">${messageCount === 1 ? 'Dernier message' : 'Derniers messages'}</h2>
        ${messages}
      </div>
      <a href="${escapeEmailHtml(conversationLink)}" class="cta-button">Voir la conversation</a>
      <p style="font-size:13px;color:#74645b;">Vous recevez cet email car vous avez un nouveau message.<br>
        <a href="${escapeEmailHtml(preferencesUrl)}">Gérer mes notifications</a>
      </p>
    </div>`,
    'Nouveau message',
    senderName,
  );
}
