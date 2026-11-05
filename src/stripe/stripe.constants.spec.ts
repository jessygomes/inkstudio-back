import { checkoutPlanFromPriceId } from './stripe.constants';

describe('checkoutPlanFromPriceId', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('recognises the current prices', () => {
    process.env.STRIPE_PRICE_PRO = 'price_pro_new';
    process.env.STRIPE_PRICE_BUSINESS = 'price_business_new';
    expect(checkoutPlanFromPriceId('price_pro_new')).toBe('PRO');
    expect(checkoutPlanFromPriceId('price_business_new')).toBe('BUSINESS');
  });

  it('keeps recognising old prices listed as legacy (comma-separated, spaces ignored)', () => {
    process.env.STRIPE_PRICE_PRO = 'price_pro_new';
    process.env.STRIPE_PRICE_BUSINESS = 'price_business_new';
    process.env.STRIPE_PRICE_PRO_LEGACY = 'price_pro_old, price_pro_older';
    process.env.STRIPE_PRICE_BUSINESS_LEGACY = ' price_business_old ';
    expect(checkoutPlanFromPriceId('price_pro_old')).toBe('PRO');
    expect(checkoutPlanFromPriceId('price_pro_older')).toBe('PRO');
    expect(checkoutPlanFromPriceId('price_business_old')).toBe('BUSINESS');
  });

  it('ignores an unknown price, even when the variables are empty', () => {
    process.env.STRIPE_PRICE_PRO = '';
    process.env.STRIPE_PRICE_BUSINESS = '';
    delete process.env.STRIPE_PRICE_PRO_LEGACY;
    delete process.env.STRIPE_PRICE_BUSINESS_LEGACY;
    expect(checkoutPlanFromPriceId('price_unknown')).toBeNull();
    expect(checkoutPlanFromPriceId('')).toBeNull();
  });
});
