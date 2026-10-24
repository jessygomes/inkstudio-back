import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { EmailTemplateService } from '../src/email/email-template.service';
import {
  emailPreviewData,
  emailPreviewTemplates,
} from '../src/email/email-preview.data';
import { escapeEmailHtml, renderInkeraEmail } from '../src/email/email-layout';
import { renderMessageEmail } from '../src/email/message-email';

// Offline only: no Nest bootstrap, database connection, or email delivery.
const output = resolve('.tmp/email-previews');
mkdirSync(output, { recursive: true });
process.env.FRONTEND_URL = 'https://inkera-studio.com';
const service = new EmailTemplateService();
const previews = Object.entries(emailPreviewTemplates).map(
  ([name, method]) => ({
    name,
    html: service[method](emailPreviewData),
  }),
);
previews.push(
  {
    name: 'message-notification',
    html: renderMessageEmail(
      {
        recipientName: 'Alex Martin',
        senderName: 'Atelier Luna',
        messageCount: 2,
        conversationLink: 'https://inkera-studio.com/messagerie/demo',
        latestMessages: [
          {
            createdAt: '2026-10-24T12:30:00Z',
            content:
              'Bonjour Alex, votre dessin est prêt !\nNous pourrons affiner les derniers détails ensemble.',
          },
          {
            createdAt: '2026-10-24T12:35:00Z',
            content:
              'Avez-vous une préférence pour le créneau du jeudi ou du vendredi ?',
          },
        ],
      },
      'https://inkera-studio.com/parametres',
    ),
  },
  {
    name: 'production-test',
    html: renderInkeraEmail(
      '<h1 class="greeting">Tout est prêt.</h1><p>La configuration des emails Inkera Studio fonctionne correctement.</p>',
      'Test de configuration - Inkera Studio',
    ),
  },
);

for (const { name, html } of previews)
  writeFileSync(resolve(output, `${name}.html`), html);
const links = previews
  .map(
    ({ name }) =>
      `<a href="${name}.html" target="email-preview">${escapeEmailHtml(name)}</a>`,
  )
  .join('');
writeFileSync(
  resolve(output, 'index.html'),
  `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inkera · Aperçus des emails</title><style>
*{box-sizing:border-box}body{margin:0;background:#131313;color:#fff;font-family:Arial,sans-serif}header{padding:24px 28px;border-bottom:1px solid #3e2c27}h1{font-size:24px;margin:0 0 8px}h1 span{color:#ff9d00}p{color:#c79f8b;font-size:14px;margin:0}main{display:flex;min-height:calc(100vh - 104px)}nav{width:280px;flex-shrink:0;padding:16px;max-height:calc(100vh - 104px);overflow:auto}a{display:block;padding:10px 12px;color:#e4cbbd;text-decoration:none;font-size:13px;border-radius:8px}a:hover{background:#3e2c27;color:#ff9d00}.stage{padding:24px;flex:1;background:#e5d8cf}iframe{display:block;width:100%;height:85vh;max-width:900px;margin:auto;border:0;background:#eee8e3}.tools{display:flex;gap:8px;justify-content:center;margin-bottom:16px}button{padding:10px 18px;border:0;border-radius:6px;background:#131313;color:#fff;cursor:pointer}@media(max-width:700px){main{display:block}nav{width:100%;max-height:180px}.stage{padding:12px}}
</style></head><body><header><h1>inkera<span>.</span> · Emails</h1><p>${previews.length} aperçus fictifs · Aucun email envoyé · La validation en boîte mail reste nécessaire pour chaque client.</p></header><main><nav>${links}</nav><section class="stage"><div class="tools"><button onclick="document.querySelector('iframe').style.maxWidth='900px'">Desktop</button><button onclick="document.querySelector('iframe').style.maxWidth='375px'">Mobile · 375 px</button></div><iframe name="email-preview" title="Aperçu du mail" src="email-verification.html"></iframe></section></main></body></html>`,
);
console.log(
  `${previews.length} previews generated: ${resolve(output, 'index.html')}`,
);
