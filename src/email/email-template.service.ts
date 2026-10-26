import { Injectable } from '@nestjs/common';
import { renderInkeraEmail } from './email-layout';
import { BACK_OFFICE_PATH } from '../config/back-office';

export interface EmailTemplateData {
  recipientName?: string;
  salonName?: string;
  // Couleurs du profil utilisateur
  colorProfile?: string;
  colorProfileBis?: string;
  appointmentDetails?: {
    venue?: string;
    date: string;
    time: string;
    duration?: string;
    service: string;
    tatoueur?: string;
    price?: number;
    title?: string;
    clientEmail?: string;
    clientPhone?: string;
    visio?: boolean;
    visioRoom?: string;
  };
  rescheduleDetails?: {
    currentDate: string;
    oldTatoueurName?: string;
    newTatoueurName?: string;
    reason?: string;
    rescheduleUrl: string;
  };
  rescheduleAcceptedDetails?: {
    clientName: string;
    clientEmail: string;
    originalDate: string;
    newDate: string;
    tatoueurName: string;
    prestation: string;
    clientMessage?: string;
  };
  rescheduleConfirmationDetails?: {
    newDate: string;
    tatoueurName: string;
    clientMessage?: string;
  };
  
  // Follow-up emails
  followUpResponseDetails?: {
    clientName: string;
    tatoueurName: string;
    prestationName: string;
    response: string;
  };
  
  cicatrisationFollowUpDetails?: {
    clientName: string;
    prestationName: string;
    tatoueurName: string;
    followUpUrl: string;
  };
  
  feedbackRequestDetails?: {
    clientName: string;
    appointmentDate: string;
    tatoueurName: string;
    prestationName: string;
    followupUrl: string;
  };
  
  // Rappel retouches
  retouchesReminderDetails?: {
    clientName: string;
    appointmentDate: string;
    tatoueurName: string;
    salonName: string;
  };

  // Rappel de fin d'essai
  trialEndingSoonDetails?: {
    trialEndDate: string;
    billingUrl?: string;
    planName?: string;
    stripeManaged?: boolean;
    isGift?: boolean;
  };
  
  verificationToken?: string;
  verificationUrl?: string;
  resetToken?: string;
  resetUrl?: string;
  followUpDetails?: {
    appointmentDate: string;
    daysSince: number;
    instructions?: string;
  };
  customMessage?: string;

  // Message de contact envoyé depuis un profil public
  publicContactDetails?: {
    senderFullName: string;
    senderEmail: string;
    bodyPart: string;
    projectDescription: string;
    sourceIp?: string;
  };

  // Notification admin nouvel utilisateur
  newUserDetails?: {
    userEmail: string;
    salonName: string;
    saasPlan: string;
    registrationDate: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  } | null;

  // Annulation de rendez-vous par le client
  clientCancellationDetails?: {
    clientName: string;
    clientEmail?: string;
    clientPhone?: string;
    appointmentDate: string;
    appointmentTime: string;
    prestation: string;
    tatoueurName?: string;
    cancellationReason?: string;
  };
}

@Injectable()
export class EmailTemplateService {
  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  }

  private isLocalhostUrl(value: string): boolean {
    try {
      const hasProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value);
      const parsed = new URL(hasProtocol ? value : `https://${value}`);
      const host = parsed.hostname.toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch {
      const lowered = value.toLowerCase();
      return lowered.includes('localhost') || lowered.includes('127.0.0.1') || lowered.includes('::1');
    }
  }

  private getFrontendBaseUrl(): string {
    const candidates = [
      process.env.FRONTEND_URL,
      process.env.WEB_URL,
      process.env.FRONT_URL,
    ]
      .map((url) => (url || '').trim())
      .filter((url) => url.length > 0)
      .map((url) => url.replace(/\/+$/, ''));

    if (candidates.length === 0) {
      return '#';
    }

    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction) {
      return candidates[0];
    }

    return candidates.find((url) => !this.isLocalhostUrl(url)) || candidates[0];
  }

  private buildFrontendUrl(path: string): string {
    const baseUrl = this.getFrontendBaseUrl();
    if (baseUrl === '#') {
      return '#';
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
  }

  private sanitizeSiteUrl(rawUrl: string | undefined, fallbackPath: string): string {
    const safeFallback = this.buildFrontendUrl(fallbackPath);

    if (!rawUrl || rawUrl.trim().length === 0) {
      return safeFallback;
    }

    const trimmedUrl = rawUrl.trim();
    if (trimmedUrl.startsWith('/')) {
      return this.buildFrontendUrl(trimmedUrl);
    }

    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction || !this.isLocalhostUrl(trimmedUrl)) {
      return trimmedUrl;
    }

    try {
      const parsed = new URL(trimmedUrl);
      const pathAndQuery = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      return this.buildFrontendUrl(pathAndQuery || fallbackPath);
    } catch {
      return safeFallback;
    }
  }


  private getBaseTemplate(content: string, title = 'Inkera Studio', salonName = 'Inkera Studio'): string {
    return renderInkeraEmail(content, title, salonName);
  }

  /**
   *! Template pour confirmation de rendez-vous (client)
   */
  private escapeVenue(value: string) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }

  generateAppointmentConfirmationEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Bonjour ${data.recipientName || 'cher client'} ! </div>
        
        <div class="message">
          <p>Parfait ! Votre rendez-vous a été <strong>confirmé avec succès</strong>.</p>
          <p>Nous avons hâte de donner vie à votre projet artistique !</p>
        </div>

        ${data.appointmentDetails?.venue ? `<p style="padding: 12px; background: #f6f3f0; border-radius: 8px;"><strong>Lieu du rendez-vous :</strong> ${this.escapeVenue(data.appointmentDetails.venue)}</p>` : ''}
        ${data.appointmentDetails ? `
          <div class="details-card">
            <div class="details-title"> Détails de votre rendez-vous</div>
            <ul class="details-list">
              <li>
                <span style="font-weight: 500; color: #3e2c27;">Date : </span>
                <span style="font-weight: 600; color: #3e2c27;">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span style="font-weight: 500; color: #3e2c27;">Heure : </span>
                <span style="font-weight: 600; color: #3e2c27;">${data.appointmentDetails.time}</span>
              </li>
              ${data.appointmentDetails.duration ? `
                <li>
                  <span style="font-weight: 500; color: #3e2c27;">Durée : </span>
                  <span style="font-weight: 600; color: #3e2c27;">${data.appointmentDetails.duration}</span>
                </li>
              ` : ''}
              <li>
                <span style="font-weight: 500; color: #3e2c27;">Prestation :</span>
                <span style="font-weight: 600; color: #3e2c27;">${data.appointmentDetails.service}</span>
              </li>
              ${data.appointmentDetails.tatoueur ? `
                <li>
                  <span style="font-weight: 500; color: #3e2c27;">Artiste : </span>
                  <span style="font-weight: 600; color: #3e2c27;">${data.appointmentDetails.tatoueur}</span>
                </li>
              ` : ''}
              ${data.appointmentDetails.price ? `
                <li>
                  <span style="font-weight: 500; color: #3e2c27;">Prix : </span>
                  <span style="font-weight: 600; color: #3e2c27;">${data.appointmentDetails.price}€</span>
                </li>
              ` : ''}
              ${data.appointmentDetails.visio && data.appointmentDetails.visioRoom ? `
                <li>
                  <span style="font-weight: 500; color: #3e2c27;">Visioconférence :</span>
                  <span class="detail-value">
                    <a href="${this.sanitizeSiteUrl(data.appointmentDetails.visioRoom, '/dashboard')}" 
                      class="cta-button" style="padding: 8px 16px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; margin-top: 8px;">
                       Rejoindre la visioconférence
                    </a>
                  </span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        ${data.customMessage ? `
          <div style="background-color: #f5eee9; border-left: 4px solid #e5d8cf; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0 0 8px 0; color: #3e2c27; font-weight: 600;"> Message du salon :</p>
            <p style="margin: 0; color: #3e2c27; font-style: italic;">"${data.customMessage}"</p>
          </div>
        ` : ''}

        <div class="warning-box">
          <strong> Important :</strong> Merci d'arriver 10 minutes avant votre rendez-vous et de vous présenter avec une pièce d'identité.
        </div>

        <div class="message">
          <p>Si vous avez des questions ou besoin de modifier votre rendez-vous, n'hésitez pas à nous contacter.</p>
          <p><strong>À très bientôt chez ${data.salonName || 'Inkera Studio'} ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Confirmation de rendez-vous - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio',
      
    );
  }

  /**
   *! Template pour notification de nouveau rendez-vous (salon)
   */
  generateNewAppointmentNotificationEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Nouveau rendez-vous ! </div>
        
        <div class="message">
          <p>Un nouveau rendez-vous vient d'être confirmé dans votre salon <strong>${data.salonName || 'Inkera Studio'}</strong>.</p>
        </div>

        ${data.appointmentDetails?.venue ? `<p style="padding: 12px; background: #f6f3f0; border-radius: 8px;"><strong>Lieu du rendez-vous :</strong> ${this.escapeVenue(data.appointmentDetails.venue)}</p>` : ''}
        ${data.appointmentDetails ? `
          <div class="details-card">
            <div class="details-title"> Résumé du rendez-vous</div>
            <ul style="list-style: none; padding: 0; margin: 0; font-family: 'Didact Gothic', Arial, Helvetica, sans-serif; color: #3e2c27;">
              <li>
                <span style="font-weight: 500; color: #3e2c27;"> Client :</span>
                <span style="font-weight: 600; color: #3e2c27;">${data.recipientName || 'Nouveau client'}</span>
              </li>
              <li>
                <span style="font-weight: 500; color: #3e2c27;"> Date :</span>
                <span style="font-weight: 600; color: #3e2c27;">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span style="font-weight: 500; color: #3e2c27;">⏰ Heure :</span>
                <span style="font-weight: 600; color: #3e2c27;">${data.appointmentDetails.time}</span>
              </li>
              <li>
                <span style="font-weight: 500; color: #3e2c27;"> Prestation :</span>
                <span style="font-weight: 600; color: #3e2c27;">${data.appointmentDetails.service}</span>
              </li>
              ${data.appointmentDetails.tatoueur ? `
                <li>
                  <span style="font-weight: 500; color: #3e2c27;"> Artiste :</span>
                  <span style="font-weight: 600; color: #3e2c27;">${data.appointmentDetails.tatoueur}</span>
                </li>
              ` : ''}
              ${data.appointmentDetails.price ? `
                <li>
                  <span style="font-weight: 500; color: #3e2c27;"> Prix :</span>
                  <span style="font-weight: 600; color: #3e2c27;">${data.appointmentDetails.price}€</span>
                </li>
              ` : ''}
              ${data.appointmentDetails.visio && data.appointmentDetails.visioRoom ? `
                <li>
                  <span style="font-weight: 500; color: #3e2c27;"> Visioconférence :</span>
                  <span style="font-weight: 600; color: #3e2c27;">
                    <a href="${this.sanitizeSiteUrl(data.appointmentDetails.visioRoom, '/dashboard')}" 
                      class="cta-button" style="padding: 8px 16px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; margin-top: 8px;">
                       Rejoindre la visioconférence
                    </a>
                  </span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        <a href="${this.buildFrontendUrl('/dashboard')}" class="cta-button">
           Voir dans le dashboard
        </a>

        <div class="message">
          <p>Le client recevra automatiquement un email de confirmation.</p>
          <p><strong>Bonne journée ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Nouveau rendez-vous - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio',
    );
  }

  /**
   *! Template pour vérification d'email
   */
  generateEmailVerificationEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="welcome-section">
          <h2 class="welcome-title">Bienvenue sur Inkera Studio !</h2>
        </div>

        <br/>
        
        <div class="message-box">
          <p class="welcome-subtitle">Bonjour ${data.recipientName || 'cher utilisateur'},</p>
          <p><strong>Félicitations !</strong> Votre compte ${data.salonName || 'Inkera Studio'} a été créé avec succès.</p>
          <br/>
          <p>Pour commencer à utiliser toutes les fonctionnalités de votre espace de gestion, veuillez confirmer votre adresse email en cliquant sur le bouton ci-dessous :</p>
        </div>
        
        ${data.verificationUrl ? `
          <div style="text-align: center;">
            <a href="${this.sanitizeSiteUrl(data.verificationUrl, '/verifier-email')}" class="cta-button">
               Confirmer mon adresse email
            </a>
          </div>
        ` : ''}
        
        ${data.verificationToken ? `
          <div class="token-display">
            <p style="font-size:13px;letter-spacing:0;font-weight:400;margin:0 0 10px;">Code de vérification</p>
            ${data.verificationToken}
          </div>
        ` : ''}
        
        <div class="info-grid">
          <div class="info-item">
            <div class="info-item-label"> Expiration dans 10min | Lien unique</div>
          </div>
        </div>
        
        <div style="background-color: #f5eee9; border: 1px solid #e5d8cf; border-radius: 12px; padding: 16px; margin: 24px 0; text-align: center;">
          <p style="font-size: 13px; color: #3e2c27; margin: 0;">
            <strong> Important :</strong> Ce lien expire dans 10 minutes pour votre sécurité.
          </p>
        </div>

        <div class="message">
          <p class="welcome-subtitle">Si vous n'avez pas créé de compte, vous pouvez ignorer cet email en toute sécurité.</p>
          <br/>
          <p><strong>Merci de nous faire confiance ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      "Vérification d'email - Inkera Studio",
      'Inkera Studio',
    
    );
  }

  /**
   *! Template de rappel de fin d'essai (J-3)
   */
  generateTrialEndingSoonEmail(data: EmailTemplateData): string {
    const details = data.trialEndingSoonDetails;
    if (!details) {
      throw new Error('trialEndingSoonDetails is required for trial ending soon email');
    }

    const billingUrl = this.sanitizeSiteUrl(
      details.billingUrl,
      '/parametres#facturation',
    );

    const content = `
      <div class="content">
        <div class="welcome-section">
          <h2 class="welcome-title">${details.isGift ? 'Votre période offerte se termine bientôt' : 'Votre essai se termine bientôt'}</h2>
        </div>

        <br/>

        <div class="message-box">
          <p class="welcome-subtitle">Bonjour ${data.recipientName || 'cher utilisateur'},</p>
          <p>
            Votre période offerte ${this.escapeHtml(details.planName || '')} sur <strong>Inkera Studio</strong>
            se termine le <strong>${details.trialEndDate}</strong>.
          </p>
          <br/>
          <p>
            ${details.isGift ? 'La facturation de votre abonnement Stripe reprendra automatiquement à cette date, au tarif de votre abonnement. Vous pouvez consulter ou résilier votre abonnement depuis vos paramètres.' : details.stripeManaged ? 'Votre abonnement est déjà souscrit. Vérifiez votre moyen de paiement avant le premier prélèvement.' : 'Pour conserver vos fonctionnalités, souscrivez à votre abonnement avant cette date. Sans souscription, votre compte repassera en formule Free à la fin de la période offerte. Aucun prélèvement automatique ne sera effectué sans souscription.'}
          </p>
        </div>

        <div style="text-align: center;">
          <a href="${billingUrl}" class="cta-button">
            ${details.stripeManaged ? 'Gérer mon abonnement' : 'Souscrire à mon abonnement'}
          </a>
        </div>

        <div style="background-color: #f5eee9; border: 1px solid #e5d8cf; border-radius: 12px; padding: 16px; margin: 24px 0; text-align: center;">
          <p style="font-size: 13px; color: #3e2c27; margin: 0;">
            <strong>À retenir :</strong> ${details.stripeManaged ? 'Vérifiez votre moyen de paiement pour éviter une interruption de votre abonnement.' : 'Souscrivez avant la date de fin pour continuer. Vos données sont conservées si votre compte repasse en Free.'}
          </p>
        </div>

        <div class="message">
          <p>Besoin d'aide ? Vous pouvez nous contacter à tout moment.</p>
          <br/>
          <p><strong>Merci de votre confiance ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content,
      `Fin d'essai imminente - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio',
    );
  }

  /**
   *! Template pour réinitialisation de mot de passe
   */
  generatePasswordResetEmail(data: EmailTemplateData): string {
    const resetUrl = this.escapeHtml(this.sanitizeSiteUrl(data.resetUrl, '/reset-password'));
    
    const content = `
      <div class="content">
        <div class="greeting">Réinitialisation de votre mot de passe </div>
        
        <div class="message">
          <p>Vous avez demandé à réinitialiser votre mot de passe pour votre compte ${data.salonName || 'Inkera Studio'}.</p>
          <p>Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe :</p>
        </div>

        <a href="${resetUrl}" class="cta-button">
          Réinitialiser mon mot de passe →
        </a>

<p style="font-size:12px;color: #3e2c27;overflow-wrap:anywhere;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><a href="${resetUrl}" style="color: #3e2c27;word-break:break-all;">${resetUrl}</a></p>
        <div class="warning-box">
          <strong>⏱ Important :</strong> Ce lien est valide pendant 15 minutes seulement.
        </div>

        <div class="message">
          <p>Si vous n'avez pas demandé cette réinitialisation, vous pouvez ignorer cet email en toute sécurité.</p>
          <p>Votre mot de passe restera inchangé.</p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Réinitialisation de mot de passe - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template pour suivi post-tatouage
   */
  generateFollowUpEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Comment va votre tatouage ? </div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher client'} !</p>
          <p>Nous espérons que vous êtes ravi(e) de votre nouveau tatouage ! </p>
        </div>

        ${data.followUpDetails ? `
          <div class="details-card">
            <div class="details-title"> Votre dernier rendez-vous</div>
            <ul class="details-list">
              <li>
                <span class="detail-label"> Date :</span>
                <span class="detail-value">${data.followUpDetails.appointmentDate}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Il y a :</span>
                <span class="detail-value">${data.followUpDetails.daysSince} jours</span>
              </li>
            </ul>
          </div>
        ` : ''}

        ${data.followUpDetails?.instructions ? `
          <div class="appointment-summary">
            <div class="details-title"> Conseils de soin</div>
            <p style="color: #3e2c27; margin: 0;">${data.followUpDetails.instructions}</p>
          </div>
        ` : `
          <div class="appointment-summary">
            <div class="details-title"> Conseils de soin</div>
            <ul style="color: #3e2c27; margin: 0; padding-left: 20px;">
              <li>Nettoyez délicatement avec un savon neutre</li>
              <li>Appliquez une crème cicatrisante recommandée</li>
              <li>Évitez les bains et la piscine pendant 2 semaines</li>
              <li>Protégez du soleil direct</li>
            </ul>
          </div>
        `}

        <div class="message">
          <p>Si vous avez des questions ou préoccupations concernant la cicatrisation, n'hésitez pas à nous contacter.</p>
          <p><strong>Prenez soin de vous et de votre tatouage ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Suivi de votre tatouage - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template pour modification de rendez-vous
   */
  generateAppointmentModificationEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Rendez-vous modifié ! </div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher client'} !</p>
          <p>Votre rendez-vous a été <strong>modifié avec succès</strong>.</p>
          <p>Voici les nouveaux détails :</p>
        </div>

        ${data.appointmentDetails?.venue ? `<p style="padding: 12px; background: #f6f3f0; border-radius: 8px;"><strong>Lieu du rendez-vous :</strong> ${this.escapeVenue(data.appointmentDetails.venue)}</p>` : ''}
        ${data.appointmentDetails ? `
          <div class="details-card">
            <div class="details-title"> Nouveaux détails du rendez-vous</div>
            <ul class="details-list">
              <li>
                <span class="detail-label"> Nouvelle date :</span>
                <span class="detail-value">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Nouvelle heure :</span>
                <span class="detail-value">${data.appointmentDetails.time}</span>
              </li>
              <li>
                <span class="detail-label"> Prestation :</span>
                <span class="detail-value">${data.appointmentDetails.service}</span>
              </li>
              ${data.appointmentDetails.tatoueur ? `
                <li>
                  <span class="detail-label"> Artiste :</span>
                  <span class="detail-value">${data.appointmentDetails.tatoueur}</span>
                </li>
              ` : ''}
              ${data.appointmentDetails.visio && data.appointmentDetails.visioRoom ? `
                <li>
                  <span class="detail-label"> Visioconférence :</span>
                  <span class="detail-value">
                    <a href="${this.sanitizeSiteUrl(data.appointmentDetails.visioRoom, '/dashboard')}" 
                       class="cta-button" style="padding: 8px 16px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; margin-top: 8px;">
                       Rejoindre la visioconférence
                    </a>
                  </span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        <div class="warning-box">
          <strong> N'oubliez pas :</strong> Notez bien ces nouvelles informations dans votre agenda !
        </div>

        <div class="message">
          <p>Si vous avez des questions concernant cette modification, n'hésitez pas à nous contacter.</p>
          <p><strong>À bientôt chez ${data.salonName || 'Inkera Studio'} ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Modification de rendez-vous - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template pour annulation de rendez-vous
   */
  generateAppointmentCancellationEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Rendez-vous annulé </div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher client'} !</p>
          <p>Nous vous confirmons que votre rendez-vous a été <strong>annulé</strong> comme demandé.</p>
        </div>

        ${data.appointmentDetails?.venue ? `<p style="padding: 12px; background: #f6f3f0; border-radius: 8px;"><strong>Lieu du rendez-vous :</strong> ${this.escapeVenue(data.appointmentDetails.venue)}</p>` : ''}
        ${data.appointmentDetails ? `
          <div class="details-card">
            <div class="details-title"> Rendez-vous annulé</div>
            <ul class="details-list">
              <li>
                <span class="detail-label"> Date :</span>
                <span class="detail-value">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Heure :</span>
                <span class="detail-value">${data.appointmentDetails.time}</span>
              </li>
              <li>
                <span class="detail-label"> Prestation :</span>
                <span class="detail-value">${data.appointmentDetails.service}</span>
              </li>
            </ul>
          </div>
        ` : ''}

        ${data.customMessage ? `
          <div style="background-color: #f5eee9; border-left: 4px solid #e5d8cf; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0 0 8px 0; color: #3e2c27; font-weight: 600;"> Message du salon :</p>
            <p style="margin: 0; color: #3e2c27; font-style: italic;">"${data.customMessage}"</p>
          </div>
        ` : ''}

        <div class="message">
          <p>Nous serions ravis de vous accueillir à nouveau chez ${data.salonName || 'Inkera Studio'} quand vous le souhaiterez !</p>
          <p>N'hésitez pas à reprendre rendez-vous à tout moment.</p>
        </div>

        <div class="message">
          <p><strong>À bientôt chez ${data.salonName || 'Inkera Studio'} ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Annulation de rendez-vous - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template pour message admin envoyé à un utilisateur
   */
  generateAdminMessageEmail(data: EmailTemplateData & { subject: string }): string {
    const content = `
      <div class="content">
        <div class="greeting">Bonjour ${data.recipientName || 'cher utilisateur'} </div>

        <div class="message">
          <p>Vous recevez ce message de la part de l'équipe <strong>Inkera Studio</strong>.</p>
        </div>

<div style="background-color: #f5eee9; border: 2px solid #e5d8cf; border-radius: 12px; padding: 25px; margin: 25px 0;">
        <div class="details-title">${data.subject}</div>
        <div style="margin-top: 12px; line-height: 1.8; white-space: pre-wrap; color: #3e2c27; font-family: 'Didact Gothic', Arial, Helvetica, sans-serif; font-size: 16px;">${data.customMessage || ''}</div>
        </div>

        <div class="message" style="margin-top: 30px;">
          <p>Si vous avez des questions ou avez besoin d'assistance, n'hésitez pas à répondre à cet email.</p>
          <p style="margin-top: 12px;"><strong>L'équipe Inkera Studio </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content,
      data.subject,
      'Inkera Studio',
    );
  }

  /**
   *! Template pour message de contact reçu depuis le profil public
   */
  generatePublicContactEmail(data: EmailTemplateData): string {
    const details = data.publicContactDetails;

    const content = `
      <div class="content">
        <div class="greeting">Nouveau message depuis votre profil public </div>

        <div class="message">
          <p>Vous avez reçu une nouvelle demande de contact pour <strong>${data.salonName || 'votre profil'}</strong>.</p>
        </div>

        <div class="details-card">
          <div class="details-title"> Détails du message</div>
          <ul class="details-list">
            <li>
              <span class="detail-label"> Nom :</span>
              <span class="detail-value">${details?.senderFullName || 'Non renseigné'}</span>
            </li>
            <li>
              <span class="detail-label"> Email :</span>
              <span class="detail-value">${details?.senderEmail || 'Non renseigné'}</span>
            </li>
            <li>
              <span class="detail-label"> Partie du corps :</span>
              <span class="detail-value">${details?.bodyPart || 'Non renseigné'}</span>
            </li>
          </ul>
        </div>

        <div style="background-color: #f5eee9; border: 2px solid #e5d8cf; border-radius: 12px; padding: 25px; margin: 25px 0;">
          <div class="details-title"> Description du projet</div>
          <div style="margin-top: 12px; line-height: 1.8; white-space: pre-wrap; color: #3e2c27; font-family: 'Didact Gothic', Arial, Helvetica, sans-serif; font-size: 16px;">${details?.projectDescription || ''}</div>
          ${details?.sourceIp ? `<div style="margin-top: 16px; font-size: 12px; color: #3e2c27;">IP source: ${details.sourceIp}</div>` : ''}
        </div>

        <div class="message">
          <p>Vous pouvez répondre directement à cet email pour reprendre contact avec la personne.</p>
          <p style="margin-top: 12px;"><strong>L'équipe Inkera Studio </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content,
      `Nouveau message de contact - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio',
    );
  }

  /**
   *! Template générique pour messages personnalisés
   */
  generateCustomEmail(data: EmailTemplateData, subject: string = `Message de ${data.salonName || 'Inkera Studio'}`): string {
    const content = `
      <div class="content">
        <div class="greeting">Bonjour ${data.recipientName || 'cher client'} ! </div>
        
        <div class="message">
          ${data.customMessage || `<p>Nous vous contactons depuis ${data.salonName || 'Inkera Studio'}.</p>`}
        </div>

        <div class="message">
          <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p><strong>L'équipe ${data.salonName || 'Inkera Studio'} </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      subject, 
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template pour notification de rendez-vous en attente (salon)
   */
  generatePendingAppointmentNotificationEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Nouveau rendez-vous en attente ! ⏰</div>
        
        <div class="message">
          <p>Un nouveau rendez-vous nécessite votre confirmation dans votre salon <strong>${data.salonName || 'Inkera Studio'}</strong>.</p>
        </div>

        ${data.appointmentDetails?.venue ? `<p style="padding: 12px; background: #f6f3f0; border-radius: 8px;"><strong>Lieu du rendez-vous :</strong> ${this.escapeVenue(data.appointmentDetails.venue)}</p>` : ''}
        ${data.appointmentDetails ? `
          <div class="details-card">
            <div class="details-title"> Détails du rendez-vous</div>
            <ul class="details-list">
              <li>
                <span class="detail-label"> Client :</span>
                <span class="detail-value">${data.recipientName || 'Nouveau client'}</span>
              </li>
              <li>
                <span class="detail-label"> Email :</span>
                <span class="detail-value">${data.appointmentDetails.clientEmail || 'Non renseigné'}</span>
              </li>
              <li>
                <span class="detail-label"> Téléphone :</span>
                <span class="detail-value">${data.appointmentDetails.clientPhone || 'Non renseigné'}</span>
              </li>
              <li>
                <span class="detail-label"> Date :</span>
                <span class="detail-value">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Heure :</span>
                <span class="detail-value">${data.appointmentDetails.time}</span>
              </li>
              <li>
                <span class="detail-label"> Prestation :</span>
                <span class="detail-value">${data.appointmentDetails.service}</span>
              </li>
              <li>
                <span class="detail-label"> Titre :</span>
                <span class="detail-value">${data.appointmentDetails.title || 'Non renseigné'}</span>
              </li>
            </ul>
          </div>
        ` : ''}

        <a href="${this.buildFrontendUrl('/dashboard')}" class="cta-button">
           Confirmer le rendez-vous
        </a>

        <div class="message">
          <p>Connectez-vous à votre espace pour confirmer ou modifier ce rendez-vous.</p>
          <p><strong>Action requise ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Nouveau rendez-vous en attente - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template pour confirmation automatique de rendez-vous (client)
   */
  generateAutoConfirmedAppointmentEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Rendez-vous confirmé automatiquement ! </div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher client'} !</p>
          <p>Votre rendez-vous a été <strong>confirmé automatiquement</strong>.</p>
          <p>Nous avons hâte de vous voir ! </p>
        </div>

        ${data.appointmentDetails?.venue ? `<p style="padding: 12px; background: #f6f3f0; border-radius: 8px;"><strong>Lieu du rendez-vous :</strong> ${this.escapeVenue(data.appointmentDetails.venue)}</p>` : ''}
        ${data.appointmentDetails ? `
          <div class="details-card">
            <div class="details-title"> Détails de votre rendez-vous</div>
            <ul class="details-list">
              <li>
                <span class="detail-label"> Date :</span>
                <span class="detail-value">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Heure :</span>
                <span class="detail-value">${data.appointmentDetails.time}</span>
              </li>
              <li>
                <span class="detail-label"> Prestation :</span>
                <span class="detail-value">${data.appointmentDetails.service}</span>
              </li>
              <li>
                <span class="detail-label"> Titre :</span>
                <span class="detail-value">${data.appointmentDetails.title || 'Non renseigné'}</span>
              </li>
              ${data.appointmentDetails.tatoueur ? `
                <li>
                  <span class="detail-label"> Artiste :</span>
                  <span class="detail-value">${data.appointmentDetails.tatoueur}</span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        <div class="warning-box">
          <strong> Important :</strong> Merci d'arriver 10 minutes avant votre rendez-vous et de vous présenter avec une pièce d'identité.
        </div>

        <div class="message">
          <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p><strong>À très bientôt chez ${data.salonName || 'Inkera Studio'} ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Rendez-vous confirmé - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   * Template pour proposition de reprogrammation
   */
  generateRescheduleProposalEmail(data: EmailTemplateData): string {
    const reschedule = data.rescheduleDetails;
    if (!reschedule) {
      throw new Error('rescheduleDetails are required for reschedule proposal email');
    }

    const content = `
      <div class="content">
        <div class="greeting">Reprogrammation de votre rendez-vous </div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher client'},</p>
          <p>Nous devons reprogrammer votre rendez-vous chez ${data.salonName || 'Inkera Studio'}.</p>
        </div>

        <div class="details-card">
          <h3 style="color: #3e2c27; margin: 0 0 16px 0;"> Rendez-vous actuel</h3>
          <div style="background-color: #f5eee9; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px 0; color: #3e2c27;"><strong> Date :</strong> ${reschedule.currentDate}</p>
            ${reschedule.oldTatoueurName ? `<p style="margin: 0 0 8px 0; color: #3e2c27;"><strong> Tatoueur :</strong> ${reschedule.oldTatoueurName}</p>` : ''}
            ${reschedule.newTatoueurName ? `<p style="margin: 0; color: #3e2c27;"><strong> Nouveau tatoueur :</strong> ${reschedule.newTatoueurName}</p>` : ''}
          </div>
        </div>

        ${reschedule.reason ? `
          <div style="background-color: #f5eee9; border-left: 4px solid #e5d8cf; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0 0 8px 0; color: #3e2c27; font-weight: 600;">Motif de la reprogrammation :</p>
            <p style="margin: 0; color: #3e2c27; font-style: italic;">${reschedule.reason}</p>
          </div>
        ` : ''}

        <div style="text-align: center; margin: 32px 0;">
          <a href="${this.sanitizeSiteUrl(reschedule.rescheduleUrl, '/nouveau-creneau')}" class="cta-button">
             Choisir de nouveaux créneaux
          </a>
        </div>

        <div class="warning-box">
          <strong>⏰ Important :</strong> Ce lien expire dans 7 jours. Veuillez choisir vos nouveaux créneaux rapidement.
        </div>

        <div class="message">
          <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p><strong>Merci de votre compréhension ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Reprogrammation nécessaire - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template pour notification d'acceptation de reprogrammation (pour le salon)
   */
  generateRescheduleAcceptedNotificationEmail(data: EmailTemplateData): string {
    const reschedule = data.rescheduleAcceptedDetails;
    if (!reschedule) {
      throw new Error('rescheduleAcceptedDetails are required for reschedule accepted notification email');
    }

    const content = `
      <div class="content">
        <div class="greeting" style="background-color: #f5eee9; color: #3e2c27; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
           Reprogrammation Acceptée
        </div>
        
        <div class="message">
          <p>Bonjour <strong>${data.salonName || 'Salon'}</strong>,</p>
          <p> Le client <strong>${reschedule.clientName}</strong> a accepté la reprogrammation et choisi un nouveau créneau !</p>
        </div>

        <div class="details-card">
          <h3 class="details-title"> Détails de la reprogrammation</h3>
          <div style="background-color: #f5eee9; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px 0; color: #3e2c27;"><strong> Ancien créneau :</strong> ${reschedule.originalDate}</p>
            <p style="margin: 0 0 8px 0; color: #3e2c27;"><strong> Nouveau créneau :</strong> ${reschedule.newDate}</p>
            <p style="margin: 0; color: #3e2c27;"><strong> Tatoueur :</strong> ${reschedule.tatoueurName}</p>
          </div>
        </div>

        <div class="details-card">
          <h3 class="details-title"> Informations du client</h3>
          <div style="background-color: #f5eee9; padding: 12px; border-radius: 6px;">
            <p style="margin: 0 0 4px 0; color: #3e2c27;"><strong>Nom :</strong> ${reschedule.clientName}</p>
            <p style="margin: 0 0 4px 0; color: #3e2c27;"><strong>Email :</strong> ${reschedule.clientEmail}</p>
            <p style="margin: 0; color: #3e2c27;"><strong>Prestation :</strong> ${reschedule.prestation}</p>
          </div>
        </div>

        ${reschedule.clientMessage ? `
          <div style="background-color: #f5eee9; border-left: 4px solid #e5d8cf; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0 0 8px 0; color: #3e2c27; font-weight: 600;"> Message du client :</p>
            <p style="margin: 0; color: #3e2c27; font-style: italic;">"${reschedule.clientMessage}"</p>
          </div>
        ` : ''}

        <div class="message">
          <p>Le rendez-vous a été automatiquement mis à jour dans votre planning.</p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Reprogrammation acceptée - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template pour confirmation de reprogrammation (pour le client)
   */
  generateRescheduleConfirmationEmail(data: EmailTemplateData): string {
    const reschedule = data.rescheduleConfirmationDetails;
    if (!reschedule) {
      throw new Error('rescheduleConfirmationDetails are required for reschedule confirmation email');
    }

    const content = `
      <div class="content">
        <div class="greeting" style="background-color: #f5eee9; color: #3e2c27; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
           Rendez-vous Reprogrammé !
        </div>
        
        <div class="message">
          <p>Bonjour <strong>${data.recipientName || 'cher client'}</strong>,</p>
          <p> Parfait ! Votre rendez-vous a été reprogrammé avec succès chez ${data.salonName || 'Inkera Studio'}.</p>
        </div>

        <div class="details-card">
          <div class="details-title" style="color: #3e2c27;"> Votre nouveau rendez-vous</div>
          <div style="background-color: #f5eee9; padding: 16px; border-radius: 8px;">
            <p style="margin: 0 0 8px 0; color: #3e2c27;"><strong> Nouvelle date :</strong> ${reschedule.newDate}</p>
            <p style="margin: 0; color: #3e2c27;"><strong> Tatoueur :</strong> ${reschedule.tatoueurName}</p>
          </div>
        </div>

        <div style="background-color: #f5eee9; border: 1px solid #e5d8cf; padding: 16px; border-radius: 8px; margin: 24px 0; text-align: center;">
          <p style="margin: 0; color: #3e2c27; font-size: 16px;">
             <strong>Confirmé :</strong> Votre rendez-vous est maintenant confirmé pour le nouveau créneau.
          </p>
        </div>

        <div class="warning-box">
          <strong> Important :</strong> Notez bien cette nouvelle date dans votre agenda !
        </div>

        <div class="message">
          <p>Merci pour votre flexibilité ! Nous avons hâte de vous voir. </p>
          <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p><strong>À très bientôt chez ${data.salonName || 'Inkera Studio'} ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Rendez-vous reprogrammé - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template de réponse au follow-up du client
   */
  generateFollowUpResponseEmail(data: EmailTemplateData): string {
    const details = data.followUpResponseDetails;
    if (!details) {
      throw new Error('followUpResponseDetails is required for follow-up response email');
    }

    const content = `
      <div class="content">
        <div class="greeting">Réponse à votre suivi de cicatrisation </div>
        
        <div class="message">
          <p>Bonjour <strong>${details.clientName}</strong>,</p>
          <p>Merci pour votre photo et votre avis concernant votre ${details.prestationName.toLowerCase()} réalisé par ${details.tatoueurName} !</p>
        </div>

        <div class="details-card">
          <div class="details-title" style="color: #3e2c27;"> Notre réponse</div>
          <div style="background-color: #f5eee9; padding: 20px; border-radius: 8px;">
            <p style="margin: 0; color: #3e2c27; font-size: 16px; line-height: 1.6;">${details.response}</p>
          </div>
        </div>

        <div class="message">
          <p>Nous espérons que ces informations vous seront utiles. N'hésitez pas à nous contacter si vous avez d'autres questions.</p>
          <p>Cordialement,<br><strong>L'équipe de ${data.salonName || 'Inkera Studio'}</strong></p>
        </div>

        <div class="warning-box" style="background-color: #f5eee9; border-left: 4px solid #e5d8cf; color: #3e2c27;">
          <strong> Information :</strong> Cet email est une réponse à votre suivi de cicatrisation. Si vous n'avez pas envoyé de suivi, veuillez nous contacter.
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Réponse à votre suivi - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template de demande de suivi de cicatrisation
   */
  generateCicatrisationFollowUpEmail(data: EmailTemplateData): string {
    const details = data.cicatrisationFollowUpDetails;
    if (!details) {
      throw new Error('cicatrisationFollowUpDetails is required for cicatrisation follow-up email');
    }

    const content = `
      <div class="content">
        <div class="greeting">Suivi de cicatrisation </div>
        
        <div class="message">
          <p>Bonjour <strong>${details.clientName}</strong>,</p>
          <p>Merci pour votre visite chez ${data.salonName || 'Inkera Studio'} !</p>
          <p>Votre ${details.prestationName.toLowerCase()} avec ${details.tatoueurName} s'est bien déroulé.</p>
        </div>

        <div class="details-card">
          <div class="details-title"> Suivi de cicatrisation</div>
          <p><strong>Pour assurer un suivi optimal de votre cicatrisation, nous aimerions avoir de vos nouvelles :</strong></p>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${this.sanitizeSiteUrl(details.followUpUrl, '/suivi')}" class="cta-button">
            Envoyer ma photo et mon avis
          </a>
        </div>

        <div class="warning-box">
          <strong>⏰ Important :</strong> Ce lien est valable pendant 14 jours. Votre photo nous aidera à vérifier que la cicatrisation se déroule bien.
        </div>

        <div class="message">
          <p>Si vous avez des questions ou des préoccupations, n'hésitez pas à nous contacter directement.</p>
          <p><strong>${data.salonName || 'Inkera Studio'}</strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Suivi de cicatrisation - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   * ! Template de demande d'avis client
   */
  generateFeedbackRequestEmail(data: EmailTemplateData): string {
    const details = data.feedbackRequestDetails;
    if (!details) {
      throw new Error('feedbackRequestDetails is required for feedback request email');
    }

    const content = `
      <div class="content">
        <div class="greeting">Votre avis nous intéresse ! </div>
        
        <div class="message">
          <p>Bonjour <strong>${details.clientName}</strong> !</p>
          <p>Nous espérons que votre <strong>${details.prestationName.toLowerCase()}</strong> s'est bien passé(e) !</p>
        </div>

        <div class="details-card">
          <div class="details-title"> Détails de votre rendez-vous</div>
          <ul class="details-list">
            <li>
              <span class="detail-label"> Date :</span>
              <span class="detail-value">${details.appointmentDate}</span>
            </li>
            <li>
              <span class="detail-label"> Artiste :</span>
              <span class="detail-value">${details.tatoueurName}</span>
            </li>
            <li>
              <span class="detail-label"> Prestation :</span>
              <span class="detail-value">${details.prestationName}</span>
            </li>
          </ul>
        </div>

        <div class="message">
          <p>Votre avis nous intéresse ! Pouvez-vous prendre quelques minutes pour nous faire un retour ?</p>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${this.sanitizeSiteUrl(details.followupUrl, '/suivi')}" class="cta-button">
             Laisser mon avis
          </a>
        </div>

        <div class="warning-box">
          <strong>⏰ Important :</strong> Ce lien expire dans 7 jours. Si vous avez des questions, n'hésitez pas à nous contacter.
        </div>

        <div class="message">
          <p>Merci pour votre confiance ! </p>
          <p><strong>L'équipe de ${data.salonName || 'Inkera Studio'}</strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Comment s'est passé votre ${details.prestationName.toLowerCase()} ? - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   * ! Template pour confirmation de changement de mot de passe
   */
  generatePasswordChangeConfirmationEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Mot de passe modifié </div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher utilisateur'} !</p>
          <p>Nous vous confirmons que votre mot de passe a été <strong>modifié avec succès</strong> pour votre compte ${data.salonName || 'Inkera Studio'}.</p>
        </div>

        <div class="details-card">
          <div class="details-title"> Informations de sécurité</div>
          <ul class="details-list">
            <li>
              <span class="detail-label">⏰ Date de modification :</span>
              <span class="detail-value">${new Date().toLocaleDateString('fr-FR', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit' 
              })}</span>
            </li>
            <li>
              <span class="detail-label"> Action :</span>
              <span class="detail-value">Changement de mot de passe</span>
            </li>
            <li>
              <span class="detail-label"> Statut :</span>
              <span class="detail-value">Confirmé</span>
            </li>
          </ul>
        </div>

        <div class="warning-box">
          <strong> Vous n'êtes pas à l'origine de ce changement ?</strong><br/>
          Contactez immédiatement notre support pour sécuriser votre compte.
        </div>

        <div class="message">
          <p>Votre nouveau mot de passe est maintenant actif. Vous pouvez vous connecter à votre espace de gestion avec vos nouveaux identifiants.</p>
          <p>Pour votre sécurité, nous vous recommandons de :</p>
          <ul style="margin: 12px 0; padding-left: 20px; color: #3e2c27;">
            <li>Ne pas partager votre mot de passe</li>
            <li>Utiliser un mot de passe unique pour votre compte</li>
            <li>Vous déconnecter après chaque session</li>
          </ul>
        </div>

        <a href="${this.buildFrontendUrl('/connexion')}" class="cta-button">
           Se connecter à mon espace
        </a>

        <div class="message">
          <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p><strong>Merci de votre confiance ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Mot de passe modifié - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   * ! Template de rappel pour retouches tatouage (1 mois après)
   */
  generateRetouchesReminderEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Comment va votre tatouage ? </div>
        
        <div class="message">
          <p>Bonjour ${data.retouchesReminderDetails?.clientName || data.recipientName || 'cher client'} !</p>
          <p>Cela fait maintenant <strong>un mois</strong> depuis votre séance de tatouage chez ${data.retouchesReminderDetails?.salonName || data.salonName || 'notre salon'}.</p>
          <p>Nous espérons que vous êtes totalement ravi(e) du résultat ! </p>
        </div>

        ${data.retouchesReminderDetails ? `
          <div class="details-card">
            <div class="details-title"> Votre séance de tatouage</div>
            <ul class="details-list">
              <li>
                <span class="detail-label"> Date :</span>
                <span class="detail-value">${data.retouchesReminderDetails.appointmentDate}</span>
              </li>
              <li>
                <span class="detail-label"> Artiste :</span>
                <span class="detail-value">${data.retouchesReminderDetails.tatoueurName}</span>
              </li>
            </ul>
          </div>
        ` : ''}

        <div style="margin: 25px 0; padding: 20px; background-color: #f5eee9; border: 1px solid #e5d8cf; border-radius: 12px; color: #3e2c27;">
          <div class="details-title"> Retouches gratuites disponibles</div>
          <div class="message" style="color: #3e2c27; margin: 15px 0;">
            <p style="margin-bottom: 12px;">Si vous constatez que votre tatouage a besoin d'une petite retouche ? (zones moins pigmentées, traits à reprendre...)</p>
            
            <p style="margin-bottom: 12px;"><strong>Les retouches peuvent être nécessaires dans les cas suivants :</strong></p>
            <ul style="margin: 8px 0; padding-left: 20px; color: #3e2c27;">
              <li>Zones où l'encre n'a pas bien tenu</li>
              <li>Traits qui ont légèrement bavé pendant la cicatrisation</li>
              <li>Petites imperfections de cicatrisation</li>
              <li>Zones où la couleur paraît moins intense</li>
            </ul>
          </div>
        </div>

        <!--
        <div style="background-color: #f5eee9; border-left: 4px solid #e5d8cf; padding: 20px; border-radius: 8px; margin: 24px 0;">
          <p style="margin: 0 0 8px 0; color: #3e2c27; font-weight: 600;"> Service inclus :</p>
          <p style="margin: 0; color: #3e2c27; font-weight: 600;">Les retouches sont entièrement gratuites pendant 3 mois !</p>
        </div>
        -->

        <div class="message">
          <p>Si vous souhaitez programmer une retouche ou si vous avez des questions concernant votre tatouage, n'hésitez pas à nous contacter.</p>
          <p>Nous serons ravis de vous accueillir à nouveau pour parfaire votre œuvre d'art ! </p>
        </div>

        <a href="${this.buildFrontendUrl('/contactez-nous')}" class="cta-button">
           Nous contacter pour une retouche
        </a>

        <!--
        <div class="warning-box">
          <strong>⏰ Important :</strong> Les retouches gratuites sont disponibles uniquement pendant les 3 premiers mois suivant votre tatouage.
        </div>
        -->

        <div class="message">
          <p><strong>Merci de nous faire confiance pour vos créations artistiques ! </strong></p>
          <p><em>${data.retouchesReminderDetails?.salonName || data.salonName || 'Inkera Studio'}</em></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Retouches gratuites disponibles - ${data.retouchesReminderDetails?.salonName || data.salonName || 'Inkera Studio'}`,
      data.retouchesReminderDetails?.salonName || data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template pour notification d'inscription à l'administrateur
   */
  generateAdminNewUserNotificationEmail(data: EmailTemplateData): string {
    const newUser = data.newUserDetails;
    if (!newUser) {
      throw new Error('newUserDetails are required for admin new user notification email');
    }

    const content = `
      <div class="content">
        <div class="greeting" style="background-color: #f5eee9; color: #3e2c27; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
           Nouvelle Inscription !
        </div>
        
        <div class="message">
          <p>Bonjour <strong>Admin</strong>,</p>
          <p>Une nouvelle inscription vient d'avoir lieu sur la plateforme Inkera Studio ! </p>
        </div>

        <div class="details-card">
          <div class="details-title"> Informations du nouveau salon</div>
          <ul class="details-list">
            <li>
              <span class="detail-label">Nom du salon : </span>
              <span class="detail-value">${newUser.salonName}</span>
            </li>
            <li>
              <span class="detail-label">Email : </span>
              <span class="detail-value">${newUser.userEmail}</span>
            </li>
            <li>
              <span class="detail-label">Plan SaaS : </span>
              <span class="detail-value">${newUser.saasPlan}</span>
            </li>
            <li>
              <span class="detail-label">Date d'inscription : </span>
              <span class="detail-value">${newUser.registrationDate}</span>
            </li>
            ${newUser.firstName && newUser.lastName ? `
              <li>
                <span class="detail-label">Nom complet : </span>
                <span class="detail-value">${newUser.firstName} ${newUser.lastName}</span>
              </li>
            ` : ''}
            ${newUser.phone ? `
              <li>
                <span class="detail-label">Téléphone : </span>
                <span class="detail-value">${newUser.phone}</span>
              </li>
            ` : ''}
          </ul>
        </div>

        <div style="background-color: #f5eee9; border: 1px solid #e5d8cf; border-radius: 12px; padding: 16px; margin: 24px 0; text-align: center;">
          <p style="margin: 0; color: #3e2c27; font-size: 16px; font-weight: 600;">
            <strong>Action recommandée :</strong> Surveiller l'activation et l'utilisation du nouveau compte
          </p>
        </div>

        <div class="appointment-summary">
          <div class="details-title"> Actions à effectuer</div>
          <ul style="color: #3e2c27; margin: 15px 0; padding-left: 20px;">
            <li>Vérifier que l'email de vérification a été envoyé</li>
            <li>Surveiller l'activation du compte</li>
            <li>Confirmer la création du plan SaaS (${newUser.saasPlan})</li>
            <li>Éventuellement contacter le salon pour l'accompagnement</li>
          </ul>
        </div>

        <a href="${this.buildFrontendUrl(`${BACK_OFFICE_PATH}/users`)}" class="cta-button">
          Voir dans l'admin
        </a>

        <div class="warning-box">
          <strong> Note :</strong> Ce salon devra vérifier son email avant de pouvoir accéder à son espace de gestion.
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Nouvelle inscription - ${newUser.salonName}`, 
      'Inkera Studio - Admin'
    );
  }

  /**
   *! Template pour notification d'annulation de RDV par le client (SALON)
   */
  generateClientCancellationNotificationEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Annulation de rendez-vous</div>
        
        <div class="message">
          <p>Bonjour,</p>
          <p><strong>${data.clientCancellationDetails?.clientName || 'Un client'}</strong> a annulé son rendez-vous.</p>
        </div>

        ${data.clientCancellationDetails ? `
          <div class="details-card">
            <div class="details-title"> Détails du rendez-vous annulé</div>
            <ul class="details-list">
              <li>
                <span class="detail-label"> Client :</span>
                <span class="detail-value">${data.clientCancellationDetails.clientName}</span>
              </li>
              ${data.clientCancellationDetails.clientEmail ? `
                <li>
                  <span class="detail-label"> Email :</span>
                  <span class="detail-value">${data.clientCancellationDetails.clientEmail}</span>
                </li>
              ` : ''}
              ${data.clientCancellationDetails.clientPhone ? `
                <li>
                  <span class="detail-label"> Téléphone :</span>
                  <span class="detail-value">${data.clientCancellationDetails.clientPhone}</span>
                </li>
              ` : ''}
              <li>
                <span class="detail-label"> Date :</span>
                <span class="detail-value">${data.clientCancellationDetails.appointmentDate}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Heure :</span>
                <span class="detail-value">${data.clientCancellationDetails.appointmentTime}</span>
              </li>
              <li>
                <span class="detail-label"> Prestation :</span>
                <span class="detail-value">${data.clientCancellationDetails.prestation}</span>
              </li>
              ${data.clientCancellationDetails.tatoueurName ? `
                <li>
                  <span class="detail-label"> Artiste :</span>
                  <span class="detail-value">${data.clientCancellationDetails.tatoueurName}</span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        ${data.clientCancellationDetails?.cancellationReason ? `
          <div style="background-color: #f5eee9; border-left: 4px solid #e5d8cf; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0 0 8px 0; color: #3e2c27; font-weight: 600;"> Raison de l'annulation :</p>
            <p style="margin: 0; color: #3e2c27; font-style: italic;">"${data.clientCancellationDetails.cancellationReason}"</p>
          </div>
        ` : ''}

        <div style="background-color: #f5eee9; color: #3e2c27; padding: 20px; border-radius: 10px; margin: 20px 0; text-align: center;">
          <p style="margin: 0; font-weight: 600;"> Ce créneau est maintenant disponible</p>
          <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Vous pouvez l'attribuer à un autre client</p>
        </div>

        <div class="message">
          <p>Cette annulation a été effectuée directement par le client depuis son espace personnel.</p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content,
      `Annulation de rendez-vous - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template pour confirmation d'annulation au client
   */
  generateClientCancellationConfirmationEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Annulation confirmée</div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher client'},</p>
          <p>Votre rendez-vous a bien été <strong>annulé</strong> comme demandé.</p>
        </div>

        ${data.clientCancellationDetails ? `
          <div class="details-card">
            <div class="details-title"> Récapitulatif du rendez-vous annulé</div>
            <ul class="details-list">
              <li>
                <span class="detail-label"> Salon :</span>
                <span class="detail-value">${data.salonName || 'Inkera Studio'}</span>
              </li>
              <li>
                <span class="detail-label"> Date :</span>
                <span class="detail-value">${data.clientCancellationDetails.appointmentDate}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Heure :</span>
                <span class="detail-value">${data.clientCancellationDetails.appointmentTime}</span>
              </li>
              <li>
                <span class="detail-label"> Prestation :</span>
                <span class="detail-value">${data.clientCancellationDetails.prestation}</span>
              </li>
              ${data.clientCancellationDetails.tatoueurName ? `
                <li>
                  <span class="detail-label"> Artiste :</span>
                  <span class="detail-value">${data.clientCancellationDetails.tatoueurName}</span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        <div style="background-color: #f5eee9; color: #3e2c27; padding: 25px; border-radius: 15px; margin: 25px 0; text-align: center;">
          <p style="margin: 0 0 12px 0; font-size: 18px; font-weight: 600;"> Nous restons à votre disposition</p>
          <p style="margin: 0; font-size: 14px; opacity: 0.9; line-height: 1.6;">
            Si vous souhaitez reprendre rendez-vous ou si vous avez des questions,<br>
            n'hésitez pas à nous contacter.
          </p>
        </div>

        <div class="message">
          <p>Nous espérons vous revoir bientôt chez <strong>${data.salonName || 'Inkera Studio'}</strong> ! </p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content,
      `Confirmation d'annulation - ${data.salonName || 'Inkera Studio'}`,
      data.salonName || 'Inkera Studio'
    );
  }

  /**
   *! Template pour vérification d'email CLIENT
   */
  generateClientEmailVerificationEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="welcome-section">
          <h2 class="welcome-title">Bienvenue sur Inkera Studio ! </h2>
        </div>

        <br/>
        
        <div class="message-box">
          <p class="welcome-subtitle">Bonjour ${data.recipientName || 'cher client'},</p>
          <p><strong>Félicitations !</strong> Votre compte client a été créé avec succès sur Inkera Studio.</p>
          <br/>
          <p>Vous pouvez maintenant prendre rendez-vous facilement avec vos salons de tatouage préférés, suivre l'évolution de vos tatouages et bien plus encore !</p>
          <br/>
          <p>Pour accéder à toutes ces fonctionnalités, veuillez confirmer votre adresse email en cliquant sur le bouton ci-dessous :</p>
        </div>
        
        ${data.verificationUrl ? `
          <div style="text-align: center;">
            <a href="${this.sanitizeSiteUrl(data.verificationUrl, '/verifier-email')}" class="cta-button">
               Confirmer mon adresse email
            </a>
          </div>
        ` : ''}
        
        ${data.verificationToken ? `
          <div class="token-display">
            <p style="font-size:13px;letter-spacing:0;font-weight:400;margin:0 0 10px;">Code de vérification</p>
            ${data.verificationToken}
          </div>
        ` : ''}
        
        <div class="info-grid">
          <div class="info-item">
            <div class="info-item-label"> Expiration dans 10min | Lien unique</div>
          </div>
        </div>
        
        <div class="details-card">
          <div class="details-title"> Ce que vous pouvez faire maintenant :</div>
          <ul style="list-style: none; padding: 0; color: #3e2c27;">
            <li style="padding: 8px 0;  ">
              <span style="margin-right: 10px;"></span>
              <span>Prendre rendez-vous dans vos salons préférés</span>
            </li>
            <li style="padding: 8px 0;  ">
              <span style="margin-right: 10px;"></span>
              <span>Ajouter vos salons en favoris</span>
            </li>
            <li style="padding: 8px 0;  ">
              <span style="margin-right: 10px;"></span>
              <span>Suivre vos rendez-vous et tatouages</span>
            </li>
            <li style="padding: 8px 0;  ">
              <span style="margin-right: 10px;">⭐</span>
              <span>Laisser des avis sur vos expériences</span>
            </li>
          </ul>
        </div>
        
        <div style="background-color: #f5eee9; border: 1px solid #e5d8cf; border-radius: 12px; padding: 16px; margin: 24px 0; text-align: center;">
          <p style="font-size: 13px; color: #3e2c27; margin: 0;">
            <strong> Important :</strong> Ce lien expire dans 10 minutes pour votre sécurité.
          </p>
        </div>

        <div class="message">
          <p class="welcome-subtitle">Si vous n'avez pas créé de compte, vous pouvez ignorer cet email en toute sécurité.</p>
          <br/>
          <p><strong>Bienvenue dans la communauté Inkera ! </strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      'Vérification d\'email - Inkera Studio',
      'Inkera Studio'
    );
  }
}

