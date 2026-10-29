import { emailTokenHash, validateEmailToken } from './email-token-policy';
import { Injectable, Logger, BadRequestException, Optional, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import {compare, hash} from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { UserPayload } from './jwt.strategy';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { MailService } from 'src/email/mailer.service';
import { createHash, randomBytes } from 'crypto';
import { SaasService } from 'src/saas/saas.service';
import { nativeTrialEndDate } from '../saas/trial-policy';
import { invitationEndDate, invitationTokenHash } from './invitation-policy';
import { CreateUserClientDto } from './dto/create-userClient.dto';
import { CreateTatoueurUserDto } from './dto/create-tatoueur-user.dto';
import { StripeService } from 'src/stripe/stripe.service';
import { AgendaMode, SaasPlan, SaasPlanStatus } from '@prisma/client';
import { CacheService } from 'src/redis/cache.service';
import { GoogleIdentityService } from './google-identity.service';

interface AuthenticatedUser {
  id: string;
  role: string;
  salonName: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  image?: string | null;
  profileImage?: string | null;
  saasPlan: string | null;
  agendaMode?: string | null;
  phone: string | null;
  address: string | null;
  verifiedSalon: boolean | null;
  salonHours?: string | null;
  clientProfile?: {
    id: string;
    userId: string;
    pseudo?: string | null;
    birthDate?: Date | null;
    city?: string | null;
    postalCode?: string | null;
  } | null;
}

export type AuthTokenResponse = {
  access_token: string;
  id: string;
  role: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  image?: string | null;
  profileImage?: string | null;
  clientProfile?: {
    id: string;
    userId: string;
    pseudo?: string | null;
    birthDate?: Date | null;
    city?: string | null;
    postalCode?: string | null;
  } | null;
  salonName?: string | null;
  saasPlan?: string | null;
  agendaMode?: string | null;
  phone?: string | null;
  address?: string | null;
  verifiedSalon?: boolean | null;
  salonHours?: string | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Offre de bienvenue par défaut pour les nouveaux comptes tatoueur indépendants.
  private readonly defaultTatoueurTrialMonths = 3;

  constructor(
    private readonly prisma: PrismaService, 
    private readonly jwtService : JwtService, 
    private readonly mailService: MailService,
    private readonly saasService: SaasService,
    private readonly stripeService: StripeService,
    private readonly googleIdentity: GoogleIdentityService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  private getTatoueurTrialMonths(): number {
    const rawMonths = process.env.TATOUEUR_PRO_TRIAL_MONTHS;

    if (!rawMonths) {
      return this.defaultTatoueurTrialMonths;
    }

    const parsedMonths = Number.parseInt(rawMonths, 10);

    if (!Number.isFinite(parsedMonths) || parsedMonths <= 0) {
      return this.defaultTatoueurTrialMonths;
    }

    return parsedMonths;
  }

  private computeTatoueurTrialEndDate(fromDate = new Date()): Date {
    return nativeTrialEndDate('user_tatoueur', 'PRO', fromDate, this.getTatoueurTrialMonths())!;
  }

  //! CONNEXION
  async login({ authBody }: { authBody: LoginUserDto }) {
    try {
      const { email, password } = authBody;
  
      const existingUser = await this.prisma.user.findUnique({
        where: {
          email,
        },
        include: {
          clientProfile: true,
          saasPlanDetails: {
            select: {
              agendaMode: true,
            },
          },
        },
      });
  
      if (!existingUser) {
        throw new Error("L'email ou le mot de passe sont incorrect.");
      }
  
      const isPasswordValid = await this.isPasswordValid({password, hashedPassword: existingUser.password});
  
      if (!isPasswordValid) {
        throw new Error("L'email ou le mot de passe sont incorrect.");
      }

      if (!existingUser.emailVerified) {
        const token = await this.issueEmailToken(email, 'verify');

        const confirmationUrl = this.buildAuthEmailUrl('/verifier-email', token, email);

        // Envoyer le bon template selon le rôle de l'utilisateur
        if (existingUser.role === 'client') {
          await this.mailService.sendClientEmailVerification(
            email,
            {
              recipientName: `${existingUser.firstName} ${existingUser.lastName}`,
              verificationUrl: confirmationUrl,
            }
          );
        } else {
          await this.mailService.sendEmailVerification(
            email,
            {
              recipientName: existingUser.salonName || 'Salon/Tatoueur',
              salonName: existingUser.salonName || 'Inkera Studio',
              verificationUrl: confirmationUrl,
            },
            existingUser.salonName || undefined
          );
        }
  
        return {
          error: "Votre adresse email n'est pas vérifiée. Un nouveau code de vérification vous a été envoyé par email.",
        };
      }
  
      return this.authenticateUser({
        ...existingUser,
        agendaMode:
          existingUser.role === 'user_salon'
            ? AgendaMode.PAR_TATOUEUR
            : existingUser.role === 'user_tatoueur'
              ? AgendaMode.GLOBAL
              : (existingUser.saasPlanDetails?.agendaMode ?? null),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
}

  //! INSCRIPTION (salon ou tatoueur indépendant)
  async register({ registerBody }: { registerBody: CreateUserDto }) {
    try {
      const {
        email: registrationEmail,
        role,
        salonName,
        saasPlan,
        checkoutPlan,
        password,
        firstName,
        lastName,
        phone,
        website,
        invitationToken,
      } = registerBody;
      const email = invitationToken ? registrationEmail.trim().toLowerCase() : registrationEmail;

      // Honeypot backend: un humain ne renseigne pas ce champ caché.
      // Si le champ est rempli, on ne crée pas de compte et on renvoie
      // une réponse neutre pour ne pas informer les bots de la détection.
      if (typeof website === 'string' && website.trim().length > 0) {
        const emailHash = typeof email === 'string'
          ? createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
          : null;

        this.logger.warn(
          JSON.stringify({
            event: 'auth.registration.honeypot_triggered',
            emailHash,
            timestamp: new Date().toISOString(),
          }),
        );

        return {
          message: "Votre compte a été créé avec succès. Veuillez vérifier vos emails pour confirmer votre adresse.",
          checkoutUrl: null,
          checkoutError: null,
        };
      }

      const invitation = invitationToken
        ? await this.prisma.subscriptionInvitation.findUnique({ where: { tokenHash: invitationTokenHash(invitationToken) } })
        : null;
      if (invitationToken && (!invitation || invitation.revokedAt || invitation.useCount >= invitation.maxUses || invitation.expiresAt <= new Date())) {
        throw new BadRequestException('Invitation invalide, expirée ou quota atteint.');
      }
      if (invitation && ((invitation.email && invitation.email !== email.trim().toLowerCase()) || (invitation.role && invitation.role !== role))) {
        throw new BadRequestException('Cette invitation ne correspond pas à votre email ou au type de compte.');
      }
      if ((saasPlan === SaasPlan.BUSINESS || checkoutPlan === 'BUSINESS') && role !== 'user_salon') {
        throw new BadRequestException('Le plan Business est réservé aux comptes salon.');
      }

      // Validation métier selon le rôle
      if (role === 'user_salon' && !salonName?.trim()) {
        throw new Error("Le nom du salon est requis pour créer un compte salon.");
      }
      if (role === 'user_salon' && !saasPlan) {
        throw new Error("Le plan SaaS est requis pour créer un compte salon.");
      }

      const existingUser = await this.prisma.user.findUnique({
        where: {
          email,
        },
      });
      
      if (existingUser) {
        throw new Error("Un compte existe déjà avec cet email.");
      }
  
      // Hashage du mot de passe
      const hashedPassword = await this.hashPassword({password});
      const isTatoueurRole = role === 'user_tatoueur';
      const initialPlan = invitation
        ? invitation.plan ?? (isTatoueurRole ? SaasPlan.PRO : SaasPlan.BUSINESS)
        : (isTatoueurRole ? SaasPlan.PRO : (saasPlan || SaasPlan.FREE));
      const trialEndDate = invitation ? null : nativeTrialEndDate(role, initialPlan, new Date(), this.getTatoueurTrialMonths());
      const redeemedAt = new Date();
      const offeredEndDate = invitation ? invitationEndDate(redeemedAt, invitation.durationMonths) : null;
  
      // Création de l'utilisateur dans la DB
      const userData: import('@prisma/client').Prisma.UserCreateInput = {
          email: invitation ? email.trim().toLowerCase() : email,
          firstName,
          lastName,
          phone,
          password: hashedPassword,
          role: role as import('@prisma/client').Role,
          ...(role === 'user_salon' ? { salonName } : { nickname: registerBody.nickname?.trim() || null }),
          saasPlan: initialPlan,
          saasPlanUntil: offeredEndDate ?? trialEndDate,
          ...((role === 'user_salon' || role === 'user_tatoueur')
            ? {
                saasPlanDetails: {
                  create: {
                    ...this.saasService.getPlanConfiguration(initialPlan),
                    currentPlan: initialPlan,
                    ...(trialEndDate ? {
                      planStatus: SaasPlanStatus.TRIAL,
                      trialEndDate,
                      nextPaymentDate: null,
                    } : {}),
                    ...(invitation ? {
                      planStatus: SaasPlanStatus.ACTIVE,
                      startDate: redeemedAt,
                      endDate: offeredEndDate,
                      trialEndDate: null,
                      nextPaymentDate: null,
                      monthlyPrice: 0,
                      yearlyPrice: 0,
                      paymentMethod: 'INVITATION',
                    } : {}),
                    agendaMode: role === 'user_salon'
                      ? AgendaMode.PAR_TATOUEUR
                      : AgendaMode.GLOBAL,
                  },
                },
              }
            : {}),
      };
      const createdUser = invitation
        ? await this.prisma.$transaction(async tx => {
            const claimed = await tx.subscriptionInvitation.updateMany({
              where: { id: invitation.id, useCount: { lt: invitation.maxUses }, maxUses: invitation.maxUses, revokedAt: null, expiresAt: { gt: new Date() }, durationMonths: invitation.durationMonths },
              data: { useCount: { increment: 1 } },
            });
            if (!claimed.count) throw new BadRequestException('Invitation modifiée ou quota atteint. Rechargez la page.');
            const user = await tx.user.create({ data: userData });
            await tx.subscriptionInvitationRedemption.create({ data: { invitationId: invitation.id, userId: user.id, redeemedAt, durationMonths: invitation.durationMonths, plan: initialPlan } });
            return user;
          })
        : await this.prisma.user.create({ data: userData });
      if (invitation) await this.cacheService?.delPattern('admin:salons:*');

      // Envoi d'un mail à l'administrateur pour l'informer de la nouvelle inscription
      await this.mailService.sendAdminNewUserNotification({
        userEmail: createdUser.email,
        salonName: createdUser.salonName ?? `${createdUser.firstName} ${createdUser.lastName}`,
        saasPlan: createdUser.saasPlan || role,
        firstName: createdUser.firstName,
        lastName: createdUser.lastName,
        phone: createdUser.phone,
        registrationDate: new Date().toLocaleDateString('fr-FR', { 
          day: '2-digit', 
          month: '2-digit', 
          year: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit' 
        })
      });

      // Génération du token de vérification de l'adresse mail
      const token = await this.issueEmailToken(email, 'verify');

      const confirmationUrl = this.buildAuthEmailUrl('/verifier-email', token, email);

      // Email de vérification adapté selon le rôle
      if (role === 'user_tatoueur') {
        await this.mailService.sendClientEmailVerification(
          email,
          {
            recipientName: `${createdUser.firstName} ${createdUser.lastName}`,
            verificationUrl: confirmationUrl,
          },
        );
      } else {
        await this.mailService.sendEmailVerification(
          email,
          {
            recipientName: createdUser.salonName || 'Salon',
            salonName: createdUser.salonName || 'Inkera Studio',
            verificationUrl: confirmationUrl,
          },
          createdUser.salonName || undefined,
        );
      }

      let checkoutUrl: string | null = null;
      let checkoutError: string | null = null;

      // Stripe pour salon et tatoueur si un checkoutPlan est fourni
      if ((role === 'user_salon' || role === 'user_tatoueur') && checkoutPlan && !trialEndDate && !invitation) {
        try {
          checkoutUrl = await this.stripeService.createCheckoutSession(
            createdUser.id,
            checkoutPlan,
          );
        } catch (error: unknown) {
          checkoutError =
            error instanceof Error
              ? error.message
              : 'Impossible de créer la session Stripe.';

          this.logger.error(
            `Création de session Stripe impossible pour ${createdUser.id}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
  
      // // Authentifier directement le nouvel utilisateur
      // return this.authenticateUser({userId: createdUser.id});
      return {
        ...(offeredEndDate ? { offeredEndDate: offeredEndDate.toISOString() } : {}),
        trialEndDate: trialEndDate?.toISOString() || null,
        message: "Votre compte a été créé avec succès. Veuillez vérifier vos emails pour confirmer votre adresse.",
        checkoutUrl,
        checkoutError,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! INSCRIPTION CLIENT
  async registerClient({ registerBody }: { registerBody: CreateUserClientDto }) {
    try {
      const {
        email,
        password,
        firstName,
        lastName,
        birthDate,
        confirmPassword,
        website,
      } = registerBody;

      // Honeypot backend: un utilisateur humain ne remplit jamais ce champ caché.
      // Si rempli, on ne crée rien en base et on retourne un message neutre
      // pour ne pas donner d'indice aux bots.
      if (typeof website === 'string' && website.trim().length > 0) {
        const emailHash = typeof email === 'string'
          ? createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
          : null;

        this.logger.warn(
          JSON.stringify({
            event: 'auth.registration_client.honeypot_triggered',
            emailHash,
            timestamp: new Date().toISOString(),
          }),
        );

        return {
          message:
            "Votre compte client a été créé avec succès. Veuillez vérifier vos emails pour confirmer votre adresse.",
        };
      }
      
      // Vérifier la confirmation du mot de passe
      if (confirmPassword && password !== confirmPassword) {
        throw new Error("Les mots de passe ne correspondent pas.");
      }
      
      // Vérifier si l'utilisateur existe déjà
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw new Error("Un compte existe déjà avec cet email.");
      }
      // Hashage du mot de passe
      const hashedPassword = await this.hashPassword({password});
      // Création de l'utilisateur dans la DB avec son profil client
      const createdUser = await this.prisma.user.create({
        data: {
          email,
          firstName,
          lastName,
          password: hashedPassword,
          role: 'client',
          clientProfile: {
            create: {
              birthDate: birthDate ? new Date(birthDate) : null,
            }
          }
        },
        include: {
          clientProfile: true
        }
      });

      // Génération du token de vérification de l'adresse mail
      const token = await this.issueEmailToken(email, 'verify');

      const confirmationUrl = this.buildAuthEmailUrl('/verifier-email', token, email);

      await this.mailService.sendClientEmailVerification(
        email,
        {
          recipientName: `${createdUser.firstName} ${createdUser.lastName}`,
          verificationUrl: confirmationUrl,
        }
      );

      return {
        message: "Votre compte client a été créé avec succès. Veuillez vérifier vos emails pour confirmer votre adresse.",
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  //! INSCRIPTION TATOUEUR (indépendant ou rattaché à un salon)
  async registerTatoueur({ registerBody }: { registerBody: CreateTatoueurUserDto }) {
    try {
      const {
        email,
        password,
        firstName,
        lastName,
        phone,
        salonId,
        website,
      } = registerBody;

      // Honeypot backend
      if (typeof website === 'string' && website.trim().length > 0) {
        const emailHash = typeof email === 'string'
          ? createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
          : null;
        this.logger.warn(
          JSON.stringify({
            event: 'auth.registration_tatoueur.honeypot_triggered',
            emailHash,
            timestamp: new Date().toISOString(),
          }),
        );
        return {
          message: "Votre compte tatoueur a été créé avec succès. Veuillez vérifier vos emails pour confirmer votre adresse.",
        };
      }

      const existingUser = await this.prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        throw new Error("Un compte existe déjà avec cet email.");
      }

      // Si un salonId est fourni, vérifier que le salon existe et a le bon rôle
      if (salonId) {
        const salon = await this.prisma.user.findUnique({
          where: { id: salonId },
          select: { role: true },
        });
        if (!salon || (salon.role !== 'user_salon' && salon.role !== 'user')) {
          throw new Error("Le salon spécifié est introuvable ou invalide.");
        }
      }

      const hashedPassword = await this.hashPassword({ password });
      const shouldOfferTatoueurTrial = true;
      const tatoueurTrialEndDate = this.computeTatoueurTrialEndDate();

      const createdUser = await this.prisma.user.create({
        data: {
          email,
          firstName,
          lastName,
          phone,
          password: hashedPassword,
          role: 'user_tatoueur',
          nickname: registerBody.nickname?.trim() || null,
          ...(shouldOfferTatoueurTrial
            ? {
                saasPlan: SaasPlan.PRO,
                saasPlanUntil: tatoueurTrialEndDate,
                saasPlanDetails: {
                  create: {
                    ...this.saasService.getPlanConfiguration(SaasPlan.PRO),
                    currentPlan: SaasPlan.PRO,
                    planStatus: SaasPlanStatus.TRIAL,
                    trialEndDate: tatoueurTrialEndDate,
                    nextPaymentDate: null,
                    agendaMode: AgendaMode.GLOBAL,
                  },
                },
              }
            : {}),
          ...(salonId ? { salonId } : {}),
        },
      });

      // Token de vérification email
      const token = await this.issueEmailToken(email, 'verify');

      const confirmationUrl = this.buildAuthEmailUrl('/verifier-email', token, email);

      await this.mailService.sendClientEmailVerification(
        email,
        {
          recipientName: `${createdUser.firstName} ${createdUser.lastName}`,
          verificationUrl: confirmationUrl,
        },
      );

      return {
        message: "Votre compte tatoueur a été créé avec succès. Veuillez vérifier vos emails pour confirmer votre adresse.",
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
  }

  private buildAuthEmailUrl(path: string, token: string, email: string): string {
    const base = process.env.FRONTEND_URL?.trim();
    if (!base) throw new Error('FRONTEND_URL est requis pour les emails de sécurité.');
    const url = new URL(path, base);
    if (!['http:', 'https:'].includes(url.protocol) ||
        (process.env.NODE_ENV === 'production' && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new Error('FRONTEND_URL doit être une URL publique HTTPS en production.');
    }
    url.search = new URLSearchParams({ token, email }).toString();
    return url.toString();
  }

  //! MOT DE PASSE OUBLIÉ
  // ENVOIE UN EMAIL DE RÉINITIALISATION DE MOT DE PASSE
  async sendResetPasswordEmail(email: string) {
    if (typeof email !== 'string' || !email.trim()) {
      throw new BadRequestException('Une adresse e-mail est requise.');
    }
    email = email.trim().toLowerCase();

    // Vérifier si l'utilisateur existe
    const user = await this.prisma.user.findUnique({ where: { email } });
  
    if (!user) {
      return { message: "Si un compte existe avec cette adresse, un email a été envoyé." };
    }
  
    const token = await this.issueEmailToken(email, 'reset');

    // Construire l'URL de réinitialisation du mot de passe
    const resetUrl = this.buildAuthEmailUrl('/reset-password', token, email);

    // Envoyer l'email de réinitialisation du mot de passe
    await this.mailService.sendPasswordReset(
      email,
      {
        recipientName: user.salonName || 'Salon',
        salonName: user.salonName || 'Inkera Studio',
        resetUrl: resetUrl,
      },
      user.salonName || undefined
    );
  
    // Retourner un message générique pour ne pas révéler si l'email existe ou non
    return { message: "Si un compte existe avec cette adresse, un email a été envoyé." };
  }

  //! RÉINITIALISE LE MOT DE PASSE
  async resetPassword({
    email,
    token,
    password,
  }: {
    email: string;
    token: string;
    password: string;
  }) {
    validateEmailToken(email, token);
    if (
      typeof password !== 'string' ||
      password.length < 8 ||
      Buffer.byteLength(password, 'utf8') > 72
    )
      throw new BadRequestException(
        'Le mot de passe doit contenir au moins 8 caract\u00e8res et au maximum 72 octets.',
      );
    const hashedPassword = await this.hashPassword({ password });
    await this.consumeEmailToken(email, token, 'reset', hashedPassword);
    return { message: 'Mot de passe mis \u00e0 jour avec succ\u00e8s.' };
  }

  async verifyEmail(email: string, token: string) {
    validateEmailToken(email, token);
    await this.consumeEmailToken(email, token, 'verify');
    return { message: 'Email v\u00e9rifi\u00e9 avec succ\u00e8s.' };
  }

  private async issueEmailToken(
    email: string,
    purpose: 'verify' | 'reset',
  ): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const expires = new Date(
      Date.now() + (purpose === 'verify' ? 10 : 15) * 60000,
    );
    const data = { email, token: emailTokenHash(purpose, token), expires };
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE email = ${email} FOR UPDATE`;
      if (purpose === 'verify') {
        await tx.verificationToken.deleteMany({ where: { email } });
        await tx.verificationToken.create({ data });
      } else {
        await tx.passwordResetToken.deleteMany({ where: { email } });
        await tx.passwordResetToken.create({ data });
      }
    });
    return token;
  }

  private async consumeEmailToken(
    email: string,
    token: string,
    purpose: 'verify' | 'reset',
    password?: string,
  ) {
    const digest = emailTokenHash(purpose, token);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE email = ${email} FOR UPDATE`;
      const where = { email_token: { email, token: digest } };
      const record =
        purpose === 'verify'
          ? await tx.verificationToken.findUnique({ where })
          : await tx.passwordResetToken.findUnique({ where });
      const now = new Date();
      if (!record || record.expires <= now)
        throw new BadRequestException('Lien invalide ou expir\u00e9.');
      const claim = {
        where: { id: record.id, email, token: digest, expires: { gt: now } },
      };
      const consumed =
        purpose === 'verify'
          ? await tx.verificationToken.deleteMany(claim)
          : await tx.passwordResetToken.deleteMany(claim);
      if (consumed.count !== 1)
        throw new BadRequestException('Lien invalide ou expir\u00e9.');
      await tx.user.update({
        where: { email },
        data: purpose === 'verify' ? { emailVerified: now } : { password },
      });
      // Invalidate all previous links of the same purpose in the same transaction.
      if (purpose === 'verify')
        await tx.verificationToken.deleteMany({ where: { email } });
      else await tx.passwordResetToken.deleteMany({ where: { email } });
    });
  }

  //! CHANGEMENT DE MOT DE PASSE
  async changePassword({
    userId,
    currentPassword,
    newPassword,
  }: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }) {
    try {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new Error("Utilisateur non trouvé.");
    }

    const isPasswordValid = await this.isPasswordValid({password: currentPassword, hashedPassword: user.password});
    if (!isPasswordValid) {
      throw new Error("Mot de passe actuel incorrect.");
    }

    // Vérifier que le nouveau mot de passe est différent de l'ancien
    if (currentPassword === newPassword) {
      throw new Error("Le nouveau mot de passe doit être différent de l'ancien.");
    }

    // Vérifier que le nouveau mot de passe respecte les critères de sécurité
    if (newPassword.length < 6) {
      throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
    }

    // Hashage du nouveau mot de passe
    const hashedNewPassword = await this.hashPassword({password: newPassword});
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword },
    });

    // Envoi d'un email de confirmation
    await this.mailService.sendPasswordChangeConfirmation(
      user.email,
      {
        recipientName: user.salonName || 'Salon',
        salonName: user.salonName || 'InkStudio'
      },
      user.salonName || undefined
    );

    return { message: "Mot de passe changé avec succès." };
    }
    catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      throw new Error(errorMessage);
    }
  }

  //! Méthode d'authentification :
  // Méthodes privées pour le hashage du mot de passe et la vérification du mot de passe
  private async hashPassword({password} : {password: string}) {
    const hashPassword =  await hash (password, 10);
    return hashPassword;
  }

  private async isPasswordValid({password, hashedPassword} : {password: string, hashedPassword: string}) {
    const isPasswordValid = await compare(password, hashedPassword);
    return isPasswordValid;
  }

  // Méthode pour générer un token d'authentification
  private authenticateUser(user: AuthenticatedUser): AuthTokenResponse {
    const payload: UserPayload = {userId: user.id, role: user.role}
    
    const access_token = this.jwtService.sign(payload);

    if (user.role === 'client') {
      return {
        access_token,
        id: user.id,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        clientProfile: user.clientProfile,
        image: user.image || null,
        agendaMode: user.agendaMode || null,
      }
    }
    
    return {
      access_token,
      id: user.id,
      salonName: user.salonName,
      role: user.role,
      email: user.email,
      image: user.image || null,
      profileImage: user.profileImage || null,
      saasPlan: user.saasPlan,
      agendaMode: user.agendaMode || null,
      phone: user.phone || "",
      address: user.address || "",
      verifiedSalon: user.verifiedSalon || false,
      salonHours: user.salonHours || null,
    }
  }

  // GOOGLE OAUTH - Authentifie/crée l'utilisateur puis retourne le token métier
  async loginWithGoogle(payload: {
    idToken: string;
  }): Promise<AuthTokenResponse> {
    const user = await this.validateGoogleUser(payload);

    return this.authenticateUser({
      id: user.id,
      role: user.role,
      salonName: user.salonName ?? null,
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      image: user.image ?? null,
      saasPlan: user.saasPlan ?? null,
      agendaMode: user.saasPlanDetails?.agendaMode ?? null,
      phone: user.phone ?? null,
      address: user.address ?? null,
      verifiedSalon: user.verifiedSalon ?? null,
      salonHours: user.salonHours ?? null,
      clientProfile: user.clientProfile
        ? {
            id: user.clientProfile.id,
            userId: user.clientProfile.userId,
            pseudo: user.clientProfile.pseudo ?? null,
            birthDate: user.clientProfile.birthDate ?? null,
            city: user.clientProfile.city ?? null,
            postalCode: user.clientProfile.postalCode ?? null,
          }
        : null,
    });
  }

  //! GOOGLE OAUTH - Validation et création d'utilisateur
  private async validateGoogleUser({ idToken }: { idToken: string }) {
    const { subject, email, firstName, lastName, image, isEmailAuthoritative } =
      await this.googleIdentity.verify(idToken);
    const include = {
      clientProfile: true,
      saasPlanDetails: { select: { agendaMode: true } },
    } as const;

    // Once linked, the stable Google subject identifies the account even if its email changes.
    const linkedUser = await this.prisma.user.findUnique({
      where: { googleSubject: subject },
      include,
    });
    if (linkedUser) return linkedUser;

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include,
    });

    if (existingUser) {
      if (existingUser.googleSubject || !isEmailAuthoritative) {
        throw new UnauthorizedException(
          'Connectez-vous avec votre mot de passe pour cette adresse email.',
        );
      }
      // Compare-and-set prevents a simultaneous login from replacing another Google identity.
      const linked = await this.prisma.user.updateMany({
        where: { id: existingUser.id, googleSubject: null },
        data: {
          googleSubject: subject,
          // Do not activate a password chosen before email ownership was proven.
          ...(!existingUser.emailVerified
            ? { emailVerified: new Date(), password: '' }
            : {}),
        },
      });
      if (linked.count !== 1) {
        throw new UnauthorizedException('Connexion Google à réessayer.');
      }
      return { ...existingUser, googleSubject: subject };
    }

    // Créer un nouvel utilisateur client avec Google
    const newUser = await this.prisma.user.create({
      data: {
        email,
        googleSubject: subject,
        firstName,
        lastName,
        image,
        password: '', // Pas de mot de passe pour Google OAuth
        role: 'client', // Par défaut client pour Google OAuth
        emailVerified: new Date(), // Email vérifié par Google
        clientProfile: {
          create: {
            // Profil client vide, sera complété plus tard par le client
          }
        }
      },
      include: {
        clientProfile: true,
        saasPlanDetails: {
          select: {
            agendaMode: true,
          },
        },
      }
    });

    return newUser;
  }
}
