import { config, modes } from './config.js';
import { geminiText } from './agent/gemini.js';
import { fmtNgn } from './money.js';
import { displayPhone } from './nigeria.js';

/*
 * After a "buy for family back home" order is paid, write the WhatsApp message the buyer
 * sends to the person receiving the gift. Gemini writes it in the chosen language;
 * without a key we use warm templates (English and Pidgin).
 */

const LANGS = ['english', 'pidgin', 'yoruba', 'igbo', 'hausa'];
export const normLanguage = (l) => (LANGS.includes(String(l || '').toLowerCase()) ? String(l).toLowerCase() : 'english');

const itemsLine = (items) => items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)).join(' and ');

function template(order, lang) {
  const d = order.delivery;
  const first = (d.recipientName || '').split(' ').find((w) => !/^(mama|papa|mrs?|miss|dr|chief|alhaji|alhaja|aunty|uncle)$/i.test(w)) || d.recipientName;
  const from = d.senderName ? d.senderName : 'me';
  const note = d.giftNote ? `\n\n${d.giftNote}` : '';
  const what = itemsLine(order.items);
  if (lang === 'pidgin') {
    return `Hello ${first}! 🎁 I don buy ${what} for you from ${config.store.name}. Dem go deliver am to ${d.address}, ${d.city} within ${config.store.deliveryDays}. Dem fit call you for ${displayPhone(d.recipientPhone)} before dem come. Everything don pay finish, no pay anybody anything.${note}\n\n— ${from}`;
  }
  return `Hello ${first}! 🎁 I've bought you ${what} from ${config.store.name}. It will be delivered to ${d.address}, ${d.city} within ${config.store.deliveryDays}, and they may call you on ${displayPhone(d.recipientPhone)} before they come. It's fully paid, so please don't pay anyone anything on delivery.${note}\n\n— ${from}`;
}

export async function familyMessage(order) {
  const d = order.delivery;
  if (!d?.recipientPhone) return null;
  const lang = normLanguage(d.language);
  let text = null;

  if (modes.ai === 'gemini' && lang !== 'english') {
    try {
      text = await geminiText(
        `You write short, warm WhatsApp messages from a Nigerian living abroad to a family member back home, telling them a gift is on the way. Write ONLY the message, in ${lang}. Max 70 words. Keep product names, the address and the phone number exactly as given. Say clearly it is fully paid and they should not pay anyone on delivery. End with "— ${d.senderName || 'me'}".`,
        JSON.stringify({
          recipient: d.recipientName, relationship: d.relationship, items: itemsLine(order.items), store: config.store.name,
          address: `${d.address}, ${d.city}, ${d.state}`, phone: displayPhone(d.recipientPhone), deliveryTime: config.store.deliveryDays, personalNote: d.giftNote || null,
        }),
      );
    } catch (err) {
      console.error('Family message via Gemini failed, using template:', err.message);
    }
  }
  if (!text) text = template(order, lang === 'pidgin' ? 'pidgin' : 'english');

  const waUrl = `https://wa.me/${d.recipientPhone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
  // Without Gemini, only English and Pidgin templates exist.
  const usedLang = modes.ai === 'gemini' || lang === 'pidgin' ? lang : 'english';
  return { text, waUrl, language: usedLang, recipientName: d.recipientName, recipientPhone: displayPhone(d.recipientPhone), valueNgn: fmtNgn(order.totalNgn) };
}
