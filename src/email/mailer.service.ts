import { Injectable } from '@nestjs/common';
import { MailgunService, MailgunResponse } from './mailgun.service';
import { EmailTemplateService, EmailTemplateData } from './email-template.service';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class MailService {
  constructor(
    private readonly mailgunService: MailgunService,
    private readonly emailTemplateService: EmailTemplateService,
    private readonly prisma: PrismaService
  ) {}

  /**
   *! Récupère les couleurs du profil d'un salon
   */
  private async getSalonColors(userId: string): Promise<{ colorProfile: string; colorProfileBis: string }> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { colorProfile: true, colorProfileBis: true }
      });

      return {
        colorProfile: user?.colorProfile || 'default',
        colorProfileBis: user?.colorProfileBis || 'default'
      };
    } catch (error) {
      console.error('Erreur lors de la récupération des couleurs du salon:', error);
      return {
        colorProfile: 'default',
        colorProfileBis: 'default'
      };
    }
  }

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

  //! MAIL ADMIN - NOUVELLE INSCRIPTION
  async sendAdminNewUserNotification(newUserData: {
    userEmail: string;
    salonName: string;
    saasPlan: string;
    registrationDate: string;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  }): Promise<MailgunResponse> {
    const adminEmail = process.env.ADMIN_EMAIL || 'contact.inkera@gmail.com';
    const subject = `Nouvelle inscription - ${newUserData.salonName}`;
    
    const emailData: EmailTemplateData = {
      recipientName: 'Admin',
      salonName: 'Inkera Studio - Admin',
      newUserDetails: {
        ...newUserData,
        firstName: newUserData.firstName || undefined,
        lastName: newUserData.lastName || undefined,
        phone: newUserData.phone || undefined,
      }
    };
    
    const html = this.emailTemplateService.generateAdminNewUserNotificationEmail(emailData);
    
    return await this.sendMail(
      adminEmail,
      subject,
      html,
      'Inkera Studio - Notifications'
    );
  }

  //! MAIL DE CONFIRMATION DE RDV
  async sendAppointmentConfirmation(to: string, data: EmailTemplateData, salonName?: string, salonEmail?: string, userId?: string): Promise<MailgunResponse> {
    const subject = `Confirmation de votre rendez-vous${salonName ? ` chez ${salonName}` : ''}`;
    
    // Récupérer les couleurs du salon si userId est fourni
    let dataWithColors = { ...data, salonName: salonName || data.salonName };
    if (userId) {
      const salonColors = await this.getSalonColors(userId);
      dataWithColors = {
        ...dataWithColors,
        colorProfile: salonColors.colorProfile,
        colorProfileBis: salonColors.colorProfileBis
      };
    }
    
    const html = this.emailTemplateService.generateAppointmentConfirmationEmail(dataWithColors);
    
    return await this.sendMail(
      to,
      subject,
      html,
      salonName || 'Tattoo Studio',
      salonEmail
    );
  }

  //! MAIL DE NOUVEAU RDV (SALON)
  async sendNewAppointmentNotification(to: string, data: EmailTemplateData, salonName?: string, userId?: string): Promise<MailgunResponse> {
    const subject = `Nouveau rendez-vous${salonName ? ` - ${salonName}` : ''}`;
    
    // Récupérer les couleurs du salon si userId est fourni
    let dataWithColors = { ...data, salonName: salonName || data.salonName };
    if (userId) {
      const salonColors = await this.getSalonColors(userId);
      dataWithColors = {
        ...dataWithColors,
        colorProfile: salonColors.colorProfile,
        colorProfileBis: salonColors.colorProfileBis
      };
    }
    
    const html = this.emailTemplateService.generateNewAppointmentNotificationEmail(dataWithColors);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE VERIFICATION D'EMAIL
  async sendEmailVerification(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Vérification de votre email${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateEmailVerificationEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE REINITIALISATION DE MOT DE PASSE
  async sendPasswordReset(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Réinitialisation de votre mot de passe${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generatePasswordResetEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE CONFIRMATION DE CHANGEMENT DE MOT DE PASSE
  async sendPasswordChangeConfirmation(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Mot de passe modifié${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generatePasswordChangeConfirmationEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE SUIVI POST-TATOUAGE
  async sendFollowUp(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Votre suivi post-tatouage${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateFollowUpEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE SUIVI POST-TATOUAGE
  async sendFollowUpResponse(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Réponse à votre suivi${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateFollowUpResponseEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE SUIVI POST-TATOUAGE
  async sendCicatrisationFollowUp(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Suivi de cicatrisation${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateCicatrisationFollowUpEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE RAPPEL RETOUCHES (1 mois après tatouage)
  async sendRetouchesReminder(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Retouches gratuites disponibles${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateRetouchesReminderEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE DEMANDE DE RETOUR D'EXPERIENCE
  async sendFeedbackRequest(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Votre avis nous intéresse${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateFeedbackRequestEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE MODIFICATION DE RDV
  async sendAppointmentModification(to: string, data: EmailTemplateData, salonName?: string, salonEmail?: string, userId?: string): Promise<MailgunResponse> {
    const subject = `Modification de votre rendez-vous${salonName ? ` chez ${salonName}` : ''}`;
    
    // Récupérer les couleurs du salon si userId est fourni
    let dataWithColors = { ...data, salonName: salonName || data.salonName };
    if (userId) {
      const salonColors = await this.getSalonColors(userId);
      dataWithColors = {
        ...dataWithColors,
        colorProfile: salonColors.colorProfile,
        colorProfileBis: salonColors.colorProfileBis
      };
    }
    
    const html = this.emailTemplateService.generateAppointmentModificationEmail(dataWithColors);
    
    return await this.sendMail(
      to,
      subject,
      html,
      salonName || 'Tattoo Studio',
      salonEmail
    );
  }

  //! MAIL D'ANNULATION DE RDV
  async sendAppointmentCancellation(to: string, data: EmailTemplateData, salonName?: string, salonEmail?: string, userId?: string): Promise<MailgunResponse> {
    const subject = `Annulation de votre rendez-vous${salonName ? ` chez ${salonName}` : ''}`;
    
    // Récupérer les couleurs du salon si userId est fourni
    let dataWithColors = { ...data, salonName: salonName || data.salonName };
    if (userId) {
      const salonColors = await this.getSalonColors(userId);
      dataWithColors = {
        ...dataWithColors,
        colorProfile: salonColors.colorProfile,
        colorProfileBis: salonColors.colorProfileBis
      };
    }
    
    const html = this.emailTemplateService.generateAppointmentCancellationEmail(dataWithColors);
    
    return await this.sendMail(
      to,
      subject,
      html,
      salonName || 'Tattoo Studio',
      salonEmail
    );
  }

  //! MAIL PERSONNALISE
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

  //! MAIL DE NOTIFICATION DE RDV EN ATTENTE
  async sendPendingAppointmentNotification(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Rendez-vous en attente de confirmation${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generatePendingAppointmentNotificationEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE CONFIRMATION DE RDV
  async sendAutoConfirmedAppointment(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Rendez-vous confirmé automatiquement${salonName ? ` chez ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateAutoConfirmedAppointmentEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE PROPOSITION DE REPROGRAMMATION
  async sendRescheduleProposal(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Proposition de reprogrammation${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateRescheduleProposalEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE NOTIFICATION DE REPROGRAMMATION
  async sendRescheduleAcceptedNotification(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Reprogrammation acceptée${salonName ? ` - ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateRescheduleAcceptedNotificationEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }

  //! MAIL DE CONFIRMATION DE REPROGRAMMATION
  async sendRescheduleConfirmation(to: string, data: EmailTemplateData, salonName?: string): Promise<MailgunResponse> {
    const subject = `Confirmation de reprogrammation${salonName ? ` chez ${salonName}` : ''}`;
    const dataWithSalon = { ...data, salonName: salonName || data.salonName };
    const html = this.emailTemplateService.generateRescheduleConfirmationEmail(dataWithSalon);
    
    return await this.sendMail(to, subject, html, salonName);
  }
}