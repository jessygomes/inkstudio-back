import { Injectable, Logger } from '@nestjs/common';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';

interface MailgunConfig {
  apiKey: string;
  domain: string;
  baseUrl?: string;
}

export interface EmailOptions {
  from: string;
  to: string;
  subject: string;
  html: string;
  'h:Reply-To'?: string;
}

export interface MailgunResponse {
  id: string;
  message: string;
}

@Injectable()
export class MailgunService {
  private readonly logger = new Logger(MailgunService.name);
  private mailgun: any;
  private config: MailgunConfig;

  constructor() {
    this.config = {
      apiKey: process.env.MAILGUN_API_KEY || process.env.SENDING_KEY || '',
      domain: process.env.MAILGUN_DOMAIN || '',
      baseUrl: process.env.MAILGUN_BASE_URL || 'https://api.eu.mailgun.net', // URL EU par défaut
    };

    if (!this.config.apiKey || !this.config.domain) {
      this.logger.error('❌ Configuration Mailgun manquante - vérifiez MAILGUN_API_KEY et MAILGUN_DOMAIN');
      throw new Error('Configuration Mailgun manquante');
    }

    // Initialiser Mailgun avec l'approche correcte pour Node.js
    try {
      const mg = new Mailgun(FormData);
      this.mailgun = mg.client({
        username: 'api',
        key: this.config.apiKey,
        url: this.config.baseUrl,
      });

      this.logger.log(`✅ Mailgun initialisé pour le domaine: ${this.config.domain}`);
    } catch (error) {
      this.logger.error('❌ Erreur lors de l\'initialisation de Mailgun:', error);
      throw error;
    }
  }

  /**
   * Envoie un email via Mailgun
   * @param options - Options d'envoi d'email
   * @returns Promise<MailgunResponse>
   */
  async sendEmail(options: EmailOptions): Promise<MailgunResponse> {
    try {
      this.logger.log('📧 Tentative d\'envoi d\'email via Mailgun:', {
        to: options.to,
        subject: options.subject,
        from: options.from,
        replyTo: options['h:Reply-To'],
        domain: this.config.domain,
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = await this.mailgun.messages.create(this.config.domain, options);
      
      // Assertion de type pour le résultat
      const typedResult = result as MailgunResponse;
      
      this.logger.log('✅ Email envoyé avec succès via Mailgun:', {
        to: options.to,
        messageId: typedResult.id || 'unknown',
      });

      return typedResult;
    } catch (error) {
      this.logger.error('❌ Erreur lors de l\'envoi de l\'email via Mailgun:', error);
      throw error;
    }
  }

  /**
   * Méthode générique pour envoyer un email avec support du salon
   * @param emailOptions - Options d'email
   * @returns Promise<MailgunResponse>
   */
  async sendMail(emailOptions: {
    to: string;
    subject: string;
    html: string;
    salonName?: string;
    salonEmail?: string;
  }): Promise<MailgunResponse> {
    const salonName = emailOptions.salonName || 'InkStudio';
    
    // IMPORTANT: Avec un domaine sandbox, l'expéditeur doit utiliser le domaine sandbox
    // L'email du salon sera utilisé uniquement en Reply-To
    const fromEmail = `"${salonName}" <noreply@${this.config.domain}>`;

    const mailgunOptions: EmailOptions = {
      from: fromEmail,
      to: emailOptions.to,
      subject: emailOptions.subject,
      html: emailOptions.html,
    };

    // Toujours ajouter Reply-To avec l'email du salon si fourni
    // Cela permet aux clients de répondre directement au salon
    if (emailOptions.salonEmail) {
      mailgunOptions['h:Reply-To'] = emailOptions.salonEmail;
      this.logger.log(`📍 Reply-To configuré: ${emailOptions.salonEmail}`);
    }

    return this.sendEmail(mailgunOptions);
  }

  /**
   * Vérifie la configuration Mailgun
   * @returns Status de la configuration
   */
  isConfigured(): boolean {
    return !!(this.config.apiKey && this.config.domain);
  }

  /**
   * Obtient les informations de configuration (sans exposer les secrets)
   * @returns Informations de configuration
   */
  getConfigInfo() {
    return {
      domain: this.config.domain,
      baseUrl: this.config.baseUrl,
      isConfigured: this.isConfigured(),
      apiKeyConfigured: !!this.config.apiKey,
    };
  }

  /**
   * Test d'envoi d'email de production (selon l'exemple Mailgun)
   * @param testEmail - Email de test à envoyer
   * @returns Promise<MailgunResponse>
   */
  async sendProductionTestEmail(testEmail: string): Promise<MailgunResponse> {
    try {
      this.logger.log('🧪 Test d\'envoi email production Mailgun...');

      const testOptions: EmailOptions = {
        from: `INKERA <postmaster@${this.config.domain}>`,
        to: testEmail,
        subject: "Test Production - INKERA STUDIO",
        html: `
          <h2>🎉 Test de Production Réussi !</h2>
          <p>Félicitations ! Votre configuration Mailgun fonctionne parfaitement en production.</p>
          <p><strong>Domaine :</strong> ${this.config.domain}</p>
          <p><strong>Base URL :</strong> ${this.config.baseUrl}</p>
          <p>Vous pouvez maintenant envoyer des emails depuis votre application INKERA STUDIO !</p>
          <br>
          <p><em>Envoyé via Mailgun API</em></p>
        `
      };

      const result = await this.sendEmail(testOptions);
      
      this.logger.log('✅ Email de test production envoyé avec succès !', {
        messageId: result.id,
        to: testEmail
      });

      return result;
    } catch (error) {
      this.logger.error('❌ Échec du test email production:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue';
      throw new Error(`Test production échoué: ${errorMessage}`);
    }
  }
}
