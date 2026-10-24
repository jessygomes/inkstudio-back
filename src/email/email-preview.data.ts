import type { EmailTemplateData } from './email-template.service';

/** Fictitious data shared by development previews and the offline gallery. */
export const emailPreviewData: EmailTemplateData & { subject: string } = {
  subject: 'Votre projet, notre prochaine étape',
  verificationToken: '482913',
  newUserDetails: {
    userEmail: 'alex@example.com',
    salonName: 'Atelier Luna',
    saasPlan: 'PRO',
    registrationDate: '24 octobre 2026',
    firstName: 'Alex',
    lastName: 'Martin',
    phone: '06 12 34 56 78',
  },
  retouchesReminderDetails: {
    clientName: 'Alex Martin',
    appointmentDate: '11 mai 2026',
    tatoueurName: 'Luna',
    salonName: 'Atelier Luna',
  },
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
    rescheduleUrl:
      'https://app.inkera.com/nouveau-creneau?token=demo-reschedule',
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
  publicContactDetails: {
    senderFullName: 'Alex Martin',
    senderEmail: 'alex@example.com',
    bodyPart: 'Avant-bras',
    projectDescription:
      'Bonjour, je souhaiterais discuter d un projet floral fin en noir et gris avec quelques references deja preparees.',
    sourceIp: '203.0.113.42',
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

export const emailPreviewTemplates = {
  'appointment-confirmation': 'generateAppointmentConfirmationEmail',
  'new-appointment-notification': 'generateNewAppointmentNotificationEmail',
  'email-verification': 'generateEmailVerificationEmail',
  'trial-ending-soon': 'generateTrialEndingSoonEmail',
  'password-reset': 'generatePasswordResetEmail',
  'followup-response': 'generateFollowUpResponseEmail',
  'cicatrisation-followup': 'generateCicatrisationFollowUpEmail',
  'feedback-request': 'generateFeedbackRequestEmail',
  'reschedule-proposal': 'generateRescheduleProposalEmail',
  'reschedule-confirmation': 'generateRescheduleConfirmationEmail',
  'retouches-reminder': 'generateRetouchesReminderEmail',
  'password-change-confirmation': 'generatePasswordChangeConfirmationEmail',
  'pending-appointment': 'generatePendingAppointmentNotificationEmail',
  'auto-confirmed-appointment': 'generateAutoConfirmedAppointmentEmail',
  'client-email-verification': 'generateClientEmailVerificationEmail',
  'public-contact': 'generatePublicContactEmail',
  'appointment-modification': 'generateAppointmentModificationEmail',
  'appointment-cancellation': 'generateAppointmentCancellationEmail',
  'admin-message': 'generateAdminMessageEmail',
  'custom-message': 'generateCustomEmail',
  followup: 'generateFollowUpEmail',
  'reschedule-accepted': 'generateRescheduleAcceptedNotificationEmail',
  'admin-new-user': 'generateAdminNewUserNotificationEmail',
  'client-cancellation-notification':
    'generateClientCancellationNotificationEmail',
  'client-cancellation-confirmation':
    'generateClientCancellationConfirmationEmail',
} as const;
