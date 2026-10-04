// An agent's monitor: a canvas texture styled per role, redrawn at most 20×/second (spec §8).
import * as THREE from 'three';

const W = 1024;
const H = 640;
const HEADER = 44;
const PAD = 18;
const FONT = 19;
const LINE = 24;
export const MIN_REDRAW_MS = 50;

const THEMES = {
  code: { bg: '#1e1f29', header: '#16171f', fg: '#d7dae0', dim: '#5c6370', accent: '#61afef', title: 'editor' },
  tests: { bg: '#10151c', header: '#0b0f14', fg: '#c9d1d9', dim: '#56606b', accent: '#3fb950', title: 'test runner' },
  plan: { bg: '#f7f5ef', header: '#e8e3d6', fg: '#2b2b2b', dim: '#8a8578', accent: '#c7782a', title: 'plans & briefs' },
  terminal: { bg: '#0b0b0e', header: '#1b1b22', fg: '#b8f5b8', dim: '#4e6b4e', accent: '#a78bfa', title: 'terminal' },
  diff: { bg: '#181a20', header: '#101217', fg: '#d0d4dc', dim: '#5b616e', accent: '#f0506e', title: 'code review' },
};

const KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|new|async|await|def|fn|pub|use|struct|impl|local|end|then|true|false|null|None|self|this|describe|it|expect)\b/g;

// Idle "autopilot" snippets typed out slowly when nobody has asked for anything.
const IDLE = {
  code: 'function tick(state) {\n  const next = { ...state };\n  next.frame += 1;\n  for (const e of next.entities) {\n    e.x += e.vx;\n    e.y += e.vy;\n  }\n  return next;\n}\n\n// TODO: spatial hash for collisions\n',
  tests: "describe('tick', () => {\n  it('advances the frame', () => {\n    expect(tick({ frame: 1, entities: [] }).frame).toBe(2);\n  });\n\n  it('moves entities by velocity', () => {\n    // pending\n  });\n});\n",
  plan: '# Backlog grooming\n\n- [ ] onboarding flow\n- [ ] settings page\n- [ ] usage analytics (privacy review first)\n\nOpen questions:\n- who owns the design system?\n',
  terminal: '$ git status\n$ git log --oneline -5\n$ docker compose config\n$ # waiting for a task\n',
  diff: '--- a/src/tick.js\n+++ b/src/tick.js\n@@ -3,4 +3,4 @@\n-  next.frame++;\n+  next.frame += 1;\n',
};

export class Monitor {
  constructor(agent) {
    this.agent = agent;
    this.theme = THEMES[agent.screen];
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.text = '';
    this.title = 'autopilot';
    this.state = 'idle'; // idle | thinking | streaming | done | error
    this.error = '';
    this.scroll = 0; // lines from the top
    this.follow = true;
    this.idleText = IDLE[agent.screen];
    this.idleChars = 0;
    this.idleNext = 0;
    this.dirty = true;
    this.lastDraw = 0;
    this.lines = [];
    this.wrapCache = null;
    this.cols = Math.floor((W - PAD * 2 - 44) / (FONT * 0.6));
    this.rows = Math.floor((H - HEADER - PAD * 2) / LINE);
  }

  // ---- state changes (cheap; drawing happens in update) ----
  begin(prompt) {
    this.text = '';
    this.error = '';
    this.title = prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt;
    this.state = 'thinking';
    this.scroll = 0;
    this.follow = true;
    this.dirty = true;
  }

  append(t) {
    if (!t) return;
    this.text += t;
    this.state = 'streaming';
    this.dirty = true;
  }

  finish() {
    if (this.state !== 'error') this.state = 'done';
    this.dirty = true;
  }

  fail(message) {
    this.state = 'error';
    this.error = message;
    this.dirty = true;
  }

  scrollBy(lines) {
    const max = Math.max(0, this.wrapped().length - this.rows);
    this.scroll = Math.max(0, Math.min(max, this.scroll + lines));
    this.follow = this.scroll >= max;
    this.dirty = true;
  }

  fullText() {
    return this.text;
  }

  wrapped() {
    const src = this.state === 'idle' ? this.idleText.slice(0, this.idleChars) : this.text;
    if (this.wrapCache?.src === src) return this.wrapCache.lines;
    const out = [];
    for (const raw of src.replace(/\t/g, '  ').split('\n')) {
      if (raw.length <= this.cols) { out.push(raw); continue; }
      for (let i = 0; i < raw.length; i += this.cols) out.push(raw.slice(i, i + this.cols));
    }
    this.wrapCache = { src, lines: out };
    return out;
  }

  /** Call every frame; redraws only when something changed, and at most every 50 ms. */
  update(now) {
    if (this.state === 'idle' && now > this.idleNext) {
      this.idleChars = this.idleChars >= this.idleText.length + 40 ? 0 : this.idleChars + 1;
      this.idleNext = now + 60 + Math.random() * 140;
      this.dirty = true;
    }
    if (this.state === 'thinking') this.dirty = true; // spinner
    const blink = Math.floor(now / 500) % 2;
    if (blink !== this.blink && (this.state === 'streaming' || this.state === 'idle')) {
      this.blink = blink;
      this.dirty = true;
    }
    if (!this.dirty || now - this.lastDraw < MIN_REDRAW_MS) return;
    this.lastDraw = now;
    this.dirty = false;
    this.draw(now);
    this.texture.needsUpdate = true;
  }

  draw(now) {
    const { ctx, theme: th } = this;
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);

    // Header: window dots, agent, title, state.
    ctx.fillStyle = th.header;
    ctx.fillRect(0, 0, W, HEADER);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(22 + i * 22, HEADER / 2, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.font = `600 18px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = th.accent;
    ctx.textBaseline = 'middle';
    ctx.fillText(`${this.agent.name} · ${th.title}`, 96, HEADER / 2);
    ctx.fillStyle = th.dim;
    ctx.font = `16px ui-sans-serif, system-ui, sans-serif`;
    const label = { idle: 'autopilot', thinking: 'thinking…', streaming: 'writing…', done: 'ready', error: 'error' }[this.state];
    const title = this.state === 'idle' ? '' : this.title;
    ctx.fillText(title, 330, HEADER / 2, W - 330 - 140);
    ctx.textAlign = 'right';
    ctx.fillStyle = this.state === 'error' ? '#ff6b6b' : th.dim;
    ctx.fillText(label, W - PAD, HEADER / 2);
    ctx.textAlign = 'left';

    if (this.state === 'thinking' && !this.text) {
      this.drawSpinner(now);
      return;
    }

    const lines = this.wrapped();
    if (this.follow) this.scroll = Math.max(0, lines.length - this.rows);
    const start = Math.min(this.scroll, Math.max(0, lines.length - 1));
    const view = lines.slice(start, start + this.rows);

    ctx.font = `${FONT}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'top';
    let inFence = false;
    for (let i = 0; i < start; i++) if (lines[i].trimStart().startsWith('```')) inFence = !inFence;
    view.forEach((line, i) => {
      const y = HEADER + PAD + i * LINE;
      if (this.agent.screen !== 'plan') {
        ctx.fillStyle = th.dim;
        ctx.textAlign = 'right';
        ctx.fillText(String(start + i + 1), PAD + 30, y);
        ctx.textAlign = 'left';
      }
      if (line.trimStart().startsWith('```')) inFence = !inFence;
      this.drawLine(line, PAD + 44, y, inFence);
    });

    // Typing caret on the last line while writing / on autopilot.
    if ((this.state === 'streaming' || this.state === 'idle') && Math.floor(now / 500) % 2 === 0 && view.length) {
      const last = view[view.length - 1];
      ctx.fillStyle = th.accent;
      ctx.fillRect(PAD + 44 + ctx.measureText(last).width + 2, HEADER + PAD + (view.length - 1) * LINE + 2, 10, FONT);
    }

    // Scrollbar when content overflows.
    if (lines.length > this.rows) {
      const trackH = H - HEADER - 8;
      const h = Math.max(30, trackH * (this.rows / lines.length));
      const y = HEADER + 4 + (trackH - h) * (start / Math.max(1, lines.length - this.rows));
      ctx.fillStyle = th.dim;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(W - 10, y, 6, h);
      ctx.globalAlpha = 1;
    }

    if (this.state === 'error') this.drawError();
  }

  drawLine(line, x, y, inFence) {
    const { ctx, theme: th } = this;
    const kind = this.agent.screen;
    let color = th.fg;
    if (kind === 'diff' || /^(\+\+\+|---|@@)/.test(line)) {
      if (line.startsWith('+++') || line.startsWith('---')) color = th.dim;
      else if (line.startsWith('+')) color = '#56d364';
      else if (line.startsWith('-')) color = '#f47067';
      else if (line.startsWith('@@')) color = '#6cb6ff';
    }
    if (kind === 'terminal' && /^\s*\$/.test(line)) color = '#e6e6e6';
    if (kind === 'tests' && /\b(it|test)\(/.test(line)) color = '#e3b341';
    if (kind === 'plan' && !inFence) {
      if (/^#{1,6}\s/.test(line)) {
        ctx.font = `700 ${FONT + 2}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = th.accent;
        ctx.fillText(line.replace(/^#+\s*/, ''), x, y - 1);
        ctx.font = `${FONT}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        return;
      }
    }
    if (/^\s*(\/\/|#(?!#)|--(?!-)\s)/.test(line) && kind !== 'plan' && kind !== 'terminal') color = th.dim;
    ctx.fillStyle = color;
    if (color !== th.fg || kind === 'plan' || kind === 'terminal') {
      ctx.fillText(line, x, y);
      return;
    }
    // Light syntax highlighting: keywords and strings.
    let cx = x;
    const parts = line.split(/("[^"]*"|'[^']*'|`[^`]*`)/);
    for (const part of parts) {
      if (/^["'`]/.test(part)) {
        ctx.fillStyle = '#98c379';
        ctx.fillText(part, cx, y);
        cx += ctx.measureText(part).width;
        continue;
      }
      const words = part.split(KEYWORDS);
      words.forEach((w, i) => {
        ctx.fillStyle = i % 2 === 1 ? '#c678dd' : th.fg;
        ctx.fillText(w, cx, y);
        cx += ctx.measureText(w).width;
      });
    }
  }

  drawSpinner(now) {
    const { ctx, theme: th } = this;
    const cx = W / 2;
    const cy = (H + HEADER) / 2 - 10;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + now / 250;
      ctx.globalAlpha = (i + 1) / 8;
      ctx.fillStyle = th.accent;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.dim;
    ctx.font = '20px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('thinking…', cx, cy + 60);
    ctx.textAlign = 'left';
  }

  drawError() {
    const { ctx } = this;
    const boxH = 150;
    const y = H - boxH - 20;
    ctx.fillStyle = 'rgba(80, 10, 20, 0.92)';
    ctx.fillRect(20, y, W - 40, boxH);
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 2;
    ctx.strokeRect(20, y, W - 40, boxH);
    ctx.fillStyle = '#ffb3b3';
    ctx.font = '600 20px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('Something went wrong', 40, y + 16);
    ctx.fillStyle = '#ffe0e0';
    ctx.font = '18px ui-sans-serif, system-ui, sans-serif';
    wrapText(ctx, this.error, W - 80).slice(0, 4).forEach((l, i) => ctx.fillText(l, 40, y + 50 + i * 24));
  }
}

export function wrapText(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}
