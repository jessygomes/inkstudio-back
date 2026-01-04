import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Service pour valider et extraire les tokens JWT des connexions WebSocket
 */
@Injectable()
export class WebSocketAuthService {
  private readonly logger = new Logger('WebSocketAuthService');

  constructor(private jwtService: JwtService) {}

  // Normalise une erreur inconnue en message lisible
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Erreur inconnue';
  }

  /**
   * Valider et extraire le userId du token WebSocket
   * @param token Token JWT du handshake
   * @returns userId si valide, null sinon
   */
  validateToken(token: string): string | null {
    try {
      const decoded = this.jwtService.verify<{ userId?: string }>(token);
      return decoded?.userId ?? null;
    } catch (error: unknown) {
      this.logger.warn(
        `Token JWT invalide ou expiré: ${this.getErrorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * Extraire le token depuis le header Authorization au format "Bearer <token>"
   * @param authHeader Header Authorization
   * @returns Token si présent, null sinon
   */
  extractTokenFromHeader(authHeader: string): string | null {
    if (!authHeader) return null;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    return parts[1];
  }

  /**
   * Valider un token depuis le header Authorization
   * @param authHeader Header Authorization
   * @returns userId si valide, null sinon
   */
  validateAuthHeader(authHeader: string): string | null {
    const token = this.extractTokenFromHeader(authHeader);
    if (!token) return null;

    return this.validateToken(token);
  }
}
