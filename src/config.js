import 'dotenv/config';

const env = (key, fallback = '') => (process.env[key] ?? fallback).trim();

export const config = {
  port: Number(env('PORT', '3000')),

  store: {
    name: env('STORE_NAME', 'Danzora'),
    tagline: env('STORE_TAGLINE', 'Gadgets that work as hard as you do'),
    currency: 'USD',
    // Official NFEM rate, 19 Oct 2026. Update before the demo.
    ngnPerUsd: Number(env('NGN_PER_USD', '1333.54')),
    // Free shipping at or above this subtotal; flat fee below it.
    freeShippingFrom: Number(env('FREE_SHIPPING_FROM', '150')),
    flatShipping: Number(env('FLAT_SHIPPING', '5')),
  },

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
