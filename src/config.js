import 'dotenv/config';

const env = (key, fallback = '') => (process.env[key] ?? fallback).trim();

export const config = {
  port: Number(env('PORT', '3000')),

  store: {
    name: env('STORE_NAME', 'Danzora'),
    tagline: env('STORE_TAGLINE', 'Gadgets that work as hard as you do'),
    city: env('STORE_CITY', 'Lokoja'),
    // Nationwide delivery inside Nigeria, priced in naira. Free above the threshold.
    deliveryFeeNgn: Number(env('DELIVERY_FEE_NGN', '6000')),
    freeDeliveryFromNgn: Number(env('FREE_DELIVERY_FROM_NGN', '200000')),
    deliveryDays: env('DELIVERY_DAYS', '2–4 working days'),
  },

  /*
   * Naira per unit of each checkout currency (PayPal can't charge in naira).
   * USD: official NFEM rate, 19 Oct 2026. GBP/EUR: Aug 2026 NFEM cross rates applied
   * to the Oct USD rate. CAD: estimated from USD/CAD. Update before the demo.
   */
  fx: {
    USD: Number(env('NGN_PER_USD', '1333.54')),
    GBP: Number(env('NGN_PER_GBP', '1818')),
    EUR: Number(env('NGN_PER_EUR', '1555')),
    CAD: Number(env('NGN_PER_CAD', '973')),
  },
  defaultCurrency: 'USD',

  ai: {
    geminiKey: env('GEMINI_API_KEY'),
    geminiModel: env('GEMINI_MODEL', 'gemini-2.5-flash'),
    maxToolSteps: 6,
  },

  paypal: {
    clientId: env('PAYPAL_CLIENT_ID'),
    clientSecret: env('PAYPAL_CLIENT_SECRET'),
    // Sandbox by default. Set PAYPAL_ENV=live only after the hackathon.
    baseUrl:
      env('PAYPAL_ENV', 'sandbox') === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com',
    merchantEmail: env('PAYPAL_MERCHANT_EMAIL'),
  },

  sellerKey: env('SELLER_KEY'),
};

export const modes = {
  ai: config.ai.geminiKey ? 'gemini' : 'offline',
  paypal: config.paypal.clientId && config.paypal.clientSecret ? 'sandbox' : 'mock',
};
