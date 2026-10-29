import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Global,
  HttpException,
  Injectable,
  Logger,
  Module,
  ServiceUnavailableException,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';

export const COUNTER_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;
type Axis = { kind: string; value: string; max: number; seconds: number };
export type LimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  blockedBy: string | null;
};

@Injectable()
export class SecurityRateLimiter {
  private readonly logger = new Logger(SecurityRateLimiter.name);
  constructor(private readonly redis: RedisService) {}

  async consume(scope: string, axes: Axis[]): Promise<LimitResult> {
    for (const axis of axes) {
      if (
        !Number.isSafeInteger(axis.max) ||
        axis.max < 1 ||
        !Number.isSafeInteger(axis.seconds) ||
        axis.seconds < 1
      )
        throw new ServiceUnavailableException();
      const digest = createHash('sha256').update(axis.value).digest('hex');
      const key = `security:attempts:v1:${scope}:${axis.kind}:${digest}`;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const client = this.redis.getClient();
        if (!client?.isReady) throw new Error('Redis unavailable');
        const result: unknown = await Promise.race([
          client.eval(COUNTER_SCRIPT, {
            keys: [key],
            arguments: [String(axis.seconds)],
          }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Redis timeout')), 1500);
          }),
        ]);
        if (
          !Array.isArray(result) ||
          result.length !== 2 ||
          !result.every(
            (value) => typeof value === 'number' && Number.isSafeInteger(value),
          ) ||
          result[0] < 1 ||
          result[1] < 0
        )
          throw new Error('Invalid Redis result');
        if ((result[0] as number) > axis.max)
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, result[1] as number),
            blockedBy: axis.kind,
          };
      } catch {
        this.logger.error(
          'Security rate limiter unavailable; request refused.',
        );
        throw new ServiceUnavailableException(
          'Protection temporairement indisponible. Merci de réessayer.',
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return { allowed: true, retryAfterSeconds: 0, blockedBy: null };
  }
}

const policies = {
  login: { ip: [120, 900], email: [10, 900] },
  google: { ip: [120, 900] },
  verify: { ip: [60, 900], email: [10, 900] },
  forgot: { ip: [10, 900], email: [3, 3600] },
  reset: { ip: [20, 900], email: [5, 900] },
  change: { ip: [20, 900], user: [5, 900] },
  booking: { ip: [60, 900], email: [5, 900], user: [10, 900] },
  upload: { ip: [240, 900] },
} satisfies Record<
  string,
  Partial<Record<'ip' | 'email' | 'user', [number, number]>>
>;
type PolicyName = keyof typeof policies;
const metadataKey = 'security:throttle';
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function identity(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : undefined;
}

@Injectable()
export class SecurityThrottleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: SecurityRateLimiter,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.get<PolicyName>(
      metadataKey,
      context.getHandler(),
    );
    if (!scope || !policies[scope]) throw new ServiceUnavailableException();
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: { userId?: string } }>();
    const response = context.switchToHttp().getResponse<Response>();
    const body = object(request.body);
    const email =
      scope === 'booking'
        ? object(body.rdvBody).clientEmail
        : scope === 'verify'
          ? object(request.query).email
          : body.email;
    const values = {
      ip: request.ip || request.socket?.remoteAddress || 'unknown',
      email: identity(email),
      user: request.user?.userId,
    };
    const axes: Axis[] = [];
    for (const [kind, [max, seconds]] of Object.entries(policies[scope])) {
      const value = values[kind as keyof typeof values];
      if (value) {
        const configured = Number(
          process.env[
            `SECURITY_RATE_LIMIT_${scope.toUpperCase()}_${kind.toUpperCase()}_MAX`
          ],
        );
        const limit =
          Number.isSafeInteger(configured) &&
          configured > 0 &&
          configured <= 10000
            ? configured
            : max;
        axes.push({ kind, value, max: limit, seconds });
      }
    }
    response.setHeader('Cache-Control', 'private, no-store');
    const result = await this.limiter.consume(scope, axes);
    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Trop de tentatives. Merci de réessayer plus tard.',
          retryAfterSeconds: result.retryAfterSeconds,
        },
        429,
      );
    }
    return true;
  }
}
export const SecurityThrottle = (scope: PolicyName) =>
  applyDecorators(
    SetMetadata(metadataKey, scope),
    UseGuards(SecurityThrottleGuard),
  );

@Global()
@Module({
  imports: [RedisModule],
  providers: [SecurityRateLimiter, SecurityThrottleGuard],
  exports: [SecurityRateLimiter, SecurityThrottleGuard],
})
export class SecurityThrottleModule {}
