import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailTemplateService, EmailTemplateData } from './email-template.service';

@Injectable()
export class MailService {
  private transporter: ReturnType<typeof nodemailer.createTransport>;

  constructor(private readonly emailTemplateService: EmailTemplateService) {
    this.transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_SECURE === "true", // ⚠️ Attention ici
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  // Méthode générique pour envoyer un email
  async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    salonName?: string; // Nom du salon (optionnel, par défaut "InkStudio")
    salonEmail?: string; // Email du salon pour Reply-To
  }) {
    try {
      const fromName = options.salonName || "InkStudio";
      const fromEmail = `"${fromName}" <${process.env.EMAIL_USER}>`;
      
      console.log('📧 Tentative d\'envoi d\'email:', {
        to: options.to,
        subject: options.subject,
        from: fromEmail,
        replyTo: options.salonEmail || process.env.EMAIL_USER,
        service: process.env.EMAIL_SERVICE,
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: process.env.EMAIL_SECURE
      });

      await this.transporter.sendMail({
        from: fromEmail,
        replyTo: options.salonEmail || process.env.EMAIL_USER, // Reply-To vers le salon
        to: options.to,
        subject: options.subject,
        html: options.html,
      });

      console.log('✅ Email envoyé avec succès à:', options.to);
    } catch (error) {
      console.error('❌ Erreur lors de l\'envoi de l\'email:', error);
      throw error;
    }
  }

  // Méthodes spécialisées avec templates cohérents
  async sendAppointmentConfirmation(to: string, data: EmailTemplateData, salonName?: string, salonEmail?: string) {
    try {
      const salonDisplayName = salonName || "InkStudio";
      
      // Ajouter le nom du salon aux données du template
      const templateData = {
        ...data,
        salonName: salonDisplayName
      };
      
      const html = this.emailTemplateService.generateAppointmentConfirmationEmail(templateData);
      
      await this.sendMail({
        to,
        subject: `✅ Confirmation de votre rendez-vous - ${salonDisplayName}`,
        html,
        salonName: salonDisplayName,
        salonEmail, // Passer l'email du salon
      });
    } catch (error) {
      console.error('💥 Erreur lors de l\'envoi du mail de confirmation:', error);
      throw error;
    }
  }

  async sendNewAppointmentNotification(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateNewAppointmentNotificationEmail(templateData);
    await this.sendMail({
      to,
      subject: `🎉 Nouveau rendez-vous confirmé - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }

  async sendEmailVerification(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateEmailVerificationEmail(templateData);
    await this.sendMail({
      to,
      subject: `✨ Confirmez votre adresse email - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }

  async sendPasswordReset(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generatePasswordResetEmail(templateData);
    await this.sendMail({
      to,
      subject: `🔐 Réinitialisation de votre mot de passe - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }

  async sendFollowUp(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateFollowUpEmail(templateData);
    await this.sendMail({
      to,
      subject: `🎨 Comment va votre tatouage ? - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }

  async sendAppointmentModification(to: string, data: EmailTemplateData, salonName?: string, salonEmail?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateAppointmentModificationEmail(templateData);
    await this.sendMail({
      to,
      subject: `📅 Modification de votre rendez-vous - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
      salonEmail,
    });
  }

  async sendAppointmentCancellation(to: string, data: EmailTemplateData, salonName?: string, salonEmail?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateAppointmentCancellationEmail(templateData);
    await this.sendMail({
      to,
      subject: `❌ Annulation de votre rendez-vous - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
      salonEmail,
    });
  }

  async sendCustomEmail(to: string, subject: string, data: EmailTemplateData, salonName?: string, salonEmail?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateCustomEmail(templateData, subject);
    await this.sendMail({
      to,
      subject,
      html,
      salonName: salonDisplayName,
      salonEmail,
    });
  }

  async sendPendingAppointmentNotification(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generatePendingAppointmentNotificationEmail(templateData);
    await this.sendMail({
      to,
      subject: `⏰ Nouveau rendez-vous en attente - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }

  async sendAutoConfirmedAppointment(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateAutoConfirmedAppointmentEmail(templateData);
    await this.sendMail({
      to,
      subject: `✅ Rendez-vous confirmé automatiquement - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }

  async sendRescheduleProposal(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateRescheduleProposalEmail(templateData);
    await this.sendMail({
      to,
      subject: `📅 Reprogrammation nécessaire - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }

  async sendRescheduleAcceptedNotification(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateRescheduleAcceptedNotificationEmail(templateData);
    await this.sendMail({
      to,
      subject: `✅ Reprogrammation acceptée - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }

  async sendRescheduleConfirmation(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateRescheduleConfirmationEmail(templateData);
    await this.sendMail({
      to,
      subject: `✅ Rendez-vous reprogrammé - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }

  // Follow-up emails
  async sendFollowUpResponse(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateFollowUpResponseEmail(templateData);
    await this.sendMail({
      to,
      subject: `Réponse à votre suivi de cicatrisation - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }

  async sendCicatrisationFollowUp(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateCicatrisationFollowUpEmail(templateData);
    await this.sendMail({
      to,
      subject: `Suivi de cicatrisation — Envoyez votre photo - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }

  async sendFeedbackRequest(to: string, data: EmailTemplateData, salonName?: string) {
    const salonDisplayName = salonName || "InkStudio";
    const templateData = { ...data, salonName: salonDisplayName };
    const html = this.emailTemplateService.generateFeedbackRequestEmail(templateData);
    await this.sendMail({
      to,
      subject: `Comment s'est passé votre ${data.feedbackRequestDetails?.prestationName?.toLowerCase() || 'rendez-vous'} ? - ${salonDisplayName}`,
      html,
      salonName: salonDisplayName,
    });
  }
}