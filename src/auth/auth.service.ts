import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import {compare, hash} from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { UserPayload } from './jwt.strategy';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { MailService } from 'src/mailer.service';
import { randomBytes } from 'crypto';
import { SaasService } from 'src/saas/saas.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService, 
    private readonly jwtService : JwtService, 
    private readonly mailService: MailService,
    private readonly saasService: SaasService
  ) {}

  //! CONNEXION
  async login({ authBody }: { authBody: LoginUserDto }) {
    try {
      const { email, password } = authBody;
  
      const existingUser = await this.prisma.user.findUnique({
        where: {
          email,
        },
      });
  
      if (!existingUser) {
        throw new Error("L'email ou le mot de passe sont incorrect.");
      }
  
      // const hashedPassword = await this.hashPassword(password);
  
      const isPasswordValid = await this.isPasswordValid({password, hashedPassword: existingUser.password});
  
      if (!isPasswordValid) {
        throw new Error("L'email ou le mot de passe sont incorrect.");
      }

      if (!existingUser.emailVerified) {
        // Supprimer tout token de vérification existant pour cet email
        await this.prisma.verificationToken.deleteMany({
          where: {
            email,
          },
        });
  
        // Générer un nouveau token de vérification
        const token = Math.floor(100000 + Math.random() * 900000).toString(); // Génère un nombre à 6 chiffres
        const expires = new Date(Date.now() + 1000 * 60 * 10); // Expiration dans 10 minutes
  
        await this.prisma.verificationToken.create({
          data: {
            email,
            token,
            expires,
          },
        });
  
        const confirmationUrl = `${process.env.FRONTEND_URL}/verifier-email?token=${token}&email=${email}`;
  
        // Envoyer un email de vérification
        await this.mailService.sendMail({
          to: email,
          subject: "Confirmez votre adresse email",
          html: `
            <h2>Bonjour ${existingUser.salonName} !</h2>
            <p>Vous avez essayé de vous connecter, mais votre adresse email n'est pas encore vérifiée.</p>
            <p>Veuillez confirmer votre adresse email en cliquant sur le lien ci-dessous :</p>
            <a href="${confirmationUrl}">Confirmer mon email</a>
            <p>Ce lien expire dans 10 minutes.</p>
          `,
        });
  
        return {
          error: "Votre adresse email n'est pas vérifiée. Un nouveau code de vérification vous a été envoyé par email.",
        };
      }
  
      return this.authenticateUser({userId: existingUser.id});
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
}

  //! INSCRIPTION
  async register({ registerBody }: { registerBody: CreateUserDto }) {
    console.log("📝 Payload reçu :", registerBody);
    try {
      const { email, salonName, saasPlan, password } = registerBody;

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
  
      // Création de l'utilisateur dans la DB
      const createdUser = await this.prisma.user.create({
        data: {
          email,
          salonName,
          saasPlan,
          password: hashedPassword,
        },
      });

      // Créer le plan SaaS détaillé immédiatement après la création de l'utilisateur
      await this.saasService.createUserPlanOnRegistration(createdUser.id, saasPlan);

      // Génération du token de vérification de l'adresse mail
      const token = Math.floor(100000 + Math.random() * 900000).toString(); // Génère un nombre à 6 chiffres
      const expires = new Date(Date.now() + 1000 * 60 * 10); // Expiration dans 10 minutes

      await this.prisma.verificationToken.create({
        data: {
          email,
          token,
          expires,
        },
      });

      const confirmationUrl = `${process.env.FRONTEND_URL}/verifier-email?token=${token}&email=${email}`;

      console.log("🔗 Lien de confirmation d'email :", confirmationUrl);

      await this.mailService.sendMail({
        to: email,
        subject: "✨ Confirmez votre adresse email - InkStudio",
        html: `
          <!DOCTYPE html>
          <html lang="fr">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Confirmation d'email - InkStudio</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
              
              * { margin: 0; padding: 0; box-sizing: border-box; }
              
              body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background-color: #0f1113;
                color: #ffffff;
                line-height: 1.6;
                margin: 0;
                padding: 20px;
              }
              
              .container {
                max-width: 600px;
                margin: 0 auto;
                background: linear-gradient(135deg, #1a1d23 0%, #0f1113 100%);
                border-radius: 24px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                overflow: hidden;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
              }
              
              .header {
                background: linear-gradient(135deg, #f97316 0%, #eab308 100%);
                padding: 32px 24px;
                text-align: center;
                position: relative;
                overflow: hidden;
              }
              
              .header::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: url('data:image/svg+xml,<svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><g fill="none" fill-rule="evenodd"><g fill="%23ffffff" fill-opacity="0.05"><circle cx="30" cy="30" r="2"/></g></g></svg>');
                opacity: 0.3;
              }
              
              .logo {
                position: relative;
                z-index: 1;
              }
              
              .logo h1 {
                font-size: 28px;
                font-weight: 700;
                color: white;
                margin-bottom: 8px;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
              }
              
              .logo p {
                font-size: 14px;
                color: rgba(255, 255, 255, 0.9);
                font-weight: 500;
              }
              
              .content {
                padding: 40px 24px;
              }
              
              .welcome-section {
                text-align: center;
                margin-bottom: 32px;
              }
              
              .emoji-icon {
                font-size: 48px;
                margin-bottom: 16px;
                display: block;
              }
              
              .welcome-title {
                font-size: 24px;
                font-weight: 700;
                color: #ffffff;
                margin-bottom: 12px;
              }
              
              .welcome-subtitle {
                font-size: 16px;
                color: rgba(255, 255, 255, 0.8);
                margin-bottom: 8px;
              }
              
              .salon-name {
                display: inline-block;
                background: linear-gradient(135deg, #f97316 0%, #eab308 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                font-weight: 700;
                font-size: 18px;
              }
              
              .message-box {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                padding: 24px;
                margin: 32px 0;
              }
              
              .message-box p {
                font-size: 15px;
                color: rgba(255, 255, 255, 0.9);
                margin-bottom: 16px;
              }
              
              .cta-button {
                display: inline-block;
                background: linear-gradient(135deg, #f97316 0%, #eab308 100%);
                color: white !important;
                text-decoration: none;
                padding: 16px 32px;
                border-radius: 12px;
                font-weight: 600;
                font-size: 16px;
                text-align: center;
                transition: all 0.3s ease;
                box-shadow: 0 10px 25px rgba(249, 115, 22, 0.3);
                border: none;
                cursor: pointer;
                margin: 20px 0;
              }
              
              .cta-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 15px 35px rgba(249, 115, 22, 0.4);
              }
              
              .info-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
                margin: 24px 0;
              }
              
              .info-item {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                padding: 16px;
                text-align: center;
              }
              
              .info-item-icon {
                font-size: 20px;
                margin-bottom: 8px;
                display: block;
              }
              
              .info-item-label {
                font-size: 12px;
                color: rgba(255, 255, 255, 0.6);
                text-transform: uppercase;
                font-weight: 500;
                letter-spacing: 0.5px;
                margin-bottom: 4px;
              }
              
              .info-item-value {
                font-size: 14px;
                color: #ffffff;
                font-weight: 600;
              }
              
              .footer {
                background: rgba(255, 255, 255, 0.02);
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                padding: 24px;
                text-align: center;
              }
              
              .footer p {
                font-size: 12px;
                color: rgba(255, 255, 255, 0.5);
                margin-bottom: 8px;
              }
              
              .footer .brand {
                color: #f97316;
                font-weight: 600;
              }
              
              @media (max-width: 600px) {
                body { padding: 10px; }
                .container { margin: 0; border-radius: 16px; }
                .header { padding: 24px 16px; }
                .content { padding: 24px 16px; }
                .info-grid { grid-template-columns: 1fr; }
                .cta-button { padding: 14px 24px; font-size: 15px; }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <div class="logo">
                  <h1>InkStudio</h1>
                  <p>Votre plateforme de gestion de salon de tatouage</p>
                </div>
              </div>
              
              <div class="content">
                <div class="welcome-section">
                  <span class="emoji-icon">🎉</span>
                  <h2 class="welcome-title">Bienvenue sur InkStudio !</h2>
                  <p class="welcome-subtitle">Bonjour <span class="salon-name">${salonName}</span></p>
                </div>
                
                <div class="message-box">
                  <p>✨ <strong>Félicitations !</strong> Votre compte InkStudio a été créé avec succès.</p>
                  <p>Pour commencer à utiliser toutes les fonctionnalités de votre espace de gestion, veuillez confirmer votre adresse email en cliquant sur le bouton ci-dessous :</p>
                </div>
                
                <div style="text-align: center;">
                  <a href="${confirmationUrl}" class="cta-button">
                    ✅ Confirmer mon adresse email
                  </a>
                </div>
                
                <div class="info-grid">
                  <div class="info-item">
                    <div class="info-item-label">Expiration</div>
                    <div class="info-item-value">10 minutes</div>
                  </div>
                  <div class="info-item">
                    <span class="info-item-icon">🔒</span>
                    <div class="info-item-label">Sécurité</div>
                    <div class="info-item-value">Lien unique</div>
                  </div>
                </div>
                
                <div class="message-box" style="margin-top: 32px;">
                  <p><strong>🚀 Une fois votre email confirmé, vous pourrez :</strong></p>
                  <ul style="margin: 12px 0; padding-left: 20px; color: rgba(255, 255, 255, 0.8);">
                    <li>📅 Gérer vos rendez-vous et votre agenda</li>
                    <li>👥 Créer et organiser vos fiches clients</li>
                    <li>🎨 Gérer votre portfolio et vos réalisations</li>
                    <li>📊 Accéder aux statistiques de votre salon</li>
                    <li>✉️ Système de suivi post-tatouage</li>
                  </ul>
                </div>
                
                <div style="background: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.2); border-radius: 12px; padding: 16px; margin: 24px 0; text-align: center;">
                  <p style="font-size: 13px; color: rgba(249, 115, 22, 0.9); margin: 0;">
                    <strong>⚠️ Important :</strong> Ce lien expire dans 10 minutes pour votre sécurité.
                  </p>
                </div>
              </div>
              
              <div class="footer">
                <p>Cet email a été envoyé par <span class="brand">InkStudio</span></p>
                <p>Si vous n'avez pas créé de compte, vous pouvez ignorer cet email.</p>
                <p style="margin-top: 16px; font-size: 11px;">
                  © 2025 InkStudio - Plateforme de gestion pour salons de tatouage
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
      });
  
      // // Authentifier directement le nouvel utilisateur
      // return this.authenticateUser({userId: createdUser.id});
      return {
        message: "Votre compte a été créé avec succès. Veuillez vérifier vos emails pour confirmer votre adresse.",
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        error: true,
        message: errorMessage,
      };
    }
    
  }

  //! MOT DE PASSE OUBLIÉ
  // ENVOIE UN EMAIL DE RÉINITIALISATION DE MOT DE PASSE
  async sendResetPasswordEmail(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
  
    if (!user) {
      return { message: "Si un compte existe avec cette adresse, un email a été envoyé." };
    }
  
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 15); // 15 minutes
  
    await this.prisma.passwordResetToken.create({
      data: {
        email,
        token,
        expires,
      },
    });
  
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}&email=${email}`;
  
    await this.mailService.sendMail({
      to: email,
      subject: "Réinitialisation de votre mot de passe",
      html: `
        <h2>Réinitialisation du mot de passe</h2>
        <p>Vous avez demandé à réinitialiser votre mot de passe.</p>
        <p>Si ce n’est pas vous, ignorez cet email.</p>
        <a href="${resetUrl}">Cliquez ici pour réinitialiser</a>
        <p>Ce lien est valable 15 minutes.</p>
      `,
    });
  
    return { message: "Si un compte existe avec cette adresse, un email a été envoyé." };
  }

  // RÉINITIALISE LE MOT DE PASSE
  async resetPassword({
    email,
    token,
    password,
  }: {
    email: string;
    token: string;
    password: string;
  }) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: {
        email_token: { email, token },
      },
    });
  
    if (!record || record.expires < new Date()) {
      throw new Error("Lien de réinitialisation invalide ou expiré.");
    }
  
    const hashedPassword = await this.hashPassword({ password });
  
    await this.prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
    });
  
    await this.prisma.passwordResetToken.delete({
      where: { id: record.id },
    });
  
    return {
      message: "Mot de passe mis à jour avec succès.",
    };
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
  private  authenticateUser({userId} : UserPayload) {
    const payload: UserPayload = {userId}
    
    const access_token = this.jwtService.sign(payload);
    console.log("🔑 Token généré avec userId :", userId);
    console.log("📦 Payload utilisé :", payload);
    console.log('🔑 Token généré :', access_token);
    
    return {
      access_token,
      userId
    }
  }
}
