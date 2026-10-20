import { modes } from '../config.js';
import { addTranscript, cartTotals } from '../store.js';
import { runGemini, noteForGemini } from './gemini.js';
import { runOffline } from './offline.js';

/**
 * Run one buyer turn. Uses Gemini when a key is set; if Gemini fails (quota, network),
 * falls back to the offline brain so the buyer is never left hanging.
 */
export async function runAgent(session, userText) {
  addTranscript(session, 'user', userText);
  let out;
  let brain = modes.ai;

  if (modes.ai === 'gemini') {
    const before = session.llmHistory.length;
    try {
      out = await runGemini(session, userText);
    } catch (err) {
      console.error('Gemini failed, using offline brain:', err.message);
      session.llmHistory.length = before; // roll back the half-finished turn
      brain = 'offline-fallback';
      out = await runOffline(session, userText);
    }
  } else {
    out = await runOffline(session, userText);
  }

  addTranscript(session, 'assistant', out.reply);
  return { ...out, brain, cart: cartTotals(session.cart) };
}

/** Record a backend fact (payment captured, item added from a card) so the agent knows next turn. */
export function addNote(session, text) {
  addTranscript(session, 'note', text);
  if (modes.ai === 'gemini') noteForGemini(session, text);
}
