/* eslint-disable @typescript-eslint/no-require-imports */
// Les origines sont calculées à l'import : chaque test recharge le module avec son propre environnement.
function load(env: Record<string, string | undefined> = {}): typeof import('./cors.config') {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const key of Object.keys(env)) if (env[key] === undefined) delete process.env[key];
  try {
    let loaded!: typeof import('./cors.config');
    jest.isolateModules(() => {
      loaded = require('./cors.config');
    });
    return loaded;
  } finally {
    process.env = saved;
  }
}

describe('cors.config', () => {
  it("accepts the backend's own origin, sent by React Native on websocket upgrades", () => {
    const { isAllowedOrigin } = load();
    expect(isAllowedOrigin('https://inkstudio-back-production.up.railway.app')).toBe(true);
  });

  it('accepts the origin of BACKEND_URL (path ignored) and RAILWAY_PUBLIC_DOMAIN', () => {
    const { isAllowedOrigin } = load({
      BACKEND_URL: 'http://192.168.1.52:4000/api',
      RAILWAY_PUBLIC_DOMAIN: 'api.example.test',
    });
    expect(isAllowedOrigin('http://192.168.1.52:4000')).toBe(true);
    expect(isAllowedOrigin('https://api.example.test')).toBe(true);
  });

  it('ignores an unparsable BACKEND_URL', () => {
    const { ALLOWED_ORIGINS } = load({ BACKEND_URL: 'http://' });
    expect(ALLOWED_ORIGINS).toContain('https://inkstudio-back-production.up.railway.app');
  });

  it('still refuses unknown origins and keeps the existing ones', () => {
    const { isAllowedOrigin } = load();
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('https://theinkera.com')).toBe(true);
    expect(isAllowedOrigin(undefined)).toBe(true);
  });
});
