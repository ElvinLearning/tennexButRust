// Push-to-talk speech recognition (R2) and a speech queue that speaks one agent at a time (R5).

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = !!Recognition;

export class PushToTalk {
  /** @param {{onCaption:(text:string)=>void, onFinal:(text:string)=>void, onError:(msg:string)=>void}} cb */
  constructor(cb) {
    this.cb = cb;
    this.active = false;
    this.rec = null;
  }

  start() {
    if (!Recognition || this.active) return false;
    this.active = true;
    this.finals = '';
    this.interim = '';
    this.released = false;
    const rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finals += `${r[0].transcript} `;
        else interim += r[0].transcript;
      }
      this.interim = interim;
      this.cb.onCaption(`${this.finals}${interim}`.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      const msg = e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in the address bar, or press Enter to type.'
        : `Speech recognition error: ${e.error}`;
      this.cb.onError(msg);
    };
    rec.onend = () => {
      // Chrome ends sessions on its own after silence; restart while V is still held.
      if (!this.released) { try { rec.start(); } catch { /* already started */ } return; }
      this.active = false;
      this.rec = null;
      this.cb.onFinal(`${this.finals}${this.interim}`.trim());
    };
    this.rec = rec;
    try { rec.start(); } catch (e) { this.active = false; this.cb.onError(`Could not start the microphone: ${e.message}`); return false; }
    return true;
  }

  stop() {
    if (!this.active || !this.rec) return;
    this.released = true;
    this.rec.stop(); // onend delivers the final text
  }
}

// Different voices per agent where the browser has several.
const VOICE_STYLE = {
  tenx: { pitch: 1.0, rate: 1.08, pick: 0 },
  assert: { pitch: 1.15, rate: 1.05, pick: 1 },
  vector: { pitch: 0.95, rate: 1.0, pick: 2 },
  deploy: { pitch: 0.85, rate: 1.06, pick: 3 },
  critic: { pitch: 0.9, rate: 0.98, pick: 4 },
};

export class Speaker {
  /** @param {(agentId:string|null)=>void} onSpeakingChange */
  constructor(onSpeakingChange) {
    this.synth = window.speechSynthesis || null;
    this.queues = new Map(); // agentId -> { sentences: string[], done: boolean }
    this.order = [];
    this.current = null;
    this.speaking = false;
    this.onSpeakingChange = onSpeakingChange;
    this.voices = [];
    this.muted = false;
    if (this.synth) {
      const load = () => {
        const all = this.synth.getVoices();
        const lang = (navigator.language || 'en').slice(0, 2);
        this.voices = all.filter((v) => v.lang?.startsWith(lang));
        if (!this.voices.length) this.voices = all;
      };
      load();
      this.synth.addEventListener?.('voiceschanged', load);
    }
  }

  get available() { return !!this.synth; }

  begin(agentId) {
    this.cancelAgent(agentId);
    this.queues.set(agentId, { sentences: [], done: false });
    this.order.push(agentId);
  }

  say(agentId, sentence) {
    const q = this.queues.get(agentId);
    if (!q || !sentence) return;
    q.sentences.push(sentence);
    this.pump();
  }

  finish(agentId) {
    const q = this.queues.get(agentId);
    if (q) q.done = true;
    this.pump();
  }

  pump() {
    if (!this.synth || this.speaking) return;
    while (this.order.length) {
      const id = this.current ?? this.order[0];
      const q = this.queues.get(id);
      if (!q) { this.order = this.order.filter((x) => x !== id); this.current = null; continue; }
      this.current = id;
      if (q.sentences.length) {
        this.speakNow(id, q.sentences.shift());
        return;
      }
      if (q.done) {
        this.queues.delete(id);
        this.order = this.order.filter((x) => x !== id);
        this.current = null;
        continue;
      }
      return; // wait for more of the current agent's reply
    }
    this.onSpeakingChange(null);
  }

  speakNow(id, text) {
    if (this.muted) { this.pump(); return; }
    const u = new SpeechSynthesisUtterance(text);
    const style = VOICE_STYLE[id] || VOICE_STYLE.tenx;
    if (this.voices.length) u.voice = this.voices[style.pick % this.voices.length];
    u.pitch = style.pitch;
    u.rate = style.rate;
    this.speaking = true;
    this.onSpeakingChange(id);
    const next = () => {
      if (u._cancelled) return;
      this.speaking = false;
      this.pump();
    };
    u.onend = next;
    u.onerror = next;
    this.utterance = u;
    this.synth.speak(u);
  }

  cancelAgent(agentId) {
    if (!this.queues.has(agentId)) return;
    this.queues.delete(agentId);
    this.order = this.order.filter((x) => x !== agentId);
    if (this.current === agentId) {
      this.current = null;
      if (this.speaking) this.stopUtterance();
    }
  }

  /** Stop all speech now (R2 AC3). Screens keep streaming. */
  interrupt() {
    this.queues.clear();
    this.order = [];
    this.current = null;
    if (this.speaking) this.stopUtterance();
    this.onSpeakingChange(null);
  }

  stopUtterance() {
    if (this.utterance) this.utterance._cancelled = true;
    this.speaking = false;
    this.synth?.cancel();
    this.onSpeakingChange(null);
    queueMicrotask(() => this.pump());
  }
}
