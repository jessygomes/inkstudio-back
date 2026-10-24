import { EmailTemplateService } from './email-template.service';
import { emailPreviewData, emailPreviewTemplates } from './email-preview.data';
import { renderInkeraEmail } from './email-layout';
import { renderMessageEmail } from './message-email';

describe('Inkera email presentation', () => {
  const service = new EmailTemplateService();

  it.each(Object.entries(emailPreviewTemplates))(
    '%s renders with the shared layout and meaningful content',
    (_, method) => {
      const html = service[method](emailPreviewData);
      expect(html).toContain('class="email-copy"');
      expect(html).toContain('bgcolor="#131313"');
      expect(html).toContain('Inkera Studio');
      expect(html).not.toMatch(
        /\bundefined\b|\bnull\b|display:\s*(flex|grid)|linear-gradient/,
      );
      expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(90_000);
      expect(html).toContain("'Didact Gothic', Arial, Helvetica, sans-serif");
    },
  );

  it('keeps essential styles and working action URLs without embedded CSS', () => {
    const html = service
      .generateEmailVerificationEmail(emailPreviewData)
      .replace(/<style>[\s\S]*?<\/style>/g, '');
    expect(html).toContain(`href="${emailPreviewData.verificationUrl}"`);
    expect(html).toMatch(
      /class="cta-button" style="[^"]*background-color:#ff9d00/,
    );
    expect(html).toMatch(/class="email-copy"[^>]+padding:36px 40px/);
    expect(html).toContain('mso-padding-alt:15px 24px');
  });

  it('escapes the header, title and sender context', () => {
    const html = renderInkeraEmail(
      '<p>Contenu</p>',
      '<script>bad</script>',
      '<img src=x onerror=bad>',
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=bad&gt;');
  });

  it('keeps message content as text and retains conversation and settings links', () => {
    const html = renderMessageEmail(
      {
        recipientName: '<Alex>',
        senderName: 'Atelier & Luna',
        messageCount: 1,
        conversationLink: 'https://inkera-studio.com/messagerie/demo',
        latestMessages: [
          {
            createdAt: '2026-10-24T12:00:00Z',
            content: '<img src=x onerror=bad>\nBonjour !',
          },
        ],
      },
      'https://inkera-studio.com/parametres',
    );
    expect(html).toContain('&lt;Alex&gt;');
    expect(html).toContain('Atelier &amp; Luna');
    expect(html).toContain('&lt;img src=x onerror=bad&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('href="https://inkera-studio.com/messagerie/demo"');
    expect(html).toContain('href="https://inkera-studio.com/parametres"');
  });

  it('covers every transaction template in the preview gallery', () => {
    const methods = Object.getOwnPropertyNames(
      EmailTemplateService.prototype,
    ).filter((name) => name.startsWith('generate'));
    expect(Object.values(emailPreviewTemplates).sort()).toEqual(methods.sort());
  });
});
