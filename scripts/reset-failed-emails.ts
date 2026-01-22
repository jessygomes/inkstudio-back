import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetFailedEmails() {
  console.log('🔄 Réinitialisation des emails échoués...\n');

  const result = await prisma.emailNotificationQueue.updateMany({
    where: { status: 'FAILED' },
    data: {
      status: 'PENDING',
      failureReason: null,
      sentAt: null,
    },
  });

  console.log(`✅ ${result.count} email(s) réinitialisé(s) à PENDING`);

  // Afficher les emails réinitialisés
  const pending = await prisma.emailNotificationQueue.findMany({
    where: { status: 'PENDING' },
    include: {
      conversation: {
        select: {
          salon: { select: { salonName: true, firstName: true } },
          clientUser: { select: { firstName: true, email: true } },
        },
      },
    },
  });

  console.log("\n📧 Emails en attente d'envoi:");
  pending.forEach((email) => {
    const salon = email.conversation.salon;
    const client = email.conversation.clientUser;
    console.log(`\n  ✉️  ${client.email}`);
    console.log(`     De: ${salon.salonName || salon.firstName}`);
    console.log(`     Messages: ${email.messageCount}`);
  });
}

resetFailedEmails()
  .then(() => {
    console.log(
      '\n✨ Terminé - Vous pouvez maintenant exécuter: npm run test:send-emails',
    );
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Erreur:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
