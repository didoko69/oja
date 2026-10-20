// Sample Danzora catalog. Replace with real products (and add `image` URLs) before the demo.
// Prices are in USD because PayPal sandbox checkout runs in USD.

export const products = [
  {
    id: 'ph-a15', name: 'Samsung Galaxy A15', category: 'phones', price: 165, stock: 12, rating: 4.4,
    tags: ['android', 'budget', 'big battery', 'amoled'],
    specs: { screen: '6.5" Super AMOLED', storage: '128GB', ram: '6GB', camera: '50MP main', battery: '5000mAh' },
    summary: 'Bright AMOLED screen and a two-day battery at a budget price.',
  },
  {
    id: 'ph-redmi13', name: 'Xiaomi Redmi Note 13', category: 'phones', price: 199, stock: 9, rating: 4.5,
    tags: ['android', 'camera', 'content creation', '108mp', 'amoled'],
    specs: { screen: '6.67" AMOLED 120Hz', storage: '256GB', ram: '8GB', camera: '108MP main', battery: '5000mAh' },
    summary: '108MP camera and 120Hz screen — the value pick for content creators.',
  },
  {
    id: 'ph-tecno-c20', name: 'Tecno Camon 20', category: 'phones', price: 179, stock: 15, rating: 4.3,
    tags: ['android', 'camera', 'selfie', 'content creation'],
    specs: { screen: '6.67" AMOLED', storage: '256GB', ram: '8GB', camera: '64MP main, 32MP selfie', battery: '5000mAh' },
    summary: 'Strong selfie camera with ring flash, great for video calls and content.',
  },
  {
    id: 'ph-pixel7a', name: 'Google Pixel 7a (UK used, A-grade)', category: 'phones', price: 289, stock: 4, rating: 4.7,
    tags: ['android', 'camera', 'clean android', 'night photos', 'content creation'],
    specs: { screen: '6.1" OLED 90Hz', storage: '128GB', ram: '8GB', camera: '64MP main, best-in-class processing', battery: '4385mAh' },
    summary: 'Best photo quality under $300, especially at night.',
  },
  {
    id: 'ph-iphone13', name: 'iPhone 13 (UK used)', category: 'phones', price: 389, stock: 0, rating: 4.8,
    tags: ['ios', 'apple', 'camera', 'premium'],
    specs: { screen: '6.1" OLED', storage: '128GB', camera: 'Dual 12MP', battery: '3240mAh' },
    summary: 'Premium iOS phone. Currently out of stock.',
  },
  {
    id: 'lp-hp240', name: 'HP 240 G8 Laptop', category: 'laptops', price: 329, stock: 6, rating: 4.2,
    tags: ['windows', 'student', 'office', 'budget'],
    specs: { cpu: 'Intel Core i3 11th gen', ram: '8GB', storage: '256GB SSD', screen: '14" HD', battery: 'up to 7 hrs' },
    summary: 'Reliable student and office laptop with a fast SSD.',
  },
  {
    id: 'lp-thinkpad', name: 'Lenovo ThinkPad T480 (refurbished)', category: 'laptops', price: 279, stock: 8, rating: 4.6,
    tags: ['windows', 'programming', 'student', 'durable', 'refurbished'],
    specs: { cpu: 'Intel Core i5 8th gen', ram: '16GB', storage: '512GB SSD', screen: '14" FHD', battery: 'dual battery, up to 10 hrs' },
    summary: 'Tough, great keyboard, 16GB RAM — the developer favourite on a budget.',
  },
  {
    id: 'lp-mba-m1', name: 'MacBook Air M1 (UK used)', category: 'laptops', price: 549, stock: 3, rating: 4.9,
    tags: ['macos', 'apple', 'programming', 'video editing', 'long battery'],
    specs: { cpu: 'Apple M1', ram: '8GB', storage: '256GB SSD', screen: '13.3" Retina', battery: 'up to 18 hrs' },
    summary: 'Silent, fast and an all-day battery. Handles light video editing.',
  },
  {
    id: 'au-oraimo-freepods', name: 'Oraimo FreePods 4', category: 'audio', price: 29, stock: 40, rating: 4.3,
    tags: ['earbuds', 'wireless', 'anc', 'budget'],
    specs: { type: 'True wireless earbuds', anc: 'Active noise cancelling', battery: '35 hrs with case' },
    summary: 'Noise-cancelling earbuds for less than $30.',
  },
  {
    id: 'au-jbl-go3', name: 'JBL Go 3 Speaker', category: 'audio', price: 45, stock: 18, rating: 4.6,
    tags: ['speaker', 'bluetooth', 'waterproof', 'portable'],
    specs: { type: 'Portable Bluetooth speaker', waterproof: 'IP67', battery: '5 hrs' },
    summary: 'Small, loud and waterproof.',
  },
  {
    id: 'au-boya-mic', name: 'BOYA BY-M1 Lavalier Mic', category: 'audio', price: 15, stock: 30, rating: 4.4,
    tags: ['microphone', 'content creation', 'youtube', 'video'],
    specs: { type: 'Clip-on lavalier microphone', cable: '6m', connector: '3.5mm with adapter' },
    summary: 'Clear voice for YouTube and TikTok videos for $15.',
  },
  {
    id: 'pw-oraimo-20k', name: 'Oraimo Traveler 20000mAh Power Bank', category: 'power', price: 22, stock: 50, rating: 4.5,
    tags: ['power bank', 'fast charging', 'nepa', 'travel'],
    specs: { capacity: '20000mAh', output: '22.5W fast charge', ports: 'USB-C + 2x USB-A' },
    summary: 'Charges a phone about 4 times. A must for power cuts.',
  },
  {
    id: 'pw-anker-10k', name: 'Anker PowerCore 10000', category: 'power', price: 26, stock: 20, rating: 4.7,
    tags: ['power bank', 'compact', 'travel'],
    specs: { capacity: '10000mAh', output: '12W', size: 'Pocket size' },
    summary: 'Pocket-sized and very reliable.',
  },
  {
    id: 'pw-solar-gen', name: 'ITEL Solar Power Station 300W', category: 'power', price: 199, stock: 5, rating: 4.4,
    tags: ['solar', 'inverter', 'nepa', 'backup power', 'laptop charging'],
    specs: { capacity: '296Wh', output: '300W AC + USB', charging: 'Solar panel or wall' },
    summary: 'Runs a laptop, router and fan through a power cut.',
  },
  {
    id: 'wr-redmi-watch', name: 'Redmi Watch 3 Active', category: 'wearables', price: 35, stock: 25, rating: 4.3,
    tags: ['smartwatch', 'fitness', 'calls', 'budget'],
    specs: { screen: '1.83" LCD', battery: '12 days', features: 'Bluetooth calls, heart rate, SpO2' },
    summary: 'Bluetooth calls and 12-day battery for $35.',
  },
  {
    id: 'ac-ringlight', name: '18" LED Ring Light with Tripod', category: 'accessories', price: 32, stock: 14, rating: 4.4,
    tags: ['ring light', 'content creation', 'youtube', 'tiktok', 'video'],
    specs: { size: '18 inch', stand: '2m tripod', modes: '3 colour modes, 10 brightness levels' },
    summary: 'Even, flattering light for videos and calls.',
  },
];

const byId = new Map(products.map((p) => [p.id, p]));

export function getProduct(id) {
  return byId.get(id) || null;
}

/** Find a product by id, exact name or a loose name match (used when the model passes a name). */
export function resolveProduct(ref) {
  if (!ref) return null;
  const direct = byId.get(ref);
  if (direct) return direct;
  const q = normalise(ref);
  return (
    products.find((p) => normalise(p.name) === q) ||
    products.find((p) => normalise(p.name).includes(q)) ||
    products.find((p) => q.includes(normalise(p.name).split(' (')[0])) ||
    null
  );
}

const STOP = new Set(['a', 'an', 'the', 'i', 'me', 'my', 'for', 'with', 'and', 'or', 'need', 'want', 'good', 'some', 'show', 'any', 'do', 'you', 'have', 'under', 'below', 'less', 'than', 'please', 'get', 'buy', 'looking']);
const SYNONYMS = {
  phone: 'phones', smartphone: 'phones', mobile: 'phones',
  laptop: 'laptops', computer: 'laptops', pc: 'laptops',
  earbud: 'earbuds', earphones: 'earbuds', headphones: 'earbuds', airpods: 'earbuds',
  powerbank: 'power bank', outage: 'nepa', blackout: 'nepa',
  watch: 'smartwatch',
  mic: 'microphone',
  content: 'content creation', creator: 'content creation', youtuber: 'youtube',
  coding: 'programming', developer: 'programming', code: 'programming',
};

function normalise(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 .]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Keyword + filter search. Returns products sorted by relevance, then rating.
 * Out-of-stock items are included (flagged) so the agent can say so honestly.
 */
export function searchProducts({ query = '', category, maxPrice, minPrice, inStockOnly = false, limit = 4 } = {}) {
  const words = normalise(query)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => SYNONYMS[w] || SYNONYMS[w.replace(/s$/, '')] || w);

  // If the buyer named a category ("phone", "laptop"...), stay inside it.
  const inferred = words.find((w) => categories.includes(w));
  const cat = category ? normalise(category) : inferred || null;

  const scored = products
    .filter((p) => (cat ? p.category === cat || p.category === cat + 's' : true))
    .filter((p) => (maxPrice != null ? p.price <= Number(maxPrice) : true))
    .filter((p) => (minPrice != null ? p.price >= Number(minPrice) : true))
    .filter((p) => (inStockOnly ? p.stock > 0 : true))
    .map((p) => {
      const hay = normalise([p.name, p.category, p.summary, ...p.tags, ...Object.values(p.specs)].join(' '));
      let score = 0;
      for (const w of words) {
        if (p.category === w || p.category === w + 's') score += 3;
        if (p.tags.some((t) => t === w)) score += 3;
        else if (hay.includes(w)) score += 1;
      }
      return { p, score };
    })
    .filter(({ score }) => (words.length ? score > 0 : true))
    .sort((a, b) => b.score - a.score || (b.p.stock > 0) - (a.p.stock > 0) || b.p.rating - a.p.rating);

  // Drop weak matches: keep results scoring more than half of the best one.
  const best = scored[0]?.score || 0;
  // (Not needed when a category already narrows the results.)
  const relevant = words.length && !cat ? scored.filter(({ score }) => score > best * 0.5) : scored;

  return relevant.slice(0, Math.max(1, Math.min(Number(limit) || 4, 8))).map(({ p }) => p);
}

/** The shape the AI and the UI see. Keeps internal fields out. */
export function publicProduct(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: p.price,
    inStock: p.stock > 0,
    stockLeft: p.stock,
    rating: p.rating,
    summary: p.summary,
    specs: p.specs,
    image: p.image || null,
  };
}

export const categories = [...new Set(products.map((p) => p.category))];
