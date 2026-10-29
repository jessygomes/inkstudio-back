import { isIP } from 'node:net';

/** Only explicit proxy addresses/subnets are accepted; never trust every hop. */
export function trustedProxyConfig(
  value = process.env.TRUSTED_PROXY_CIDRS,
): false | string[] {
  if (!value?.trim()) return false;

  const entries = value.split(',').map((entry) => entry.trim());
  for (const entry of entries) {
    const [address, prefix, ...extra] = entry.split('/');
    const family = isIP(address);
    const maxPrefix = family === 4 ? 32 : 128;
    if (
      !family ||
      extra.length ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) ||
          Number(prefix) < 1 ||
          Number(prefix) > maxPrefix))
    ) {
      throw new Error(
        'TRUSTED_PROXY_CIDRS must contain explicit IP addresses or non-zero CIDR subnets',
      );
    }
  }
  return entries;
}
