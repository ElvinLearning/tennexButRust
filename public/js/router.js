// Decide who a message is for (spec R4). Pure functions, no DOM.
import { AGENTS } from './agents.js';

const GREETING = '(?:hey|hi|hello|ok|okay|yo|so)';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Speech recognition hears "Tenx" as "10x", "ten x", ... Rewrite every alias to the canonical id.
export function normalizeNames(text) {
  let out = text;
  for (const a of AGENTS) {
    for (const alias of a.aliases) {
      if (alias === a.id) continue;
      const re = new RegExp(`(^|[^\\w@])(@?)${escape(alias).replace(/ /g, '\\s*')}(?![\\w])`, 'gi');
      out = out.replace(re, (_, pre, at) => `${pre}${at}${a.name}`);
    }
  }
  return out;
}

function mentions(text) {
  const found = new Set();
  const re = /@([a-z0-9]+)/gi;
  let m;
  while ((m = re.exec(text))) {
    const a = AGENTS.find((x) => x.id === m[1].toLowerCase());
    if (a) found.add(a.id);
  }
  return [...found];
}

/**
 * @param {string} raw        what the user said or typed
 * @param {string|null} nearbyId  agent the player is standing next to
 * @returns {{targets: string[], text: string, reason: string, error?: string}}
 */
export function route(raw, nearbyId = null) {
  const text = normalizeNames(raw.trim());
  if (!text) return { targets: [], text, reason: 'empty', error: 'Say or type something first.' };

  // 1. "team, …" / "everyone, …"
  const all = text.match(new RegExp(`^(?:${GREETING}\\s+)?@?(?:team|everyone|everybody|all)\\s*[,:!.\\-—]\\s*`, 'i'))
    || text.match(/^@(?:team|everyone|all)\b\s*/i);
  if (all) {
    return { targets: AGENTS.map((a) => a.id), text: text.slice(all[0].length) || text, reason: 'team' };
  }

  // 2. Starts with a name: "Critic, …", "@critic …", "hey critic …"
  for (const a of AGENTS) {
    const re = new RegExp(`^(${GREETING}\\s+)?(@)?${escape(a.id)}\\b(\\s*[,:!?.\\-—])?\\s*`, 'i');
    const m = text.match(re);
    if (!m) continue;
    const [whole, greeting, at, punct] = m;
    // Names that are also verbs ("deploy it", "assert that…") need an explicit signal.
    if (a.verb && !greeting && !at && !punct) continue;
    return { targets: [a.id], text: text.slice(whole.length) || text, reason: 'name' };
  }

  // 3. Exactly one @name anywhere.
  const ms = mentions(text);
  if (ms.length === 1) return { targets: ms, text, reason: 'mention' };

  // 4. Whoever you're standing next to.
  if (nearbyId) return { targets: [nearbyId], text, reason: 'nearby' };

  const shown = raw.trim().length > 48 ? `${raw.trim().slice(0, 48)}…` : raw.trim();
  return {
    targets: [], text, reason: 'nobody',
    error: `Nobody heard “${shown}” — walk up to someone, or start with a name (e.g. “Tenx, …” or “team, …”).`,
  };
}

// ---- @mention autocomplete for the text box (R3) ----

/** The partial name being typed at the caret, e.g. "cr" for "hey @cr|". */
export function mentionQuery(text, caret = text.length) {
  const m = text.slice(0, caret).match(/(?:^|\s)@([a-z0-9]*)$/i);
  return m ? m[1].toLowerCase() : null;
}

export function matchAgents(partial) {
  if (partial == null) return [];
  return AGENTS.filter((a) => a.id.startsWith(partial.toLowerCase()));
}

/** Replace the partial mention at the caret with the full name. */
export function completeMention(text, caret, agentId) {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const replaced = before.replace(/@([a-z0-9]*)$/i, `@${agentId} `);
  return { text: replaced + after.replace(/^\s+/, ''), caret: replaced.length };
}
