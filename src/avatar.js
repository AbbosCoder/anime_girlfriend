// 3D anime qiz: VRM model, mimika, ko'z, soch (spring bone), tana harakatlari
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRMSpringBoneCollider, VRMSpringBoneColliderShapeSphere } from '@pixiv/three-vrm';

const EMOTIONS = {
  neutral: {},
  happy: { happy: 0.75 },
  excited: { happy: 1.0, surprised: 0.25 },
  sad: { sad: 0.8 },
  angry: { angry: 0.75 },
  surprised: { surprised: 0.85 },
  shy: { happy: 0.35, relaxed: 0.35 },
  thinking: { relaxed: 0.15, sad: 0.1 },
  relaxed: { relaxed: 0.7 },
};
const EXPR_KEYS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];
const MOUTH_KEYS = ['aa', 'ih', 'ou', 'ee', 'oh'];
const BONES = ['hips', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'];

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
// silliq "tirik" shovqin
const noise = (t, s = 0) => Math.sin(t * 1.3 + s) * 0.5 + Math.sin(t * 2.1 + s * 1.7) * 0.3 + Math.sin(t * 0.7 + s * 3.1) * 0.2;

// Tana harakatlari: abs = aniq poza, add = qo'shimcha tebranish. t — soniyada
// O'ng qo'l pozasidan chap qo'l pozasini (ko'zgu) yasash
const ARMS = (ua, ly) => ({
  rightUpperArm: ua, rightLowerArm: [0, ly, 0],
  leftUpperArm: [ua[0], -ua[1], -ua[2]], leftLowerArm: [0, -ly, 0],
});
const mixArr = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const POSE = {
  clapIn: { ua: [-0.2, 0.8, 1.2], ly: 1.4 },
  clapOut: { ua: [-0.2, 0.25, 1.4], ly: 1.6 },
  face: { ua: [-1.35, 0.35, 1.5], ly: 2.2 },
  belly: { ua: [0.6, 0.8, 0.6], ly: 1.6 },
  fist: { ua: [0, 0.4, 1.2], ly: 1.6 },
};

const GESTURES = {
  // kulish: bosh orqaga, yelkalar silkinadi, og'iz ochiq
  laugh: {
    dur: 2.2, fn: (t) => {
      const sh = Math.sin(t * 15);
      return {
        add: { head: [-0.14 + sh * 0.035, 0, 0.06], spine: [-0.04, 0, 0], leftShoulder: [0, 0, sh * 0.05], rightShoulder: [0, 0, -sh * 0.05] },
        mouth: { aa: 0.55 + Math.abs(sh) * 0.35, ee: 0.2 },
      };
    },
  },
  // qahqaha: qornini ushlab, oldinga egilib kuladi
  bellylaugh: {
    dur: 3.2, fn: (t) => {
      const sh = Math.sin(t * 13);
      return {
        abs: ARMS(POSE.belly.ua, POSE.belly.ly),
        add: { spine: [0.22 + sh * 0.03, 0, 0], chest: [0.08, 0, 0], head: [0.05 + sh * 0.06, 0, 0.05] },
        mouth: { aa: 0.65 + Math.abs(sh) * 0.3, ee: 0.15 },
      };
    },
  },
  // qarsak chalish
  clap: {
    dur: 2.4, fn: (t) => {
      const k = Math.pow((Math.sin(t * 13) + 1) / 2, 2);
      return {
        abs: ARMS(mixArr(POSE.clapOut.ua, POSE.clapIn.ua, k), POSE.clapOut.ly + (POSE.clapIn.ly - POSE.clapOut.ly) * k),
        add: { head: [-0.05, 0, Math.sin(t * 3) * 0.05] },
        mouth: { aa: 0.25, ee: 0.2 },
      };
    },
  },
  // uyalib yuzini qo'llari bilan yopadi
  cover: {
    dur: 3.0, fn: (t) => ({
      abs: ARMS(POSE.face.ua, POSE.face.ly),
      add: { head: [0.16, Math.sin(t * 2.5) * 0.12, 0], spine: [0.06, 0, 0] },
    }),
  },
  // hayajon: mushtlarini siqib sakraydi
  excited: {
    dur: 2.0, fn: (t) => {
      const b = Math.sin(t * 9);
      return {
        pos: Math.abs(b) * 0.045 * (1 - t / 2),
        abs: ARMS([POSE.fist.ua[0] - 0.2 * Math.abs(b), POSE.fist.ua[1], POSE.fist.ua[2]], POSE.fist.ly + Math.abs(b) * 0.3),
        add: { head: [-0.06 + b * 0.03, 0, 0] },
        mouth: { aa: 0.4, ee: 0.3 },
      };
    },
  },

  nod: { dur: 1.3, fn: (t) => ({ add: { head: [Math.sin(t * 11) * 0.18 * (1 - t / 1.3), 0, 0], neck: [Math.sin(t * 11) * 0.06, 0, 0] } }) },
  shake: { dur: 1.4, fn: (t) => ({ add: { head: [0, Math.sin(t * 10) * 0.28 * (1 - t / 1.4), 0] } }) },
  tilt: { dur: 2.2, fn: () => ({ add: { head: [0, 0.1, 0.28], neck: [0, 0, 0.08] } }) },
  wave: {
    dur: 2.4, fn: (t) => ({
      abs: { rightUpperArm: [0, 0.35, 0.05], rightLowerArm: [0, 0.2, -1.55 + Math.sin(t * 9) * 0.35], rightHand: [0, 0, Math.sin(t * 9) * 0.2] },
      add: { head: [0, -0.08, 0.12] },
    }),
  },
  shy: {
    dur: 3.0, fn: (t) => ({
      abs: { leftUpperArm: [0.15, -0.45, -1.15], rightUpperArm: [0.15, 0.45, 1.15], leftLowerArm: [0, -1.5, 0], rightLowerArm: [0, 1.5, 0] },
      add: { head: [0.22, 0.25 + Math.sin(t * 2) * 0.05, 0.1], spine: [0.06, 0, 0] },
    }),
  },
  think: {
    dur: 3.0, fn: (t) => ({
      abs: { rightUpperArm: [-0.8, 0.6, 1.3], rightLowerArm: [0, 2.6, 0], rightHand: [0, 0, 0.3], leftUpperArm: [0.1, -0.5, -1.15], leftLowerArm: [0, -1.2, 0] },
      add: { head: [-0.12, -0.15 + Math.sin(t) * 0.05, 0.15] },
    }),
  },
  bounce: {
    dur: 1.6, fn: (t) => ({
      pos: Math.abs(Math.sin(t * 7)) * 0.05 * (1 - t / 1.6),
      abs: { leftUpperArm: [0, 0, -0.9], rightUpperArm: [0, 0, 0.9], leftLowerArm: [0, -0.6, 0], rightLowerArm: [0, 0.6, 0] },
      add: { head: [Math.sin(t * 7) * 0.05, 0, 0] },
    }),
  },
  bow: { dur: 2.0, fn: () => ({ add: { spine: [0.35, 0, 0], chest: [0.15, 0, 0], head: [0.15, 0, 0] } }) },
  pout: {
    dur: 2.8, fn: () => ({
      abs: { leftUpperArm: [0.2, -0.7, -1.2], rightUpperArm: [0.2, 0.7, 1.2], leftLowerArm: [0, -2.0, 0], rightLowerArm: [0, 2.0, 0] },
      add: { head: [-0.05, -0.45, -0.12], spine: [0, -0.1, 0] },
    }),
  },
};

export class Avatar {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = makeGradient();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    this.camera.position.set(0, 1.35, 1.9);
    this.camTarget = new THREE.Vector3(0, 1.3, 0);

    this.scene.add(new THREE.HemisphereLight(0xffeef8, 0x445577, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 2, 2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xa0c8ff, 1.2);
    rim.position.set(-1.5, 1.5, -1.5);
    this.scene.add(rim);

    this.petals = makePetals();
    this.scene.add(this.petals);

    this.lookTarget = new THREE.Object3D();
    this.scene.add(this.lookTarget);
    this.mouse = new THREE.Vector2();
    this.mouseSmooth = new THREE.Vector2();
    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    });

    this.clock = new THREE.Clock();
    this.vrm = null;
    this.emotion = 'neutral';
    this.emotionTime = 0;
    this.exprCur = Object.fromEntries(EXPR_KEYS.map((k) => [k, 0]));
    this.mouthTarget = Object.fromEntries(MOUTH_KEYS.map((k) => [k, 0]));
    this.mouthCur = { ...this.mouthTarget };
    this.speaking = false;
    this.gesture = null;
    this.blink = { next: 2, t: -1, double: false };
    this.saccade = { next: 0, off: new THREE.Vector3() };
    this.listening = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // tor ekranda (telefon) biroz uzoqroq
    this.camDist = w / h < 0.8 ? 2.6 : 1.9;
    this.camera.updateProjectionMatrix();
  }

  async load(url, onProgress, look) {
    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('Bu VRM fayl emas');
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons?.(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => { o.frustumCulled = false; });
    if (look) applyLook(vrm, look);
    // VRM 0.x da normallashtirilgan suyaklarning X va Z burilishi teskari
    this.flip = vrm.meta?.metaVersion === '0' ? -1 : 1;

    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
    }
    this.vrm = vrm;
    this.scene.add(vrm.scene);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;

    this.bones = {};
    for (const b of BONES) this.bones[b] = vrm.humanoid.getNormalizedBoneNode(b);
    this.hipsY = this.bones.hips?.position.y ?? 0;

    // kamerani bosh balandligiga moslash
    vrm.scene.updateMatrixWorld(true);
    const head = vrm.humanoid.getNormalizedBoneNode('head');
    const hp = new THREE.Vector3();
    head.getWorldPosition(hp);
    this.headY = hp.y;
    this.camTarget.set(0, hp.y - 0.12, 0);
    // fizikani tinchlantirish (soch "sakrab" ketmasligi uchun)
    addBodyColliders(vrm);
    vrm.springBoneManager?.reset();
  }

  hasExpr(name) {
    return !!this.vrm?.expressionManager?.getExpression(name);
  }

  setEmotion(name) {
    this.emotion = EMOTIONS[name] ? name : 'neutral';
    this.emotionTime = 0;
  }

  playGesture(name) {
    if (!GESTURES[name]) return;
    this.gesture = { name, t: 0, ...GESTURES[name] };
  }

  setMouth(weights) { Object.assign(this.mouthTarget, weights); }
  setSpeaking(v) { this.speaking = v; if (!v) this.setMouth({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }); }

  // ekranning qaysi joyiga bosildi — boshgami?
  isHeadAt(clientX, clientY) {
    if (!this.vrm) return false;
    const p = new THREE.Vector3();
    this.bones.head.getWorldPosition(p);
    p.y += 0.08;
    p.project(this.camera);
    const sx = (p.x + 1) / 2 * innerWidth, sy = (1 - p.y) / 2 * innerHeight;
    const r = innerHeight * 0.11 * (1.9 / this.camDist);
    return Math.hypot(clientX - sx, clientY - sy) < r;
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    // kamera
    const camPos = new THREE.Vector3(this.camTarget.x, this.camTarget.y + 0.05, this.camDist);
    this.camera.position.lerp(camPos, 1 - Math.exp(-dt * 3));
    this.camera.lookAt(this.camTarget);

    // gulbarglar
    const pos = this.petals.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - dt * (0.08 + (i % 5) * 0.02);
      if (y < -0.5) y = 3;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t + i) * dt * 0.05);
    }
    pos.needsUpdate = true;

    if (this.vrm) {
      this.animate(t, dt);
      this.vrm.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  animate(t, dt) {
    const em = this.emotion;
    this.emotionTime += dt;
    // uzoq gapirmasa, asta neytralga qaytadi
    if (!this.speaking && em !== 'neutral' && this.emotionTime > 9) this.setEmotion('neutral');

    // ---- mimika ----
    const target = EMOTIONS[this.emotion];
    const em_ = this.vrm.expressionManager;
    const k = 1 - Math.exp(-dt * 6);
    for (const key of EXPR_KEYS) {
      let v = target[key] || 0;
      if (this.speaking && key === 'happy') v *= 0.7; // gapirganda og'iz ochila olsin
      this.exprCur[key] = lerp(this.exprCur[key], v, k);
      em_?.setValue(key, this.exprCur[key]);
    }
    const km = 1 - Math.exp(-dt * 18);
    for (const key of MOUTH_KEYS) {
      this.mouthCur[key] = lerp(this.mouthCur[key], this.mouthTarget[key], km);
      em_?.setValue(key, this.mouthCur[key]);
    }

    // ---- ko'z qisish (blink) ----
    const b = this.blink;
    b.next -= dt;
    if (b.next <= 0 && b.t < 0) { b.t = 0; b.double = Math.random() < 0.2; }
    let blinkV = 0;
    if (b.t >= 0) {
      b.t += dt;
      const D = 0.16;
      blinkV = b.t < D ? Math.sin((b.t / D) * Math.PI) : 0;
      if (b.t >= D) {
        if (b.double) { b.double = false; b.t = -0.0001; b.next = 0.08; }
        else { b.t = -1; b.next = 1.5 + Math.random() * 4.5; }
      }
    }
    if (em === 'sad') blinkV = Math.max(blinkV, 0.15);
    em_?.setValue('blink', blinkV);

    // ---- nigoh: sizga qaraydi, ko'zlari biroz yuguradi, sichqonchani kuzatadi ----
    this.mouseSmooth.lerp(this.mouse, 1 - Math.exp(-dt * 4));
    const s = this.saccade;
    s.next -= dt;
    if (s.next <= 0) {
      const away = em === 'shy' || em === 'thinking' ? 0.25 : 0.05;
      s.off.set((Math.random() - 0.5) * away * 2, (Math.random() - 0.3) * away, 0);
      s.next = 0.4 + Math.random() * 2.5;
    }
    this.lookTarget.position.set(
      this.camera.position.x + this.mouseSmooth.x * 0.6 + s.off.x,
      this.camera.position.y + this.mouseSmooth.y * 0.35 + s.off.y,
      this.camera.position.z,
    );

    // ---- tana ----
    const B = this.bones;
    const sadness = this.exprCur.sad, joy = this.exprCur.happy;
    const breath = Math.sin(t * (sadness > 0.4 ? 1.2 : 1.7));
    const pose = {
      hips: [0, noise(t * 0.3, 1) * 0.04, noise(t * 0.25, 2) * 0.02],
      spine: [0.02 + sadness * 0.08 + breath * 0.012, noise(t * 0.3, 3) * 0.03, noise(t * 0.35, 4) * 0.025],
      chest: [breath * 0.02, 0, 0],
      neck: [0, 0, 0],
      head: [
        noise(t * 0.5, 5) * 0.04 + sadness * 0.15,
        noise(t * 0.4, 6) * 0.06 + this.mouseSmooth.x * 0.25,
        noise(t * 0.45, 7) * 0.05 + (em === 'thinking' ? 0.18 : 0),
      ],
      leftShoulder: [0, 0, -breath * 0.015], rightShoulder: [0, 0, breath * 0.015],
      leftUpperArm: [0, -0.1, -1.22 + breath * 0.02 + joy * 0.08], rightUpperArm: [0, 0.1, 1.22 - breath * 0.02 - joy * 0.08],
      leftLowerArm: [0, -0.25, 0], rightLowerArm: [0, 0.25, 0],
      leftHand: [0, 0, -0.1], rightHand: [0, 0, 0.1],
    };
    pose.head[0] -= this.mouseSmooth.y * 0.12;
    if (this.listening) { pose.head[2] += 0.12; pose.head[0] -= 0.04; }

    // gapirayotganda bosh va tana ritmik harakatlanadi
    const lvl = this.mouthCur.aa + this.mouthCur.oh * 0.5 + this.mouthCur.ee * 0.5;
    if (this.speaking) {
      pose.head[0] += Math.sin(t * 7.3) * 0.025 * lvl + noise(t * 1.5, 9) * 0.03;
      pose.head[1] += noise(t * 1.1, 10) * 0.05;
      pose.spine[1] += noise(t * 0.9, 11) * 0.03;
    }
    // quvonch — yengil chayqalish
    let hipLift = 0;
    if (joy > 0.5) { pose.hips[2] += Math.sin(t * 2.4) * 0.03 * joy; hipLift = Math.abs(Math.sin(t * 2.4)) * 0.006 * joy; }

    // gesture
    const g = this.gesture;
    if (g) {
      g.t += dt;
      const w = smooth(clamp01(g.t / 0.35)) * smooth(clamp01((g.dur - g.t) / 0.45));
      const r = g.fn(g.t);
      for (const [bn, v] of Object.entries(r.abs || {})) {
        if (!pose[bn]) continue;
        for (let i = 0; i < 3; i++) pose[bn][i] = lerp(pose[bn][i], v[i], w);
      }
      for (const [bn, v] of Object.entries(r.add || {})) {
        if (!pose[bn]) continue;
        for (let i = 0; i < 3; i++) pose[bn][i] += v[i] * w;
      }
      hipLift += (r.pos || 0) * w;
      // gapirmayotgan bo'lsa — harakatga mos og'iz (kulgi va h.k.)
      if (r.mouth && !this.speaking) {
        for (const [k, v] of Object.entries(r.mouth)) {
          const target = v * w;
          this.mouthCur[k] = Math.max(this.mouthCur[k], target);
          this.vrm.expressionManager?.setValue(k, this.mouthCur[k]);
        }
      }
      if (g.t >= g.dur) this.gesture = null;
    }

    const f = this.flip || 1;
    for (const [bn, v] of Object.entries(pose)) B[bn]?.rotation.set(v[0] * f, v[1], v[2] * f);
    if (B.hips) B.hips.position.y = this.hipsY + hipLift;
  }
}

function makeGradient() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#2b2350');
  gr.addColorStop(0.55, '#7a5a9e');
  gr.addColorStop(1, '#f2b5c8');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePetals() {
  const n = 120;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = (Math.random() - 0.5) * 4;
    arr[i * 3 + 1] = Math.random() * 3.5 - 0.5;
    arr[i * 3 + 2] = -0.5 - Math.random() * 2.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,220,235,1)');
  gr.addColorStop(1, 'rgba(255,180,210,0)');
  g.fillStyle = gr;
  g.beginPath(); g.ellipse(16, 16, 15, 9, 0.6, 0, Math.PI * 2); g.fill();
  const mat = new THREE.PointsMaterial({ size: 0.05, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  return new THREE.Points(geo, mat);
}

// Soch ko'ylak/tana ichidan o'tib ketmasligi uchun ko'krak, qorin va yelkalarga qo'shimcha "to'siqlar"
function addBodyColliders(vrm) {
  const mgr = vrm.springBoneManager;
  if (!mgr) return;
  const h = vrm.humanoid;
  const raw = (n) => h.getRawBoneNode(n);
  const wp = (n) => { const v = new THREE.Vector3(); h.getNormalizedBoneNode(n)?.getWorldPosition(v); return v; };
  const L = wp('leftUpperArm'), R = wp('rightUpperArm'), hips = wp('hips');
  const shoulderW = Math.abs(L.x - R.x); // ~0.25–0.35 m
  const top = (L.y + R.y) / 2;
  const colliders = [];
  const add = (boneName, x, y, z, r) => {
    const bone = raw(boneName) || raw('chest') || raw('spine');
    if (!bone) return;
    const c = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({ radius: r }));
    bone.add(c);
    bone.updateWorldMatrix(true, false);
    c.position.copy(bone.worldToLocal(new THREE.Vector3(x, y, z)));
    colliders.push(c);
  };
  const s = shoulderW;
  const chestBone = raw('upperChest') ? 'upperChest' : 'chest';
  // ko'krak (oldinga chiqib turgan qism)
  for (const fx of [-0.3, 0, 0.3]) add(chestBone, fx * s, top - 0.13, 0.05, s * 0.32);
  for (const fx of [-0.25, 0.25]) add(chestBone, fx * s, top - 0.06, 0.03, s * 0.3);
  // qorin
  for (const fx of [-0.2, 0.2]) add('spine', fx * s, (top + hips.y) / 2 - 0.04, 0.02, s * 0.33);
  // yelkalar
  add(chestBone, L.x, top, 0, s * 0.22);
  add(chestBone, R.x, top, 0, s * 0.22);
  const group = { colliders, name: 'aiko-body' };
  for (const j of mgr.joints) j.colliderGroups = [...j.colliderGroups, group];
}

// Personaj kartasi uchun portret: VRM modeldan rasm chizadi (dataURL)
export async function renderPortrait(url, { look = null, expression = 'happy', weight = 0.8, tilt = 0, turn = 0.15, bg = ['#3b2d6b', '#f2b5c8'], w = 480, h = 600 } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  renderer.setSize(w, h, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffeef8, 0x445577, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1, 2, 2); scene.add(key);
  const rim = new THREE.DirectionalLight(0xa0c8ff, 1.4); rim.position.set(-1.5, 1.5, -1.5); scene.add(rim);
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  VRMUtils.rotateVRM0(vrm);
  if (look) applyLook(vrm, look);
  scene.add(vrm.scene);
  const f = vrm.meta?.metaVersion === '0' ? -1 : 1;
  const hb0 = (n) => vrm.humanoid.getNormalizedBoneNode(n);
  const hb = (n) => { const b = hb0(n); if (!b) return null; return { rotation: { set: (x, y, z) => b.rotation.set(x * f, y, z * f) }, getWorldPosition: (v) => b.getWorldPosition(v) }; };
  hb('leftUpperArm')?.rotation.set(0, -0.1, -1.22);
  hb('rightUpperArm')?.rotation.set(0, 0.1, 1.22);
  hb('leftLowerArm')?.rotation.set(0, -0.25, 0);
  hb('rightLowerArm')?.rotation.set(0, 0.25, 0);
  hb('head')?.rotation.set(0.04, turn, tilt);
  hb('neck')?.rotation.set(0, turn * 0.5, tilt * 0.3);
  vrm.expressionManager?.setValue(expression, weight);
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  const head = new THREE.Vector3();
  hb('head').getWorldPosition(head);
  const cam = new THREE.PerspectiveCamera(24, w / h, 0.1, 20);
  cam.position.set(0.12, head.y - 0.05, 1.25);
  cam.lookAt(0, head.y - 0.12, 0);
  renderer.render(scene, cam);
  // fon gradient + model
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.drawImage(renderer.domElement, 0, 0);
  const out = c.toDataURL('image/jpeg', 0.88);
  VRMUtils.deepDispose(vrm.scene);
  renderer.dispose();
  renderer.forceContextLoss?.();
  return out;
}

// ---------- Ranglarni o'zgartirish (bitta modeldan har xil qizlar) ----------
// look = { hair: {h, s, lm, la}, eyes: {...}, cloth: {...} }  h,s: 0..1; yorug'lik = l*lm + la
const LOOK_PARTS = {
  hair: /hair/i,
  eyes: /iris/i,
  cloth: /cloth|tops|bottoms|wear(?!_?metal)/i,
};
export function applyLook(vrm, look) {
  const done = new Map();
  vrm.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const [part, re] of Object.entries(LOOK_PARTS)) {
        if (!look[part] || !re.test(m.name || '')) continue;
        for (const key of ['map', 'shadeMultiplyTexture']) {
          const tex = m[key];
          if (!tex?.image) continue;
          const id = tex.uuid + part;
          if (!done.has(id)) done.set(id, recolorTexture(tex, look[part]));
          m[key] = done.get(id);
        }
      }
    }
  });
}

function recolorTexture(tex, { h, s = 0.6, lm = 1, la = 0 }) {
  const img = tex.image;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    const r = p[i] / 255, gg = p[i + 1] / 255, b = p[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    let l = (mx + mn) / 2;
    l = Math.min(1, Math.max(0, l * lm + la));
    // HSL -> RGB (yangi rang, eski yorug'lik naqshi saqlanadi)
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, pp = 2 * l - q;
    const hue = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp; };
    p[i] = hue(h + 1 / 3) * 255; p[i + 1] = hue(h) * 255; p[i + 2] = hue(h - 1 / 3) * 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = tex.colorSpace; t.flipY = tex.flipY;
  t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; t.channel = tex.channel;
  t.offset.copy(tex.offset); t.repeat.copy(tex.repeat);
  t.needsUpdate = true;
  return t;
}
