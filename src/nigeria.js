/* Nigerian delivery helpers: states, common cities, phone numbers, and a forgiving address parser. */

export const STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta',
  'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi',
  'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers',
  'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

/** Common delivery cities and their state. */
export const CITIES = {
  lokoja: 'Kogi', okene: 'Kogi', kabba: 'Kogi', idah: 'Kogi', anyigba: 'Kogi', ankpa: 'Kogi',
  abuja: 'FCT', gwagwalada: 'FCT', kubwa: 'FCT', lugbe: 'FCT',
  lagos: 'Lagos', ikeja: 'Lagos', lekki: 'Lagos', yaba: 'Lagos', surulere: 'Lagos', ikorodu: 'Lagos', ajah: 'Lagos', 'victoria island': 'Lagos',
  ibadan: 'Oyo', ogbomoso: 'Oyo', abeokuta: 'Ogun', 'ijebu ode': 'Ogun', sagamu: 'Ogun',
  ilorin: 'Kwara', malete: 'Kwara', offa: 'Kwara',
  'port harcourt': 'Rivers', enugu: 'Enugu', nsukka: 'Enugu', owerri: 'Imo', aba: 'Abia', umuahia: 'Abia',
  onitsha: 'Anambra', awka: 'Anambra', nnewi: 'Anambra', asaba: 'Delta', warri: 'Delta', 'benin city': 'Edo', benin: 'Edo',
  kaduna: 'Kaduna', zaria: 'Kaduna', kano: 'Kano', jos: 'Plateau', makurdi: 'Benue', minna: 'Niger', lafia: 'Nasarawa',
  akure: 'Ondo', osogbo: 'Osun', 'ile ife': 'Osun', 'ado ekiti': 'Ekiti', calabar: 'Cross River', uyo: 'Akwa Ibom',
  yenagoa: 'Bayelsa', abakaliki: 'Ebonyi', bauchi: 'Bauchi', maiduguri: 'Borno', sokoto: 'Sokoto', yola: 'Adamawa',
};

const RELATIONS = [
  'mum', 'mom', 'mother', 'mama', 'mummy', 'dad', 'father', 'papa', 'daddy', 'sister', 'brother', 'sis', 'bro',
  'wife', 'husband', 'son', 'daughter', 'aunt', 'aunty', 'auntie', 'uncle', 'grandma', 'grandmother', 'grandpa',
  'grandfather', 'cousin', 'niece', 'nephew', 'friend', 'family', 'parents', 'in-law',
];

// Digit runs that may contain spaces, dashes or brackets: "0803 123 4567", "+234 (0) 803-123-4567".
const PHONE_CANDIDATE_RE = /\+?[\d][\d\s()-]{8,18}\d/g;

function phoneMatch(text) {
  for (const m of String(text || '').matchAll(PHONE_CANDIDATE_RE)) {
    let d = m[0].replace(/\D/g, '');
    if (d.startsWith('2340')) d = d.slice(4);
    else if (d.startsWith('234')) d = d.slice(3);
    else if (d.startsWith('0')) d = d.slice(1);
    if (/^[789][01]\d{8}$/.test(d)) return { raw: m[0], phone: `+234${d}` };
  }
  return null;
}

/** "+2348031234567" -> "0803 123 4567" (how Nigerians write it). */
export const displayPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '').replace(/^234/, '');
  return d.length === 10 ? `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(p || '');
};

/** Normalise a Nigerian mobile number to +234XXXXXXXXXX, or null. */
export const normalisePhone = (text) => phoneMatch(text)?.phone || null;

export function findState(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(fct|abuja)\b/.test(t)) return 'FCT';
  return STATES.find((s) => new RegExp(`\\b${s.toLowerCase()}\\b`).test(t)) || null;
}

export function findCity(text) {
  const t = String(text || '').toLowerCase();
  const hit = Object.keys(CITIES).sort((a, b) => b.length - a.length).find((c) => new RegExp(`\\b${c}\\b`).test(t));
  return hit ? { city: hit.replace(/\b\w/g, (c) => c.toUpperCase()), state: CITIES[hit] } : null;
}

/** "my mum", "my brother in Abuja" -> "mum" / "brother". */
export function findRelationship(text) {
  const m = String(text || '').toLowerCase().match(new RegExp(`\\b(?:my|for (?:my|our))\\s+(${RELATIONS.join('|')})\\b`));
  return m ? m[1] : null;
}

/** Is the buyer buying for someone else in Nigeria? */
export function isGiftIntent(text) {
  const t = String(text || '').toLowerCase();
  return Boolean(findRelationship(t)) || /\b(back home|for (?:someone|somebody) in|send (?:it )?to (?:my|nigeria)|gift for|as a gift|deliver(?:ed)? to my)\b/.test(t);
}

/**
 * Pull whatever delivery details are in a message, e.g.
 * "Mama Grace Idoko, 0803 123 4567, 12 Ganaja Road, Lokoja, Kogi".
 * Returns only the fields it found.
 */
export function parseDelivery(text) {
  const raw = String(text || '').trim();
  const out = {};
  const pm = phoneMatch(raw);
  if (pm) out.recipientPhone = pm.phone;
  const city = findCity(raw);
  const state = findState(raw) || city?.state;
  if (city) out.city = city.city;
  if (state) out.state = state;

  const cleaned = (pm ? raw.replace(pm.raw, '|') : raw).replace(/\b(?:(?:her|his|their|the|my \w+'?s?)\s+)?(?:full\s+)?(?:name|phone(?: number)?|number|address)\s*(?:is|:|-)\s*/gi, '|');
  const parts = cleaned.split(/[,\n;|]+/).map((s) => s.trim()).filter(Boolean);
  const isPlace = (s) => findCity(s) || findState(s);
  const STREETY = /\b(road|rd|street|st|close|avenue|ave|estate|crescent|lane|way|junction|opposite|behind|near|quarters|area|phase|house|plot|block|flat|no\.?)\b/i;
  const isAddress = (s) => !/[£€$₦]|\b(about|around|budget|under)\b/i.test(s) && (STREETY.test(s) || /^\d+[a-z]?\s+[a-z]/i.test(s));
  const firstAddr = parts.findIndex(isAddress);
  const looksLikeName = (s) => s.length >= 3 && looksLikePersonName(s) && !isPlace(s) && !STREETY.test(s);
  // A name comes before the street address; plain words after it are the neighbourhood.
  const name = parts.find((s, i) => looksLikeName(s) && (firstAddr === -1 || i < firstAddr));
  if (name) out.recipientName = name;
  if (firstAddr !== -1) {
    const addr = parts.filter((s, i) => i >= firstAddr && !isPlace(s) && s !== name && (isAddress(s) || /^[a-z' .-]{3,40}$/i.test(s)));
    out.address = addr.join(', ');
  }
  return out;
}

const NOT_NAME_WORDS = new Set(('add the a an one cheaper cheapest first second third last this that it its want need buy get show me please pls yes no ok okay ' +
  'and for to of in on at with what how which who can could do does you your i we my our is are was be checkout pay order cart phone laptop ' +
  'compare remove price cost much send deliver delivery tomorrow today later now thanks thank hi hello hey good morning').split(' '));

/** Could this short text be a person's name (not a command like "add the cheaper one")? */
export function looksLikePersonName(text) {
  const words = String(text || '').trim().split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;
  if (!words.every((w) => /^[a-z][a-z'.-]*$/i.test(w))) return false;
  return !words.some((w) => NOT_NAME_WORDS.has(w.toLowerCase()));
}

export const REQUIRED_DELIVERY = ['recipientName', 'recipientPhone', 'address', 'city', 'state'];
export const missingDelivery = (d) => REQUIRED_DELIVERY.filter((k) => !d?.[k]);
