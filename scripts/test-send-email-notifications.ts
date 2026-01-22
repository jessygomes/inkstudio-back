import { PrismaClient } from '@prisma/client';
import Mailgun from 'mailgun.js';
import * as formData from 'form-data';

const prisma = new PrismaClient();

async function sendEmailNotifications() {
  console.log('🔍 Recherche des emails en attente...\n');

  const pendingEmails = await prisma.emailNotificationQueue.findMany({
    where: { status: 'PENDING' },
    include: {
      conversation: {
        include: {
          salon: {
            select: {
              id: true,
              email: true,
              salonName: true,
              firstName: true,
            },
          },
          clientUser: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 3,
          },
        },
      },
    },
  });

  console.log(`📧 ${pendingEmails.length} email(s) en attente\n`);

  if (pendingEmails.length === 0) {
    console.log('✅ Aucun email à envoyer');
    return;
  }

  // Configuration Mailgun
  const mailgun = new Mailgun(formData);
  const mg = mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY || '',
    url: process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net',
  });

  let sent = 0;
  let failed = 0;

  for (const queue of pendingEmails) {
    const { conversation, recipientUserId, messageCount } = queue;

    try {
      // Déterminer l'expéditeur et le destinataire
      const recipient =
        conversation.clientUserId === recipientUserId
          ? conversation.clientUser
          : conversation.salon;

      const sender =
        conversation.clientUserId === recipientUserId
          ? conversation.salon
          : conversation.clientUser;

      if (!recipient || !sender) {
        console.log(
          `❌ Email ${queue.id}: Destinataire ou expéditeur manquant`,
        );
        await prisma.emailNotificationQueue.update({
          where: { id: queue.id },
          data: {
            status: 'FAILED',
            failureReason: 'Missing recipient or sender',
          },
        });
        failed++;
        continue;
      }

      const recipientName = recipient.firstName || 'Bonjour';
      const senderName =
        'salonName' in sender
          ? sender.salonName || sender.firstName || 'Un contact'
          : sender.firstName || 'Un contact';

      const subject =
        messageCount > 1
          ? `${messageCount} nouveaux messages de ${senderName}`
          : `Nouveau message de ${senderName}`;

      // Générer le HTML avec le template design
      const messagesHtml = conversation.messages
        .map(
          (msg) => `
          <div style="padding: 15px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.2);">
            <div style="color: rgba(255, 255, 255, 0.8); font-size: 12px; margin-bottom: 5px;">
              ${new Date(msg.createdAt).toLocaleString('fr-FR')}
            </div>
            <div style="color: #ffffff; font-size: 15px; line-height: 1.5;">
              ${msg.content}
            </div>
          </div>
        `,
        )
        .join('');

      const conversationLink = `${process.env.FRONTEND_URL}/conversations/${conversation.id}`;

      const content = `
      <div class="content">
        <div class="greeting">
          Bonjour ${recipientName},
        </div>
        
        <div class="message">
          ${
            messageCount === 1
              ? `Vous avez reçu un nouveau message de <strong>${senderName}</strong>.`
              : `Vous avez reçu <strong>${messageCount} nouveaux messages</strong> de <strong>${senderName}</strong>.`
          }
        </div>

        <div class="details-card">
          <div class="details-title">
            💬 ${messageCount === 1 ? 'Dernier message' : 'Derniers messages'}
          </div>
          ${messagesHtml}
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${conversationLink}" class="cta-button" style="text-decoration: none;">
            📱 Voir la conversation
          </a>
        </div>

        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 2px solid #f0f0f0;">
          <p style="font-size: 14px; color: #666; margin-bottom: 10px;">
            Vous recevez cet email car vous avez un nouveau message.
          </p>
          <a href="${process.env.FRONTEND_URL}/parametres" 
             style="color: #ff9d00; text-decoration: none; font-size: 14px; font-weight: 500;">
            ⚙️ Gérer vos préférences de notification
          </a>
        </div>
      </div>
    `;

      const html = `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Nouveau message</title>
        <link href="https://fonts.googleapis.com/css2?family=Didact+Gothic&family=Exo+2:wght@300;400;500;600;700&family=Montserrat+Alternates:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Didact Gothic', sans-serif;
            background-color: #ffffff;
            color: #171717;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%);
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          }
          
          .header {
            background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%);
            padding: 30px 40px;
            text-align: center;
            position: relative;
            font-family: 'Exo 2', sans-serif;
          }
          
          .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, #131313 0%, #1a1a1a 100%);
            pointer-events: none;
          }
          
          .logo {
            font-family: 'Montserrat Alternates', sans-serif;
            font-size: 32px;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 8px;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
          }
          
          .tagline {
            font-family: 'Didact Gothic', sans-serif;
            font-size: 14px;
            color: #ffffff;
            opacity: 0.9;
            text-transform: uppercase;
            letter-spacing: 2px;
          }
          
          .content {
            padding: 40px;
            background-color: #ffffff;
            color: #171717;
          }
          
          .greeting {
            font-family: 'Exo 2', sans-serif;
            font-size: 24px;
            font-weight: 600;
            color: #2d1f1a;
            margin-bottom: 20px;
          }
          
          .message {
            font-size: 16px;
            margin-bottom: 30px;
            color: #3e2c27;
            font-family: 'Exo 2', sans-serif;
          }
          
          .details-card {
            background: linear-gradient(135deg, #c79f8b, #af7e70);
            color: #fff;
            font-family: 'Exo 2', sans-serif;
            font-size: 16px;
            padding: 25px;
            border-radius: 15px;
            margin: 25px 0;
          }
          
          .details-title {
            font-family: 'Montserrat Alternates', sans-serif;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 15px;
            color: #fff;
          }
          
          .cta-button {
            display: inline-block;
            background: linear-gradient(90deg, #ff9d00, #ff5500);
            color: #ffffff;
            text-decoration: none;
            padding: 15px 30px;
            border-radius: 25px;
            font-family: 'Exo 2', sans-serif;
            font-weight: 600;
            font-size: 16px;
            text-align: center;
            margin: 20px 0;
          }
          
          .footer {
            background: linear-gradient(135deg, #131313, #1a1a1a);
            padding: 30px 40px;
            text-align: center;
            color: #ffffff;
            font-family: 'Exo 2', sans-serif;
          }
          
          .footer-content {
            font-size: 14px;
            margin-bottom: 15px;
            opacity: 0.8;
          }
          
          @media (max-width: 600px) {
            .email-container {
              margin: 10px;
            }
            
            .header, .content, .footer {
              padding: 20px;
            }
            
            .logo {
              font-size: 24px;
            }
            
            .greeting {
              font-size: 20px;
            }
            
            .cta-button {
              width: 100%;
              padding: 12px 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <div class="logo">${senderName}</div>
            <div class="tagline">Messagerie</div>
          </div>
          ${content}
          <div class="footer">
            <div class="footer-content">
              <p><strong>${senderName}</strong></p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

      console.log(`📤 Envoi email à ${recipient.email}...`);
      console.log(`   Sujet: ${subject}`);
      console.log(`   Messages: ${messageCount}`);

      // Envoyer l'email
      await mg.messages.create(process.env.MAILGUN_DOMAIN || '', {
        from: `Tattoo Studio <noreply@${process.env.MAILGUN_DOMAIN}>`,
        to: [recipient.email],
        subject,
        html,
      });

      // Marquer comme envoyé
      await prisma.emailNotificationQueue.update({
        where: { id: queue.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
        },
      });

      console.log(`✅ Email envoyé avec succès!\n`);
      sent++;
    } catch (error) {
      console.error(`❌ Erreur lors de l'envoi de l'email ${queue.id}:`, error);

      await prisma.emailNotificationQueue.update({
        where: { id: queue.id },
        data: {
          status: 'FAILED',
          failureReason: error instanceof Error ? error.message : String(error),
        },
      });
      failed++;
    }
  }

  console.log('\n📊 Résumé:');
  console.log(`   ✅ Envoyés: ${sent}`);
  console.log(`   ❌ Échoués: ${failed}`);
  console.log(`   📧 Total: ${pendingEmails.length}`);
}

// Exécuter le script
sendEmailNotifications()
  .then(() => {
    console.log('\n✨ Script terminé');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Erreur fatale:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
