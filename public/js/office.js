// The office room, furniture and props, all generated in code. Also returns colliders and points of interest.
import * as THREE from 'three';
import { wrapText } from './monitor.js';

export const ROOM = { minX: -10, maxX: 10, minZ: -7, maxZ: 7, height: 3.2 };
export const DESK_Z = -3.0; // desk centre
export const SEAT_Z = -2.25; // where the agent sits
export const FRONT_AISLE_Z = -1.2;
export const BACK_AISLE_Z = -5.3;
export const DESK_XS = [-7, -3.5, 0, 3.5, 7];
export const GAP_XS = [-8.9, -5.25, -1.75, 1.75, 5.25, 8.9];

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...opts });

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

export function buildOffice(scene) {
  const colliders = []; // axis-aligned rectangles on the floor: {minX, maxX, minZ, maxZ}
  const addCollider = (x, z, w, d) => colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  const blinkers = [];

  // ---- lights ----
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x5a4a3a, 1.0));
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.4);
  sun.position.set(-6, 9, 5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.35);
  fill.position.set(6, 5, -4);
  scene.add(fill);

  // ---- room shell ----
  const W = ROOM.maxX - ROOM.minX;
  const D = ROOM.maxZ - ROOM.minZ;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0x8a6a4f, { roughness: 0.9, map: plankTexture() }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0xeeeeea, { emissive: 0x77736c }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM.height;
  scene.add(ceiling);

  const wallMat = mat(0xe9e4da);
  const accentWall = mat(0x2f3b4c);
  const walls = [
    { w: W, x: 0, z: ROOM.minZ, ry: 0, m: accentWall },
    { w: W, x: 0, z: ROOM.maxZ, ry: Math.PI, m: wallMat },
    { w: D, x: ROOM.minX, z: 0, ry: Math.PI / 2, m: wallMat },
    { w: D, x: ROOM.maxX, z: 0, ry: -Math.PI / 2, m: wallMat },
  ];
  for (const w of walls) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w.w, ROOM.height), w.m);
    p.position.set(w.x, ROOM.height / 2, w.z);
    p.rotation.y = w.ry;
    scene.add(p);
  }
  // skirting
  const skirt = mat(0x3b3b3b);
  scene.add(box(W, 0.1, 0.03, skirt, 0, 0.05, ROOM.maxZ - 0.015));
  scene.add(box(0.03, 0.1, D, skirt, ROOM.minX + 0.015, 0.05, 0));
  scene.add(box(0.03, 0.1, D, skirt, ROOM.maxX - 0.015, 0.05, 0));

  // windows on the front wall (emissive sky)
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTexture() });
  for (const x of [-6, -2, 2, 6]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.5), skyMat);
    win.position.set(x, 1.75, ROOM.maxZ - 0.02);
    win.rotation.y = Math.PI;
    scene.add(win);
    scene.add(box(2.7, 0.06, 0.08, skirt, x, 1.0, ROOM.maxZ - 0.04));
    scene.add(box(2.7, 0.06, 0.08, skirt, x, 2.5, ROOM.maxZ - 0.04));
  }

  // ceiling light panels
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xfffdf5 });
  for (const x of [-6, 0, 6]) for (const z of [-3, 3]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.6), panelMat);
    p.rotation.x = Math.PI / 2;
    p.position.set(x, ROOM.height - 0.01, z);
    scene.add(p);
  }

  // rug in the lounge
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), mat(0x6b4e71, { roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(5.5, 0.005, 4.2);
  scene.add(rug);

  // ---- desks ----
  const deskTop = mat(0xc9a57a, { roughness: 0.6 });
  const metal = mat(0x2a2a2e, { metalness: 0.6, roughness: 0.4 });
  const desks = [];
  for (const x of DESK_XS) {
    const g = new THREE.Group();
    g.add(box(1.8, 0.05, 0.85, deskTop, 0, 0.74, 0));
    for (const sx of [-0.85, 0.85]) g.add(box(0.05, 0.72, 0.75, metal, sx, 0.36, 0));
    g.add(box(1.6, 0.3, 0.02, metal, 0, 0.55, -0.38)); // modesty panel
    // keyboard + mouse
    g.add(box(0.46, 0.02, 0.15, mat(0x222222), 0, 0.775, 0.2));
    g.add(box(0.06, 0.025, 0.1, mat(0x222222), 0.36, 0.775, 0.22));
    // mug
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 12), mat(0xffffff));
    mug.position.set(-0.62, 0.815, 0.1);
    g.add(mug);
    // monitor stand
    g.add(box(0.22, 0.02, 0.16, metal, 0, 0.775, -0.3));
    g.add(box(0.05, 0.3, 0.04, metal, 0, 0.92, -0.32));
    g.position.set(x, 0, DESK_Z);
    scene.add(g);
    addCollider(x, DESK_Z, 1.8, 0.85);
    desks.push({ x, group: g });
  }

  // ---- props & points of interest ----
  const pois = {};

  // coffee machine on a counter (left wall)
  {
    const counter = box(0.7, 0.95, 1.8, mat(0x4a4f57), ROOM.minX + 0.35, 0.475, 2);
    scene.add(counter);
    scene.add(box(0.72, 0.04, 1.82, mat(0xdedad0), ROOM.minX + 0.35, 0.97, 2));
    const machine = new THREE.Group();
    machine.add(box(0.4, 0.5, 0.35, mat(0x1c1c1c, { metalness: 0.5 }), 0, 0.25, 0));
    machine.add(box(0.3, 0.08, 0.02, new THREE.MeshBasicMaterial({ color: 0x40e0a0 }), 0.02, 0.38, 0.18));
    machine.add(box(0.1, 0.04, 0.12, mat(0x888888, { metalness: 0.8 }), 0, 0.15, 0.2));
    machine.rotation.y = Math.PI / 2;
    machine.position.set(ROOM.minX + 0.35, 0.99, 1.8);
    scene.add(machine);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 12), mat(0xf5f5f5));
    cup.position.set(ROOM.minX + 0.4, 1.04, 2.4);
    scene.add(cup);
    addCollider(ROOM.minX + 0.35, 2, 0.7, 1.8);
    pois.coffee = { name: 'the coffee machine', x: ROOM.minX + 1.15, z: 1.8, face: -Math.PI / 2 };
  }

  // whiteboard on the back wall
  {
    const wb = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: whiteboardTexture() }));
    wb.position.set(-4, 1.6, ROOM.minZ + 0.02);
    scene.add(wb);
    scene.add(box(2.5, 1.3, 0.03, mat(0xb0b0b0, { metalness: 0.6 }), -4, 1.6, ROOM.minZ + 0.005));
    scene.add(box(2.4, 0.04, 0.08, mat(0xb0b0b0), -4, 0.98, ROOM.minZ + 0.05));
    pois.whiteboard = { name: 'the whiteboard', x: -4, z: ROOM.minZ + 1.0, face: Math.PI };
  }

  // wall display with the project brief
  const display = makeWallDisplay();
  display.mesh.position.set(3.6, 1.75, ROOM.minZ + 0.045);
  scene.add(display.mesh);
  scene.add(box(3.3, 1.9, 0.05, mat(0x111111), 3.6, 1.75, ROOM.minZ + 0.01));
  pois.display = { name: 'the wall display', x: 3.6, z: ROOM.minZ + 1.3, face: Math.PI };

  // server rack (right wall)
  {
    const rack = new THREE.Group();
    rack.add(box(0.7, 2.0, 0.9, mat(0x1a1c22, { metalness: 0.4 }), 0, 1.0, 0));
    for (let i = 0; i < 8; i++) {
      rack.add(box(0.02, 0.16, 0.8, mat(0x2d313a), -0.36, 0.3 + i * 0.22, 0));
      for (let j = 0; j < 3; j++) {
        const led = new THREE.MeshBasicMaterial({ color: [0x39ff88, 0x39c0ff, 0xffb13b][j] });
        const m = box(0.01, 0.03, 0.03, led, -0.375, 0.3 + i * 0.22, -0.3 + j * 0.08);
        rack.add(m);
        blinkers.push({ mat: led, base: led.color.clone(), phase: Math.random() * 10, speed: 1 + Math.random() * 5 });
      }
    }
    rack.position.set(ROOM.maxX - 0.45, 0, 3);
    scene.add(rack);
    addCollider(ROOM.maxX - 0.45, 3, 0.7, 0.9);
    pois.rack = { name: 'the server rack', x: ROOM.maxX - 1.35, z: 3, face: Math.PI / 2 };
  }

  // lounge: sofa + coffee table
  {
    const sofaMat = mat(0x3d5a80, { roughness: 1 });
    const sofa = new THREE.Group();
    sofa.add(box(2.2, 0.42, 0.9, sofaMat, 0, 0.21, 0));
    sofa.add(box(2.2, 0.5, 0.2, sofaMat, 0, 0.6, 0.35));
    for (const sx of [-1.0, 1.0]) sofa.add(box(0.2, 0.3, 0.9, sofaMat, sx, 0.55, 0));
    sofa.position.set(5.5, 0, 5.9);
    scene.add(sofa);
    addCollider(5.5, 5.9, 2.2, 0.9);
    const table = new THREE.Group();
    table.add(box(1.2, 0.05, 0.6, deskTop, 0, 0.42, 0));
    for (const [sx, sz] of [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]]) table.add(box(0.04, 0.4, 0.04, metal, sx, 0.2, sz));
    table.position.set(5.5, 0, 4.2);
    scene.add(table);
    addCollider(5.5, 4.2, 1.2, 0.6);
  }

  // bookshelf (left wall, front)
  {
    const shelf = new THREE.Group();
    const wood = mat(0x6d4c33);
    shelf.add(box(0.35, 2.0, 1.6, wood, 0, 1.0, 0));
    const colors = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1];
    for (let row = 0; row < 4; row++) {
      let z = -0.7;
      while (z < 0.7) {
        const w = 0.05 + Math.random() * 0.05;
        const h = 0.25 + Math.random() * 0.12;
        shelf.add(box(0.25, h, w, mat(colors[Math.floor(Math.random() * colors.length)]), 0.06, 0.2 + row * 0.45 + h / 2, z + w / 2));
        z += w + 0.01;
      }
    }
    shelf.position.set(ROOM.minX + 0.2, 0, 5.2);
    scene.add(shelf);
    addCollider(ROOM.minX + 0.2, 5.2, 0.4, 1.6);
  }

  // plants in the corners
  for (const [x, z] of [[ROOM.minX + 0.5, ROOM.minZ + 0.5], [ROOM.maxX - 0.5, ROOM.minZ + 0.5], [ROOM.maxX - 0.5, ROOM.maxZ - 0.5], [-1.2, 5.8]]) {
    scene.add(plant(x, z));
    addCollider(x, z, 0.5, 0.5);
  }

  // outer walls as colliders
  const T = 1;
  colliders.push({ minX: ROOM.minX - T, maxX: ROOM.maxX + T, minZ: ROOM.minZ - T, maxZ: ROOM.minZ });
  colliders.push({ minX: ROOM.minX - T, maxX: ROOM.maxX + T, minZ: ROOM.maxZ, maxZ: ROOM.maxZ + T });
  colliders.push({ minX: ROOM.minX - T, maxX: ROOM.minX, minZ: ROOM.minZ - T, maxZ: ROOM.maxZ + T });
  colliders.push({ minX: ROOM.maxX, maxX: ROOM.maxX + T, minZ: ROOM.minZ - T, maxZ: ROOM.maxZ + T });

  return { colliders, desks, pois, display, blinkers };
}

function plant(x, z) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.4, 16), mat(0xd9d2c5));
  pot.position.y = 0.2;
  g.add(pot);
  const leaf = mat(0x2f7d4a, { roughness: 1 });
  for (let i = 0; i < 7; i++) {
    const l = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.8, 6), leaf);
    const a = (i / 7) * Math.PI * 2;
    l.position.set(Math.cos(a) * 0.08, 0.75, Math.sin(a) * 0.08);
    l.rotation.set(Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4);
    g.add(l);
  }
  g.position.set(x, 0, z);
  return g;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function plankTexture() {
  const t = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8a6a4f';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 64) {
      for (let x = (y / 64) % 2 ? -128 : 0; x < w; x += 256) {
        ctx.fillStyle = `hsl(28, 30%, ${38 + Math.random() * 10}%)`;
        ctx.fillRect(x + 1, y + 1, 254, 62);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 4);
  return t;
}

function skyTexture() {
  return canvasTexture(256, 160, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#7fb7ff');
    g.addColorStop(1, '#dff0ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5f7087';
    for (let x = 0; x < w; x += 18) {
      const bh = 30 + Math.random() * 70;
      ctx.fillRect(x, h - bh, 14, bh);
    }
  });
}

function whiteboardTexture() {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#fbfbf8';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#1f6feb';
    ctx.font = 'bold 44px "Comic Sans MS", "Marker Felt", cursive';
    ctx.fillStyle = '#1f6feb';
    ctx.fillText('SHIP IT → review → test', 40, 70);
    ctx.strokeStyle = '#d73a49';
    ctx.fillStyle = '#d73a49';
    const boxes = [['idea', 80], ['plan', 310], ['build', 540], ['ship', 770]];
    for (const [label, x] of boxes) {
      ctx.strokeRect(x, 180, 170, 90);
      ctx.fillText(label, x + 30, 240);
      if (x < 770) { ctx.beginPath(); ctx.moveTo(x + 175, 225); ctx.lineTo(x + 225, 225); ctx.stroke(); }
    }
    ctx.fillStyle = '#2da44e';
    ctx.font = '34px "Comic Sans MS", cursive';
    ctx.fillText('• never claim you ran it', 60, 360);
    ctx.fillText('• hand off by name', 60, 410);
    ctx.fillText('• state assumptions, keep going', 60, 460);
  });
}

function makeWallDisplay() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), new THREE.MeshBasicMaterial({ map: tex }));
  const ctx = canvas.getContext('2d');

  function render(brief, statuses = []) {
    const g = ctx.createLinearGradient(0, 0, 1280, 720);
    g.addColorStop(0, '#0f1b2d');
    g.addColorStop(1, '#1d1033');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '#7dd3fc';
    ctx.font = '700 40px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('PROJECT BRIEF', 60, 50);
    ctx.fillStyle = brief ? '#f1f5f9' : '#94a3b8';
    ctx.font = `${brief ? 34 : 32}px ui-sans-serif, system-ui, sans-serif`;
    const lines = wrapText(ctx, brief || 'No brief yet. Press Enter and type /brief <text>, or try /brief cozy.', 760).slice(0, 12);
    lines.forEach((l, i) => ctx.fillText(l, 60, 120 + i * 44));

    ctx.fillStyle = '#7dd3fc';
    ctx.font = '700 30px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('TEAM', 900, 50);
    statuses.forEach((s, i) => {
      const y = 110 + i * 96;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(915, y + 20, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '600 30px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(s.name, 940, y);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '24px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(s.status, 940, y + 38);
    });
    tex.needsUpdate = true;
  }
  render('');
  return { mesh, render };
}
