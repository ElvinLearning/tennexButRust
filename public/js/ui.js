// DOM overlays: start/pause screens, roster, prompt box, full-text viewer, HUD, toasts.
import { mentionQuery, matchAgents, completeMention } from './router.js';

const $ = (id) => document.getElementById(id);

export function show(id) { $(id).hidden = false; }
export function hide(id) { $(id).hidden = true; }
export function hideOverlays() { for (const id of ['start', 'pause', 'click-resume', 'fulltext']) hide(id); }
export function onClick(id, fn) { $(id).addEventListener('click', fn); }

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderStartTeam(agents) {
  $('start-team').innerHTML = agents
    .map((a) => `<span class="who" style="border-color:${hex(a.color)}"><b>${esc(a.name)}</b><span class="muted">${esc(a.role)}</span></span>`)
    .join('');
}
export function setStartStatus(text) { $('start-status').textContent = text; }
export function setStartStatusExtra(text) {
  const p = document.createElement('p');
  p.className = 'muted small';
  p.textContent = text;
  $('start-status').after(p);
}
export function setModeBadge(text) { $('mode-badge').textContent = text; }
export function setHint(text) { $('hint').textContent = text; }

export function setCaption(text) {
  const el = $('caption');
  if (text == null) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
}

export function renderFeed(lines) {
  $('feed').innerHTML = lines.map((l) => `<div>${esc(l)}</div>`).join('');
}

export function toast(message, kind = 'info') {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.append(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.remove(), kind === 'error' ? 9000 : 5000);
}

// ---- pause screen roster (R7) ----
export function renderRoster({ agents, options, current, label, onChange, onAll, status, brief }) {
  $('pause-status').textContent = status;
  $('pause-brief').textContent = brief || 'none — press Enter and type /brief <text>';
  const optionHtml = (selected) => options
    .map((o) => `<option value="${esc(o.id)}"${o.id === selected ? ' selected' : ''}>${esc(o.label)}</option>`)
    .join('');
  $('roster').innerHTML = agents.map((a) => `
    <tr>
      <td><span class="dot" style="background:${hex(a.color)}"></span><b>${esc(a.name)}</b>
        <span class="model-label">${esc(label(a.id))}</span></td>
      <td class="muted">${esc(a.role)}</td>
      <td><select data-agent="${a.id}" aria-label="Model for ${esc(a.name)}">${optionHtml(current(a.id))}</select></td>
    </tr>`).join('');
  for (const sel of $('roster').querySelectorAll('select')) {
    sel.addEventListener('change', () => onChange(sel.dataset.agent, sel.value));
  }
  const all = $('model-all');
  const values = new Set(agents.map((a) => current(a.id)));
  const same = values.size === 1 ? [...values][0] : null;
  all.innerHTML = (same ? '' : '<option value="" selected>— mixed —</option>') + optionHtml(same);
  all.onchange = () => { if (all.value) onAll(all.value); };
}

// ---- prompt box (R3) ----
let promptCtx = null;

export function openPrompt(ctx) {
  promptCtx = ctx;
  const input = $('prompt-input');
  input.value = '';
  $('chips').innerHTML = ctx.agents
    .map((a) => `<span class="chip" data-id="${a.id}" style="border-left:3px solid ${hex(a.color)}">@${a.id}<span class="role">${esc(a.role)}</span></span>`)
    .join('');
  for (const chip of $('chips').children) {
    chip.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus in the input
      insertMention(chip.dataset.id);
    });
  }
  show('prompt');
  updatePrompt();
  setTimeout(() => input.focus(), 0);
}

export function closePrompt() {
  promptCtx = null;
  hide('prompt');
  $('prompt-input').blur();
}

function insertMention(id) {
  const input = $('prompt-input');
  const caret = input.selectionStart ?? input.value.length;
  if (mentionQuery(input.value, caret) != null) {
    const r = completeMention(input.value, caret, id);
    input.value = r.text;
    input.setSelectionRange(r.caret, r.caret);
  } else {
    input.value = `@${id} ${input.value.replace(/^\s+/, '')}`;
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }
  updatePrompt();
}

function updatePrompt() {
  if (!promptCtx) return;
  const input = $('prompt-input');
  const text = input.value;
  const partial = mentionQuery(text, input.selectionStart ?? text.length);
  const matches = new Set(matchAgents(partial).map((a) => a.id));

  const target = $('prompt-target');
  let targets = [];
  if (/^\s*\/brief\b/i.test(text)) {
    target.textContent = '→ project brief';
    target.className = '';
  } else {
    const r = promptCtx.route(text.trim() || 'x', promptCtx.nearbyId());
    targets = r.targets;
    if (!targets.length) { target.textContent = '→ nobody'; target.className = 'none'; }
    else {
      target.className = '';
      target.textContent = targets.length === promptCtx.agents.length
        ? '→ Everyone'
        : `→ ${promptCtx.agents.find((a) => a.id === targets[0]).name}`;
    }
  }
  for (const chip of $('chips').children) {
    chip.classList.toggle('match', partial != null && matches.has(chip.dataset.id));
    chip.classList.toggle('target', targets.includes(chip.dataset.id));
  }
}

$('prompt-input').addEventListener('input', updatePrompt);
$('prompt-input').addEventListener('click', updatePrompt);
$('prompt-input').addEventListener('keydown', (e) => {
  if (!promptCtx) return;
  e.stopPropagation();
  const input = e.target;
  if (e.key === 'Tab') {
    e.preventDefault();
    const partial = mentionQuery(input.value, input.selectionStart);
    const m = matchAgents(partial);
    if (m.length) insertMention(m[0].id);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    promptCtx.onSend(input.value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    promptCtx.onCancel();
  } else {
    setTimeout(updatePrompt, 0); // caret moves
  }
});

// ---- full text viewer (R6 AC3) ----
let fullCtx = null;

export function openFullText(ctx) {
  fullCtx = ctx;
  $('fulltext-title').textContent = ctx.title;
  $('fulltext-body').value = ctx.text;
  show('fulltext');
}
export function closeFullText() {
  fullCtx = null;
  hide('fulltext');
}

onClick('copy-all', async () => {
  const area = $('fulltext-body');
  try {
    await navigator.clipboard.writeText(area.value);
    toast('Copied to clipboard.');
  } catch {
    // Clipboard blocked: pre-select so Ctrl/Cmd+C works.
    area.focus();
    area.select();
    toast('Your browser blocked the clipboard. The text is selected; press Ctrl/Cmd+C to copy.', 'error');
  }
});
onClick('fulltext-close', () => fullCtx?.onClose());
document.addEventListener('keydown', (e) => {
  if (fullCtx && e.key === 'Escape') fullCtx.onClose();
});
