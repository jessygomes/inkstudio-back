import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';
import { EmailTemplateService } from './email-template.service';

@Controller('dev/email-preview')
export class EmailPreviewController {
  constructor(private readonly emailTemplateService: EmailTemplateService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  preview(@Query('template') template = 'cicatrisation-followup'): string {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Email preview is disabled in production');
    }

    const baseData = {
      recipientName: 'Alex Martin',
      salonName: 'Inkera Studio',
      verificationUrl: 'https://app.inkera.com/verifier-email?token=demo-token',
      resetUrl:
        'https://app.inkera.com/reset-password?token=demo-token&email=alex@example.com',
      appointmentDetails: {
        date: 'Lundi 18 mai 2026',
        time: '14:30',
        duration: '2h',
        service: 'Tatouage floral',
        tatoueur: 'Luna',
        price: 220,
        title: 'Projet floral avant-bras',
        clientEmail: 'alex@example.com',
        clientPhone: '06 12 34 56 78',
        visio: true,
        visioRoom: 'https://app.inkera.com/meeting/demo-meeting-id',
      },
      followUpResponseDetails: {
        clientName: 'Alex Martin',
        tatoueurName: 'Luna',
        prestationName: 'Tatouage floral',
        response:
          'La cicatrisation est tres propre. Continuez la creme hydratante 1x/jour encore 5 jours.',
      },
      cicatrisationFollowUpDetails: {
        clientName: 'Alex Martin',
        prestationName: 'Tatouage floral',
        tatoueurName: 'Luna',
        followUpUrl: 'https://app.inkera.com/suivi/demo-followup-token',
      },
      feedbackRequestDetails: {
        clientName: 'Alex Martin',
        appointmentDate: 'Lundi 11 mai 2026',
        tatoueurName: 'Luna',
        prestationName: 'Tatouage floral',
        followupUrl: 'https://app.inkera.com/suivi/demo-feedback-token',
      },
      rescheduleDetails: {
        currentDate: 'Mardi 26 mai 2026 a 11:00',
        oldTatoueurName: 'Luna',
        newTatoueurName: 'Milo',
        reason: 'Imprevu medical',
        rescheduleUrl: 'https://app.inkera.com/nouveau-creneau?token=demo-reschedule',
      },
      rescheduleAcceptedDetails: {
        clientName: 'Alex Martin',
        clientEmail: 'alex@example.com',
        originalDate: 'Mardi 26 mai 2026 a 11:00',
        newDate: 'Jeudi 28 mai 2026 a 15:30',
        tatoueurName: 'Milo',
        prestation: 'Tatouage floral',
        clientMessage: 'Merci, ce nouveau creneau me convient parfaitement.',
      },
      rescheduleConfirmationDetails: {
        newDate: 'Jeudi 28 mai 2026 a 15:30',
        tatoueurName: 'Milo',
        clientMessage: 'Parfait pour moi',
      },
      clientCancellationDetails: {
        clientName: 'Alex Martin',
        clientEmail: 'alex@example.com',
        clientPhone: '06 12 34 56 78',
        appointmentDate: 'Vendredi 29 mai 2026',
        appointmentTime: '10:00',
        prestation: 'Tatouage floral',
        tatoueurName: 'Luna',
        cancellationReason: 'Contrainte personnelle',
      },
      followUpDetails: {
        appointmentDate: 'Lundi 11 mai 2026',
        daysSince: 7,
      },
      trialEndingSoonDetails: {
        trialEndDate: 'Lundi 15 juin 2026',
        billingUrl: 'https://app.inkera.com/dashboard',
      },
      customMessage:
        'N hesitez pas a nous contacter si vous souhaitez ajuster le design avant la seance.',
    };

    switch (template) {
      case 'appointment-confirmation':
        return this.emailTemplateService.generateAppointmentConfirmationEmail(baseData);
      case 'new-appointment-notification':
        return this.emailTemplateService.generateNewAppointmentNotificationEmail(baseData);
      case 'email-verification':
        return this.emailTemplateService.generateEmailVerificationEmail(baseData);
      case 'trial-ending-soon':
        return this.emailTemplateService.generateTrialEndingSoonEmail(baseData);
      case 'password-reset':
        return this.emailTemplateService.generatePasswordResetEmail(baseData);
      case 'followup-response':
        return this.emailTemplateService.generateFollowUpResponseEmail(baseData);
      case 'cicatrisation-followup':
        return this.emailTemplateService.generateCicatrisationFollowUpEmail(baseData);
      case 'feedback-request':
        return this.emailTemplateService.generateFeedbackRequestEmail(baseData);
      case 'reschedule-proposal':
        return this.emailTemplateService.generateRescheduleProposalEmail(baseData);
      case 'reschedule-confirmation':
        return this.emailTemplateService.generateRescheduleConfirmationEmail(baseData);
      case 'retouches-reminder':
        return this.emailTemplateService.generateRetouchesReminderEmail(baseData);
      case 'password-change-confirmation':
        return this.emailTemplateService.generatePasswordChangeConfirmationEmail(baseData);
      case 'pending-appointment':
        return this.emailTemplateService.generatePendingAppointmentNotificationEmail(baseData);
      case 'auto-confirmed-appointment':
        return this.emailTemplateService.generateAutoConfirmedAppointmentEmail(baseData);
      case 'client-email-verification':
        return this.emailTemplateService.generateClientEmailVerificationEmail(baseData);
      default:
        throw new BadRequestException(
          `Unknown template '${template}'. Try: appointment-confirmation, new-appointment-notification, email-verification, trial-ending-soon, password-reset, followup-response, cicatrisation-followup, feedback-request, reschedule-proposal, reschedule-confirmation, retouches-reminder, password-change-confirmation, pending-appointment, auto-confirmed-appointment, client-email-verification`,
        );
    }
  }
}
