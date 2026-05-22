import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Body,
  Headers,
  RawBodyRequest,
  BadRequestException,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { SaasPlan } from '@prisma/client';
import { Request } from 'express';
import Stripe from 'stripe';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import {
  StripeService,
  type ManagedPaidPlanResult,
  type CancelSubscriptionResult,
} from './stripe.service';
import { PrismaService } from 'src/database/prisma.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { SaasService } from 'src/saas/saas.service';
import { MailService } from 'src/email/mailer.service';
import {
  CheckoutPlan,
  STRIPE_API_VERSION,
  isCheckoutPlan,
  resolveStripeSecretKey,
} from './stripe.constants';

interface CreateCheckoutBody {
  plan?: unknown;
}

interface ChangePlanBody {
  plan?: unknown;
}

function isSaasPlan(value: unknown): value is SaasPlan {
  return Object.values(SaasPlan).some((plan) => plan === value);
}

const CHECKOUT_PLAN_TO_SAAS_PLAN: Record<CheckoutPlan, SaasPlan> = {
  PRO: SaasPlan.PRO,
  BUSINESS: SaasPlan.BUSINESS,
};

type StripePlanServiceContract = {
  ensurePaidPlan(
    userId: string,
    plan: CheckoutPlan,
  ): Promise<ManagedPaidPlanResult>;
  cancelSubscription(userId: string): Promise<CancelSubscriptionResult>;
};

type PaidPlanChangeResponse =
  | {
      mode: 'checkout';
      url: string;
      updated: false;
      alreadyOnTargetPlan: false;
    }
  | {
      mode: 'updated';
      url: string | null;
      updated: true;
      alreadyOnTargetPlan: boolean;
    };

@Controller('stripe')
export class StripeController {
  // Logger pour enregistrer les événements et erreurs
  private logger = new Logger('StripeController');

  // Instance Stripe pour vérifier les webhooks
  private stripe = new Stripe(resolveStripeSecretKey(), {
    apiVersion: STRIPE_API_VERSION,
  });

  constructor(
    private stripeService: StripeService,
    private prisma: PrismaService,
    private saasService: SaasService,
    private mailService: MailService,
  ) {}

  // Méthode pour vérifier si un événement Stripe a déjà été traité (idempotence)
  private async isWebhookEventAlreadyProcessed(eventId: string): Promise<boolean> {
    const existingEvent = await this.prisma.stripeWebhookEvent.findUnique({
      where: { eventId },
      select: { id: true },
    });

    return !!existingEvent;
  }

  // Méthode pour marquer un événement Stripe comme traité (enregistrer son ID dans la base de données)
  private async markWebhookEventAsProcessed(event: Stripe.Event): Promise<void> {
  // Idempotence webhook: évite de traiter deux fois le même événement Stripe.
    try {
      await this.prisma.stripeWebhookEvent.create({
        data: {
          eventId: event.id,
          eventType: event.type,
        },
      });
    } catch (error) {
      const prismaError = error as { code?: string };
  // Enregistre l'événement traité. En cas de concurrence, l'unicité DB
  // protège contre les doublons (code Prisma P2002).
      if (prismaError?.code !== 'P2002') {
        throw error;
      }
    }
  }

  // Méthode utilitaire pour trouver un utilisateur local à partir des références Stripe (subscriptionId ou customerId)
  private async findUserByStripeReferences(
    subscriptionId?: string | null,
    customerId?: string | null,
  ) {
    if (subscriptionId) {
      const userBySubscription = await this.prisma.user.findFirst({
        where: { stripeSubscriptionId: subscriptionId },
        select: {
          id: true,
  // Résout l'utilisateur local depuis les identifiants Stripe connus.
          email: true,
          salonName: true,
          firstName: true,
          lastName: true,
          saasPlan: true,
          saasPlanUntil: true,
          stripeSubscriptionId: true,
          stripeCustomerId: true,
        },
      });

      if (userBySubscription) {
        return userBySubscription;
      }
    }

    if (customerId) {
      return await this.prisma.user.findFirst({
        where: { stripeCustomerId: customerId },
        select: {
          id: true,
          email: true,
          salonName: true,
          firstName: true,
          lastName: true,
          saasPlan: true,
          saasPlanUntil: true,
          stripeSubscriptionId: true,
          stripeCustomerId: true,
        },
      });
    }

    return null;
  }

  // Méthode pour synchroniser le plan local de l'utilisateur avec l'état de sa souscription Stripe
  private async syncPlanFromStripeSubscription(
    userId: string,
    subscription: Stripe.Subscription,
  ) {
    const firstItem = subscription.items.data[0];
    const priceId =
      typeof firstItem?.price === 'string'
        ? firstItem.price
  // Synchronise le plan et le statut de facturation local en fonction de Stripe.
        : firstItem?.price?.id;

    if (!priceId) {
      this.logger.warn(
        `Impossible de déterminer le price ID pour la souscription ${subscription.id}`,
      );
      return;
    }

    const checkoutPlan = this.getCheckoutPlanFromPriceId(priceId);

    if (!checkoutPlan) {
      this.logger.warn(`Price ID Stripe non reconnu: ${priceId}`);
      return;
    }

    const targetPlan = CHECKOUT_PLAN_TO_SAAS_PLAN[checkoutPlan];
    const nextPaymentDate = this.getSubscriptionCurrentPeriodEnd(subscription);
    const trialEndDate = subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null;

    if (subscription.status === 'trialing') {
      await this.saasService.markSubscriptionTrialing(
        userId,
        targetPlan,
        trialEndDate,
      );
      return;
    }

    if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
      await this.saasService.markSubscriptionPastDue(
        userId,
        targetPlan,
        nextPaymentDate,
      );
      return;
    }

    await this.saasService.markSubscriptionActive(userId, targetPlan, nextPaymentDate);
  }

  // Méthode pour obtenir la date de fin de période actuelle d'une souscription Stripe
  private getSubscriptionCurrentPeriodEnd(
    subscription: Stripe.Subscription,
  ): Date | null {
    const rawSubscription = subscription as unknown as {
      current_period_end?: number;
    };

    if (!rawSubscription.current_period_end) {
      return null;
    }

    // Cast défensif: certains champs Stripe existent en runtime mais pas toujours
    // exposés de façon homogène par les typings du SDK.
    return new Date(rawSubscription.current_period_end * 1000);
  }

  // Méthode pour obtenir l'ID de souscription à partir d'une facture Stripe
  private getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    const rawInvoice = invoice as unknown as {
      subscription?: string | { id?: string } | null;
      parent?: {
        subscription_details?: {
          subscription?: string | null;
        };
      };
    };
    // On gère plusieurs formats possibles selon version/shape de l'objet invoice.

    const directSubscription = rawInvoice.subscription;

    if (typeof directSubscription === 'string') {
      return directSubscription;
    }

    if (directSubscription && typeof directSubscription.id === 'string') {
      return directSubscription.id;
    }

    return rawInvoice.parent?.subscription_details?.subscription ?? null;
  }

  private getStripePlanService(): StripePlanServiceContract {
    // On se limite volontairement au contrat utilisé par ce contrôleur:
    // plus simple à lire et plus simple à mocker dans les tests.
    return this.stripeService as unknown as StripePlanServiceContract;
  }

  private async applyPaidPlanChange(
    userId: string,
    plan: CheckoutPlan,
    // Événement Stripe envoyé en général 3 jours avant la fin d'essai.
  ): Promise<PaidPlanChangeResponse> {
    /*
     * Cette méthode centralise tous les passages vers un plan payant.
     * Le contrôleur n'a donc qu'une seule logique à gérer pour:
     * - FREE -> payant
     * - payant -> autre payant
     * - réactivation d'une souscription déjà planifiée pour s'arrêter
     */
    const stripePlanService = this.getStripePlanService();
    const targetSaasPlan = CHECKOUT_PLAN_TO_SAAS_PLAN[plan];
    const result = await stripePlanService.ensurePaidPlan(userId, plan);

    if (result.mode === 'checkout') {
      return {
        mode: 'checkout' as const,
        url: result.url,
        updated: false,
        alreadyOnTargetPlan: false,
      };
    }

    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        saasPlan: true,
        stripeSubscriptionId: true,
      },
    });

    const shouldSyncPlan =
      !result.alreadyOnTargetPlan ||
      !currentUser ||
      currentUser.saasPlan !== targetSaasPlan;

    if (shouldSyncPlan) {
      // On garde la base locale alignée avec l'état Stripe attendu.
    // Le paiement a échoué: on passe le compte en PAST_DUE côté métier.
      await this.saasService.updateUserPlan(userId, targetSaasPlan);
    }

    if (!currentUser || currentUser.stripeSubscriptionId !== result.subscriptionId) {
      // Même après un update direct Stripe, on conserve l'ID exact en base locale.
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          stripeSubscriptionId: result.subscriptionId,
        },
      });
    }

    return {
      mode: 'updated' as const,
      url: null as string | null,
      updated: true,
      alreadyOnTargetPlan: result.alreadyOnTargetPlan,
    };
  }

  private getCheckoutPlanFromPriceId(priceId: string): CheckoutPlan | null {
    const proPriceId = process.env.STRIPE_PRICE_PRO;
    const businessPriceId = process.env.STRIPE_PRICE_BUSINESS;

    if (proPriceId && priceId === proPriceId) {
      return 'PRO';
    }

    if (businessPriceId && priceId === businessPriceId) {
      return 'BUSINESS';
    }

    return null;
  }

  /**
   * Route POST /stripe/checkout
   * Crée une session de checkout Stripe et retourne l'URL
    // Le paiement est régularisé/réussi: retour automatique en ACTIVE.
   * L'utilisateur est redirigé vers Stripe pour entrer ses informations de paiement
   * 
   * 🔐 SÉCURITÉ: Cette route est protégée par JwtAuthGuard
   * Seul un utilisateur connecté peut créer une session de checkout
   */
  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  async createCheckout(
    @Req() req: RequestWithUser,
    @Body() body: CreateCheckoutBody,
  ) {
    try {
      /*
       * Récupérer l'ID utilisateur depuis l'authentification
       * req.user.userId est GARANTI d'exister grâce au JwtAuthGuard
       * Le guard rejette automatiquement les requêtes sans token valide
       */
      const userId = req.user.userId;

      /*
       * Récupérer le plan depuis le corps de la requête
        * Le frontend envoie: { plan: 'PRO' } ou { plan: 'BUSINESS' }
       */
      const { plan } = body;

      // Valider que le plan est correct
      if (!isCheckoutPlan(plan)) {
        throw new BadRequestException(
          'Plan invalide. Utilisez PRO ou BUSINESS',
        );
      }

      const change = await this.applyPaidPlanChange(userId, plan);

      if (change.mode === 'checkout') {
        return {
          url: change.url,
          updated: false,
          // Ici le front doit rediriger vers Stripe Checkout.
          message: `Session checkout ${plan} créée avec succès`,
        };
      }

      return {
        url: change.url,
        updated: true,
        alreadyOnTargetPlan: change.alreadyOnTargetPlan,
        // Ici aucun écran Stripe n'est nécessaire: la souscription a été modifiée directement.
        message: change.alreadyOnTargetPlan
          ? `Le plan ${plan} est déjà actif.`
          : `Abonnement mis à jour vers ${plan} avec succès.`,
      };
    } catch (error) {
      this.logger.error('Erreur lors de la création du checkout', error);
      throw error;
    }
  }

  /**
   * Route POST /stripe/change-plan
   * Gère les transitions d'abonnement depuis les paramètres du compte:
   * - FREE -> PRO/BUSINESS (checkout ou update direct selon état Stripe)
   * - PRO/BUSINESS -> PRO/BUSINESS (update direct de la souscription)
   * - PRO/BUSINESS -> FREE (résiliation)
   */
  @UseGuards(JwtAuthGuard)
  @Post('change-plan')
  async changePlan(
    @Req() req: RequestWithUser,
    @Body() body: ChangePlanBody,
  ) {
    try {
      const userId = req.user.userId;
      const { plan } = body;

      if (!isSaasPlan(plan)) {
        throw new BadRequestException(
          'Plan invalide. Utilisez FREE, PRO ou BUSINESS',
        );
      }

      if (plan === SaasPlan.FREE) {
        const currentUser = await this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            saasPlan: true,
          },
        });
        const stripePlanService = this.getStripePlanService();
        const cancelResult = await stripePlanService.cancelSubscription(userId);

        if (!cancelResult.hadSubscription) {
          // Aucune souscription Stripe active: on peut passer localement en FREE tout de suite.
          await this.saasService.updateUserPlan(userId, SaasPlan.FREE, null);

          await this.prisma.user.update({
            where: { id: userId },
            data: {
              stripeSubscriptionId: null,
            },
          });

          return {
            updated: true,
            plan: SaasPlan.FREE,
            scheduledPlan: SaasPlan.FREE,
            hadStripeSubscription: false,
            cancelAtPeriodEnd: false,
            currentPeriodEnd: null,
            alreadyScheduled: false,
            message: 'Aucun abonnement Stripe actif. Le plan FREE est maintenant actif.',
          };
        }

        const currentPaidPlan = cancelResult.currentPlan
          ? CHECKOUT_PLAN_TO_SAAS_PLAN[cancelResult.currentPlan]
          : currentUser?.saasPlan && currentUser.saasPlan !== SaasPlan.FREE
            ? currentUser.saasPlan
            : null;

        if (currentPaidPlan && currentPaidPlan !== SaasPlan.FREE) {
          // La période payée reste valable jusqu'à la date retournée par Stripe.
          await this.saasService.updateUserPlan(
            userId,
            currentPaidPlan,
            cancelResult.currentPeriodEnd,
          );
        }

        return {
          updated: true,
          // `plan` = plan encore actif pendant la période déjà payée.
          plan: currentPaidPlan ?? currentUser?.saasPlan ?? null,
          // `scheduledPlan` = plan visé une fois la période en cours terminée.
          scheduledPlan: SaasPlan.FREE,
          hadStripeSubscription: cancelResult.hadSubscription,
          cancelAtPeriodEnd: cancelResult.cancelAtPeriodEnd,
          currentPeriodEnd: cancelResult.currentPeriodEnd
            ? cancelResult.currentPeriodEnd.toISOString()
            : null,
          alreadyScheduled: cancelResult.alreadyScheduled,
          message: cancelResult.currentPeriodEnd
            ? `Abonnement programmé pour se terminer le ${cancelResult.currentPeriodEnd.toISOString()}. Le plan FREE prendra effet à cette date.`
            : 'Abonnement programmé pour se terminer à la fin de la période en cours.',
        };
      }

      if (!isCheckoutPlan(plan)) {
        throw new BadRequestException(
          'Plan payant invalide. Utilisez PRO ou BUSINESS',
        );
      }

      const change = await this.applyPaidPlanChange(userId, plan);

      if (change.mode === 'checkout') {
        return {
          updated: false,
          plan,
          url: change.url,
          // Le front doit ouvrir Stripe Checkout pour finaliser le paiement.
          message: `Session checkout ${plan} créée avec succès`,
        };
      }

      return {
        updated: true,
        plan,
        url: change.url,
        alreadyOnTargetPlan: change.alreadyOnTargetPlan,
        // Le changement a été fait sans redirection car Stripe a pu mettre à jour la souscription existante.
        message: change.alreadyOnTargetPlan
          ? `Le plan ${plan} est déjà actif.`
          : `Abonnement mis à jour vers ${plan} avec succès.`,
      };
    } catch (error) {
      this.logger.error('Erreur lors du changement de plan', error);
      throw error;
    }
  }

  /**
   * Route GET /stripe/invoices
   * Retourne toutes les factures Stripe de l'utilisateur connecté.
   * Chaque entrée contient le montant, la période, le statut, un lien PDF
   * et un lien vers la page Stripe hébergée.
   *
   * Usage front: afficher l'historique de facturation dans les paramètres du compte.
   */
  @UseGuards(JwtAuthGuard)
  @Get('invoices')
  async getInvoices(
    @Req() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // On convertit les query params en entiers avec des valeurs par défaut sûres.
    const parsedPage = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit ?? '5', 10) || 5));
    return this.stripeService.getInvoices(req.user.userId, parsedPage, parsedLimit);
  }

  /**
   * Route GET /stripe/portal
   * Crée une session du Portail Client Stripe et retourne son URL.
   * Ce portail hébergé par Stripe permet à l'utilisateur de:
   * - Télécharger toutes ses factures en PDF
   * - Voir l'historique de facturation complet
   * - Mettre à jour son moyen de paiement
   *
   * Prérequis: configurer le Portail Client dans Stripe Dashboard
   * (Billing > Customer portal > Activer).
   *
   * Usage front: ouvrir l'URL retournée dans un nouvel onglet.
   */
  @UseGuards(JwtAuthGuard)
  @Get('portal')
  async getPortalSession(@Req() req: RequestWithUser) {
    const url = await this.stripeService.createPortalSession(req.user.userId);
    return { url };
  }

  /**
   * Route POST /stripe/webhook
   * Reçoit les événements Stripe (paiement réussi, annulé, etc.)
   * À configurer dans le tableau de bord Stripe: https://dashboard.stripe.com
   *
   * IMPORTANT: Cette route doit être PUBLIQUE (pas de JwtAuthGuard)
   * car Stripe l'appelle sans authentification
   */
  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    try {
      /*
       * req.rawBody contient la requête brute (non parsée)
       * Stripe exige le body brut pour calculer et vérifier la signature
       * (c'est une mesure de sécurité pour prouver que Stripe a envoyé ce webhook)
       */
      const signatureFromHeaders = req.headers['stripe-signature'];
      const resolvedSignature =
        signature ??
        (Array.isArray(signatureFromHeaders)
          ? signatureFromHeaders[0]
          : signatureFromHeaders);

      if (!resolvedSignature) {
        throw new BadRequestException('Signature Stripe manquante');
      }

      // Supporte les deux modes: rawBody NestJS et bodyParser.raw (Buffer dans req.body)
      const payload =
        req.rawBody ??
        (Buffer.isBuffer(req.body)
          ? req.body
          : typeof req.body === 'string'
            ? Buffer.from(req.body, 'utf8')
            : undefined);

      if (!payload) {
        throw new BadRequestException('Payload webhook manquant');
      }

      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        throw new BadRequestException('STRIPE_WEBHOOK_SECRET manquant');
      }

      // ✅ ÉTAPE 1 : Vérifier la signature du webhook
      /*
       * constructEvent fait deux choses:
       * 1. Vérifie que la signature est valide (provient vraiment de Stripe)
       * 2. Récupère l'événement Stripe
       * Si la signature est fausse, une erreur est levée
       *
       * STRIPE_WEBHOOK_SECRET: clé secrète du webhook (depuis Stripe dashboard)
       */
      const event = this.stripe.webhooks.constructEvent(
        payload,
        resolvedSignature,
        webhookSecret,
      );

      if (await this.isWebhookEventAlreadyProcessed(event.id)) {
        this.logger.warn(`Webhook déjà traité, ignore: ${event.id}`);
        return { received: true };
      }

      this.logger.debug(`Webhook reçu: ${event.type}`);

      // ✅ ÉTAPE 2 : Gérer les différents types d'événements
      /*
       * Stripe envoie plusieurs types d'événements, on traite celui qui nous intéresse:
       * - checkout.session.completed: paiement réussi ✅
       * - charge.failed: paiement échoué
       * - customer.subscription.deleted: abonnement annulé
       * etc.
       */
      if (event.type === 'checkout.session.completed') {
        await this.handleCheckoutSessionCompleted(event);
      } else if (event.type === 'customer.subscription.trial_will_end') {
        await this.handleSubscriptionTrialWillEnd(event);
      } else if (event.type === 'invoice.payment_failed') {
        await this.handleInvoicePaymentFailed(event);
      } else if (event.type === 'invoice.payment_succeeded') {
        await this.handleInvoicePaymentSucceeded(event);
      } else if (event.type === 'customer.subscription.deleted') {
        await this.handleSubscriptionDeleted(event);
      } else if (event.type === 'customer.subscription.updated') {
        await this.handleSubscriptionUpdated(event);
      } else {
        this.logger.debug(`Événement non traité: ${event.type}`);
      }

      await this.markWebhookEventAsProcessed(event);

      // Confirmer à Stripe que le webhook a été reçu
      return { received: true };
    } catch (error) {
      this.logger.error('Erreur webhook Stripe', error);
      /*
       * Important: toujours retourner 200 OK à Stripe même en cas d'erreur
       * sinon Stripe va réessayer indéfiniment
       * Enregistrer l'erreur pour enquête manuelle
       */
      throw new BadRequestException('Erreur webhook');
    }
  }

  /**
   * Traite l'événement "paiement réussi"
   * L'utilisateur a complété l'achat et le paiement est validé
   */
  private async handleCheckoutSessionCompleted(event: Stripe.Event) {
    const session = event.data.object as Stripe.Checkout.Session;

    // Récupérer les métadonnées stockées lors de la création de la session
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;

    if (!userId || !isCheckoutPlan(plan)) {
      this.logger.warn('Métadonnées Stripe invalides dans le webhook');
      return;
    }

    if (!subscriptionId) {
      this.logger.warn('Abonnement Stripe manquant dans le webhook');
      return;
    }

    this.logger.log(`✅ Paiement validé pour l'utilisateur ${userId}, plan: ${plan}`);

    // ✅ Mettre à jour l'utilisateur en base de données
    /*
     * Une fois le paiement validé, on enregistre:
      * 1. plan: le nouveau plan de l'utilisateur (PRO ou BUSINESS)
     * 2. stripeSubscriptionId: l'ID de l'abonnement pour:
     *    - Pouvoir l'annuler (changer de plan, cancellation)
     *    - Suivre les renouvellements
     *    - Gérer les factures
     */
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['items.data.price'],
      });

      await this.syncPlanFromStripeSubscription(userId, subscription);

      const userStripeUpdate: {
        stripeSubscriptionId: string;
        stripeCustomerId?: string;
      } = {
        stripeSubscriptionId: subscriptionId,
      };

      if (customerId) {
        userStripeUpdate.stripeCustomerId = customerId;
      }

      await this.prisma.user.update({
        where: { id: userId },
        data: userStripeUpdate,
      });

      this.logger.log(`Utilisateur ${userId} passé au plan ${plan}`);
    } catch (error) {
      this.logger.error(
        `Erreur lors de la mise à jour de l'utilisateur ${userId}`,
        error,
      );
      throw error;
    }
  }

  private async handleSubscriptionTrialWillEnd(event: Stripe.Event) {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

    const user = await this.findUserByStripeReferences(subscription.id, customerId);

    if (!user || !user.email) {
      this.logger.warn(
        `Aucun utilisateur local trouvé pour le rappel de fin d'essai ${subscription.id}`,
      );
      return;
    }

    const trialEndDate = subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null;

    if (!trialEndDate) {
      this.logger.warn(`trial_end absent pour la souscription ${subscription.id}`);
      return;
    }

    const recipientName = user.firstName || user.salonName || 'Salon';

    await this.mailService.sendTrialEndingSoonReminder(user.email, {
      recipientName,
      salonName: user.salonName,
      trialEndDate: trialEndDate.toLocaleDateString('fr-FR'),
    });

    this.logger.log(`Rappel de fin d'essai envoyé au salon ${user.id}`);
  }

  private async handleInvoicePaymentFailed(event: Stripe.Event) {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = this.getInvoiceSubscriptionId(invoice);
    const customerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

    const user = await this.findUserByStripeReferences(subscriptionId, customerId);

    if (!user) {
      this.logger.warn(
        `Aucun utilisateur local trouvé pour invoice.payment_failed (invoice ${invoice.id})`,
      );
      return;
    }

    if (!subscriptionId) {
      this.logger.warn(
        `Souscription manquante dans invoice.payment_failed (invoice ${invoice.id})`,
      );
      return;
    }

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price'],
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        stripeSubscriptionId: subscriptionId,
        ...(customerId ? { stripeCustomerId: customerId } : {}),
      },
    });

    await this.syncPlanFromStripeSubscription(user.id, subscription);

    this.logger.log(`Compte ${user.id} marqué en past_due`);
  }

  private async handleInvoicePaymentSucceeded(event: Stripe.Event) {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = this.getInvoiceSubscriptionId(invoice);
    const customerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

    const user = await this.findUserByStripeReferences(subscriptionId, customerId);

    if (!user) {
      this.logger.warn(
        `Aucun utilisateur local trouvé pour invoice.payment_succeeded (invoice ${invoice.id})`,
      );
      return;
    }

    if (!subscriptionId) {
      this.logger.warn(
        `Souscription manquante dans invoice.payment_succeeded (invoice ${invoice.id})`,
      );
      return;
    }

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price'],
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        stripeSubscriptionId: subscriptionId,
        ...(customerId ? { stripeCustomerId: customerId } : {}),
      },
    });

    await this.syncPlanFromStripeSubscription(user.id, subscription);

    this.logger.log(`Paiement confirmé et plan synchronisé pour ${user.id}`);
  }

  /**
   * Traite l'événement "abonnement annulé"
   * L'utilisateur a anuulé son abonnement (depuis Stripe dashboard ou via votre API)
   */
  private async handleSubscriptionDeleted(event: Stripe.Event) {
    const subscription = event.data.object as Stripe.Subscription;

    this.logger.log(`❌ Abonnement annulé: ${subscription.id}`);

    /*
     * Rechercher l'utilisateur ayant cet abonnement
     * et le repasser à un plan gratuit (ou le désactiver)
     */
    const user = await this.prisma.user.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (user) {
      await this.saasService.updateUserPlan(user.id, SaasPlan.FREE, null);

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          stripeSubscriptionId: null,
        },
      });

      this.logger.log(`Utilisateur ${user.id} repassed au plan FREE`);
    }
  }

  /**
   * Traite l'événement "abonnement mis à jour"
   * Utile si l'utilisateur change de plan
   */
  private async handleSubscriptionUpdated(event: Stripe.Event) {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

    this.logger.log(`🔄 Abonnement mis à jour: ${subscription.id}`);

    const user = await this.findUserByStripeReferences(subscription.id, customerId);

    if (!user) {
      this.logger.warn(
        `Aucun utilisateur local trouvé pour la souscription ${subscription.id}`,
      );
      return;
    }

    if (user.stripeSubscriptionId !== subscription.id) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          stripeSubscriptionId: subscription.id,
        },
      });
    }

    if (subscription.status === 'canceled') {
      // Stripe considère l'abonnement comme réellement terminé: on coupe l'accès local.
      await this.saasService.updateUserPlan(user.id, SaasPlan.FREE, null);

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          stripeSubscriptionId: null,
        },
      });

      this.logger.log(`Utilisateur ${user.id} repassé au plan FREE`);
      return;
    }

    await this.syncPlanFromStripeSubscription(user.id, subscription);

    const firstItem = subscription.items.data[0];
    const priceId =
      typeof firstItem?.price === 'string'
        ? firstItem.price
        : firstItem?.price?.id;

    if (!priceId) {
      this.logger.warn(
        `Impossible de déterminer le price ID pour la souscription ${subscription.id}`,
      );
      return;
    }

    const checkoutPlan = this.getCheckoutPlanFromPriceId(priceId);

    if (!checkoutPlan) {
      this.logger.warn(`Price ID Stripe non reconnu: ${priceId}`);
      return;
    }

    const targetPlan = CHECKOUT_PLAN_TO_SAAS_PLAN[checkoutPlan];
    const currentPeriodEnd = subscription.cancel_at
      ? new Date(subscription.cancel_at * 1000)
      : null;

    // Quand Stripe planifie une fin de période, on répercute aussi cette date
    // dans `saasPlanUntil` pour que le back sache jusqu'à quand l'accès reste valable.
    const shouldSyncScheduledEnd =
      subscription.cancel_at_period_end &&
      !!currentPeriodEnd &&
      !user.saasPlanUntil;

    if (shouldSyncScheduledEnd) {
      await this.saasService.updateUserPlan(
        user.id,
        targetPlan,
        subscription.cancel_at_period_end ? currentPeriodEnd : undefined,
      );
    }

    this.logger.log(
      `Utilisateur ${user.id} synchronisé sur le plan ${checkoutPlan}`,
    );

    // TODO: gérer ici d'autres attributs métier liés au statut Stripe si nécessaire.
  }
}