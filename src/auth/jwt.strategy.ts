/* eslint-disable prettier/prettier */
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

export type UserPayload = {
  userId: string,
};

export type RequestWithUser = {
  user: UserPayload,
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    /* On utilise la méthode super() pour appeler le constructeur de la classe mère
      ** -> await fetch("auth", { headers : [ "Authorization" : `Bearer ${token}` ] })
    
      --> Vérifie si le token est bien présent dans le header de la requête
      -->S'il est bien présent, il utilise le SECRET pour convertir le mdp avec le payload 

    */
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });

    console.log('🧪 JwtStrategy loaded with secret:', process.env.JWT_SECRET);
  }

  async validate({ userId }: UserPayload) {
    console.log('✅ JWT VALIDATED - User ID :', userId);
    return { userId };
  }
}
