import { config } from './config.js';

/* Money helpers. Prices live in naira; buyers abroad pay in their own currency through PayPal. */

export const CURRENCIES = {
  USD: { symbol: '$', name: 'US dollars' },
  GBP: { symbol: '£', name: 'British pounds' },
  EUR: { symbol: '€', name: 'euros' },
  CAD: { symbol: 'CA$', name: 'Canadian dollars' },
};

export const isCurrency = (c) => Object.hasOwn(CURRENCIES, String(c || '').toUpperCase());
export const normCurrency = (c) => (isCurrency(c) ? String(c).toUpperCase() : config.defaultCurrency);

/** Naira -> checkout currency, rounded to whole units so prices look clean. */
export const fromNgn = (ngn, cur) => Math.max(1, Math.round(ngn / config.fx[normCurrency(cur)]));
/** Checkout currency -> naira (for budgets like "about £120"). */
export const toNgnFrom = (amount, cur) => Math.round(Number(amount) * config.fx[normCurrency(cur)]);

export const fmt = (amount, cur) => {
  const c = CURRENCIES[normCurrency(cur)];
  return `${c.symbol}${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
};
export const fmtNgn = (n) => `₦${Math.round(n).toLocaleString('en-US')}`;

export const deliveryFeeNgn = (subtotalNgn) =>
  subtotalNgn === 0 || subtotalNgn >= config.store.freeDeliveryFromNgn ? 0 : config.store.deliveryFeeNgn;

/** Guess a checkout currency from what the buyer typed. Returns null if nothing obvious. */
export function currencyFromText(text) {
  const t = String(text);
  if (/£|\bgbp\b|\bpounds?\b|\b(uk|london|manchester|birmingham|england|scotland)\b/i.test(t)) return 'GBP';
  if (/€|\beur\b|\beuros?\b|\b(germany|berlin|ireland|dublin|france|paris|italy|spain|netherlands|amsterdam)\b/i.test(t)) return 'EUR';
  if (/ca\$|\bcad\b|\bcanadian\b|\b(canada|toronto|calgary|vancouver|ottawa|montreal)\b/i.test(t)) return 'CAD';
  if (/\$|\busd\b|\bdollars?\b|\b(usa|america|us|houston|new york|atlanta|texas|dallas|maryland)\b/i.test(t)) return 'USD';
  return null;
}

/** Guess from a browser locale like "en-GB". */
export function currencyFromLocale(locale) {
  const region = String(locale || '').split(/[-_]/)[1]?.toUpperCase();
  if (region === 'GB') return 'GBP';
  if (region === 'CA') return 'CAD';
  if (['IE', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'FI'].includes(region)) return 'EUR';
  return 'USD';
}
