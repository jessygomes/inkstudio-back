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
import { PublicContactRateLimiterService } from './public-contact-rate-limiter.service';

@Injectable()
export class PublicContactThrottleGuard implements CanActivate {
  private readonly logger = new Logger(PublicContactThrottleGuard.name);

  constructor(private readonly publicContactRateLimiterService: PublicContactRateLimiterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Donnees minimales pour evaluer les trois axes de limitation.
    const ip = this.extractClientIp(request);
    const senderEmail = this.extractEmailFromBody(request.body);
    const targetUserId = String((request.params as { userId?: string })?.userId || '').trim();

    // Delegue la decision au service (logique metier + Redis).
    const result = await this.publicContactRateLimiterService.consume({
      ip,
      targetUserId,
      senderEmail,
    });

    if (!result.allowed) {
      // Header standard exploitable cote front pour temporiser les retries.
      response.setHeader('Retry-After', String(result.retryAfterSeconds));

      // Logs structures: utile pour monitoring sans exposer de PII brute.
      this.logger.warn(
        JSON.stringify({
          event: 'public.contact.rate_limited',
          method: request.method,
          path: request.originalUrl || request.url,
          blockedBy: result.blockedBy,
          retryAfterSeconds: result.retryAfterSeconds,
          clientIpMasked: this.maskIp(ip),
          senderEmailHash: this.hashEmail(senderEmail),
          targetUserId,
          userAgent: this.extractUserAgent(request),
          requestId: this.extractRequestId(request),
          timestamp: new Date().toISOString(),
        }),
      );

      // Reponse 429 explicite pour harmoniser la gestion d'erreur cote client.
      throw new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Trop de messages envoyes. Merci de reessayer dans quelques instants.',
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

  private extractClientIp(request: Request): string {
    const xForwardedFor = request.headers['x-forwarded-for'];

    // Cas proxy/CDN: on prend la premiere IP de la chaine.
    if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
      return xForwardedFor.split(',')[0].trim();
    }

    if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
      return xForwardedFor[0].split(',')[0].trim();
    }

    // Fallback local quand le header n'est pas present.
    return request.ip || 'unknown-ip';
  }

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

  private hashEmail(email?: string): string | null {
    if (!email) {
      return null;
    }

    // Hash irreversible pour conserver une trace exploitable sans email en clair.
    return createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex');
  }

  private maskIp(ip: string): string {
    // On masque le dernier octet IPv4 pour reduire l'exposition en logs.
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      const parts = ip.split('.');
      return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
    }

    // Pour IPv6, on tronque egalement la fin de l'adresse.
    if (ip.includes(':')) {
      return `${ip.split(':').slice(0, 4).join(':')}::`;
    }

    return 'masked';
  }

  private extractUserAgent(request: Request): string {
    const userAgent = request.headers['user-agent'];
    if (typeof userAgent === 'string') {
      // Borne defensive pour eviter des logs trop volumineux.
      return userAgent.slice(0, 300);
    }
    return 'unknown';
  }

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
