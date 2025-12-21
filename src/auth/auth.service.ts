import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import {compare, hash} from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { UserPayload } from './jwt.strategy';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { MailService } from 'src/email/mailer.service';
import { randomBytes } from 'crypto';
import { SaasService } from 'src/saas/saas.service';
import { CreateUserClientDto } from './dto/create-userClient.dto';

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
              recipientName: existingUser.salonName || 'Salon',
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
  
      return this.authenticateUser({userId: existingUser.id, role: existingUser.role});
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
    try {
      const { email, salonName, saasPlan, password, firstName, lastName, phone } = registerBody;

      // Convertir TESTEUR en FREE
      // const finalSaasPlan = saasPlan === "TESTEUR" ? "FREE" : saasPlan;

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
          firstName,
          lastName,
          phone,
          saasPlan,
          password: hashedPassword,
        },
      });

      // Envoi d'un mail à l'administrateur pour l'informer de la nouvelle inscription
      await this.mailService.sendAdminNewUserNotification({
        userEmail: createdUser.email,
        salonName: createdUser.salonName ?? 'Salon',
        saasPlan: createdUser.saasPlan || 'Salon',
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

      await this.mailService.sendEmailVerification(
          email,
          {
            recipientName: createdUser.salonName || 'Salon',
            salonName: createdUser.salonName || 'Inkera Studio',
            verificationUrl: confirmationUrl,
          },
          createdUser.salonName || undefined
        );
  
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

  //! INSCRIPTION CLIENT
  async registerClient({ registerBody }: { registerBody: CreateUserClientDto }) {
    try {
      const { email, password, firstName, lastName, birthDate, confirmPassword } = registerBody;
      
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

    await this.mailService.sendPasswordReset(
      email,
      {
        recipientName: user.salonName || 'Salon',
        salonName: user.salonName || 'InkStudio',
        resetUrl: resetUrl,
      },
      user.salonName || undefined
    );
  
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
  private  authenticateUser({userId, role} : UserPayload) {
    const payload: UserPayload = {userId, role}
    
    const access_token = this.jwtService.sign(payload);
    // console.log("🔑 Token généré avec userId :", userId);
    // console.log("📦 Payload utilisé :", payload);
    // console.log('🔑 Token généré :', access_token);
    
    return {
      access_token,
      userId,
      role,
    }
  }

  //! GOOGLE OAUTH - Validation et création d'utilisateur
  async validateGoogleUser(googleUser: {
    email: string;
    firstName: string;
    lastName: string;
    image?: string;
    access_token: string;
  }) {
    const { email, firstName, lastName, image } = googleUser;

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: { clientProfile: true }
    });

    if (existingUser) {
      // Utilisateur existe, vérifier l'email et retourner
      if (!existingUser.emailVerified) {
        await this.prisma.user.update({
          where: { id: existingUser.id },
          data: { emailVerified: new Date() }
        });
      }
      return existingUser;
    }

    // Créer un nouvel utilisateur client avec Google
    const newUser = await this.prisma.user.create({
      data: {
        email,
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
      include: { clientProfile: true }
    });

    return newUser;
  }
}
