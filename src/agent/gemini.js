import { config } from '../config.js';
import { tools, runTool } from './tools.js';
import { systemPrompt } from './prompt.js';

/*
 * Gemini function-calling loop (REST, no SDK).
 * session.llmHistory stores Gemini "contents" so the model keeps tool context across turns.
 */

const ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const declarations = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));

async function callGemini(contents, { withTools = true, system = systemPrompt() } = {}) {
  const res = await fetch(ENDPOINT(config.ai.geminiModel), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.ai.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      ...(withTools ? { tools: [{ functionDeclarations: declarations }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
      generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const content = data.candidates?.[0]?.content;
  if (!content?.parts?.length) {
    const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'empty response';
    throw new Error(`Gemini returned no content (${reason})`);
  }
  return content;
}

export async function runGemini(session, userText) {
  const ui = [];
  const history = session.llmHistory;
  history.push({ role: 'user', parts: [{ text: userText }] });

  let reply = '';
  for (let step = 0; step < config.ai.maxToolSteps; step++) {
    const content = await callGemini(trim(history));
    // Keep the model turn exactly as returned (it may carry thought signatures).
    history.push({ role: 'model', parts: content.parts });

    const calls = content.parts.filter((p) => p.functionCall);
    const text = content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();

    if (!calls.length) {
      reply = text;
      break;
    }

    const responses = [];
    for (const { functionCall } of calls) {
      const result = await runTool(session, functionCall.name, functionCall.args, ui);
      responses.push({ functionResponse: { name: functionCall.name, response: { result } } });
    }
    history.push({ role: 'user', parts: responses });
    if (text) reply = text;
  }

  if (!reply) reply = 'Done! Anything else I can help you with?';
  return { reply, ui };
}

/** Add a backend fact (e.g. "payment captured") so the model knows on the next turn. */
export function noteForGemini(session, text) {
  session.llmHistory.push({ role: 'user', parts: [{ text: `[system] ${text}` }] });
  session.llmHistory.push({ role: 'model', parts: [{ text: 'Noted.' }] });
}

/** Keep the request small: last ~40 turns, never starting on a dangling tool response. */
function trim(history) {
  if (history.length <= 40) return history;
  let start = history.length - 40;
  while (start < history.length && !(history[start].role === 'user' && history[start].parts.some((p) => p.text))) start++;
  return history.slice(start);
}

/** One-shot text generation (used for the seller insight). */
export async function geminiText(system, prompt) {
  const content = await callGemini([{ role: 'user', parts: [{ text: prompt }] }], { withTools: false, system });
  return content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
}
