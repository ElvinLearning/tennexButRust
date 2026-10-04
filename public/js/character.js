// Low-poly agent characters with a chair and a name tag. Built in code, animated procedurally.
import * as THREE from 'three';

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts });

export const STATUS_COLORS = {
  autopilot: '#94a3b8',
  listening: '#38bdf8',
  thinking: '#facc15',
  shipping: '#a3e635',
  talking: '#34d399',
  'on a break': '#c084fc',
  crashed: '#f87171',
};

function limb(len, radius, material) {
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len - radius * 2, 4, 8), material);
  m.position.y = -len / 2;
  pivot.add(m);
  return pivot;
}

export function buildChair() {
  const g = new THREE.Group();
  const seatMat = mat(0x24262d);
  const metal = mat(0x777777, { metalness: 0.7, roughness: 0.3 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), seatMat);
  seat.position.y = 0.45;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.55, 0.07), seatMat);
  back.position.set(0, 0.8, -0.24); // behind the sitter, who faces local +z like the character
  g.add(back);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), metal);
  post.position.y = 0.24;
  g.add(post);
  for (let i = 0; i < 5; i++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), metal);
    const a = (i / 5) * Math.PI * 2;
    leg.position.set(Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15);
    leg.rotation.y = a;
    g.add(leg);
  }
  return g;
}

export class Character {
  constructor(agent) {
    this.agent = agent;
    this.root = new THREE.Group(); // positioned on the floor; local +z is "forward"
    const shirt = mat(agent.color);
    const skin = mat(agent.skin);
    const pants = mat(0x2d3142);
    const hair = mat(agent.hair);

    this.hips = new THREE.Group();
    this.root.add(this.hips);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 4, 10), shirt);
    torso.position.y = 0.3;
    torso.scale.set(1.1, 1, 0.75);
    this.hips.add(torso);
    this.torso = torso;

    this.head = new THREE.Group();
    this.head.position.y = 0.68;
    this.hips.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), skin);
    this.head.add(skull);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairCap.rotation.x = -0.35;
    hairCap.position.set(0, 0.01, -0.01);
    this.head.add(hairCap);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    this.eyes = [-0.05, 0.05].map((x) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat);
      e.position.set(x, 0.02, 0.138);
      this.head.add(e);
      return e;
    });
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), skin);
    nose.position.set(0, -0.02, 0.15);
    this.head.add(nose);

    // arms: shoulder pivots
    this.arms = [-1, 1].map((side) => {
      const a = limb(0.52, 0.05, shirt);
      a.position.set(side * 0.23, 0.5, 0);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skin);
      hand.position.y = -0.54;
      a.add(hand);
      this.hips.add(a);
      return a;
    });
    // legs: hip pivot → thigh; knee pivot → shin
    this.legs = [-1, 1].map((side) => {
      const thigh = limb(0.44, 0.07, pants);
      thigh.position.set(side * 0.1, 0, 0);
      const knee = limb(0.44, 0.06, pants);
      knee.position.y = -0.44;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.2), mat(0x1b1b1b));
      shoe.position.set(0, -0.46, 0.05);
      knee.add(shoe);
      thigh.add(knee);
      this.hips.add(thigh);
      return { thigh, knee };
    });

    this.tag = makeNameTag(agent);
    this.root.add(this.tag.sprite);

    this.chair = buildChair();

    this.blinkAt = 1 + Math.random() * 3;
    this.walkPhase = 0;
    this.sitting = true;
    this.headYaw = 0;
    this.bodyYaw = 0; // extra yaw toward the player while seated
  }

  setStatus(status) { this.tag.setStatus(status); }

  /**
   * @param {number} t     seconds since start
   * @param {number} dt
   * @param {{sitting:boolean, walking:boolean, typing:boolean, lookYaw:number|null}} s
   *   lookYaw: desired head yaw relative to the body (null = look ahead)
   */
  animate(t, dt, s) {
    this.sitting = s.sitting;
    const k = Math.min(1, dt * 8);

    // Posture
    const hipY = s.sitting ? 0.5 : 0.93;
    this.hips.position.y += (hipY - this.hips.position.y) * k;
    this.tag.sprite.position.y = (s.sitting ? 1.62 : 2.05);

    let lThigh = 0; let rThigh = 0; let lKnee = 0; let rKnee = 0;
    let lArm = 0; let rArm = 0;
    if (s.sitting) {
      lThigh = rThigh = -Math.PI / 2;
      lKnee = rKnee = Math.PI / 2;
      if (s.typing) {
        lArm = -1.15 + Math.sin(t * 17) * 0.06;
        rArm = -1.15 + Math.sin(t * 19 + 1) * 0.06;
      } else {
        lArm = rArm = -0.9;
      }
    } else if (s.walking) {
      this.walkPhase += dt * 7.5;
      const sw = Math.sin(this.walkPhase) * 0.55;
      lThigh = sw; rThigh = -sw;
      lKnee = Math.max(0, -Math.sin(this.walkPhase)) * 0.7;
      rKnee = Math.max(0, Math.sin(this.walkPhase)) * 0.7;
      lArm = -sw * 0.8; rArm = sw * 0.8;
      this.hips.position.y = hipY + Math.abs(Math.cos(this.walkPhase)) * 0.03;
    } else {
      lArm = rArm = Math.sin(t * 1.3) * 0.03;
    }
    const lerp = (o, target) => { o.rotation.x += (target - o.rotation.x) * k; };
    lerp(this.legs[0].thigh, lThigh); lerp(this.legs[1].thigh, rThigh);
    lerp(this.legs[0].knee, lKnee); lerp(this.legs[1].knee, rKnee);
    lerp(this.arms[0], lArm); lerp(this.arms[1], rArm);
    this.torso.rotation.x = s.sitting ? 0.08 : 0;

    // Head (and body while seated) turn toward the player.
    const want = s.lookYaw ?? (s.typing ? Math.sin(t * 0.4) * 0.08 : 0);
    const bodyWant = s.sitting && s.lookYaw != null ? THREE.MathUtils.clamp(s.lookYaw * 0.5, -0.7, 0.7) : 0;
    this.bodyYaw += (bodyWant - this.bodyYaw) * Math.min(1, dt * 4);
    const headWant = THREE.MathUtils.clamp(want - this.bodyYaw, -1.1, 1.1);
    this.headYaw += (headWant - this.headYaw) * Math.min(1, dt * 6);
    this.head.rotation.y = this.headYaw;
    this.hips.rotation.y = this.bodyYaw;
    this.head.rotation.x = s.typing && s.lookYaw == null ? 0.18 : 0;

    // Blink
    this.blinkAt -= dt;
    let eyeScale = 1;
    if (this.blinkAt < 0) {
      eyeScale = 0.1;
      if (this.blinkAt < -0.12) this.blinkAt = 2 + Math.random() * 4;
    }
    for (const e of this.eyes) e.scale.y = eyeScale;
  }
}

function makeNameTag(agent) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set(0.9, 0.28, 1);
  let current = null;

  function setStatus(status) {
    if (status === current) return;
    current = status;
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = 'rgba(12, 14, 20, 0.78)';
    roundRect(ctx, 8, 8, 496, 144, 28);
    ctx.fill();
    ctx.fillStyle = `#${agent.color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(8, 20, 8, 120);
    ctx.fillStyle = '#fff';
    ctx.font = '700 54px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(agent.name, 40, 70);
    ctx.fillStyle = '#aab1bd';
    ctx.font = '28px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(agent.role, 40, 108);
    ctx.fillStyle = STATUS_COLORS[status] || '#999';
    ctx.beginPath();
    ctx.arc(52, 134, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 26px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(status, 70, 143);
    tex.needsUpdate = true;
  }
  setStatus('autopilot');
  return { sprite, setStatus };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
