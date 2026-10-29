import express, { Request, Response } from 'express';
import request from 'supertest';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { trustedProxyConfig } from './trusted-proxy.config';
import { RegistrationThrottleGuard } from '../auth/registration-throttle.guard';
import { RegistrationRateLimiterService } from '../auth/registration-rate-limiter.service';
import { PublicContactThrottleGuard } from '../user/public-contact-throttle.guard';
import { PublicContactRateLimiterService } from '../user/public-contact-rate-limiter.service';

function appWithPolicy(policy: string | undefined) {
  const app = express();
  app.set('trust proxy', trustedProxyConfig(policy));
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  return app;
}

describe('trusted proxy policy', () => {
  it('ignores forwarded headers by default', async () => {
    const response = await request(appWithPolicy(''))
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.10')
      .expect(200);
    expect((response.body as { ip: string }).ip).toMatch(/127\.0\.0\.1$/);
  });

  it('accepts client IP from an explicitly trusted immediate proxy', async () => {
    const response = await request(appWithPolicy('127.0.0.1/32,::1/128'))
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.10')
      .expect(200);
    expect((response.body as { ip: string }).ip).toBe('198.51.100.10');
  });

  it('stops at the nearest untrusted hop and ignores a forged prefix', async () => {
    const response = await request(appWithPolicy('127.0.0.1/32,::1/128'))
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.99, 198.51.100.10')
      .expect(200);
    expect((response.body as { ip: string }).ip).toBe('198.51.100.10');
  });

  it('ignores headers when the immediate peer is not trusted', async () => {
    const response = await request(appWithPolicy('10.0.0.1/32'))
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.10')
      .expect(200);
    expect((response.body as { ip: string }).ip).toMatch(/127\.0\.0\.1$/);
  });

  it.each([
    'true',
    'false',
    '1',
    'loopback',
    '0.0.0.0/0',
    '::/0',
    '10.0.0.1/33',
    '::1/129',
    '10.0.0.1/',
    '10.0.0.1,,::1',
    'host.example',
    '10.0.0.1/2/3',
  ])('rejects unsafe or invalid configuration %s', (value) => {
    expect(() => trustedProxyConfig(value)).toThrow('TRUSTED_PROXY_CIDRS');
  });

  it('does not trust arbitrary IPv4 peers through an IPv6 subnet (CVE-2026-90711)', () => {
    for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
      const app = appWithPolicy(subnet);
      const trust = app.get('trust proxy fn') as (ip: string) => boolean;
      expect(trust('198.51.100.10')).toBe(false);
    }
    const trust = appWithPolicy('::ffff:10.0.0.0/104').get(
      'trust proxy fn',
    ) as (ip: string) => boolean;
    expect(trust('10.1.2.3')).toBe(true);
    expect(trust('198.51.100.10')).toBe(false);
  });
});

describe.each(['registration', 'contact'] as const)(
  '%s rate limiter HTTP integration',
  (kind) => {
    it.each(['', '127.0.0.1/32,::1/128'])(
      'changing a forwarded prefix cannot reset the IP budget (policy %s)',
      async (policy) => {
        const counts = new Map<string, number>();
        const consume = jest.fn(({ ip }: { ip: string }) => {
          const count = (counts.get(ip) ?? 0) + 1;
          counts.set(ip, count);
          return Promise.resolve({
            allowed: count <= 1,
            retryAfterSeconds: 60,
            blockedBy: count > 1 ? 'ip' : null,
          });
        });
        const guard =
          kind === 'registration'
            ? new RegistrationThrottleGuard({
                consume,
              } as unknown as RegistrationRateLimiterService)
            : new PublicContactThrottleGuard({
                consume,
              } as unknown as PublicContactRateLimiterService);
        const app = appWithPolicy(policy);
        app.post('/limited', (req: Request, res: Response) => {
          const context = {
            switchToHttp: () => ({
              getRequest: () => req,
              getResponse: () => res,
            }),
          } as unknown as ExecutionContext;
          void guard
            .canActivate(context)
            .then(() => res.sendStatus(204))
            .catch((error: HttpException) =>
              res.status(error.getStatus()).json(error.getResponse()),
            );
        });
        await request(app)
          .post('/limited')
          .set('X-Forwarded-For', '203.0.113.1, 198.51.100.10')
          .expect(204);
        const blocked = await request(app)
          .post('/limited')
          .set('X-Forwarded-For', '203.0.113.2, 198.51.100.10')
          .expect(429);
        expect(blocked.headers['retry-after']).toBe('60');
        expect((blocked.body as { code: string }).code).toBe(
          'RATE_LIMIT_EXCEEDED',
        );
        expect(consume.mock.calls[0][0].ip).toBe(consume.mock.calls[1][0].ip);
      },
    );
  },
);
