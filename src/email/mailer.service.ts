import { Injectable } from '@nestjs/common';
import { MailgunService, MailgunResponse } from './mailgun.service';
import { EmailTemplateService, EmailTemplateData } from './email-template.service';

@Injectable()
export class MailService {
  constructor(
    private readonly mailgunService: MailgunService,
    private readonly emailTemplateService: EmailTemplateService
  ) {}

  async sendMail(to: string, subject: string, html: string, fromName?: string, replyTo?: string): Promise<MailgunResponse> {
    try {
      // Utiliser le domaine configuré dans les variables d'environnement
      const domain = process.env.MAILGUN_DOMAIN || 'inkera-studio.com';
      
      const emailOptions = {
        to,
        subject,
        html,
        from: fromName ? `${fromName} <noreply@${domain}>` : `Tattoo Studio <noreply@${domain}>`,
        'h:Reply-To': replyTo || `noreply@${domain}`
      };

      return await this.mailgunService.sendEmail(emailOptions);
    } catch (error) {
      console.error('Erreur lors de l\'envoi de l\'email:', error);
      throw error;
    }
  }

  async sendAppointmentConfirmation(to: string, data: EmailTemplateData, salonName?: string, salonEmail?: string): Promise<MailgunResponse> {
    const subject = `Confirmation de votre rendez-vous${salonName ? ` chez ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateAppointmentConfirmationEmail(dataWithSalon);
    
    return await this.sendMail(
      to,
      subject,
      html,
      salonName || 'Tattoo Studio',
      salonEmail
    );
  }

  async sendNewAppointmentNotification(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Nouveau rendez-vous${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateNewAppointmentNotificationEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendEmailVerification(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Vérification de votre email${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateEmailVerificationEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendPasswordReset(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Réinitialisation de votre mot de passe${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generatePasswordResetEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendFollowUp(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Votre suivi post-tatouage${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateFollowUpEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendAppointmentModification(to: string, data: EmailTemplateData, salonName?: string, salonEmail?: string): Promise<MailgunResponse> {
    const subject = `Modification de votre rendez-vous${salonName ? ` chez ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateAppointmentModificationEmail(dataWithSalon);
    
    return await this.sendMail(
      to,
      subject,
      html,
      salonName || 'Tattoo Studio',
      salonEmail
    );
  }

  async sendAppointmentCancellation(to: string, data: EmailTemplateData, salonName?: string, salonEmail?: string): Promise<MailgunResponse> {
    const subject = `Annulation de votre rendez-vous${salonName ? ` chez ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateAppointmentCancellationEmail(dataWithSalon);
    
    return await this.sendMail(
      to,
      subject,
      html,
      salonName || 'Tattoo Studio',
      salonEmail
    );
  }

  async sendCustomEmail(to: string, subject: string, data: EmailTemplateData, salonName?: string, salonEmail?: string): Promise<MailgunResponse> {
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateCustomEmail(dataWithSalon);
    
    return await this.sendMail(
      to,
      subject,
      html,
      salonName || 'Tattoo Studio',
      salonEmail
    );
  }

  async sendPendingAppointmentNotification(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Rendez-vous en attente de confirmation${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generatePendingAppointmentNotificationEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendAutoConfirmedAppointment(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Rendez-vous confirmé automatiquement${salonName ? ` chez ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateAutoConfirmedAppointmentEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendRescheduleProposal(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Proposition de reprogrammation${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateRescheduleProposalEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendRescheduleAcceptedNotification(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Reprogrammation acceptée${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateRescheduleAcceptedNotificationEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendRescheduleConfirmation(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Confirmation de reprogrammation${salonName ? ` chez ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateRescheduleConfirmationEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendFollowUpResponse(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Réponse à votre suivi${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateFollowUpResponseEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendCicatrisationFollowUp(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Suivi de cicatrisation${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateCicatrisationFollowUpEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendFeedbackRequest(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Votre avis nous intéresse${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateFeedbackRequestEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  async sendPasswordChangeConfirmation(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Mot de passe modifié${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generatePasswordChangeConfirmationEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }
}