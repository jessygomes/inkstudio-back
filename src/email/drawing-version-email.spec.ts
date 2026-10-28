import { renderDrawingVersionEmail } from './drawing-version-email';

describe('Drawing version email', () => {
  const data = {
    clientName: 'Alex <script>',
    salonName: 'Atelier & Luna',
    title: 'Projet <floral>',
    version: 3,
    imageUrl: 'https://cdn.example.com/dessin.webp',
    caption: 'Une version\nplus fine',
  };
  it('uses the shared Inkera layout, displays the image and requests an email reply', () => {
    const { html, subject } = renderDrawingVersionEmail(data);
    expect(subject).toContain('attend votre retour');
    expect(html).toContain('xmlns:o=');
    expect(html).toContain('<img src="https://cdn.example.com/dessin.webp"');
    expect(html).toContain('Version 3');
    expect(html).toContain('Répondez directement à cet email');
    expect(html).toContain('Alex &lt;script&gt;');
    expect(html).not.toContain('Alex <script>');
    expect(html).toContain('Projet &lt;floral&gt;');
    expect(html).toContain('Une version<br>plus fine');
    expect(html).not.toContain('Donner mon avis sur Inkera');
  });
  it('offers the client app conversation only when it exists', () => {
    const { html } = renderDrawingVersionEmail({
      ...data,
      conversationUrl:
        'https://theinkera.com/mon-profil?tab=messagerie&conversationId=abc',
    });
    expect(html).toContain('Donner mon avis sur Inkera');
    expect(html).toContain('conversationId=abc');
    expect(html).toContain(
      'Répondez dans votre messagerie Inkera ou directement à cet email',
    );
    expect(html).toContain('email-action');
  });
});
