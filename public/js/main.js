// Tennex Office — browser entry point: scene, player, agents, input and chat flow.
import * as THREE from 'three';
import { AGENTS, byId } from './agents.js';
import { buildOffice, DESK_Z, SEAT_Z, FRONT_AISLE_Z, BACK_AISLE_Z, GAP_XS } from './office.js';
import { Character, STATUS_COLORS } from './character.js';
import { Monitor } from './monitor.js';
import { route } from './router.js';
import { ReplyParser, SentenceBuffer, parseReply } from './replyParser.js';
import { briefCommand } from './brief.js';
import { simReply, streamSim } from './sim.js';
import { fetchHealth, streamChat } from './api.js';
import { PushToTalk, Speaker, voiceSupported } from './voice.js';
import * as ui from './ui.js';

// ---------- constants ----------
const EYE = 1.65;
const PLAYER_R = 0.3;
const AGENT_R = 0.32;
const WALK = 3.6;
const SPRINT = 7;
const NEAR = 2.4;
const HISTORY_MAX = 24;
const FEED_MAX = 12;

// ---------- renderer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d24);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 60);
camera.rotation.order = 'YXZ';

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- office ----------
const office = buildOffice(scene);
const colliders = office.colliders;

// ---------- agents ----------
const states = AGENTS.map((agent, i) => {
  const desk = office.desks[i];
  const char = new Character(agent);
  const seat = { x: desk.x, z: SEAT_Z };
  char.root.position.set(seat.x, 0, seat.z);
  char.root.rotation.y = Math.PI; // face the desk (-z)
  char.chair.position.set(seat.x, 0, seat.z);
  char.chair.rotation.y = Math.PI;
  scene.add(char.root, char.chair);

  const monitor = new Monitor(agent);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.6, 0.04), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }));
  bezel.position.set(0, 1.12, -0.28);
  desk.group.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.55), new THREE.MeshBasicMaterial({ map: monitor.texture, toneMapped: false }));
  screen.position.set(0, 1.12, -0.255);
  desk.group.add(screen);

  return {
    agent, char, monitor, seat,
    screenWorld: new THREE.Vector3(desk.x, 1.12, DESK_Z - 0.255),
    mode: 'desk', // desk | walking | poi
    path: [], visited: [], returning: false, speed: 1.3, poi: null, poiUntil: 0,
    nextBreak: 12 + i * 9 + Math.random() * 20,
    controller: null, pending: false, streamingScreen: false, error: null,
    history: [],
    status: 'autopilot',
  };
});
const stateById = Object.fromEntries(states.map((s) => [s.agent.id, s]));

// ---------- app state ----------
let mode = 'start'; // start | play | paused | prompt | fulltext | resume
let focus = null; // { s, t, dir, fromPos, fromQuat, toPos, toQuat }
let expectUnlock = false;
let health = { live: false, models: [], defaultModel: 'sim' };
let brief = load('tennex.brief', '');
let savedModels = load('tennex.models', {});
let feed = [];
let speakingId = null;
let listening = false;
let listenTarget = null;

const player = { x: 0, z: 4.6, yaw: 0, pitch: -0.05 };
const keys = new Set();

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

// ---------- models ----------
function modelFor(id) {
  const m = savedModels[id];
  if (m === 'sim' || health.models.some((x) => x.id === m)) return m;
  return health.defaultModel || 'sim';
}
function modelLabel(id) {
  if (id === 'sim') return 'Sim (offline)';
  const m = health.models.find((x) => x.id === id);
  return m ? `${m.label} · ${m.provider}` : id;
}
function setModel(agentId, modelId) {
  savedModels = { ...savedModels, [agentId]: modelId };
  save('tennex.models', savedModels);
  refreshRoster();
}
async function refreshHealth() {
  health = await fetchHealth();
  ui.setModeBadge(health.live ? `Live · ${health.models.length} model${health.models.length === 1 ? '' : 's'}` : 'Offline sim mode');
  refreshRoster();
  return health;
}
function refreshRoster() {
  ui.renderRoster({
    agents: AGENTS,
    options: [...health.models.map((m) => ({ id: m.id, label: `${m.label} — ${m.provider}` })), { id: 'sim', label: 'Sim (offline)' }],
    current: (id) => modelFor(id),
    label: (id) => modelLabel(modelFor(id)),
    onChange: setModel,
    onAll: (modelId) => { for (const a of AGENTS) savedModels[a.id] = modelId; save('tennex.models', savedModels); refreshRoster(); },
    status: health.live
      ? 'Pick a model for each agent. Only models configured on the server and reachable right now are listed.'
      : 'No models configured on the server, so everyone runs in offline sim mode with canned replies. Add an API key to .env to go live.',
    brief,
  });
}

// ---------- brief / feed ----------
function setBrief(b) {
  brief = b || '';
  save('tennex.brief', brief);
  renderDisplay();
  refreshRoster();
}
function renderDisplay() {
  office.display.render(brief, states.map((s) => ({ name: s.agent.name, status: s.status, color: STATUS_COLORS[s.status] })));
}
function addFeed(line) {
  feed.push(line);
  if (feed.length > FEED_MAX) feed = feed.slice(-FEED_MAX);
  ui.renderFeed(feed.slice(-5));
}

// ---------- voice ----------
const speaker = new Speaker((id) => { speakingId = id; });
const ptt = new PushToTalk({
  onCaption: (t) => ui.setCaption(t || 'listening…'),
  onFinal: (t) => {
    listening = false;
    listenTarget = null;
    ui.setCaption(null);
    if (t) handleInput(t);
  },
  onError: (msg) => { ui.toast(msg, 'error'); },
});

// ---------- chat ----------
function handleInput(text) {
  const cmd = briefCommand(text, brief);
  if (cmd) {
    if (cmd.brief !== undefined) setBrief(cmd.brief);
    ui.toast(cmd.message);
    return;
  }
  const near = nearestAgent();
  const r = route(text, near?.agent.id ?? null);
  if (r.error) {
    ui.toast(r.error, 'error');
    return;
  }
  const who = r.targets.length === AGENTS.length ? 'team' : byId[r.targets[0]].name;
  addFeed(`You → ${who}: ${clip(text, 90)}`);
  for (const id of r.targets) sendToAgent(stateById[id], r.text);
}

function clip(s, n) { return s.length > n ? `${s.slice(0, n)}…` : s; }

async function sendToAgent(s, prompt) {
  const id = s.agent.id;
  s.controller?.abort(); // a second prompt cancels the first
  speaker.cancelAgent(id);
  const ctl = new AbortController();
  s.controller = ctl;
  s.pending = true;
  s.streamingScreen = false;
  s.error = null;
  s.monitor.begin(prompt);
  speaker.begin(id);
  if (s.mode !== 'desk') returnToDesk(s, true);

  const parser = new ReplyParser();
  const sentences = new SentenceBuffer();
  let raw = '';
  let screenStarted = false;
  const apply = (o) => {
    if (o.say && !screenStarted) for (const line of sentences.push(o.say)) speaker.say(id, line);
    if (o.screen) {
      if (!screenStarted) {
        screenStarted = true;
        for (const line of sentences.flush()) speaker.say(id, line);
      }
      s.streamingScreen = true;
      s.monitor.append(o.screen);
    }
  };
  const onText = (t) => {
    if (ctl.signal.aborted) return;
    raw += t;
    apply(parser.push(t));
  };

  try {
    const model = modelFor(id);
    if (model === 'sim') {
      await streamSim(simReply(id, prompt, brief), onText, ctl.signal);
    } else {
      await streamChat({
        agentId: id, model, prompt,
        history: s.history.slice(-HISTORY_MAX),
        office: feed.slice(-FEED_MAX),
        brief: brief || undefined,
      }, { signal: ctl.signal, onText });
    }
    apply(parser.end());
    for (const line of sentences.flush()) speaker.say(id, line);
    speaker.finish(id);
    const reply = parseReply(raw);
    if (!reply.hasScreen || !reply.screen) {
      // Speech-only reply: keep a transcript on the monitor rather than leaving it blank.
      s.monitor.append(reply.say ? `“${reply.say}”` : '(no reply)');
    }
    s.monitor.finish();
    s.history.push({ role: 'user', content: prompt }, {
      role: 'assistant',
      content: reply.hasScreen ? `SAY: ${reply.say}\nSCREEN:\n${reply.screen}` : `SAY: ${reply.say}`,
    });
    if (s.history.length > HISTORY_MAX) s.history = s.history.slice(-HISTORY_MAX);
    addFeed(`${s.agent.name}: ${clip(reply.say || 'updated their screen', 110)}`);
  } catch (e) {
    if (e.name === 'AbortError') return;
    const msg = e.message || String(e);
    s.error = msg;
    s.monitor.fail(msg);
    speaker.finish(id);
    ui.toast(`${s.agent.name}: ${msg}`, 'error');
    addFeed(`${s.agent.name} crashed: ${clip(msg, 90)}`);
  } finally {
    if (s.controller === ctl) {
      s.controller = null;
      s.pending = false;
      s.streamingScreen = false;
    }
  }
}

window.addEventListener('beforeunload', () => { for (const s of states) s.controller?.abort(); });

// ---------- agent life (R9) ----------
function pathToPoi(s, poi) {
  const pts = [{ x: s.seat.x, z: FRONT_AISLE_Z }];
  if (poi.z < DESK_Z) {
    const gx = GAP_XS.reduce((a, b) => (Math.abs(b - s.seat.x) < Math.abs(a - s.seat.x) ? b : a));
    pts.push({ x: gx, z: FRONT_AISLE_Z }, { x: gx, z: BACK_AISLE_Z }, { x: poi.x, z: BACK_AISLE_Z });
  }
  pts.push({ x: poi.x, z: poi.z });
  return pts;
}

function startBreak(s, t) {
  const taken = new Set(states.filter((o) => o.poi).map((o) => o.poi));
  const options = Object.values(office.pois).filter((p) => !taken.has(p));
  if (!options.length) { s.nextBreak = t + 20; return; }
  s.poi = options[Math.floor(Math.random() * options.length)];
  s.path = pathToPoi(s, s.poi);
  s.visited = [];
  s.speed = 1.3;
  s.mode = 'walking';
  s.returning = false;
}

function returnToDesk(s, hurry = false) {
  s.speed = hurry ? 2.6 : 1.3;
  if (s.returning) return;
  const pos = s.char.root.position;
  const back = [...s.visited].reverse();
  if (back.length && Math.hypot(back[0].x - pos.x, back[0].z - pos.z) < 0.05) back.shift();
  s.path = [...back, { x: s.seat.x, z: s.seat.z }];
  s.visited = [];
  s.mode = 'walking';
  s.returning = true;
}

function updateAgent(s, t, dt, playerDist) {
  const root = s.char.root;
  if (s.mode === 'desk') {
    const busy = s.pending || speakingId === s.agent.id;
    if (!busy && t > s.nextBreak && playerDist > 3) startBreak(s, t);
    else if (t > s.nextBreak) s.nextBreak = t + 10;
  } else if (s.mode === 'walking') {
    const target = s.path[0];
    if (!target) {
      if (s.returning) {
        s.mode = 'desk';
        s.poi = null;
        s.returning = false;
        root.position.set(s.seat.x, 0, s.seat.z);
        s.nextBreak = t + 25 + Math.random() * 45;
      } else {
        s.mode = 'poi';
        s.poiUntil = t + 5 + Math.random() * 6;
      }
    } else {
      const dx = target.x - root.position.x;
      const dz = target.z - root.position.z;
      const d = Math.hypot(dx, dz);
      const step = s.speed * dt;
      if (d <= step) {
        root.position.x = target.x;
        root.position.z = target.z;
        s.path.shift();
        if (!s.returning) s.visited.push(target);
      } else {
        root.position.x += (dx / d) * step;
        root.position.z += (dz / d) * step;
        turnToward(root, Math.atan2(dx, dz), dt * 8);
      }
    }
  } else if (s.mode === 'poi') {
    turnToward(root, s.poi.face, dt * 5);
    if (t > s.poiUntil) returnToDesk(s);
  }
  if (s.mode === 'desk') turnToward(root, Math.PI, dt * 6);

  // Look at the player when they come close (head + chair).
  let lookYaw = null;
  if (playerDist < 3.2 && mode !== 'start') {
    const want = Math.atan2(player.x - root.position.x, player.z - root.position.z);
    lookYaw = wrapAngle(want - root.rotation.y);
  }
  const sitting = s.mode === 'desk';
  s.char.animate(t, dt, {
    sitting,
    walking: s.mode === 'walking',
    typing: sitting && lookYaw == null,
    lookYaw,
  });
  s.char.chair.rotation.y = Math.PI + (sitting ? s.char.bodyYaw : 0);
}

function turnToward(obj, yaw, k) {
  obj.rotation.y += wrapAngle(yaw - obj.rotation.y) * Math.min(1, k);
}
function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function computeStatus(s) {
  const id = s.agent.id;
  if (speakingId === id) return 'talking';
  if (listening && listenTarget === id) return 'listening';
  if (s.pending) return s.streamingScreen ? 'shipping' : 'thinking';
  if (s.error) return 'crashed';
  if (s.mode !== 'desk') return 'on a break';
  return 'autopilot';
}

// ---------- player ----------
function nearestAgent() {
  let best = null;
  let bestD = NEAR;
  for (const s of states) {
    const d = Math.hypot(s.char.root.position.x - player.x, s.char.root.position.z - player.z);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

function resolveCollisions(p) {
  for (let iter = 0; iter < 3; iter++) {
    for (const c of colliders) {
      const cx = Math.max(c.minX, Math.min(p.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= PLAYER_R * PLAYER_R) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * PLAYER_R;
        p.z = cz + (dz / d) * PLAYER_R;
      } else {
        // Centre inside the box: push out along the shortest axis.
        const pushes = [[c.minX - PLAYER_R - p.x, 0], [c.maxX + PLAYER_R - p.x, 0], [0, c.minZ - PLAYER_R - p.z], [0, c.maxZ + PLAYER_R - p.z]];
        pushes.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        p.x += pushes[0][0];
        p.z += pushes[0][1];
      }
    }
    const circles = [
      ...states.map((s) => ({ x: s.char.root.position.x, z: s.char.root.position.z, r: AGENT_R })),
      ...states.filter((s) => s.mode !== 'desk').map((s) => ({ x: s.seat.x, z: s.seat.z, r: 0.28 })), // empty chairs
    ];
    for (const c of circles) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = PLAYER_R + c.r;
      const d = Math.hypot(dx, dz);
      if (d >= min) continue;
      if (d < 1e-6) { p.z += min; continue; }
      p.x = c.x + (dx / d) * min;
      p.z = c.z + (dz / d) * min;
    }
  }
}

function updatePlayer(dt) {
  if (mode !== 'play' || focus) return;
  let f = 0;
  let r = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1;
  if (!f && !r) return;
  const len = Math.hypot(f, r);
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? SPRINT : WALK;
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  // yaw 0 looks down -z
  const vx = ((-sin * f) + (cos * r)) / len * speed;
  const vz = ((-cos * f) - (sin * r)) / len * speed;
  // Sub-step so a sprint can't tunnel through thin furniture.
  const steps = Math.ceil((speed * dt) / 0.1);
  for (let i = 0; i < steps; i++) {
    player.x += (vx * dt) / steps;
    player.z += (vz * dt) / steps;
    resolveCollisions(player);
  }
}

// ---------- monitor close-up (R6) ----------
function enterFocus(s) {
  const toPos = s.screenWorld.clone().add(new THREE.Vector3(0, 0, 0.62));
  const toQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0, 'YXZ'));
  focus = { s, t: 0, dir: 1, fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone(), toPos, toQuat };
}
function exitFocus() {
  if (!focus) return;
  focus.dir = -1;
}
function updateFocus(dt) {
  if (!focus) return false;
  focus.t = Math.max(0, Math.min(1, focus.t + (dt / 0.6) * focus.dir));
  const e = focus.t < 0.5 ? 2 * focus.t * focus.t : 1 - (-2 * focus.t + 2) ** 2 / 2;
  // "from" follows the live player camera so returning lands exactly where you stood.
  const from = new THREE.Vector3(player.x, EYE, player.z);
  const fromQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  camera.position.lerpVectors(from, focus.toPos, e);
  camera.quaternion.slerpQuaternions(fromQuat, focus.toQuat, e);
  if (focus.dir < 0 && focus.t === 0) focus = null;
  return true;
}

// ---------- pointer lock & modes ----------
function lock() {
  try {
    const p = canvas.requestPointerLock();
    if (p?.catch) p.catch(() => showClickResume());
  } catch { showClickResume(); }
}
function unlock() {
  if (document.pointerLockElement) {
    expectUnlock = true;
    document.exitPointerLock();
  }
}
function showClickResume() {
  mode = 'resume';
  ui.show('click-resume');
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    mode = 'play';
    ui.hideOverlays();
    ui.show('hud');
    return;
  }
  if (expectUnlock) { expectUnlock = false; return; }
  stopListening();
  if (mode !== 'play') return;
  if (focus) {
    exitFocus(); // Esc in close-up returns to the office
    showClickResume();
  } else {
    pause();
  }
});
document.addEventListener('pointerlockerror', () => { if (mode === 'play' || mode === 'start') showClickResume(); });

function pause() {
  mode = 'paused';
  ui.show('pause');
  refreshHealth();
}

// ---------- input ----------
document.addEventListener('mousemove', (e) => {
  if (mode !== 'play' || focus || document.pointerLockElement !== canvas) return;
  // Some browsers report a huge jump on the first event after locking; ignore it.
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * 0.0022));
});

document.addEventListener('wheel', (e) => {
  if (mode === 'play' && focus && focus.dir > 0) focus.s.monitor.scrollBy(Math.sign(e.deltaY) * 3);
}, { passive: true });

canvas.addEventListener('click', () => { if (mode === 'play' && !document.pointerLockElement) lock(); });

document.addEventListener('keydown', (e) => {
  if (mode === 'prompt' || mode === 'fulltext') return; // handled by the panels
  if (mode !== 'play') return;
  keys.add(e.code);
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyV':
      e.preventDefault();
      startListening();
      break;
    case 'Enter':
      e.preventDefault();
      openPrompt();
      break;
    case 'KeyF': {
      if (focus && focus.dir > 0) { exitFocus(); break; }
      const s = nearestAgent();
      if (s) enterFocus(s);
      else ui.toast('Walk up to an agent to look at their screen.');
      break;
    }
    case 'KeyC':
      if (focus && focus.dir > 0) openFullText(focus.s);
      break;
    default:
  }
});
document.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'KeyV') stopListening();
});
window.addEventListener('blur', () => { keys.clear(); stopListening(); });

function startListening() {
  if (!voiceSupported) {
    ui.toast('Voice input isn’t supported in this browser. Press Enter and type instead.', 'error');
    return;
  }
  speaker.interrupt(); // talking over an agent stops them
  listenTarget = nearestAgent()?.agent.id ?? null;
  if (ptt.start()) {
    listening = true;
    ui.setCaption('listening…');
  }
}
function stopListening() {
  if (!listening) return;
  ptt.stop(); // onFinal clears the caption and sends
}

// ---------- prompt box (R3) ----------
function openPrompt() {
  mode = 'prompt';
  keys.clear();
  unlock();
  ui.openPrompt({
    agents: AGENTS,
    nearbyId: () => nearestAgent()?.agent.id ?? null,
    route,
    onSend: (text) => {
      closePrompt(true);
      if (text.trim()) handleInput(text);
    },
    onCancel: () => closePrompt(false),
  });
}
function closePrompt(relock) {
  ui.closePrompt();
  if (relock) { mode = 'play'; lock(); } else showClickResume();
}

// ---------- full text (R6 AC3) ----------
function openFullText(s) {
  mode = 'fulltext';
  keys.clear();
  unlock();
  ui.openFullText({
    title: `${s.agent.name} · ${s.monitor.title}`,
    text: s.monitor.fullText() || '(nothing on screen yet)',
    onClose: () => { ui.closeFullText(); mode = 'play'; lock(); },
  });
}

// ---------- buttons ----------
ui.onClick('enter', () => { ui.hide('start'); mode = 'play'; lock(); });
ui.onClick('resume', () => { mode = 'play'; lock(); });
document.querySelector('#click-resume button').addEventListener('click', () => { mode = 'play'; lock(); });
document.getElementById('mute').addEventListener('change', (e) => {
  speaker.muted = e.target.checked;
  if (speaker.muted) speaker.interrupt();
});

// ---------- loop ----------
const clock = new THREE.Clock();
let lastStatusKey = '';
let hintKey = '';

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const now = performance.now();

  updatePlayer(dt);
  for (const s of states) {
    const d = Math.hypot(s.char.root.position.x - player.x, s.char.root.position.z - player.z);
    updateAgent(s, t, dt, d);
    // Fade the name tag when you're close, so it doesn't cover the monitor over their shoulder.
    const tagMat = s.char.tag.sprite.material;
    tagMat.opacity += ((d < 2.2 ? 0 : 1) - tagMat.opacity) * Math.min(1, dt * 6);
    s.monitor.update(now);
    const status = computeStatus(s);
    if (status !== s.status) { s.status = status; s.char.setStatus(status); }
  }
  // Walking agents can bump into a standing player.
  if (mode === 'play' && !focus) resolveCollisions(player);

  if (!updateFocus(dt)) {
    camera.position.set(player.x, EYE, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }

  const statusKey = states.map((s) => s.status).join('|');
  if (statusKey !== lastStatusKey) { lastStatusKey = statusKey; renderDisplay(); }

  for (const b of office.blinkers) {
    const on = Math.sin(t * b.speed + b.phase) > -0.3;
    b.mat.color.copy(b.base).multiplyScalar(on ? 1 : 0.15);
  }

  // Hint line
  let hint = '';
  if (mode === 'play') {
    if (focus) hint = `${focus.s.agent.name}’s screen — scroll to read · C full text & copy · F or Esc to return`;
    else {
      const n = nearestAgent();
      hint = n
        ? `${n.agent.name} · ${n.agent.role} (${n.status}) — hold V to talk · Enter to type · F to view screen`
        : 'Walk up to an agent · Enter to type · hold V to talk · Esc for menu';
    }
  }
  if (hint !== hintKey) { hintKey = hint; ui.setHint(hint); }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
ui.renderStartTeam(AGENTS);
renderDisplay();
ui.renderFeed([]);
refreshHealth().then((h) => {
  ui.setStartStatus(h.live
    ? `Live: ${h.models.length} model${h.models.length === 1 ? '' : 's'} available. Default: ${modelLabel(h.defaultModel)}.`
    : 'Offline sim mode: no models configured on the server, agents reply with canned examples.');
});
if (!voiceSupported) ui.setStartStatusExtra('Voice input needs Chrome or Edge. Typing works everywhere.');
camera.position.set(player.x, EYE, player.z);
requestAnimationFrame(frame);

// Handle for the browser console and smoke tests.
window.tennex = {
  handleInput, player, states: stateById, route, camera,
  focus: (id) => enterFocus(stateById[id]), unfocus: exitFocus,
  get mode() { return mode; }, set mode(m) { mode = m; },
};
