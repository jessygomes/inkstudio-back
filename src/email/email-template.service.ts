import { Injectable } from '@nestjs/common';

export interface EmailTemplateData {
  recipientName?: string;
  salonName?: string;
  // Couleurs du profil utilisateur
  colorProfile?: string;
  colorProfileBis?: string;
  appointmentDetails?: {
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


  /**
   * Template de base avec le design cohérent du site
   */
  private getBaseTemplate(content: string, title: string = 'Inkera Studio', salonName: string = 'Inkera Studio'): string {
    
    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <link href="https://fonts.googleapis.com/css2?family=Didact+Gothic&family=Exo+2:wght@300;400;500;600;700&family=Montserrat+Alternates:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Didact Gothic', sans-serif;
            background-color: #ffffff;
            color: #171717;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%);
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          }
          
          .header {
            background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%);
            padding: 30px 40px;
            text-align: center;
            position: relative;
            font-family: 'Exo 2', sans-serif;
          }
          
          .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%);
            pointer-events: none;
          }
          
          .logo {
            font-family: 'Montserrat Alternates', sans-serif;
            font-size: 32px;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 8px;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
          }
          
          .tagline {
            font-family: 'Didact Gothic', sans-serif;
            font-size: 14px;
            color: #ffffff;
            opacity: 0.9;
            text-transform: uppercase;
            letter-spacing: 2px;
          }
          
          .content {
            padding: 40px;
            background-color: #ffffff;
            color: #171717;
          }
          
          .greeting {
            font-family: 'Exo 2', sans-serif;
            font-size: 24px;
            font-weight: 600;
            color: #2d1f1a;
            margin-bottom: 20px;
          }
          
          .message {
            font-size: 16px;
            margin-bottom: 30px;
            color: #3e2c27;
            font-family: 'Exo 2', sans-serif;
          }
          
          .details-card {
            background: linear-gradient(135deg, #c79f8b, #af7e70);
            color: #fff;
            font-family: 'Exo 2', sans-serif;
            font-size: 16px;
            padding: 25px;
            border-radius: 15px;
            margin: 25px 0;
          }
          
          .details-title {
            font-family: 'Montserrat Alternates', sans-serif;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 15px;
            color: #fff;
          }
          
          .details-list {
            list-style: none;
            padding: 0;
          }
          
          .details-list li {
            padding: 8px 0;
            border-bottom: 1px solid #ffffffbb;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          
          .details-list li:last-child {
            border-bottom: none;
          }
          
          .detail-label {
            font-weight: 500;
            color: #ffffffbb;
          }
          
          .detail-value {
            font-weight: 600;
            color: #ffffff;
          }
          
          .cta-button {
            display: inline-block;
            background: linear-gradient(90deg, #ff9d00, #ff5500);
            color: #ffffff;
            text-decoration: none;
            padding: 15px 30px;
            border-radius: 25px;
            font-family: 'Exo 2', sans-serif;
            font-weight: 600;
            font-size: 16px;
            text-align: center;
            margin: 20px 0;
          }
          
          .warning-box {
            background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%);
            color: #ffffff;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
            text-align: center;
            font-family: 'Exo 2', sans-serif;
          }
          
          .warning-box strong {
            font-family: 'Montserrat Alternates', sans-serif;
          }
          
          .footer {
            background: linear-gradient(135deg, #131313, #1a1a1a);
            padding: 30px 40px;
            text-align: center;
            color: #ffffff;
            font-family: 'Exo 2', sans-serif;
          }
          
          .footer-content {
            font-size: 14px;
            margin-bottom: 15px;
            opacity: 0.8;
          }
          
          .social-links {
            margin: 20px 0;
          }
          
          .social-link {
            display: inline-block;
            margin: 0 10px;
            color: #ff9d00;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.3s ease;
          }
          
          .social-link:hover {
            color: #ff5500;
          }
          
          .divider {
            height: 2px;
            background: linear-gradient(90deg, #ff9d00, #ff5500);
            margin: 20px 0;
            border-radius: 1px;
          }
          
          .token-display {
            background: linear-gradient(135deg, #ff9d00, #ff5500);
            color: #ffffff;
            padding: 20px;
            border-radius: 15px;
            text-align: center;
            margin: 25px 0;
            font-family: 'Montserrat Alternates', sans-serif;
            font-size: 24px;
            font-weight: 700;
            letter-spacing: 3px;
            box-shadow: 0 5px 15px #fff1e4;
          }
          
          .appointment-summary {
            background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%);
            border: 2px solid #ff5500;
            padding: 25px;
            border-radius: 15px;
            margin: 25px 0;
          }
          
          .price-highlight {
            background: linear-gradient(90deg, #ff9d00, #ff5500);
            color: #ffffff;
            padding: 10px 20px;
            border-radius: 20px;
            font-weight: 700;
            font-size: 18px;
            display: inline-block;
            box-shadow: 0 3px 10px #1a1a1a;
          }
          
          @media (max-width: 600px) {
            .email-container {
              margin: 10px;
            }
            
            .header, .content, .footer {
              padding: 20px;
            }
            
            .logo {
              font-size: 24px;
            }
            
            .greeting {
              font-size: 20px;
            }
            
            .cta-button {
              width: 100%;
              padding: 12px 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <div class="logo">${salonName}</div>
            <div class="tagline">Votre salon de tatouage</div>
          </div>
          ${content}
          <div class="footer">
            <div class="footer-content">
              <p><strong>${salonName}</strong></p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // <div class="footer">
  //           <div class="footer-content">
  //             <p><strong>${salonName}</strong> - Votre partenaire créatif</p>
  //             <div class="divider"></div>
  //             <p>Besoin d'aide ? Contactez-nous à <a href="mailto:contact@inkerastudio.fr" style="color: #af7e70;">contact@inkerastudio.fr</a></p>
  //           </div>
  //           <div class="social-links">
  //             <a href="#" class="social-link">Instagram</a> 
  //             <a href="#" class="social-link">Facebook</a>
  //             <a href="#" class="social-link">TikTok</a>
  //           </div>
  //         </div>

  /**
   *! Template pour confirmation de rendez-vous (client)
   */
  generateAppointmentConfirmationEmail(data: EmailTemplateData): string {
    const content = `
      <div class="content">
        <div class="greeting">Bonjour ${data.recipientName || 'cher client'} ! 🎨</div>
        
        <div class="message">
          <p>Parfait ! Votre rendez-vous a été <strong>confirmé avec succès</strong>.</p>
          <p>Nous avons hâte de donner vie à votre projet artistique !</p>
        </div>

        ${data.appointmentDetails ? `
          <div style="margin: 25px 0; padding: 0; background: transparent; color: #171717; font-family: 'Exo 2', sans-serif;">
            <div style="font-family: 'Montserrat Alternates', sans-serif; font-size: 18px; font-weight: 600; margin-bottom: 15px; color: #171717;">📅 Détails de votre rendez-vous</div>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li>
                <span style="font-weight: 500; color: #171717;">Date : </span>
                <span style="font-weight: 600; color: #171717;">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span style="font-weight: 500; color: #171717;">Heure : </span>
                <span style="font-weight: 600; color: #171717;">${data.appointmentDetails.time}</span>
              </li>
              ${data.appointmentDetails.duration ? `
                <li>
                  <span style="font-weight: 500; color: #171717;">Durée : </span>
                  <span style="font-weight: 600; color: #171717;">${data.appointmentDetails.duration}</span>
                </li>
              ` : ''}
              <li>
                <span style="font-weight: 500; color: #171717;">Prestation :</span>
                <span style="font-weight: 600; color: #171717;">${data.appointmentDetails.service}</span>
              </li>
              ${data.appointmentDetails.tatoueur ? `
                <li>
                  <span style="font-weight: 500; color: #171717;">Artiste : </span>
                  <span style="font-weight: 600; color: #171717;">${data.appointmentDetails.tatoueur}</span>
                </li>
              ` : ''}
              ${data.appointmentDetails.price ? `
                <li>
                  <span style="font-weight: 500; color: #171717;">Prix : </span>
                  <span style="font-weight: 600; color: #171717;">${data.appointmentDetails.price}€</span>
                </li>
              ` : ''}
              ${data.appointmentDetails.visio && data.appointmentDetails.visioRoom ? `
                <li>
                  <span style="font-weight: 500; color: #171717;">Visioconférence :</span>
                  <span class="detail-value">
                    <a href="${this.sanitizeSiteUrl(data.appointmentDetails.visioRoom, '/dashboard')}" 
                      style="background: #059669; color: white; padding: 8px 16px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; margin-top: 8px;">
                      🎥 Rejoindre la visioconférence
                    </a>
                  </span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        ${data.customMessage ? `
          <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0 0 8px 0; color: #f59e0b; font-weight: 600;">💬 Message du salon :</p>
            <p style="margin: 0; color: #1e1e1fff; font-style: italic;">"${data.customMessage}"</p>
          </div>
        ` : ''}

        <div class="warning-box">
          <strong>⚠️ Important :</strong> Merci d'arriver 10 minutes avant votre rendez-vous et de vous présenter avec une pièce d'identité.
        </div>

        <div class="message">
          <p>Si vous avez des questions ou besoin de modifier votre rendez-vous, n'hésitez pas à nous contacter.</p>
          <p><strong>À très bientôt chez ${data.salonName || 'Inkera Studio'} ! ✨</strong></p>
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
        <div class="greeting">Nouveau rendez-vous ! 🎉</div>
        
        <div class="message">
          <p>Un nouveau rendez-vous vient d'être confirmé dans votre salon <strong>${data.salonName || 'Inkera Studio'}</strong>.</p>
        </div>

        ${data.appointmentDetails ? `
          <div style="margin: 25px 0; padding: 0; background: transparent; color: #171717; font-family: 'Exo 2', sans-serif;">
            <div style="font-family: 'Montserrat Alternates', sans-serif; font-size: 18px; font-weight: 600; margin-bottom: 15px; color: #171717;">📋 Résumé du rendez-vous</div>
            <ul style="list-style: none; padding: 0; margin: 0; font-family: 'Exo 2', sans-serif; color: #171717;">
              <li>
                <span style="font-weight: 500; color: #171717;">👤 Client :</span>
                <span style="font-weight: 600; color: #171717;">${data.recipientName || 'Nouveau client'}</span>
              </li>
              <li>
                <span style="font-weight: 500; color: #171717;">📅 Date :</span>
                <span style="font-weight: 600; color: #171717;">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span style="font-weight: 500; color: #171717;">⏰ Heure :</span>
                <span style="font-weight: 600; color: #171717;">${data.appointmentDetails.time}</span>
              </li>
              <li>
                <span style="font-weight: 500; color: #171717;">🎨 Prestation :</span>
                <span style="font-weight: 600; color: #171717;">${data.appointmentDetails.service}</span>
              </li>
              ${data.appointmentDetails.tatoueur ? `
                <li>
                  <span style="font-weight: 500; color: #171717;">👨‍🎨 Artiste :</span>
                  <span style="font-weight: 600; color: #171717;">${data.appointmentDetails.tatoueur}</span>
                </li>
              ` : ''}
              ${data.appointmentDetails.price ? `
                <li>
                  <span style="font-weight: 500; color: #171717;">💰 Prix :</span>
                  <span style="font-weight: 600; color: #171717;">${data.appointmentDetails.price}€</span>
                </li>
              ` : ''}
              ${data.appointmentDetails.visio && data.appointmentDetails.visioRoom ? `
                <li>
                  <span style="font-weight: 500; color: #171717;">🎥 Visioconférence :</span>
                  <span style="font-weight: 600; color: #171717;">
                    <a href="${this.sanitizeSiteUrl(data.appointmentDetails.visioRoom, '/dashboard')}" 
                      style="background: #059669; color: white; padding: 8px 16px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; margin-top: 8px;">
                      🎥 Rejoindre la visioconférence
                    </a>
                  </span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        <a href="${this.buildFrontendUrl('/dashboard')}" class="cta-button">
          📊 Voir dans le dashboard
        </a>

        <div class="message">
          <p>Le client recevra automatiquement un email de confirmation.</p>
          <p><strong>Bonne journée ! 🎨</strong></p>
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
              ✅ Confirmer mon adresse email
            </a>
          </div>
        ` : ''}
        
        ${data.verificationToken ? `
          <div class="token-display">
            Code de vérification : ${data.verificationToken}
          </div>
        ` : ''}
        
        <div class="info-grid">
          <div class="info-item">
            <div class="info-item-label">🔒 Expiration dans 10min | Lien unique</div>
          </div>
        </div>
        
        <div style="background: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.2); border-radius: 12px; padding: 16px; margin: 24px 0; text-align: center;">
          <p style="font-size: 13px; color: rgba(249, 115, 22, 0.9); margin: 0;">
            <strong>⚠️ Important :</strong> Ce lien expire dans 10 minutes pour votre sécurité.
          </p>
        </div>

        <div class="message">
          <p class="welcome-subtitle">Si vous n'avez pas créé de compte, vous pouvez ignorer cet email en toute sécurité.</p>
          <br/>
          <p><strong>Merci de nous faire confiance ! ✨</strong></p>
        </div>
      </div>
    `;

    return this.getBaseTemplate(
      content, 
      `Vérification d'email - ${data.salonName || 'Inkera Studio'}`, 
      data.salonName || 'Inkera Studio',
    
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
      '/dashboard',
    );

    const content = `
      <div class="content">
        <div class="welcome-section">
          <h2 class="welcome-title">Votre essai se termine bientôt</h2>
        </div>

        <br/>

        <div class="message-box">
          <p class="welcome-subtitle">Bonjour ${data.recipientName || 'cher utilisateur'},</p>
          <p>
            Votre période d'essai de 30 jours pour <strong>${data.salonName || 'Inkera Studio'}</strong>
            se termine le <strong>${details.trialEndDate}</strong>.
          </p>
          <br/>
          <p>
            Aucun changement n'est nécessaire si votre moyen de paiement est valide:
            la facturation se fera automatiquement à la fin de l'essai.
          </p>
        </div>

        <div style="text-align: center;">
          <a href="${billingUrl}" class="cta-button">
            💳 Vérifier mon moyen de paiement
          </a>
        </div>

        <div style="background: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.2); border-radius: 12px; padding: 16px; margin: 24px 0; text-align: center;">
          <p style="font-size: 13px; color: rgba(249, 115, 22, 0.9); margin: 0;">
            <strong>⚠️ Important :</strong> En cas d'échec du paiement, votre compte passera en statut <strong>PAST_DUE</strong> avant un retour automatique au plan FREE après 5 jours.
          </p>
        </div>

        <div class="message">
          <p>Besoin d'aide ? Vous pouvez nous contacter à tout moment.</p>
          <br/>
          <p><strong>Merci de votre confiance ! ✨</strong></p>
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
    // const resetUrl = data.resetUrl || `${process.env.FRONTEND_URL || ''}/reset-password?token=${data.resetToken}&email=${data.recipientName}`;
    
    const content = `
      <div class="content">
        <div class="greeting">Réinitialisation de votre mot de passe 🔐</div>
        
        <div class="message">
          <p>Vous avez demandé à réinitialiser votre mot de passe pour votre compte ${data.salonName || 'Inkera Studio'}.</p>
          <p>Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe :</p>
        </div>

        <a href="${this.sanitizeSiteUrl(data.resetUrl, '/reset-password')}" class="cta-button">
          🔑 Réinitialiser mon mot de passe
        </a>

        <div class="warning-box">
          <strong>⏱️ Important :</strong> Ce lien est valide pendant 15 minutes seulement.
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
        <div class="greeting">Comment va votre tatouage ? 🎨</div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher client'} !</p>
          <p>Nous espérons que vous êtes ravi(e) de votre nouveau tatouage ! ✨</p>
        </div>

        ${data.followUpDetails ? `
          <div class="details-card">
            <div class="details-title">📅 Votre dernier rendez-vous</div>
            <ul class="details-list">
              <li>
                <span class="detail-label">📅 Date :</span>
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
            <div class="details-title">💡 Conseils de soin</div>
            <p style="color: #3e2c27; margin: 0;">${data.followUpDetails.instructions}</p>
          </div>
        ` : `
          <div class="appointment-summary">
            <div class="details-title">💡 Conseils de soin</div>
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
          <p><strong>Prenez soin de vous et de votre tatouage ! 🌟</strong></p>
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
        <div class="greeting">Rendez-vous modifié ! 📅</div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher client'} !</p>
          <p>Votre rendez-vous a été <strong>modifié avec succès</strong>.</p>
          <p>Voici les nouveaux détails :</p>
        </div>

        ${data.appointmentDetails ? `
          <div class="details-card">
            <div class="details-title">📅 Nouveaux détails du rendez-vous</div>
            <ul class="details-list">
              <li>
                <span class="detail-label">📅 Nouvelle date :</span>
                <span class="detail-value">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Nouvelle heure :</span>
                <span class="detail-value">${data.appointmentDetails.time}</span>
              </li>
              <li>
                <span class="detail-label">🎨 Prestation :</span>
                <span class="detail-value">${data.appointmentDetails.service}</span>
              </li>
              ${data.appointmentDetails.tatoueur ? `
                <li>
                  <span class="detail-label">👨‍🎨 Artiste :</span>
                  <span class="detail-value">${data.appointmentDetails.tatoueur}</span>
                </li>
              ` : ''}
              ${data.appointmentDetails.visio && data.appointmentDetails.visioRoom ? `
                <li>
                  <span class="detail-label">🎥 Visioconférence :</span>
                  <span class="detail-value">
                    <a href="${this.sanitizeSiteUrl(data.appointmentDetails.visioRoom, '/dashboard')}" 
                       style="background: #059669; color: white; padding: 8px 16px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; margin-top: 8px;">
                      🎥 Rejoindre la visioconférence
                    </a>
                  </span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        <div class="warning-box">
          <strong>📝 N'oubliez pas :</strong> Notez bien ces nouvelles informations dans votre agenda !
        </div>

        <div class="message">
          <p>Si vous avez des questions concernant cette modification, n'hésitez pas à nous contacter.</p>
          <p><strong>À bientôt chez ${data.salonName || 'Inkera Studio'} ! ✨</strong></p>
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
        <div class="greeting">Rendez-vous annulé 😔</div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher client'} !</p>
          <p>Nous vous confirmons que votre rendez-vous a été <strong>annulé</strong> comme demandé.</p>
        </div>

        ${data.appointmentDetails ? `
          <div class="details-card">
            <div class="details-title">📅 Rendez-vous annulé</div>
            <ul class="details-list">
              <li>
                <span class="detail-label">📅 Date :</span>
                <span class="detail-value">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Heure :</span>
                <span class="detail-value">${data.appointmentDetails.time}</span>
              </li>
              <li>
                <span class="detail-label">🎨 Prestation :</span>
                <span class="detail-value">${data.appointmentDetails.service}</span>
              </li>
            </ul>
          </div>
        ` : ''}

        ${data.customMessage ? `
          <div style="background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0 0 8px 0; color: #ef4444; font-weight: 600;">💬 Message du salon :</p>
            <p style="margin: 0; color: #1e1e1fff; font-style: italic;">"${data.customMessage}"</p>
          </div>
        ` : ''}

        <div class="message">
          <p>Nous serions ravis de vous accueillir à nouveau chez ${data.salonName || 'Inkera Studio'} quand vous le souhaiterez !</p>
          <p>N'hésitez pas à reprendre rendez-vous à tout moment.</p>
        </div>

        <div class="message">
          <p><strong>À bientôt chez ${data.salonName || 'Inkera Studio'} ! 🎨</strong></p>
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
        <div class="greeting">Bonjour ${data.recipientName || 'cher utilisateur'} 👋</div>

        <div class="message">
          <p>Vous recevez ce message de la part de l'équipe <strong>Inkera Studio</strong>.</p>
        </div>

<div style="background: transparent; border: 2px solid #e5e7eb; border-radius: 12px; padding: 25px; margin: 25px 0;">
        <div style="font-family: 'Montserrat Alternates', sans-serif; font-size: 18px; font-weight: 600; margin-bottom: 15px; color: #171717;">${data.subject}</div>
        <div style="margin-top: 12px; line-height: 1.8; white-space: pre-wrap; color: #171717; font-family: 'Exo 2', sans-serif; font-size: 16px;">${data.customMessage || ''}</div>
        </div>

        <div class="message" style="margin-top: 30px;">
          <p>Si vous avez des questions ou avez besoin d'assistance, n'hésitez pas à répondre à cet email.</p>
          <p style="margin-top: 12px;"><strong>L'équipe Inkera Studio ✨</strong></p>
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
   *! Template générique pour messages personnalisés
   */
  generateCustomEmail(data: EmailTemplateData, subject: string = `Message de ${data.salonName || 'Inkera Studio'}`): string {
    const content = `
      <div class="content">
        <div class="greeting">Bonjour ${data.recipientName || 'cher client'} ! 🎨</div>
        
        <div class="message">
          ${data.customMessage || `<p>Nous vous contactons depuis ${data.salonName || 'Inkera Studio'}.</p>`}
        </div>

        <div class="message">
          <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p><strong>L'équipe ${data.salonName || 'Inkera Studio'} ✨</strong></p>
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

        ${data.appointmentDetails ? `
          <div class="details-card">
            <div class="details-title">📋 Détails du rendez-vous</div>
            <ul class="details-list">
              <li>
                <span class="detail-label">👤 Client :</span>
                <span class="detail-value">${data.recipientName || 'Nouveau client'}</span>
              </li>
              <li>
                <span class="detail-label">📧 Email :</span>
                <span class="detail-value">${data.appointmentDetails.clientEmail || 'Non renseigné'}</span>
              </li>
              <li>
                <span class="detail-label">📞 Téléphone :</span>
                <span class="detail-value">${data.appointmentDetails.clientPhone || 'Non renseigné'}</span>
              </li>
              <li>
                <span class="detail-label">📅 Date :</span>
                <span class="detail-value">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Heure :</span>
                <span class="detail-value">${data.appointmentDetails.time}</span>
              </li>
              <li>
                <span class="detail-label">🎨 Prestation :</span>
                <span class="detail-value">${data.appointmentDetails.service}</span>
              </li>
              <li>
                <span class="detail-label">📝 Titre :</span>
                <span class="detail-value">${data.appointmentDetails.title || 'Non renseigné'}</span>
              </li>
            </ul>
          </div>
        ` : ''}

        <a href="${this.buildFrontendUrl('/dashboard')}" class="cta-button">
          ✅ Confirmer le rendez-vous
        </a>

        <div class="message">
          <p>Connectez-vous à votre espace pour confirmer ou modifier ce rendez-vous.</p>
          <p><strong>Action requise ! ⚡</strong></p>
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
        <div class="greeting">Rendez-vous confirmé automatiquement ! ✅</div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher client'} !</p>
          <p>Votre rendez-vous a été <strong>confirmé automatiquement</strong>.</p>
          <p>Nous avons hâte de vous voir ! 🎨</p>
        </div>

        ${data.appointmentDetails ? `
          <div class="details-card">
            <div class="details-title">📅 Détails de votre rendez-vous</div>
            <ul class="details-list">
              <li>
                <span class="detail-label">📅 Date :</span>
                <span class="detail-value">${data.appointmentDetails.date}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Heure :</span>
                <span class="detail-value">${data.appointmentDetails.time}</span>
              </li>
              <li>
                <span class="detail-label">🎨 Prestation :</span>
                <span class="detail-value">${data.appointmentDetails.service}</span>
              </li>
              <li>
                <span class="detail-label">📝 Titre :</span>
                <span class="detail-value">${data.appointmentDetails.title || 'Non renseigné'}</span>
              </li>
              ${data.appointmentDetails.tatoueur ? `
                <li>
                  <span class="detail-label">👨‍🎨 Artiste :</span>
                  <span class="detail-value">${data.appointmentDetails.tatoueur}</span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        <div class="warning-box">
          <strong>⚠️ Important :</strong> Merci d'arriver 10 minutes avant votre rendez-vous et de vous présenter avec une pièce d'identité.
        </div>

        <div class="message">
          <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p><strong>À très bientôt chez ${data.salonName || 'Inkera Studio'} ! ✨</strong></p>
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
        <div class="greeting">Reprogrammation de votre rendez-vous 📅</div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher client'},</p>
          <p>Nous devons reprogrammer votre rendez-vous chez ${data.salonName || 'Inkera Studio'}.</p>
        </div>

        <div class="details-card">
          <h3 style="color: #f97316; margin: 0 0 16px 0;">📅 Rendez-vous actuel</h3>
          <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px 0; color: #cbd5e1;"><strong>📅 Date :</strong> ${reschedule.currentDate}</p>
            ${reschedule.oldTatoueurName ? `<p style="margin: 0 0 8px 0; color: #cbd5e1;"><strong>👨‍🎨 Tatoueur :</strong> ${reschedule.oldTatoueurName}</p>` : ''}
            ${reschedule.newTatoueurName ? `<p style="margin: 0; color: #60a5fa;"><strong>👨‍🎨 Nouveau tatoueur :</strong> ${reschedule.newTatoueurName}</p>` : ''}
          </div>
        </div>

        ${reschedule.reason ? `
          <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0 0 8px 0; color: #f59e0b; font-weight: 600;">Motif de la reprogrammation :</p>
            <p style="margin: 0; color: #141414ff; font-style: italic;">${reschedule.reason}</p>
          </div>
        ` : ''}

        <div style="text-align: center; margin: 32px 0;">
          <a href="${this.sanitizeSiteUrl(reschedule.rescheduleUrl, '/nouveau-creneau')}" class="cta-button">
            📅 Choisir de nouveaux créneaux
          </a>
        </div>

        <div class="warning-box">
          <strong>⏰ Important :</strong> Ce lien expire dans 7 jours. Veuillez choisir vos nouveaux créneaux rapidement.
        </div>

        <div class="message">
          <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p><strong>Merci de votre compréhension ! 🙏</strong></p>
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
        <div class="greeting" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
          ✅ Reprogrammation Acceptée
        </div>
        
        <div class="message">
          <p>Bonjour <strong>${data.salonName || 'Salon'}</strong>,</p>
          <p>🎉 Le client <strong>${reschedule.clientName}</strong> a accepté la reprogrammation et choisi un nouveau créneau !</p>
        </div>

        <div class="details-card">
          <h3 class="details-title">📅 Détails de la reprogrammation</h3>
          <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px 0; color: #f87171;"><strong>📅 Ancien créneau :</strong> ${reschedule.originalDate}</p>
            <p style="margin: 0 0 8px 0; color: #6ee7b7;"><strong>📅 Nouveau créneau :</strong> ${reschedule.newDate}</p>
            <p style="margin: 0; color: #cbd5e1;"><strong>👨‍🎨 Tatoueur :</strong> ${reschedule.tatoueurName}</p>
          </div>
        </div>

        <div class="details-card">
          <h3 class="details-title">👥 Informations du client</h3>
          <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px;">
            <p style="margin: 0 0 4px 0; color: #cbd5e1;"><strong>Nom :</strong> ${reschedule.clientName}</p>
            <p style="margin: 0 0 4px 0; color: #cbd5e1;"><strong>Email :</strong> ${reschedule.clientEmail}</p>
            <p style="margin: 0; color: #cbd5e1;"><strong>Prestation :</strong> ${reschedule.prestation}</p>
          </div>
        </div>

        ${reschedule.clientMessage ? `
          <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0 0 8px 0; color: #f59e0b; font-weight: 600;">💬 Message du client :</p>
            <p style="margin: 0; color: #1e1e1fff; font-style: italic;">"${reschedule.clientMessage}"</p>
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
        <div class="greeting" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
          ✅ Rendez-vous Reprogrammé !
        </div>
        
        <div class="message">
          <p>Bonjour <strong>${data.recipientName || 'cher client'}</strong>,</p>
          <p>🎉 Parfait ! Votre rendez-vous a été reprogrammé avec succès chez ${data.salonName || 'Inkera Studio'}.</p>
        </div>

        <div class="details-card">
          <div class="details-title" style="color: white;">📅 Votre nouveau rendez-vous</div>
          <div style="background: rgba(255,255,255,0.1); padding: 16px; border-radius: 8px;">
            <p style="margin: 0 0 8px 0; color: white;"><strong>📅 Nouvelle date :</strong> ${reschedule.newDate}</p>
            <p style="margin: 0; color: white;"><strong>👨‍🎨 Tatoueur :</strong> ${reschedule.tatoueurName}</p>
          </div>
        </div>

        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 16px; border-radius: 8px; margin: 24px 0; text-align: center;">
          <p style="margin: 0; color: #059669; font-size: 16px;">
            ✅ <strong>Confirmé :</strong> Votre rendez-vous est maintenant confirmé pour le nouveau créneau.
          </p>
        </div>

        <div class="warning-box">
          <strong>📝 Important :</strong> Notez bien cette nouvelle date dans votre agenda !
        </div>

        <div class="message">
          <p>Merci pour votre flexibilité ! Nous avons hâte de vous voir. 🎨</p>
          <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p><strong>À très bientôt chez ${data.salonName || 'Inkera Studio'} ! ✨</strong></p>
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
        <div class="greeting">Réponse à votre suivi de cicatrisation 💬</div>
        
        <div class="message">
          <p>Bonjour <strong>${details.clientName}</strong>,</p>
          <p>Merci pour votre photo et votre avis concernant votre ${details.prestationName.toLowerCase()} réalisé par ${details.tatoueurName} !</p>
        </div>

        <div class="details-card">
          <div class="details-title" style="color: white;">💬 Notre réponse</div>
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <p style="margin: 0; color: white; font-size: 16px; line-height: 1.6;">${details.response}</p>
          </div>
        </div>

        <div class="message">
          <p>Nous espérons que ces informations vous seront utiles. N'hésitez pas à nous contacter si vous avez d'autres questions.</p>
          <p>Cordialement,<br><strong>L'équipe de ${data.salonName || 'Inkera Studio'}</strong></p>
        </div>

        <div class="warning-box" style="background: rgba(99, 102, 241, 0.1); border-left: 4px solid #6366f1; color: #171717;">
          <strong>📧 Information :</strong> Cet email est une réponse à votre suivi de cicatrisation. Si vous n'avez pas envoyé de suivi, veuillez nous contacter.
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
    console.log(data);
    const details = data.cicatrisationFollowUpDetails;
    if (!details) {
      throw new Error('cicatrisationFollowUpDetails is required for cicatrisation follow-up email');
    }

    const content = `
      <div class="content">
        <div class="greeting">Suivi de cicatrisation 🩹</div>
        
        <div class="message">
          <p>Bonjour <strong>${details.clientName}</strong>,</p>
          <p>Merci pour votre visite chez ${data.salonName || 'Inkera Studio'} !</p>
          <p>Votre ${details.prestationName.toLowerCase()} avec ${details.tatoueurName} s'est bien déroulé.</p>
        </div>

        <div class="details-card">
          <div class="details-title">🩹 Suivi de cicatrisation</div>
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
        <div class="greeting">Votre avis nous intéresse ! 💬</div>
        
        <div class="message">
          <p>Bonjour <strong>${details.clientName}</strong> !</p>
          <p>Nous espérons que votre <strong>${details.prestationName.toLowerCase()}</strong> s'est bien passé(e) !</p>
        </div>

        <div class="details-card">
          <div class="details-title">📋 Détails de votre rendez-vous</div>
          <ul class="details-list">
            <li>
              <span class="detail-label">📅 Date :</span>
              <span class="detail-value">${details.appointmentDate}</span>
            </li>
            <li>
              <span class="detail-label">👨‍🎨 Artiste :</span>
              <span class="detail-value">${details.tatoueurName}</span>
            </li>
            <li>
              <span class="detail-label">🎨 Prestation :</span>
              <span class="detail-value">${details.prestationName}</span>
            </li>
          </ul>
        </div>

        <div class="message">
          <p>Votre avis nous intéresse ! Pouvez-vous prendre quelques minutes pour nous faire un retour ?</p>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${this.sanitizeSiteUrl(details.followupUrl, '/suivi')}" class="cta-button">
            💬 Laisser mon avis
          </a>
        </div>

        <div class="warning-box">
          <strong>⏰ Important :</strong> Ce lien expire dans 7 jours. Si vous avez des questions, n'hésitez pas à nous contacter.
        </div>

        <div class="message">
          <p>Merci pour votre confiance ! 🙏</p>
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
        <div class="greeting">Mot de passe modifié 🔐</div>
        
        <div class="message">
          <p>Bonjour ${data.recipientName || 'cher utilisateur'} !</p>
          <p>Nous vous confirmons que votre mot de passe a été <strong>modifié avec succès</strong> pour votre compte ${data.salonName || 'Inkera Studio'}.</p>
        </div>

        <div class="details-card">
          <div class="details-title">🔒 Informations de sécurité</div>
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
              <span class="detail-label">🔐 Action :</span>
              <span class="detail-value">Changement de mot de passe</span>
            </li>
            <li>
              <span class="detail-label">✅ Statut :</span>
              <span class="detail-value">Confirmé</span>
            </li>
          </ul>
        </div>

        <div class="warning-box">
          <strong>⚠️ Vous n'êtes pas à l'origine de ce changement ?</strong><br/>
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

        <a href="${this.buildFrontendUrl('/login')}" class="cta-button">
          🔑 Se connecter à mon espace
        </a>

        <div class="message">
          <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p><strong>Merci de votre confiance ! 🌟</strong></p>
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
        <div class="greeting">Comment va votre tatouage ? ✨</div>
        
        <div class="message">
          <p>Bonjour ${data.retouchesReminderDetails?.clientName || data.recipientName || 'cher client'} !</p>
          <p>Cela fait maintenant <strong>un mois</strong> depuis votre séance de tatouage chez ${data.retouchesReminderDetails?.salonName || data.salonName || 'notre salon'}.</p>
          <p>Nous espérons que vous êtes totalement ravi(e) du résultat ! 🎨</p>
        </div>

        ${data.retouchesReminderDetails ? `
          <div class="details-card">
            <div class="details-title">📅 Votre séance de tatouage</div>
            <ul class="details-list">
              <li>
                <span class="detail-label">📅 Date :</span>
                <span class="detail-value">${data.retouchesReminderDetails.appointmentDate}</span>
              </li>
              <li>
                <span class="detail-label">👨‍🎨 Artiste :</span>
                <span class="detail-value">${data.retouchesReminderDetails.tatoueurName}</span>
              </li>
            </ul>
          </div>
        ` : ''}

        <div style="margin: 25px 0; padding: 20px; background: transparent; border: 1px solid #e5e7eb; border-radius: 12px; color: #171717;">
          <div style="font-family: 'Montserrat Alternates', sans-serif; font-size: 18px; font-weight: 600; margin-bottom: 15px; color: #171717;">🔧 Retouches gratuites disponibles</div>
          <div class="message" style="color: #171717; margin: 15px 0;">
            <p style="margin-bottom: 12px;">Si vous constatez que votre tatouage a besoin d'une petite retouche ? (zones moins pigmentées, traits à reprendre...)</p>
            
            <p style="margin-bottom: 12px;"><strong>Les retouches peuvent être nécessaires dans les cas suivants :</strong></p>
            <ul style="margin: 8px 0; padding-left: 20px; color: #171717;">
              <li>Zones où l'encre n'a pas bien tenu</li>
              <li>Traits qui ont légèrement bavé pendant la cicatrisation</li>
              <li>Petites imperfections de cicatrisation</li>
              <li>Zones où la couleur paraît moins intense</li>
            </ul>
          </div>
        </div>

        <!--
        <div style="background: rgba(34, 197, 94, 0.1); border-left: 4px solid #22c55e; padding: 20px; border-radius: 8px; margin: 24px 0;">
          <p style="margin: 0 0 8px 0; color: #22c55e; font-weight: 600;">✅ Service inclus :</p>
          <p style="margin: 0; color: #1e1e1fff; font-weight: 600;">Les retouches sont entièrement gratuites pendant 3 mois !</p>
        </div>
        -->

        <div class="message">
          <p>Si vous souhaitez programmer une retouche ou si vous avez des questions concernant votre tatouage, n'hésitez pas à nous contacter.</p>
          <p>Nous serons ravis de vous accueillir à nouveau pour parfaire votre œuvre d'art ! 🎯</p>
        </div>

        <a href="${this.buildFrontendUrl('/contact')}" class="cta-button">
          📞 Nous contacter pour une retouche
        </a>

        <!--
        <div class="warning-box">
          <strong>⏰ Important :</strong> Les retouches gratuites sont disponibles uniquement pendant les 3 premiers mois suivant votre tatouage.
        </div>
        -->

        <div class="message">
          <p><strong>Merci de nous faire confiance pour vos créations artistiques ! ✨</strong></p>
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
        <div class="greeting" style="background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%); color: white; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
          🎉 Nouvelle Inscription !
        </div>
        
        <div class="message">
          <p>Bonjour <strong>Admin</strong>,</p>
          <p>Une nouvelle inscription vient d'avoir lieu sur la plateforme Inkera Studio ! 🚀</p>
        </div>

        <div class="details-card">
          <div class="details-title">👤 Informations du nouveau salon</div>
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

        <div style="background: #ff9d0046; border: 1px solid #ff55008d; border-radius: 12px; padding: 16px; margin: 24px 0; text-align: center;">
          <p style="margin: 0; color: #1a1a1a; font-size: 16px; font-weight: 600;">
            <strong>Action recommandée :</strong> Surveiller l'activation et l'utilisation du nouveau compte
          </p>
        </div>

        <div class="appointment-summary">
          <div class="details-title">📋 Actions à effectuer</div>
          <ul style="color: #fff; margin: 15px 0; padding-left: 20px;">
            <li>Vérifier que l'email de vérification a été envoyé</li>
            <li>Surveiller l'activation du compte</li>
            <li>Confirmer la création du plan SaaS (${newUser.saasPlan})</li>
            <li>Éventuellement contacter le salon pour l'accompagnement</li>
          </ul>
        </div>

        <a href="${this.buildFrontendUrl('/admin/users')}" class="cta-button">
          Voir dans l'admin
        </a>

        <div class="warning-box">
          <strong>📝 Note :</strong> Ce salon devra vérifier son email avant de pouvoir accéder à son espace de gestion.
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
            <div class="details-title">📋 Détails du rendez-vous annulé</div>
            <ul class="details-list">
              <li>
                <span class="detail-label">👤 Client :</span>
                <span class="detail-value">${data.clientCancellationDetails.clientName}</span>
              </li>
              ${data.clientCancellationDetails.clientEmail ? `
                <li>
                  <span class="detail-label">📧 Email :</span>
                  <span class="detail-value">${data.clientCancellationDetails.clientEmail}</span>
                </li>
              ` : ''}
              ${data.clientCancellationDetails.clientPhone ? `
                <li>
                  <span class="detail-label">📞 Téléphone :</span>
                  <span class="detail-value">${data.clientCancellationDetails.clientPhone}</span>
                </li>
              ` : ''}
              <li>
                <span class="detail-label">📅 Date :</span>
                <span class="detail-value">${data.clientCancellationDetails.appointmentDate}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Heure :</span>
                <span class="detail-value">${data.clientCancellationDetails.appointmentTime}</span>
              </li>
              <li>
                <span class="detail-label">🎨 Prestation :</span>
                <span class="detail-value">${data.clientCancellationDetails.prestation}</span>
              </li>
              ${data.clientCancellationDetails.tatoueurName ? `
                <li>
                  <span class="detail-label">👨‍🎨 Artiste :</span>
                  <span class="detail-value">${data.clientCancellationDetails.tatoueurName}</span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        ${data.clientCancellationDetails?.cancellationReason ? `
          <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0 0 8px 0; color: #f59e0b; font-weight: 600;">💬 Raison de l'annulation :</p>
            <p style="margin: 0; color: #1e1e1fff; font-style: italic;">"${data.clientCancellationDetails.cancellationReason}"</p>
          </div>
        ` : ''}

        <div style="background: linear-gradient(135deg, #059669, #047857); color: white; padding: 20px; border-radius: 10px; margin: 20px 0; text-align: center;">
          <p style="margin: 0; font-weight: 600;">✅ Ce créneau est maintenant disponible</p>
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
            <div class="details-title">📋 Récapitulatif du rendez-vous annulé</div>
            <ul class="details-list">
              <li>
                <span class="detail-label">🏪 Salon :</span>
                <span class="detail-value">${data.salonName || 'Inkera Studio'}</span>
              </li>
              <li>
                <span class="detail-label">📅 Date :</span>
                <span class="detail-value">${data.clientCancellationDetails.appointmentDate}</span>
              </li>
              <li>
                <span class="detail-label">⏰ Heure :</span>
                <span class="detail-value">${data.clientCancellationDetails.appointmentTime}</span>
              </li>
              <li>
                <span class="detail-label">🎨 Prestation :</span>
                <span class="detail-value">${data.clientCancellationDetails.prestation}</span>
              </li>
              ${data.clientCancellationDetails.tatoueurName ? `
                <li>
                  <span class="detail-label">👨‍🎨 Artiste :</span>
                  <span class="detail-value">${data.clientCancellationDetails.tatoueurName}</span>
                </li>
              ` : ''}
            </ul>
          </div>
        ` : ''}

        <div style="background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%); color: white; padding: 25px; border-radius: 15px; margin: 25px 0; text-align: center;">
          <p style="margin: 0 0 12px 0; font-size: 18px; font-weight: 600;">💙 Nous restons à votre disposition</p>
          <p style="margin: 0; font-size: 14px; opacity: 0.9; line-height: 1.6;">
            Si vous souhaitez reprendre rendez-vous ou si vous avez des questions,<br>
            n'hésitez pas à nous contacter.
          </p>
        </div>

        <div class="message">
          <p>Nous espérons vous revoir bientôt chez <strong>${data.salonName || 'Inkera Studio'}</strong> ! ✨</p>
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
          <h2 class="welcome-title">Bienvenue sur Inkera ! 🎨</h2>
        </div>

        <br/>
        
        <div class="message-box">
          <p class="welcome-subtitle">Bonjour ${data.recipientName || 'cher client'},</p>
          <p><strong>Félicitations !</strong> Votre compte client a été créé avec succès sur Inkera.</p>
          <br/>
          <p>Vous pouvez maintenant prendre rendez-vous facilement avec vos salons de tatouage préférés, suivre l'évolution de vos tatouages et bien plus encore !</p>
          <br/>
          <p>Pour accéder à toutes ces fonctionnalités, veuillez confirmer votre adresse email en cliquant sur le bouton ci-dessous :</p>
        </div>
        
        ${data.verificationUrl ? `
          <div style="text-align: center;">
            <a href="${this.sanitizeSiteUrl(data.verificationUrl, '/verifier-email')}" class="cta-button">
              ✅ Confirmer mon adresse email
            </a>
          </div>
        ` : ''}
        
        ${data.verificationToken ? `
          <div class="token-display">
            Code de vérification : ${data.verificationToken}
          </div>
        ` : ''}
        
        <div class="info-grid">
          <div class="info-item">
            <div class="info-item-label">🔒 Expiration dans 10min | Lien unique</div>
          </div>
        </div>
        
        <div class="details-card">
          <div class="details-title">✨ Ce que vous pouvez faire maintenant :</div>
          <ul style="list-style: none; padding: 0; color: #fff;">
            <li style="padding: 8px 0; display: flex; align-items: center;">
              <span style="margin-right: 10px;">📅</span>
              <span>Prendre rendez-vous dans vos salons préférés</span>
            </li>
            <li style="padding: 8px 0; display: flex; align-items: center;">
              <span style="margin-right: 10px;">❤️</span>
              <span>Ajouter vos salons en favoris</span>
            </li>
            <li style="padding: 8px 0; display: flex; align-items: center;">
              <span style="margin-right: 10px;">📝</span>
              <span>Suivre vos rendez-vous et tatouages</span>
            </li>
            <li style="padding: 8px 0; display: flex; align-items: center;">
              <span style="margin-right: 10px;">⭐</span>
              <span>Laisser des avis sur vos expériences</span>
            </li>
          </ul>
        </div>
        
        <div style="background: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.2); border-radius: 12px; padding: 16px; margin: 24px 0; text-align: center;">
          <p style="font-size: 13px; color: rgba(249, 115, 22, 0.9); margin: 0;">
            <strong>⚠️ Important :</strong> Ce lien expire dans 10 minutes pour votre sécurité.
          </p>
        </div>

        <div class="message">
          <p class="welcome-subtitle">Si vous n'avez pas créé de compte, vous pouvez ignorer cet email en toute sécurité.</p>
          <br/>
          <p><strong>Bienvenue dans la communauté Inkera ! ✨</strong></p>
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

