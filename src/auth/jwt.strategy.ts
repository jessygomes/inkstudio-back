import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { Request } from 'express';

export type UserPayload = {
  userId: string,
  role?: string,
};

export interface RequestWithUser extends Request {
  user: UserPayload;
}

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
  }

  async validate({ userId, role }: UserPayload) {
    // console.log('🔍 JWT Strategy - Token validé pour userId:', userId);
    return { userId, role };
  }
}
