import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkEmailQueue() {
  console.log("📊 État de la file d'attente des emails:\n");

  const stats = await prisma.emailNotificationQueue.groupBy({
    by: ['status'],
    _count: {
      status: true,
    },
  });

  console.log('Statuts:');
  stats.forEach((stat) => {
    console.log(`  ${stat.status}: ${stat._count.status} email(s)`);
  });

  console.log('\n📝 Détails des emails:');
  const all = await prisma.emailNotificationQueue.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      conversation: {
        select: {
          salon: { select: { salonName: true, firstName: true } },
          clientUser: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  all.forEach((email) => {
    const salon = email.conversation.salon;
    const client = email.conversation.clientUser;
    console.log(`\n  ID: ${email.id}`);
    console.log(`  Status: ${email.status}`);
    console.log(`  Messages: ${email.messageCount}`);
    console.log(`  Salon: ${salon.salonName || salon.firstName || 'N/A'}`);
    console.log(`  Client: ${client.firstName} ${client.lastName || ''}`);
    console.log(`  Créé: ${email.createdAt.toLocaleString('fr-FR')}`);
    if (email.sentAt) {
      console.log(`  Envoyé: ${email.sentAt.toLocaleString('fr-FR')}`);
    }
    if (email.failureReason) {
      console.log(`  Erreur: ${email.failureReason}`);
    }
  });
}

checkEmailQueue()
  .then(() => {
    console.log('\n✅ Terminé');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Erreur:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
