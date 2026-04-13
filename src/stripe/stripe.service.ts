import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import Stripe from 'stripe';
import { CheckoutPlan, STRIPE_API_VERSION } from './stripe.constants';

const URL_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;
const UPDATABLE_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
  'active',
  'trialing',
  'past_due',
  'unpaid',
]);

export type ManagedPaidPlanResult =
  // `checkout`: il faut envoyer l'utilisateur vers Stripe pour finaliser le paiement.
  | { mode: 'checkout'; url: string }
  // `updated`: une souscription Stripe existante a pu être modifiée directement.
  | {
      mode: 'updated';
      subscriptionId: string;
      alreadyOnTargetPlan: boolean;
    };

export type CancelSubscriptionResult = {
  // Indique si une vraie souscription Stripe active a été trouvée côté Stripe.
  hadSubscription: boolean;
  // Vrai quand on demande à Stripe d'arrêter à la fin de la période courante.
  cancelAtPeriodEnd: boolean;
  // Date effective de fin d'accès quand Stripe la fournit.
  currentPeriodEnd: Date | null;
  // Plan actuellement porté par la souscription Stripe avant retour à FREE.
  currentPlan: CheckoutPlan | null;
  // Permet au front de savoir si la résiliation était déjà planifiée.
  alreadyScheduled: boolean;
};

type StripeUserSnapshot = {
  id: string;
  email: string;
  salonName: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

@Injectable()
export class StripeService {
  // Instance Stripe initialisée avec la clé secrète
  private stripe: Stripe;

  constructor(private prisma: PrismaService) {
    /*
     * Initialise le client Stripe avec:
     * - STRIPE_SECRET_KEY: clé secrète depuis les variables d'env
     * - apiVersion: version d'API supportée par le SDK Stripe installé
     */
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: STRIPE_API_VERSION,
    });
  }

  private getFrontendBaseUrl() {
    const rawBaseUrl = process.env.FRONTEND_URL ?? process.env.FRONT_URL;

    if (!rawBaseUrl) {
      throw new BadRequestException(
        'Configuration manquante: définissez FRONTEND_URL ou FRONT_URL.',
      );
    }

    const trimmedBaseUrl = rawBaseUrl.trim();

    if (!trimmedBaseUrl) {
      throw new BadRequestException(
        'Configuration invalide: FRONTEND_URL ou FRONT_URL est vide.',
      );
    }

    const normalizedBaseUrl = URL_SCHEME_REGEX.test(trimmedBaseUrl)
      ? trimmedBaseUrl
      : trimmedBaseUrl.startsWith('localhost') ||
          trimmedBaseUrl.startsWith('127.0.0.1')
        ? `http://${trimmedBaseUrl}`
        : `https://${trimmedBaseUrl}`;

    try {
      return new URL(normalizedBaseUrl).origin;
    } catch {
      throw new BadRequestException(
        `Configuration URL invalide: "${rawBaseUrl}". Exemple attendu: https://mon-front.com`,
      );
    }
  }

  private getPriceIdForPlan(plan: CheckoutPlan) {
    const priceId =
      plan === 'BUSINESS'
        ? process.env.STRIPE_PRICE_BUSINESS
        : process.env.STRIPE_PRICE_PRO;

    if (!priceId) {
      throw new BadRequestException(
        plan === 'BUSINESS'
          ? 'Price ID non configuré pour BUSINESS (STRIPE_PRICE_BUSINESS).'
          : 'Price ID non configuré pour PRO (STRIPE_PRICE_PRO).',
      );
    }

    return priceId;
  }

  private getCheckoutPlanFromPriceId(priceId: string): CheckoutPlan | null {
    const businessPriceId = process.env.STRIPE_PRICE_BUSINESS;
    const proPriceId = process.env.STRIPE_PRICE_PRO;

    if (businessPriceId && priceId === businessPriceId) {
      return 'BUSINESS';
    }

    if (proPriceId && priceId === proPriceId) {
      return 'PRO';
    }

    return null;
  }

  private getCheckoutPlanFromSubscription(
    subscription: Stripe.Subscription,
  ): CheckoutPlan | null {
    const firstItem = subscription.items.data[0];
    const priceId =
      typeof firstItem?.price === 'string'
        ? firstItem.price
        : firstItem?.price?.id;

    if (!priceId) {
      return null;
    }

    return this.getCheckoutPlanFromPriceId(priceId);
  }

  private isResourceMissingError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'resource_missing'
    );
  }

  private isUpdatableSubscriptionStatus(status: Stripe.Subscription.Status) {
    return UPDATABLE_SUBSCRIPTION_STATUSES.has(status);
  }

  private async getUserOrThrow(userId: string): Promise<StripeUserSnapshot> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        salonName: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`Utilisateur ${userId} introuvable`);
    }

    return user;
  }

  private async persistStripeCustomerId(userId: string, customerId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        stripeCustomerId: customerId,
      },
    });
  }

  private async persistStripeSubscriptionId(
    userId: string,
    subscriptionId: string | null,
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        stripeSubscriptionId: subscriptionId,
      },
    });
  }

  private async getOrCreateCustomerId(user: StripeUserSnapshot) {
    if (user.stripeCustomerId) {
      return user.stripeCustomerId;
    }

    const customer = await this.stripe.customers.create({
      email: user.email,
      name: user.salonName || user.email,
    });

    await this.persistStripeCustomerId(user.id, customer.id);
    return customer.id;
  }

  private async retrieveUpdatableStoredSubscription(
    user: StripeUserSnapshot,
  ): Promise<Stripe.Subscription | null> {
    // On essaie d'abord l'ID stocké localement: c'est le chemin le plus rapide
    // quand la base est déjà synchronisée avec Stripe.
    const subscriptionId = user.stripeSubscriptionId;

    if (!subscriptionId) {
      return null;
    }

    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        subscriptionId,
        {
          expand: ['items.data.price'],
        },
      );

      if (!this.isUpdatableSubscriptionStatus(subscription.status)) {
        if (subscription.status === 'canceled') {
          // On nettoie l'ID local s'il pointe vers une souscription déjà terminée.
          await this.persistStripeSubscriptionId(user.id, null);
        }

        return null;
      }

      return subscription;
    } catch (error) {
      if (!this.isResourceMissingError(error)) {
        throw error;
      }

      // L'ID local est stale côté Stripe: on le remet à null puis on laissera
      // le fallback par customerId retrouver une éventuelle souscription valide.
      await this.persistStripeSubscriptionId(user.id, null);
      return null;
    }
  }

  private async findLatestUpdatableSubscription(
    customerId: string,
  ): Promise<Stripe.Subscription | null> {
    // Fallback de sécurité: si l'ID de souscription local est absent ou périmé,
    // on reprend la dernière souscription Stripe encore exploitable pour ce client.
    const subscriptions = await this.stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 10,
      expand: ['data.items.data.price'],
    });

    return (
      subscriptions.data.find((subscription) =>
        this.isUpdatableSubscriptionStatus(subscription.status),
      ) ?? null
    );
  }

  /**
   * Crée une session de checkout Stripe pour l'abonnement
   * @param userId - ID de l'utilisateur qui s'abonne
   * @param plan - Type de plan: 'PRO' ou 'BUSINESS'
   * @returns URL de redirection vers le checkout Stripe
   */
  async createCheckoutSession(userId: string, plan: CheckoutPlan): Promise<string> {
    const frontendBaseUrl = this.getFrontendBaseUrl();

    const user = await this.getUserOrThrow(userId);
    const customerId = await this.getOrCreateCustomerId(user);
    const priceId = this.getPriceIdForPlan(plan);

    // ✅ ÉTAPE 4 : Créer la session de checkout Stripe
    /*
     * La session de checkout est l'intermédiaire qui:
     * 1. Redirige l'utilisateur vers le formulaire de paiement Stripe
     * 2. Traite les informations de paiement de manière sécurisée
     * 3. Revient à success_url ou cancel_url selon le résultat
     */
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription', // Mode abonnement (pas one-time payment)
      customer: customerId, // Lier à ce customer Stripe

      line_items: [
        {
          price: priceId, // Le prix à facturer
          quantity: 1, // Quantité d'abonnements
        },
      ],

      /*
       * URLs de redirection après le paiement:
       * - success_url: l'utilisateur reviendra ici après paiement réussi
       * - cancel_url: l'utilisateur reviendra ici s'il annule le paiement
       */
      success_url: `${frontendBaseUrl}/success`,
      cancel_url: `${frontendBaseUrl}/cancel`,

      /*
       * Métadonnées stockées dans le webhook Stripe:
       * Utiles pour identifier l'utilisateur et le plan lors du webhook
       * (car le webhook ne peut pas accéder directement à votre BDD)
       */
      metadata: {
        userId: user.id,
        plan: plan,
      },
    });

    if (!session.url) {
      throw new BadRequestException(
        'Stripe n\'a pas retourné d\'URL de checkout.',
      );
    }

    // Retourner l'URL du checkout pour rediriger le client
    return session.url;
  }

  async ensurePaidPlan(
    userId: string,
    plan: CheckoutPlan,
  ): Promise<ManagedPaidPlanResult> {
    /*
     * Point d'entrée unique pour aller vers un plan payant.
     * - pas de souscription Stripe active -> on crée une session Checkout
     * - souscription active existante -> on met à jour l'abonnement directement
     * - souscription déjà sur le bon plan -> on remonte juste l'état actuel
     */
    const user = await this.getUserOrThrow(userId);
    const customerId = await this.getOrCreateCustomerId(user);
    const targetPriceId = this.getPriceIdForPlan(plan);

    // 1) On privilégie la souscription déjà connue localement.
    let subscription: Stripe.Subscription | null =
      await this.retrieveUpdatableStoredSubscription(user);

    if (!subscription) {
      // 2) Si la base locale est incomplète, on repart de Stripe via le customer.
      subscription = await this.findLatestUpdatableSubscription(customerId);

      if (subscription) {
        await this.persistStripeSubscriptionId(user.id, subscription.id);
      }
    }

    if (!subscription) {
      // Aucun abonnement actif à modifier: il faut repasser par Checkout.
      const url = await this.createCheckoutSession(user.id, plan);
      return { mode: 'checkout', url };
    }

    const subscriptionItem = subscription.items.data[0];

    if (!subscriptionItem) {
      // Cas anormal: on préfère repartir sur un Checkout propre plutôt que
      // bricoler une souscription Stripe sans item exploitable.
      const url = await this.createCheckoutSession(user.id, plan);
      return { mode: 'checkout', url };
    }

    const currentPriceId =
      typeof subscriptionItem.price === 'string'
        ? subscriptionItem.price
        : subscriptionItem.price.id;

    const alreadyOnTargetPlan =
      currentPriceId === targetPriceId && !subscription.cancel_at_period_end;

    if (alreadyOnTargetPlan) {
      // Rien à changer côté Stripe: la souscription est déjà dans l'état attendu.
      return {
        mode: 'updated',
        subscriptionId: subscription.id,
        alreadyOnTargetPlan: true,
      };
    }

    // Mise à jour directe de la souscription existante:
    // - on retire une éventuelle fin programmée si l'utilisateur revient sur du payant
    // - on applique la nouvelle price Stripe
    // - on laisse Stripe gérer le prorata
    const updatedSubscription = await this.stripe.subscriptions.update(
      subscription.id,
      {
        cancel_at_period_end: false,
        proration_behavior: 'create_prorations',
        items: [
          {
            id: subscriptionItem.id,
            price: targetPriceId,
          },
        ],
        metadata: {
          userId: user.id,
          plan,
        },
      },
    );

    await this.persistStripeSubscriptionId(user.id, updatedSubscription.id);

    return {
      mode: 'updated',
      subscriptionId: updatedSubscription.id,
      alreadyOnTargetPlan: false,
    };
  }

  /**
   * Retourne la liste des factures Stripe de l'utilisateur.
   * Chaque facture correspond à un mois d'abonnement prélevé.
   * Le front peut utiliser `pdfUrl` pour proposer un téléchargement direct
   * ou `hostedUrl` pour renvoyer l'utilisateur vers la page Stripe de la facture.
   */
  async getInvoices(userId: string, page = 1, limit = 5) {
    const user = await this.getUserOrThrow(userId);

    if (!user.stripeCustomerId) {
      // L'utilisateur n'a jamais eu de compte Stripe: aucune facture à retourner.
      return {
        invoices: [],
        total: 0,
        page: 1,
        limit,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      };
    }

    // On récupère jusqu'à 100 factures en une seule requête Stripe (couvre ~8 ans
    // d'abonnement mensuel) puis on pagine en mémoire pour exposer une API
    // page/limit classique au frontend sans gérer de curseur côté client.
    const invoiceList = await this.stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 100,
    });

    const allInvoices = invoiceList.data.map((invoice) => ({
      id: invoice.id,
      // Référence lisible affichée sur le PDF (ex: "INV-0001").
      number: invoice.number,
      // Valeurs possibles: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void'
      status: invoice.status,
      // Montant réellement prélevé, converti en unité monétaire (cents -> euros/dollars).
      amount: invoice.amount_paid / 100,
      currency: invoice.currency.toUpperCase(),
      // Date de création de la facture.
      date: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
      // Période couverte par cette facture.
      periodStart: invoice.period_start
        ? new Date(invoice.period_start * 1000).toISOString()
        : null,
      periodEnd: invoice.period_end
        ? new Date(invoice.period_end * 1000).toISOString()
        : null,
      // Lien direct pour télécharger le PDF de la facture.
      pdfUrl: invoice.invoice_pdf,
      // Lien vers la page Stripe hébergée (affichage en ligne).
      hostedUrl: invoice.hosted_invoice_url,
      // La facture est considérée payée quand Stripe indique status='paid'.
      paid: invoice.status === 'paid',
    }));

    const total = allInvoices.length;
    const totalPages = Math.ceil(total / limit);
    // Clamp la page entre 1 et totalPages pour éviter un slice hors bornes.
    const safePage = Math.max(1, Math.min(page, totalPages || 1));
    const skip = (safePage - 1) * limit;
    const invoices = allInvoices.slice(skip, skip + limit);

    return {
      invoices,
      total,
      page: safePage,
      limit,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1,
    };
  }

  /**
   * Crée une session du Portail Client Stripe.
   * Ce portail hébergé par Stripe permet à l'utilisateur de:
   * - Télécharger toutes ses factures
   * - Mettre à jour son moyen de paiement
   * - Voir l'historique de facturation
   *
   * Prérequis: activer et configurer le Portail Client dans Stripe Dashboard
   * (Billing > Customer portal).
   *
   * @returns URL vers le portail Stripe à ouvrir côté front.
   */
  async createPortalSession(userId: string): Promise<string> {
    const user = await this.getUserOrThrow(userId);

    if (!user.stripeCustomerId) {
      throw new BadRequestException(
        'Aucun compte de facturation associé à cet utilisateur.',
      );
    }

    const frontendBaseUrl = this.getFrontendBaseUrl();

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      // URL vers laquelle l'utilisateur est redirigé après avoir quitté le portail.
      return_url: `${frontendBaseUrl}/parametres`,
    });

    return session.url;
  }

  async cancelSubscription(userId: string): Promise<CancelSubscriptionResult> {
    /*
     * Règle métier:
     * - s'il existe une souscription payante active, on programme sa fin à la
     *   fin de la période en cours pour ne pas couper un mois déjà payé
     * - s'il n'existe plus de souscription active, l'appelant peut basculer
     *   immédiatement l'utilisateur en FREE en base locale
     */
    const user = await this.getUserOrThrow(userId);

    let subscription: Stripe.Subscription | null = null;

    if (user.stripeSubscriptionId) {
      try {
        subscription = await this.stripe.subscriptions.retrieve(
          user.stripeSubscriptionId,
          {
            expand: ['items.data.price'],
          },
        );

        if (!this.isUpdatableSubscriptionStatus(subscription.status)) {
          if (subscription.status === 'canceled') {
            // La base locale ne doit pas continuer à référencer une souscription morte.
            await this.persistStripeSubscriptionId(user.id, null);
          }

          subscription = null;
        }
      } catch (error) {
        if (!this.isResourceMissingError(error)) {
          throw error;
        }

        // L'abonnement référencé n'existe plus côté Stripe.
        await this.persistStripeSubscriptionId(user.id, null);
      }
    }

    if (!subscription && user.stripeCustomerId) {
      // Dernier filet: récupérer une éventuelle souscription active via le customer.
      subscription = await this.findLatestUpdatableSubscription(
        user.stripeCustomerId,
      );

      if (subscription && subscription.id !== user.stripeSubscriptionId) {
        await this.persistStripeSubscriptionId(user.id, subscription.id);
      }
    }

    if (!subscription) {
      // Rien à résilier côté Stripe: le contrôleur pourra passer en FREE immédiatement.
      return {
        hadSubscription: false,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        currentPlan: null,
        alreadyScheduled: false,
      };
    }

    const alreadyScheduled = subscription.cancel_at_period_end;

    if (!alreadyScheduled) {
      // La souscription reste active jusqu'à la fin de la période déjà payée.
      subscription = await this.stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
      });
    }

    await this.persistStripeSubscriptionId(user.id, subscription.id);

    return {
      hadSubscription: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: subscription.cancel_at
        ? new Date(subscription.cancel_at * 1000)
        : null,
      currentPlan: this.getCheckoutPlanFromSubscription(subscription),
      alreadyScheduled,
    };
  }
}