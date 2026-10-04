// Streaming parser for the `SAY: … SCREEN: …` reply format (spec R5). Pure, no DOM.
//
// Feed chunks as they arrive; each push returns the *new* speech and screen text.
// Markers and <think>…</think> blocks never leak, even when split across chunks.

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

export class ReplyParser {
  constructor() {
    this.mode = 'say'; // 'say' | 'screen'
    this.thinking = false;
    this.pending = '';
    this.sawScreen = false;
    this.sayStarted = false;
    this.screenStarted = false;
    this.say = '';
    this.screen = '';
  }

  tokens() {
    if (this.thinking) return [THINK_CLOSE];
    const t = [THINK_OPEN];
    if (this.mode === 'say') t.push('SAY:', 'SCREEN:');
    return t;
  }

  push(chunk) {
    this.pending += chunk;
    return this.drain(false);
  }

  end() {
    return this.drain(true);
  }

  drain(final) {
    const out = { say: '', screen: '' };
    for (;;) {
      const toks = this.tokens();
      let best = -1;
      let tok = null;
      for (const t of toks) {
        const i = this.pending.indexOf(t);
        if (i !== -1 && (best === -1 || i < best)) { best = i; tok = t; }
      }
      if (tok) {
        this.emit(this.pending.slice(0, best), out);
        this.pending = this.pending.slice(best + tok.length);
        if (tok === THINK_OPEN) this.thinking = true;
        else if (tok === THINK_CLOSE) this.thinking = false;
        else if (tok === 'SAY:') this.mode = 'say';
        else if (tok === 'SCREEN:') { this.mode = 'screen'; this.sawScreen = true; }
        continue;
      }
      // No complete token: keep back any suffix that could be the start of one.
      let keep = 0;
      if (!final) {
        for (const t of toks) {
          for (let n = Math.min(t.length - 1, this.pending.length); n > keep; n--) {
            if (t.startsWith(this.pending.slice(-n))) { keep = n; break; }
          }
        }
      }
      this.emit(this.pending.slice(0, this.pending.length - keep), out);
      this.pending = this.pending.slice(this.pending.length - keep);
      return out;
    }
  }

  emit(text, out) {
    if (!text || this.thinking) return;
    if (this.mode === 'say') {
      if (!this.sayStarted) {
        text = text.replace(/^[\s*_#>]+/, '');
        if (!text) return;
        this.sayStarted = true;
      }
      out.say += text;
      this.say += text;
    } else {
      if (!this.screenStarted) {
        text = text.replace(/^[ \t*_]*\r?\n?/, '').replace(/^\s*\n/, '');
        if (!text) return;
        this.screenStarted = true;
      }
      out.screen += text;
      this.screen += text;
    }
  }
}

/** Parse a complete reply in one go. */
export function parseReply(full) {
  const p = new ReplyParser();
  p.push(full);
  p.end();
  return { say: cleanSpeech(p.say), screen: p.screen.replace(/\s+$/, ''), hasScreen: p.sawScreen };
}

/** Strip markdown and stray symbols so speech sounds natural. */
export function cleanSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/[*_#>~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Buffers streamed speech and releases whole sentences, so speaking can begin
 * at the first finished sentence (R5 AC1).
 */
export class SentenceBuffer {
  constructor() { this.buf = ''; }

  push(text) {
    this.buf += text;
    const out = [];
    // A sentence ends at . ! ? (optionally followed by quotes/brackets) and then whitespace.
    const re = /[.!?…]+["'”’)\]]*\s+/g;
    let last = 0;
    let m;
    while ((m = re.exec(this.buf))) {
      const candidate = this.buf.slice(last, m.index + m[0].length);
      // Don't split on common abbreviations like "e.g." or "Mr."
      if (/\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr)\.\s*$/i.test(candidate)) continue;
      const s = cleanSpeech(candidate);
      if (s) out.push(s);
      last = m.index + m[0].length;
    }
    this.buf = this.buf.slice(last);
    return out;
  }

  flush() {
    const s = cleanSpeech(this.buf);
    this.buf = '';
    return s ? [s] : [];
  }
}
