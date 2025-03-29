/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import {compare, hash} from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { UserPayload } from './jwt.strategy';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { MailService } from 'src/mailer.service';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwtService : JwtService, private readonly mailService: MailService) {}

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
            <h2>Bonjour ${existingUser.name} !</h2>
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
    try {
      const { email, name, password } = registerBody;

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
      await this.prisma.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
        },
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

      console.log("🔗 Lien de confirmation d'email :", confirmationUrl);

      await this.mailService.sendMail({
        to: email,
        subject: "Confirmez votre adresse email",
        html: `
          <h2>Bienvenue ${name} !</h2>
          <p>Merci de vous être inscrit sur InkStudio.</p>
          <p>Veuillez confirmer votre adresse email en cliquant sur le lien ci-dessous :</p>
          <a href="${confirmationUrl}">Confirmer mon email</a>
          <p>Ce lien expire dans 10 minutes.</p>
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
