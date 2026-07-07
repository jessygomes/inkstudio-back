import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import {
  STRIPE_API_VERSION,
  resolveStripeSecretKey,
} from '../src/stripe/stripe.constants';

type CliOptions = {
  apply: boolean,
  limit: number | null,
  userId: string | null,
};

type UserSnapshot = {
  id: string,
  email: string,
  salonName: string | null,
  stripeCustomerId: string | null,
};

type CustomerSignal = {
  customerId: string,
  hasUpdatableSubscription: boolean,
  latestSubscriptionStatus: string | null,
  createdAt: number,
};

const UPDATABLE_SUBSCRIPTION_STATUSES = new Set<string>([
  'active',
  'trialing',
  'past_due',
  'unpaid',
]);

const prisma = new PrismaClient();
const stripe = new Stripe(resolveStripeSecretKey(), {
  apiVersion: STRIPE_API_VERSION,
});

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    limit: null,
    userId: null,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const raw = arg.split('=')[1];
      const parsed = Number(raw);
      if (!Number.isNaN(parsed) && parsed > 0) {
        options.limit = Math.floor(parsed);
      }
      continue;
    }

    if (arg.startsWith('--userId=')) {
      const raw = arg.split('=')[1]?.trim();
      if (raw) {
        options.userId = raw;
      }
    }
  }

  return options;
}

async function listAllCustomersByEmail(
  email: string,
): Promise<Stripe.Customer[]> {
  const customers: Stripe.Customer[] = [];
  let startingAfter: string | undefined;

  while (true) {
    const page = await stripe.customers.list({
      email,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const item of page.data) {
      if ('deleted' in item && item.deleted) {
        continue;
      }

      customers.push(item as Stripe.Customer);
    }

    if (!page.has_more || page.data.length === 0) {
      break;
    }

    startingAfter = page.data[page.data.length - 1].id;
  }

  return customers;
}

async function buildCustomerSignal(
  customer: Stripe.Customer,
): Promise<CustomerSignal> {
  const subscriptions = await stripe.subscriptions.list({
    customer: customer.id,
    status: 'all',
    limit: 10,
  });

  const hasUpdatableSubscription = subscriptions.data.some((subscription) =>
    UPDATABLE_SUBSCRIPTION_STATUSES.has(subscription.status),
  );

  const latestSubscription = subscriptions.data
    .slice()
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];

  return {
    customerId: customer.id,
    hasUpdatableSubscription,
    latestSubscriptionStatus: latestSubscription?.status ?? null,
    createdAt: customer.created ?? 0,
  };
}

function chooseCanonicalCustomerId(
  user: UserSnapshot,
  signals: CustomerSignal[],
): string | null {
  if (signals.length === 0) {
    return null;
  }

  const byId = new Map(signals.map((signal) => [signal.customerId, signal]));

  if (user.stripeCustomerId && byId.has(user.stripeCustomerId)) {
    return user.stripeCustomerId;
  }

  const withActiveSub = signals
    .filter((signal) => signal.hasUpdatableSubscription)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (withActiveSub.length > 0) {
    return withActiveSub[0].customerId;
  }

  return signals.slice().sort((a, b) => b.createdAt - a.createdAt)[0]
    .customerId;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  console.log('Stripe customer audit');
  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY_RUN'}`);

  const usersRaw = await prisma.user.findMany({
    where: {
      ...(options.userId ? { id: options.userId } : {}),
    },
    select: {
      id: true,
      email: true,
      salonName: true,
      stripeCustomerId: true,
    },
    take: options.limit ?? undefined,
  });

  const users: UserSnapshot[] = usersRaw;

  let scanned = 0;
  let changed = 0;
  let flagged = 0;

  for (const user of users) {
    scanned += 1;

    const customers = await listAllCustomersByEmail(user.email);
    const signals = await Promise.all(
      customers.map((customer) => buildCustomerSignal(customer)),
    );
    const canonicalCustomerId = chooseCanonicalCustomerId(user, signals);

    const hasDuplicates = signals.length > 1;
    const shouldUpdate = canonicalCustomerId !== user.stripeCustomerId;

    if (!hasDuplicates && !shouldUpdate) {
      continue;
    }

    flagged += 1;

    console.log('----------------------------------------');
    console.log(`User: ${user.id} (${user.email})`);
    console.log(`Stored stripeCustomerId: ${user.stripeCustomerId ?? 'null'}`);
    console.log(`Canonical stripeCustomerId: ${canonicalCustomerId ?? 'null'}`);
    console.log(`Customers found on Stripe by email: ${signals.length}`);

    for (const signal of signals) {
      console.log(
        `- ${signal.customerId} | updatableSub=${signal.hasUpdatableSubscription} | latestSubStatus=${signal.latestSubscriptionStatus ?? 'none'} | created=${new Date(signal.createdAt * 1000).toISOString()}`,
      );
    }

    if (options.apply && shouldUpdate) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          stripeCustomerId: canonicalCustomerId,
        },
      });

      changed += 1;
      console.log('Action: DB stripeCustomerId updated');
    } else if (shouldUpdate) {
      console.log('Action: would update DB stripeCustomerId');
    } else {
      console.log('Action: no DB update required');
    }
  }

  console.log('----------------------------------------');
  console.log(`Scanned users: ${scanned}`);
  console.log(`Flagged users: ${flagged}`);
  console.log(`Updated users: ${changed}`);
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Audit failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
