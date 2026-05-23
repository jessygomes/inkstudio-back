import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { RegistrationRateLimiterService } from './registration-rate-limiter.service';

@Injectable()
export class RegistrationThrottleGuard implements CanActivate {
  private readonly logger = new Logger(RegistrationThrottleGuard.name);

  constructor(
    private readonly registrationRateLimiterService: RegistrationRateLimiterService,
  ) {}

  /**
   * Guard ciblé pour les endpoints d'inscription.
   *
   * Il extrait une IP fiable (priorité à x-forwarded-for si présent),
   * puis consomme une tentative via le service Redis.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const ip = this.extractClientIp(request);
    const email = this.extractEmailFromBody(request.body);

    const result = await this.registrationRateLimiterService.consume({ ip, email });

    if (!result.allowed) {
      // Header standard pour indiquer au client combien de temps attendre.
      response.setHeader('Retry-After', String(result.retryAfterSeconds));

      // Log structuré backend (observabilité/sécurité), sans email brut en clair.
      this.logger.warn(
        JSON.stringify({
          event: 'auth.registration.rate_limited',
          method: request.method,
          path: request.originalUrl || request.url,
          blockedBy: result.blockedBy,
          retryAfterSeconds: result.retryAfterSeconds,
          clientIpMasked: this.maskIp(ip),
          emailHash: this.hashEmail(email),
          userAgent: this.extractUserAgent(request),
          requestId: this.extractRequestId(request),
          timestamp: new Date().toISOString(),
        }),
      );

      throw new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message:
            "Trop de tentatives d'inscription. Merci de réessayer dans quelques instants.",
          retryAfterSeconds: result.retryAfterSeconds,
          blockedBy: result.blockedBy,
          timestamp: new Date().toISOString(),
          path: request.originalUrl || request.url,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Résout l'IP client en tenant compte d'un reverse proxy:
   * - x-forwarded-for: "client, proxy1, proxy2"
   * - fallback: request.ip
   */
  private extractClientIp(request: Request): string {
    const xForwardedFor = request.headers['x-forwarded-for'];

    if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
      return xForwardedFor.split(',')[0].trim();
    }

    if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
      return xForwardedFor[0].split(',')[0].trim();
    }

    return request.ip || 'unknown-ip';
  }

  /**
   * Extrait l'email de façon type-safe depuis le body HTTP.
   */
  private extractEmailFromBody(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') {
      return undefined;
    }

    const maybeEmail = (body as { email?: unknown }).email;
    if (typeof maybeEmail !== 'string') {
      return undefined;
    }

    return maybeEmail;
  }

  /**
   * Hash l'email pour le log sans exposer la donnée sensible.
   */
  private hashEmail(email?: string): string | null {
    if (!email) {
      return null;
    }

    return createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex');
  }

  /**
   * Anonymise l'IP dans les logs pour limiter l'exposition des données personnelles.
   */
  private maskIp(ip: string): string {
    // IPv4: masque le dernier octet (ex: 192.168.1.x)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      const parts = ip.split('.');
      return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
    }

    // IPv6: garde seulement les 4 premiers groupes.
    if (ip.includes(':')) {
      return `${ip.split(':').slice(0, 4).join(':')}::`;
    }

    return 'masked';
  }

  /**
   * Extrait un user-agent compact pour faciliter le debug backend.
   */
  private extractUserAgent(request: Request): string {
    const userAgent = request.headers['user-agent'];
    if (typeof userAgent === 'string') {
      return userAgent.slice(0, 300);
    }
    return 'unknown';
  }

  /**
   * Permet de corréler les logs si un request-id est propagé.
   */
  private extractRequestId(request: Request): string | null {
    const requestId = request.headers['x-request-id'];

    if (typeof requestId === 'string' && requestId.length > 0) {
      return requestId;
    }

    if (Array.isArray(requestId) && requestId.length > 0) {
      return requestId[0];
    }

    return null;
  }
}
