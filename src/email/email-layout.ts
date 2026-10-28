import { existsSync } from 'fs';
import { join } from 'path';

/** Shared email design. Essential styles are inline; media queries are enhancements. */
export const INKERA_LOGO_CID = 'inkera-logo';
export const INKERA_LOGO_PATH = join(__dirname, 'assets', 'logo_inline_white.png');
const bodyFont = "'Didact Gothic', Arial, Helvetica, sans-serif";
const headingFont = "'Exo 2', Arial, Helvetica, sans-serif";
const brandFont = "'Montserrat Alternates', Arial, Helvetica, sans-serif";

export function escapeEmailHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

const card =
  'background-color:#f5eee9;border:1px solid #e5d8cf;border-radius:12px;padding:22px;margin:24px 0;color:#3e2c27;';
const heading = `font-family:${headingFont};font-size:26px;line-height:1.3;font-weight:600;letter-spacing:-0.5px;color:#2d1f1a;margin:0 0 22px;`;
const classStyles: Record<string, string> = {
  content: 'padding:0;color:#3e2c27;',
  greeting: heading,
  'welcome-title': heading,
  'welcome-section': 'margin:0 0 22px;',
  'welcome-subtitle': 'font-size:16px;line-height:1.7;',
  message: 'font-size:16px;line-height:1.7;margin:0 0 24px;color:#3e2c27;',
  'message-box':
    'font-size:16px;line-height:1.7;margin:0 0 24px;color:#3e2c27;',
  'details-card': card,
  'appointment-summary': card,
  'details-title': `font-family:${headingFont};font-size:17px;line-height:1.5;font-weight:600;color:#2d1f1a;margin:0 0 14px;`,
  'details-list': 'list-style:none;padding:0;margin:0;',
  'detail-label': 'color:#74645b;font-weight:400;',
  'detail-value': 'color:#2d1f1a;font-weight:600;',
  'cta-button': `display:inline-block;box-sizing:border-box;background-color:#ff9d00;border:1px solid #ff9d00;border-radius:8px;padding:15px 24px;min-height:48px;font-family:${headingFont};font-size:16px;line-height:22px;font-weight:600;color:#131313;text-align:center;text-decoration:none;margin:0;mso-padding-alt:0;text-underline-color:#ff9d00;`,
  'warning-box':
    'background-color:#fff3df;border-left:3px solid #ff9d00;border-radius:8px;padding:18px 20px;margin:24px 0;color:#664018;font-size:15px;line-height:1.7;',
  'token-display': `background-color:#f5eee9;border:1px dashed #af7e70;border-radius:12px;padding:22px 12px;margin:24px 0;text-align:center;font-family:${headingFont};font-size:26px;line-height:1.5;font-weight:600;letter-spacing:3px;color:#2d1f1a;`,
  'info-grid': 'margin:18px 0;',
  'info-item': 'padding:8px 0;',
  'info-item-label': 'color:#74645b;font-size:13px;line-height:1.6;',
  divider: 'height:1px;background-color:#e5d8cf;margin:24px 0;',
  'price-highlight': `display:inline-block;background-color:#f5eee9;color:#2d1f1a;border:1px solid #e5d8cf;border-radius:8px;padding:8px 14px;font-family:${headingFont};font-size:20px;font-weight:600;`,
};

/** Inline only our known template classes; no dependency on email-client CSS support. */
function inlineContent(content: string): string {
  const styled = content.replace(
    /<(div|p|h[1-6]|a|ul|ol|li|span|strong|img)\b([^>]*)>/gi,
    (tag, element: string, attributes: string) => {
      const existing = /\sstyle="([^"]*)"/i.exec(attributes)?.[1] ?? '';
      const classes =
        /\sclass="([^"]*)"/i.exec(attributes)?.[1].split(/\s+/) ?? [];
      let defaults = '';
      if (element === 'p') defaults = 'margin:0 0 14px;';
      if (/^h[1-3]$/.test(element)) defaults = heading;
      if (element === 'a')
        defaults =
          'color:#944a26;text-decoration:underline;word-break:break-word;';
      if (element === 'ul' || element === 'ol')
        defaults = 'margin:12px 0;padding-left:22px;';
      if (element === 'li') defaults = 'padding:7px 0;line-height:1.6;';
      if (element === 'img') defaults = 'max-width:100%;height:auto;border:0;';
      const styles = classes.map((name) => classStyles[name] ?? '').join('');
      const style = `${defaults}${existing}${existing && !existing.endsWith(';') ? ';' : ''}${styles}`;
      return style
        ? `<${element}${attributes.replace(/\sstyle="[^"]*"/i, '')} style="${style}">`
        : tag;
    },
  );
  // Table cell padding is the fallback for classic Outlook, where anchor padding
  // is not reliable. The link remains usable without embedded CSS or web fonts.
  return styled.replace(
    /<a\b([^>]*class="[^"]*\bcta-button\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi,
    (_, attributes: string, label: string) =>
      `<table role="presentation" class="email-action" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:16px auto 28px;max-width:100%;"><tr><td align="center" bgcolor="#ff9d00" style="background-color:#ff9d00;border-radius:8px;mso-padding-alt:15px 24px;"><a${attributes}>${label}</a></td></tr></table>`,
  );
}

export function renderInkeraEmail(
  content: string,
  title = 'Inkera Studio',
  context = 'Inkera Studio',
): string {
  const safeTitle = escapeEmailHtml(title);
  const safeContext = escapeEmailHtml(context);
  const contextLine =
    context !== 'Inkera Studio'
      ? `<p style="margin:20px 0 0;font-family:${bodyFont};font-size:14px;line-height:1.6;color:#e4cbbd;">${safeContext}</p>`
      : '';
  const textLogo = `<span style="font-family:${brandFont};font-size:30px;font-weight:600;line-height:1.2;letter-spacing:-1px;color:#ffffff;">inkera<span style="color:#ff9d00;">.</span></span>`;
  // Logo sent as inline CID attachment (see MailgunService); alt text keeps the brand name if images are blocked.
  const brandMark = existsSync(INKERA_LOGO_PATH)
    ? `<p style="margin:0;line-height:1.2;"><img src="cid:${INKERA_LOGO_CID}" alt="inkera." height="36" style="display:block;height:36px;width:auto;border:0;font-family:${brandFont},Arial,sans-serif;font-size:30px;font-weight:bold;color:#ffffff;"></p>`
    : `<p style="margin:0;">${textLogo}</p>`;
  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
  <meta name="color-scheme" content="light">
  <title>${safeTitle}</title>
  <!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Didact+Gothic&amp;family=Exo+2:wght@400;600&amp;family=Montserrat+Alternates:wght@400;600&amp;display=swap" rel="stylesheet"><!--<![endif]-->
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><style>body,table,td,p,a,div,span,h1,h2,h3{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
  <style>
    body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}
    a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
    .email-copy{overflow-wrap:anywhere;word-wrap:break-word}
    @media screen and (max-width:620px){
      .email-outer{padding:12px 8px!important}
      .email-header{padding:28px 22px!important}
      .email-copy{padding:28px 22px!important}
      .email-footer{padding:24px 22px!important}
      .greeting,.welcome-title{font-size:24px!important}
      .details-card,.appointment-summary{padding:18px!important}
      .cta-button{display:block!important;width:100%!important;padding:15px 12px!important}
      .email-action{width:100%!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#eee8e3;font-family:${bodyFont};font-size:16px;line-height:1.7;color:#3e2c27;">
  <div style="display:none;font-size:1px;line-height:1px;color:#eee8e3;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${safeTitle} &nbsp;—&nbsp; Inkera Studio</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eee8e3">
    <tr><td align="center" class="email-outer" style="padding:32px 12px;">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-container" style="width:100%;max-width:600px;table-layout:fixed;">
        <tr><td height="4" bgcolor="#ff5500" style="height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td class="email-header" bgcolor="#131313" style="padding:34px 40px;background-color:#131313;">
          ${brandMark}
          <p style="margin:9px 0 0;font-family:${headingFont};font-size:10px;line-height:1.5;letter-spacing:3px;color:#c79f8b;text-transform:uppercase;">STUDIO · L’ESPACE DES ARTISTES</p>
          ${contextLine}
        </td></tr>
        <tr><td class="email-copy" bgcolor="#fffdfb" style="padding:36px 40px;background-color:#fffdfb;font-family:${bodyFont};font-size:16px;line-height:1.7;color:#3e2c27;word-break:break-word;">${inlineContent(content)}</td></tr>
        <tr><td class="email-footer" bgcolor="#f5eee9" style="padding:26px 40px;background-color:#f5eee9;border-top:1px solid #e5d8cf;">
          <p style="margin:0 0 8px;font-family:${headingFont};font-size:14px;line-height:1.5;font-weight:600;color:#2d1f1a;">Inkera Studio</p>
          <p style="margin:0;font-family:${bodyFont};font-size:13px;line-height:1.7;color:#74645b;">Des projets qui prennent vie. Un suivi qui fait la différence.</p>
          <p style="margin:14px 0 0;font-family:${bodyFont};font-size:12px;line-height:1.6;color:#74645b;">${context !== 'Inkera Studio' ? `${safeContext} · ` : ''}Notification envoyée avec Inkera Studio.</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}
