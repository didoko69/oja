import { fromNgn, normCurrency } from './money.js';

/*
 * Danzora catalog — real products at real Nigerian market prices (naira).
 * PayPal sandbox checks out in USD, so each price is converted at the official
 * NFEM rate (config.store.ngnPerUsd) and buyers see both.
 *
 * Price sources:
 *  - Phones: retailer prices (Slot, Jumia, Konga) compiled by TechCabal, May 2026
 *    https://techcabal.com/2026/05/28/cheapest-phones-in-nigeria-and-their-prices/
 *  - Laptops: Nigerian price ranges, NaijaTechGuide, Jan 2026 (mid-range of each listed range)
 *    https://www.naijatechguide.com/laptop-prices-in-nigeria-hp-dell-acer.html
 *  - Oraimo FreePods 2, itel ITW-60: NigerianQueries earbuds price list
 *  - Items marked (est.) are typical Lagos market prices; confirm before going live.
 */
const raw = [
  /* ---------- phones (TechCabal / Slot / Jumia / Konga) ---------- */
  {
    id: 'ph-realme-note50', name: 'Realme Note 50 (4GB/128GB)', category: 'phones', priceNgn: 119100, stock: 14, rating: 4.2,
    tags: ['android', 'budget', 'cheap', 'student', 'big battery'],
    specs: { screen: '6.74" HD+ 90Hz', ram: '4GB (expandable)', storage: '128GB', battery: '5000mAh' },
    summary: 'The cheapest solid everyday phone in the store.',
  },
  {
    id: 'ph-galaxy-a07', photo: { file: 'Samsung_Galaxy_A07_2026.jpg' }, name: 'Samsung Galaxy A07 (4GB/64GB)', category: 'phones', priceNgn: 134800, stock: 10, rating: 4.3,
    tags: ['android', 'samsung', 'budget', 'camera', 'big battery'],
    specs: { screen: '6.7" PLS LCD 90Hz', ram: '4GB', storage: '64GB', camera: '50MP dual rear, 8MP selfie', battery: '5000mAh' },
    summary: 'Samsung reliability and a 50MP camera on a budget.',
  },
  {
    id: 'ph-hot50i', name: 'Infinix Hot 50i (4GB/128GB)', category: 'phones', priceNgn: 141400, stock: 12, rating: 4.2,
    tags: ['android', 'budget', 'gaming', 'smooth screen', 'big battery'],
    specs: { screen: '6.7" IPS 120Hz', ram: '4GB + 4GB virtual', storage: '128GB', camera: '48MP rear, 8MP selfie', battery: '5000mAh' },
    summary: 'Smooth 120Hz screen for scrolling and light gaming.',
  },
  {
    id: 'ph-spark30c', name: 'Tecno Spark 30C (4GB/128GB)', category: 'phones', priceNgn: 145000, stock: 11, rating: 4.3,
    tags: ['android', 'budget', 'camera', 'smooth screen', 'big battery'],
    specs: { screen: '6.67" IPS 120Hz', ram: '4GB + 4GB virtual', storage: '128GB', camera: '50MP main, 8MP selfie', battery: '5000mAh' },
    summary: '50MP camera and a 120Hz screen under ₦150k.',
  },
  {
    id: 'ph-galaxy-a06', photo: { file: 'Samsung_Galaxy_A06_5G_2025.jpg', note: '5G model shown' }, name: 'Samsung Galaxy A06 (4GB/128GB)', category: 'phones', priceNgn: 146000, stock: 9, rating: 4.4,
    tags: ['android', 'samsung', 'budget', 'camera', 'big battery', 'memory card'],
    specs: { screen: '6.7" PLS LCD 90Hz', ram: '4GB', storage: '128GB + microSD', camera: '50MP + 2MP rear, 8MP selfie', battery: '5000mAh' },
    summary: 'Samsung with 128GB and a memory card slot for all your photos.',
  },
  {
    id: 'ph-redmi14c', name: 'Xiaomi Redmi 14C (6GB/128GB)', category: 'phones', priceNgn: 146600, stock: 13, rating: 4.5,
    tags: ['android', 'xiaomi', 'budget', 'camera', 'content creation', 'big battery', 'memory card'],
    specs: { screen: '6.88" HD+ 120Hz', ram: '6GB', storage: '128GB + microSD up to 1TB', camera: '50MP triple rear, 13MP selfie', battery: '5160mAh' },
    summary: 'Most RAM for the money, with a 13MP selfie camera for video calls and content.',
  },
  {
    id: 'ph-spark40', name: 'Tecno Spark 40 (8GB/256GB)', category: 'phones', priceNgn: 184600, stock: 8, rating: 4.6,
    tags: ['android', 'camera', 'content creation', 'fast charging', 'big storage', 'video'],
    specs: { screen: '6.78" FHD+', ram: '8GB', storage: '256GB', camera: '64MP main, 13MP selfie', battery: '5000mAh, 45W fast charge' },
    summary: '64MP camera, 256GB and 45W charging — the best pick for content creators.',
  },
  {
    id: 'ph-hot50', photo: { file: 'Infinix_HOT_50_4G.jpg' }, name: 'Infinix Hot 50 (8GB/128GB)', category: 'phones', priceNgn: 210000, stock: 6, rating: 4.4,
    tags: ['android', 'camera', 'gaming', 'big battery', 'memory card'],
    specs: { screen: '6.7" HD+', ram: '8GB (up to 16GB)', storage: '128GB + microSD up to 1TB', camera: '48MP main, 8MP selfie', battery: '5000mAh' },
    summary: '8GB RAM for heavy multitasking and gaming.',
  },
  {
    id: 'ph-iphone15pm', photo: { file: 'Back_view_of_iPhone_15_Pro_Max_Natural_Titanium.jpg' }, name: 'iPhone 15 Pro Max (256GB)', category: 'phones', priceNgn: 1450000, stock: 0, rating: 4.9,
    tags: ['ios', 'apple', 'iphone', 'camera', 'premium', 'content creation'],
    specs: { screen: '6.7" Super Retina XDR 120Hz', chip: 'A17 Pro', storage: '256GB', camera: '48MP main, 5x telephoto' },
    summary: 'Flagship iPhone with a pro camera.', estimatedPrice: true,
  },

  /* ---------- laptops (NaijaTechGuide ranges) ---------- */
  {
    id: 'lp-thinkpad', photo: { file: 'ThinkPad_T480_and_T470s.jpg', note: 'T480 shown with a T470s' }, name: 'Lenovo ThinkPad T480 (UK used)', category: 'laptops', priceNgn: 380000, stock: 7, rating: 4.6,
    tags: ['windows', 'programming', 'coding', 'student', 'durable', 'uk used'],
    specs: { cpu: 'Intel Core i5 8th gen', ram: '8GB', storage: '256GB SSD', screen: '14" FHD', battery: 'dual battery' },
    summary: 'Tough, great keyboard, long battery — the developer favourite on a budget.',
  },
  {
    id: 'lp-elitebook840', name: 'HP EliteBook 840 G5 (UK used)', category: 'laptops', priceNgn: 450000, stock: 6, rating: 4.5,
    tags: ['windows', 'office', 'business', 'student', 'programming', 'uk used'],
    specs: { cpu: 'Intel Core i5 8th gen', ram: '8GB', storage: '256GB SSD', screen: '14" FHD' },
    summary: 'Slim aluminium business laptop for school and office work.',
  },
  {
    id: 'lp-hp250g9', name: 'HP 250 G9 (new)', category: 'laptops', priceNgn: 560000, stock: 5, rating: 4.3,
    tags: ['windows', 'new', 'student', 'office', 'warranty'],
    specs: { cpu: 'Intel Core i3 12th gen', ram: '8GB', storage: '256GB SSD', screen: '15.6" FHD' },
    summary: 'Brand-new with warranty and a big 15.6" screen.',
  },
  {
    id: 'lp-mba-m1', photo: { file: 'Macbook_Air_2020_(M1)_-_1.jpg' }, name: 'MacBook Air M1 (UK used)', category: 'laptops', priceNgn: 650000, stock: 3, rating: 4.9,
    tags: ['macos', 'apple', 'programming', 'video editing', 'long battery', 'content creation'],
    specs: { cpu: 'Apple M1', ram: '8GB', storage: '256GB SSD', screen: '13.3" Retina', battery: 'up to 18 hrs' },
    summary: 'Silent, fast and an all-day battery. Handles video editing.',
  },

  /* ---------- audio ---------- */
  {
    id: 'au-freepods2', name: 'Oraimo FreePods 2', category: 'audio', priceNgn: 12000, stock: 40, rating: 4.2,
    tags: ['earbuds', 'wireless', 'budget', 'cheap'],
    specs: { type: 'True wireless earbuds', drivers: '13mm', battery: '24+ hrs with case' },
    summary: 'Everyday wireless earbuds with strong bass.',
  },
  {
    id: 'au-spacebuds', name: 'Oraimo SpaceBuds Hybrid ANC', category: 'audio', priceNgn: 35000, stock: 18, rating: 4.6,
    tags: ['earbuds', 'wireless', 'anc', 'noise cancelling', 'calls'],
    specs: { type: 'True wireless earbuds', anc: 'Up to 50dB hybrid ANC', battery: 'Up to 40 hrs with case' },
    summary: 'Real noise cancelling for danfo rides and noisy offices.', estimatedPrice: true,
  },
  {
    id: 'au-itel-itw60', name: 'itel ITW-60 Earbuds', category: 'audio', priceNgn: 10500, stock: 30, rating: 4.0,
    tags: ['earbuds', 'wireless', 'budget', 'cheap'],
    specs: { type: 'True wireless earbuds', battery: 'Case recharges buds up to 6 times' },
    summary: 'The cheapest wireless earbuds we stock.',
  },
  {
    id: 'au-boya-mic', photo: { file: 'Boya_Dual_Omni-Directional_Lavalier_Mic_01.png', note: 'dual-mic model shown' }, name: 'BOYA BY-M1 Lavalier Mic', category: 'audio', priceNgn: 8000, stock: 30, rating: 4.4,
    tags: ['microphone', 'content creation', 'youtube', 'tiktok', 'video'],
    specs: { type: 'Clip-on lavalier microphone', cable: '6m', connector: '3.5mm with adapter' },
    summary: 'Clear voice for YouTube and TikTok videos.', estimatedPrice: true,
  },

  /* ---------- power ---------- */
  {
    id: 'pw-oraimo-20k', photo: { file: 'Oraimo_power_bank.jpg', note: 'Oraimo power bank' }, name: 'Oraimo Traveler 20000mAh Power Bank', category: 'power', priceNgn: 22000, stock: 50, rating: 4.5,
    tags: ['power bank', 'fast charging', 'nepa', 'travel'],
    specs: { capacity: '20000mAh', output: 'Fast charge', ports: 'USB-C + USB-A' },
    summary: 'Charges a phone about 4 times. A must for power cuts.', estimatedPrice: true,
  },
  {
    id: 'pw-solar-gen', name: '300W Portable Power Station (solar ready)', category: 'power', priceNgn: 285000, stock: 4, rating: 4.4,
    tags: ['solar', 'inverter', 'nepa', 'backup power', 'laptop charging', 'generator'],
    specs: { capacity: '~300Wh', output: '300W AC + USB', charging: 'Solar panel or wall' },
    summary: 'Runs a laptop, router and fan through a power cut — no fuel, no noise.', estimatedPrice: true,
  },

  /* ---------- wearables & accessories ---------- */
  {
    id: 'wr-oraimo-watch', name: 'Oraimo Watch 4 Plus', category: 'wearables', priceNgn: 30000, stock: 20, rating: 4.3,
    tags: ['smartwatch', 'fitness', 'calls', 'budget'],
    specs: { screen: 'AMOLED', features: 'Bluetooth calls, heart rate, sports modes' },
    summary: 'Take calls from your wrist and track workouts.', estimatedPrice: true,
  },
  {
    id: 'ac-ringlight', name: '18" LED Ring Light with Tripod', category: 'accessories', priceNgn: 25000, stock: 14, rating: 4.4,
    tags: ['ring light', 'content creation', 'youtube', 'tiktok', 'video'],
    specs: { size: '18 inch', stand: '2m tripod', modes: '3 colour modes, 10 brightness levels' },
    summary: 'Even, flattering light for videos and calls.', estimatedPrice: true,
  },
];


/*
 * Product photos: freely licensed images from Wikimedia Commons, credited on each card.
 * Only exact (or clearly labelled near-identical) models get a photo; the rest show an icon.
 * Replace with the store's own photos by setting `image` to any URL.
 */
const commons = (file, width = 480) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
const commonsPage = (file) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`;

export const products = raw.map((p) => ({
  ...p,
  price: fromNgn(p.priceNgn, 'USD'), // USD reference; checkout uses the buyer's currency
  image: p.image || (p.photo ? commons(p.photo.file) : null),
  imageCredit: p.photo ? { url: commonsPage(p.photo.file), note: p.photo.note || null } : null,
}));

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
/** Budgets are in naira (callers convert from the buyer's currency first). */
export function searchProducts({ query = '', category, maxPriceNgn, minPriceNgn, inStockOnly = false, limit = 4 } = {}) {
  const words = normalise(query)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => SYNONYMS[w] || SYNONYMS[w.replace(/s$/, '')] || w);

  // If the buyer named a category ("phone", "laptop"...), stay inside it.
  const inferred = words.find((w) => categories.includes(w));
  const cat = category ? normalise(category) : inferred || null;

  const scored = products
    .filter((p) => (cat ? p.category === cat || p.category === cat + 's' : true))
    .filter((p) => (maxPriceNgn != null ? p.priceNgn <= Number(maxPriceNgn) : true))
    .filter((p) => (minPriceNgn != null ? p.priceNgn >= Number(minPriceNgn) : true))
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
export function publicProduct(p, currency = 'USD') {
  const cur = normCurrency(currency);
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: fromNgn(p.priceNgn, cur),
    currency: cur,
    priceNgn: p.priceNgn,
    inStock: p.stock > 0,
    stockLeft: p.stock,
    rating: p.rating,
    summary: p.summary,
    specs: p.specs,
    image: p.image || null,
    imageCredit: p.imageCredit || null,
  };
}

export const categories = [...new Set(products.map((p) => p.category))];
