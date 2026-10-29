import { Injectable } from '@nestjs/common';
import { SecurityRateLimiter } from './security-throttle';
function positive(name: string, fallback: number, ceiling: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= ceiling
    ? value
    : fallback;
}
@Injectable()
export class RegistrationRateLimiterService {
  constructor(private readonly limiter: SecurityRateLimiter) {}
  async consume(input: {
    ip: string;
    email?: string;
  }): Promise<{
    allowed: boolean;
    retryAfterSeconds: number;
    blockedBy: 'ip' | 'email' | null;
  }> {
    const axes = [
      {
        kind: 'ip',
        value: input.ip,
        max: positive('REGISTER_RATE_LIMIT_IP_MAX', 10, 10000),
        seconds: positive('REGISTER_RATE_LIMIT_IP_WINDOW_SECONDS', 900, 86400),
      },
    ];
    const email = input.email?.trim().toLowerCase();
    if (email)
      axes.push({
        kind: 'email',
        value: email,
        max: positive('REGISTER_RATE_LIMIT_EMAIL_MAX', 5, 1000),
        seconds: positive(
          'REGISTER_RATE_LIMIT_EMAIL_WINDOW_SECONDS',
          3600,
          86400,
        ),
      });
    const result = await this.limiter.consume('registration', axes);
    return { ...result, blockedBy: result.blockedBy as 'ip' | 'email' | null };
  }
}
