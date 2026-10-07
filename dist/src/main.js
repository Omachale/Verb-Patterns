import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { generateQuestion, checkAnswer } from "./verbs.js?v=5";
import { Sfx } from "./sfx.js?v=5";

const V3 = THREE.Vector3;
const sfx = new Sfx();

// Show errors on screen (the prototype is tested on phones with no console).
function reportError(err) {
  console.error(err);
  let box = document.getElementById("errors");
  if (!box) {
    box = document.createElement("div");
    box.id = "errors";
    box.style.cssText = "position:fixed;left:8px;right:8px;top:44px;z-index:99;background:#c8392bee;color:#fff;" +
      "font:12px/1.3 monospace;padding:8px;border-radius:8px;white-space:pre-wrap;max-height:40vh;overflow:auto";
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  }
  box.textContent += `${err && err.stack ? err.stack : err}

`;
}
window.addEventListener("error", (e) => reportError(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => reportError(e.reason));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const linear = (t) => t;
function lerpAngle(a, b, t) {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * t;
}

// ───────────────────────── Renderer, camera, lights ─────────────────────────
const stage = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Characters only move on stop-motion frames (12 fps), so shadows only need redrawing then.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#2b2433");

const camera = new THREE.PerspectiveCamera(26, 1, 0.5, 120);
const CAM_DIR = new V3(0.16, 1.0, 0.92).normalize();
const CAM_TARGET = new V3(-0.25, 0.6, 0.15);
const camBase = new V3();
let camShake = 0;
// The camera sits close behind the player while they answer, pulls back to the
// whole-room view whenever something happens, then pushes in again.
const CLOSE_ZOOM = 0.52;               // close distance as a fraction of the wide one
let camDistWide = 30;
let camWide = 1;                       // 0 = close on player, 1 = whole room
let camWideOverride = null;            // cut-scenes can force a framing
const camFocus = new V3().copy(CAM_TARGET);
const camFocusGoal = new V3();

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const R = 7.0;
  camDistWide = R / Math.sin(Math.min(vfov, hfov * 1.12) / 2);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// Soft image-based lighting: gives the clay gentle highlights and bounce colour (one-off cost at load).
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
scene.add(new THREE.HemisphereLight("#fff0dc", "#6a5878", 0.85));
const fill = new THREE.DirectionalLight("#a9c0ff", 0.45);
fill.position.set(-4, 8, 12);
scene.add(fill);

// Late-afternoon sun pouring in through (invisible) windows on the right.
const sun = new THREE.DirectionalLight("#ffc98a", 3.2);
sun.position.set(14, 11, -3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 45 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ───────────────────────── Clay materials & geometry ─────────────────────────
function makeClayTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#808080";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1500; i++) {
    const v = Math.floor(rand(95, 165));
    g.fillStyle = `rgba(${v},${v},${v},0.22)`;
    g.beginPath();
    g.ellipse(rand(0, 256), rand(0, 256), rand(2, 9), rand(1, 4), rand(0, Math.PI), 0, Math.PI * 2);
    g.fill();
  }
  // thumbprint ridges
  for (let i = 0; i < 40; i++) {
    const x = rand(0, 256), y = rand(0, 256), a = rand(0, Math.PI * 2);
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? 70 : 190},${Math.random() < 0.5 ? 70 : 190},128,0.16)`;
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.arc(x, y, 3 + k * 2.4, a, a + 1.8);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const clayTex = makeClayTexture();
const matCache = new Map();
function clay(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: 0.8, metalness: 0, bumpMap: clayTex, bumpScale: 1.4, ...extra
    }));
  }
  return matCache.get(key);
}

function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const s = (t) => t * t * (3 - 2 * t);
  const xf = s(x - xi), yf = s(y - yi), zf = s(z - zi);
  let r = 0;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
    const w = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
    r += w * hash3(xi + dx, yi + dy, zi + dz);
  }
  return r;
}
// Hand-modelled wobble: displace by smooth 3D noise of the position (crack-free).
function lumpy(geo, amp = 0.02, freq = 3) {
  const p = geo.attributes.position;
  const seed = rand(0, 100);
  const v = new V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const fx = v.x * freq + seed, fy = v.y * freq, fz = v.z * freq;
    p.setXYZ(i,
      v.x + (vnoise(fx, fy, fz) - 0.5) * amp * 2,
      v.y + (vnoise(fx + 31.7, fy, fz) - 0.5) * amp * 2,
      v.z + (vnoise(fx, fy + 57.1, fz) - 0.5) * amp * 2);
  }
  geo.computeVertexNormals();
  return geo;
}
const rbox = (w, h, d, r = 0.06, amp = 0.015) =>
  lumpy(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002)), amp, 2.2);
// Fewer polygons for small parts: a pupil doesn't need the detail of a head.
const sphere = (r, amp = r * 0.05) =>
  lumpy(new THREE.SphereGeometry(r, r < 0.1 ? 10 : r < 0.2 ? 16 : 22, r < 0.1 ? 7 : r < 0.2 ? 11 : 15), amp, 3 / r);
const capsule = (r, len, amp = r * 0.07) => lumpy(new THREE.CapsuleGeometry(r, len, r < 0.1 ? 3 : 5, r < 0.1 ? 8 : 14), amp, 2.5 / r);
const cyl = (rt, rb, h, seg = 16) => lumpy(new THREE.CylinderGeometry(rt, rb, h, seg, 2), 0.008, 3);

function M(geo, mat, x = 0, y = 0, z = 0, parent = scene) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  // Tiny pieces (eyes, buttons, pencils) cast shadows nobody can see — skip them.
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  m.castShadow = geo.boundingSphere.radius > 0.1;
  parent.add(m);
  return m;
}

// ───────────────────────── Room ─────────────────────────
// Floor spans x,z ∈ [-6, 6]. Whiteboard (back-left) and door (back-right) share the BACK wall (z = -6).
const ROOM = 6;
const BOARD = { x: -3.2, y: 2.45, w: 3.6, h: 1.8 };
const DOOR = { x: 4.6, w: 1.5, h: 2.9 };

M(rbox(14.2, 0.8, 14.2, 0.2, 0.04), clay("#6b4a3a"), 0, -0.55, 0);           // plinth
M(rbox(12, 0.3, 12, 0.08, 0.02), clay("#d9b089"), 0, -0.15, 0);              // floor
M(rbox(5.4, 0.05, 5.6, 0.02, 0.01), clay("#b8504a"), 0, 0.02, 0.6);          // rug
M(rbox(4.8, 0.06, 5.0, 0.02, 0.01), clay("#e8c47a"), 0, 0.03, 0.6);
M(rbox(4.3, 0.07, 4.5, 0.02, 0.01), clay("#b8504a"), 0, 0.04, 0.6);

const wallMat = clay("#9cc4aa");
M(rbox(12.6, 4.4, 0.3, 0.06, 0.03), wallMat, 0, 2.05, -ROOM - 0.15);         // back wall
M(rbox(0.3, 4.4, 12.6, 0.06, 0.03), wallMat, -ROOM - 0.15, 2.05, 0);         // left wall
M(rbox(12, 0.22, 0.08), clay("#efe1c6"), 0, 0.11, -ROOM + 0.04);             // skirting
M(rbox(0.08, 0.22, 12), clay("#efe1c6"), -ROOM + 0.04, 0.11, 0);

// Whiteboard
M(rbox(BOARD.w + 0.2, BOARD.h + 0.2, 0.14, 0.05), clay("#c9ced6"), BOARD.x, BOARD.y, -ROOM + 0.07);
M(rbox(BOARD.w * 0.8, 0.06, 0.25), clay("#c9ced6"), BOARD.x, BOARD.y - BOARD.h / 2 - 0.12, -ROOM + 0.15);
const boardCanvas = document.createElement("canvas");
boardCanvas.width = 512; boardCanvas.height = 256;               // drawn at half the layout size
const bctx = boardCanvas.getContext("2d");
bctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
const boardTex = new THREE.CanvasTexture(boardCanvas);
boardTex.colorSpace = THREE.SRGBColorSpace;
boardTex.anisotropy = 4;
const boardSurface = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w, BOARD.h),
  new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.35 }));
boardSurface.position.set(BOARD.x, BOARD.y, -ROOM + 0.15);
boardSurface.receiveShadow = true;
scene.add(boardSurface);

// Door (hinged on its right edge, swings into the room), glowing corridor behind it, EXIT sign
M(rbox(DOOR.w + 0.35, DOOR.h + 0.25, 0.2, 0.05), clay("#7a5236"), DOOR.x, DOOR.h / 2 + 0.05, -ROOM + 0.02);
const doorway = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.w, DOOR.h),
  new THREE.MeshBasicMaterial({ color: "#fff1c4" }));
doorway.position.set(DOOR.x, DOOR.h / 2, -ROOM + 0.13);
scene.add(doorway);
const doorPivot = new THREE.Group();
doorPivot.position.set(DOOR.x + DOOR.w / 2, 0, -ROOM + 0.18);
scene.add(doorPivot);
M(rbox(DOOR.w, DOOR.h, 0.1, 0.04), clay("#e0703f"), -DOOR.w / 2, DOOR.h / 2, 0, doorPivot);
M(rbox(0.55, 0.7, 0.06, 0.05), clay("#bfe6f2", { roughness: 0.3 }), -DOOR.w / 2, 2.1, 0.04, doorPivot);
M(sphere(0.07), clay("#e8c14a", { metalness: 0.4, roughness: 0.4 }), -DOOR.w + 0.2, 1.35, 0.12, doorPivot);
const doorLight = new THREE.PointLight("#ffd9a0", 0, 7, 1.5);
doorLight.position.set(DOOR.x, 1.8, -ROOM + 0.8);
scene.add(doorLight);
{
  const c = document.createElement("canvas");
  c.width = 256; c.height = 96;
  const g = c.getContext("2d");
  g.fillStyle = "#2fae5a"; g.fillRect(0, 0, 256, 96);
  g.fillStyle = "#fff"; g.font = "bold 64px Fredoka, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("EXIT", 128, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34),
    new THREE.MeshStandardMaterial({ map: tex, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.6 }));
  sign.position.set(DOOR.x, DOOR.h + 0.5, -ROOM + 0.05);
  scene.add(sign);
}

// Teacher's desk in the open end of the U, facing the class
{
  const g = new THREE.Group();
  g.position.set(0.4, 0, -4.3);
  g.rotation.y = -Math.PI / 2;
  scene.add(g);
  M(rbox(1.0, 0.12, 2.0, 0.05), clay("#a8693f"), 0, 1.0, 0, g);
  M(rbox(0.9, 0.9, 0.12, 0.04), clay("#8a5232"), 0, 0.5, -0.88, g);
  M(rbox(0.9, 0.9, 0.12, 0.04), clay("#8a5232"), 0, 0.5, 0.88, g);
  M(rbox(0.08, 0.7, 1.7, 0.03), clay("#8a5232"), 0.42, 0.6, 0, g);
  const apple = M(sphere(0.13), clay("#d8322e", { roughness: 0.5 }), 0.1, 1.18, 0.6, g);
  apple.scale.set(1, 0.9, 1);
  M(cyl(0.012, 0.015, 0.1), clay("#5a3a1e"), 0.1, 1.33, 0.6, g);
  M(rbox(0.5, 0.1, 0.38), clay("#3f6fb5"), -0.05, 1.12, -0.4, g);
  M(rbox(0.48, 0.09, 0.36), clay("#e0b030"), -0.07, 1.21, -0.38, g).rotation.y = 0.2;
  M(cyl(0.09, 0.08, 0.2), clay("#f4f0e6"), 0.15, 1.16, 0.1, g);
}

// Clock above the gap between board and door; posters + bunting on the left wall
const clockHands = [];
{
  const c = new THREE.Group();
  c.position.set(0.8, 3.35, -ROOM + 0.02);
  scene.add(c);
  M(cyl(0.42, 0.42, 0.1, 32), clay("#d84a3a"), 0, 0, 0.05, c).rotation.x = Math.PI / 2;
  M(cyl(0.35, 0.35, 0.1, 32), clay("#fbf6ea"), 0, 0, 0.08, c).rotation.x = Math.PI / 2;
  for (const [len, w] of [[0.3, 0.035], [0.22, 0.05]]) {
    const pivot = new THREE.Group();
    pivot.position.z = 0.15;
    c.add(pivot);
    M(rbox(w, len, 0.02, 0.01, 0.002), clay("#2a2a2a"), 0, len / 2 - 0.03, 0, pivot);
    clockHands.push(pivot);
  }
}
const posterColors = [["#f4d35e", "#3a86c8"], ["#f6a6b2", "#5fbf7a"], ["#bde0fe", "#e76f51"]];
posterColors.forEach(([bg, fg], i) => {
  const p = new THREE.Group();
  p.position.set(-ROOM + 0.03, 2.5 + (i % 2) * 0.25, -2 + i * 2);
  p.rotation.y = Math.PI / 2;
  scene.add(p);
  M(rbox(1.1, 1.3, 0.05, 0.03, 0.01), clay(bg), 0, 0, 0, p);
  M(sphere(0.25), clay(fg), 0, 0.2, 0.05, p).scale.set(1, 1, 0.25);
  M(rbox(0.8, 0.1, 0.04, 0.02, 0.005), clay(fg), 0, -0.3, 0.05, p);
  M(rbox(0.6, 0.1, 0.04, 0.02, 0.005), clay(fg), 0, -0.45, 0.05, p);
});
// Bookshelf against the back wall between board and door, plant on top
{
  const s = new THREE.Group();
  s.position.set(2.5, 0, -ROOM + 0.4);
  scene.add(s);
  M(rbox(1.7, 1.6, 0.6, 0.05), clay("#9a6340"), 0, 0.8, 0, s);
  for (let shelf = 0; shelf < 2; shelf++) {
    let x = -0.7;
    while (x < 0.65) {
      const w = rand(0.1, 0.18), h = rand(0.4, 0.6);
      M(rbox(w, h, 0.42, 0.02, 0.01), clay(pick(["#c8392b", "#3a86c8", "#e0b030", "#5fbf7a", "#8a5ac8"])),
        x + w / 2, 0.25 + shelf * 0.72 + h / 2 - 0.05, 0.08, s).rotation.z = rand(-0.05, 0.05);
      x += w + 0.02;
    }
  }
  M(cyl(0.28, 0.2, 0.45), clay("#c4673f"), 0.4, 1.83, 0, s);
  for (let i = 0; i < 6; i++) {
    const leaf = M(sphere(0.14), clay("#4f9a4a"), 0.4 + rand(-0.15, 0.15), 2.15 + rand(0, 0.4), rand(-0.1, 0.1), s);
    leaf.scale.set(0.7, 1.6, 0.5);
    leaf.rotation.z = rand(-0.6, 0.6);
  }
}
{
  const flagColors = ["#e63946", "#f4a261", "#e9c46a", "#2a9d8f", "#457b9d"];
  const tri = new THREE.Shape();
  tri.moveTo(-0.17, 0); tri.lineTo(0.17, 0); tri.lineTo(0, -0.32);
  const triGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.02, bevelEnabled: false });
  for (let i = 0; i < 18; i++) {
    const f = M(triGeo, clay(flagColors[i % 5]), -ROOM + 0.05, 4.05 - Math.sin((i / 17) * Math.PI) * 0.25, -5.6 + i * 0.6);
    f.rotation.y = Math.PI / 2;
  }
}

// Invisible window frames with half-open blinds: they only cast shadows,
// throwing stripes of sunlight across the room.
{
  const shape = new THREE.Shape();
  shape.moveTo(-10, -2); shape.lineTo(10, -2); shape.lineTo(10, 14); shape.lineTo(-10, 14); shape.lineTo(-10, -2);
  const windows = [-3.6, 0.2, 4.0];
  for (const wz of windows) {
    const hole = new THREE.Path();
    hole.moveTo(wz - 1.5, 3); hole.lineTo(wz + 1.5, 3); hole.lineTo(wz + 1.5, 12); hole.lineTo(wz - 1.5, 12); hole.lineTo(wz - 1.5, 3);
    shape.holes.push(hole);
  }
  const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  const gobo = new THREE.Group();
  gobo.position.set(8.5, 0, 0);
  gobo.rotation.y = Math.PI / 2;
  scene.add(gobo);
  const wall = new THREE.Mesh(new THREE.ShapeGeometry(shape), shadowOnly);
  wall.castShadow = true;
  gobo.add(wall);
  for (const wz of windows) {
    for (let y = 3.3; y < 12; y += 0.75) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 0.05), shadowOnly);
      slat.position.set(wz, y, 0);
      slat.castShadow = true;
      gobo.add(slat);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 9, 0.1), shadowOnly);
    bar.position.set(wz, 7.5, 0);
    bar.castShadow = true;
    gobo.add(bar);
  }
}

// ───────────────────────── Seats in a sideways U ─────────────────────────
// Seat 1 is beside the teacher, seat 10 beside the door.
const SEATS = [];
function addSeat(x, z, yaw) {
  SEATS.push({ pos: new V3(x, 0, z), yaw, out: new V3(-Math.sin(yaw), 0, -Math.cos(yaw)) });
}
[-3, -1, 1, 3].forEach((z) => addSeat(-4.6, z, Math.PI / 2));     // left arm, facing right
[-1.3, 1.3].forEach((x) => addSeat(x, 4.6, Math.PI));              // front, facing the board
[3, 1, -1, -3].forEach((z) => addSeat(4.6, z, -Math.PI / 2));      // right arm, facing left

const deskItemColors = ["#c8392b", "#3a86c8", "#e0b030", "#5fbf7a", "#8a5ac8", "#f08bb4"];
for (const seat of SEATS) {
  const g = new THREE.Group();
  g.position.copy(seat.pos);
  g.rotation.y = seat.yaw;
  scene.add(g);
  const chairMat = clay("#4d79b5");
  M(rbox(0.62, 0.08, 0.55, 0.03), chairMat, 0, 0.5, 0, g);
  M(rbox(0.62, 0.45, 0.07, 0.04), chairMat, 0, 0.88, -0.3, g);
  for (const [lx, lz] of [[-0.26, -0.22], [0.26, -0.22], [-0.26, 0.22], [0.26, 0.22]])
    M(cyl(0.03, 0.03, 0.5, 8), clay("#55575e"), lx, 0.25, lz, g);
  // desk
  M(rbox(1.55, 0.1, 0.8, 0.04), clay("#e3b77c"), 0, 0.95, 0.8, g);
  M(rbox(1.4, 0.55, 0.06, 0.03), clay("#5a8fc4"), 0, 0.62, 1.15, g);
  for (const lx of [-0.68, 0.68]) M(rbox(0.06, 0.9, 0.7, 0.03), clay("#5a8fc4"), lx, 0.45, 0.8, g);
  // clutter
  if (Math.random() < 0.7) M(rbox(0.32, 0.06, 0.24, 0.02, 0.005), clay(pick(deskItemColors)), rand(-0.5, 0.5), 1.03, 0.85, g).rotation.y = rand(-0.4, 0.4);
  if (Math.random() < 0.6) M(rbox(0.3, 0.01, 0.38, 0.005, 0.003), clay("#fbf8ef"), rand(-0.4, 0.4), 1.005, 0.7, g).rotation.y = rand(-0.3, 0.3);
  if (Math.random() < 0.5) {
    const p = M(cyl(0.018, 0.018, 0.3, 6), clay("#f2c12e"), rand(-0.5, 0.5), 1.02, 0.95, g);
    p.rotation.z = Math.PI / 2;
    p.rotation.y = rand(-1, 1);
  }
}

// ───────────────────────── Dust in the sunbeams ─────────────────────────
const dust = (() => {
  const N = 260;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = rand(-5, 6); pos[i * 3 + 1] = rand(0.3, 4); pos[i * 3 + 2] = rand(-5.5, 5.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,240,200,1)");
  grad.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.06, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending, color: "#ffd9a0"
  }));
  scene.add(pts);
  return pts;
})();
function driftDust(t) {
  const p = dust.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i) + 0.0025 * Math.sin(t * 0.7 + i);
    let x = p.getX(i) - 0.003;
    if (x < -5.5) x = 6;
    p.setXY(i, x, y);
  }
  p.needsUpdate = true;
}

// If the phone can't keep up, trade resolution and extras for frame rate.
let perfFrames = 0, perfTime = 0, perfChecked = false;
function checkPerformance(dt) {
  if (perfChecked) return;
  perfFrames++;
  perfTime += dt;
  if (perfFrames < 120) return;
  perfChecked = true;
  const avg = perfTime / perfFrames;
  if (avg > 1 / 30) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    dust.visible = false;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    resize();
  }
}

// ───────────────────────── Player marker ─────────────────────────
// A soft green circle on the floor around the player. Desks and chairs hide parts of it,
// which is fine. One flat transparent mesh: practically free.
const ring = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(90,255,130,0.6)");
  grad.addColorStop(0.7, "rgba(90,255,130,0.55)");
  grad.addColorStop(0.86, "rgba(170,255,190,1)");    // brighter rim
  grad.addColorStop(1, "rgba(90,255,130,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.07;                              // just above the rug
  mesh.renderOrder = 1;
  scene.add(mesh);
  return mesh;
})();
function updateRing() {
  ring.position.x = player.root.position.x;
  ring.position.z = player.root.position.z;
  ring.visible = player.root.visible;
}

// ───────────────────────── Merge the static scenery ─────────────────────────
// Hundreds of small clay pieces never move; merging them by material turns ~250 draw calls
// (doubled by the shadow pass) into a couple of dozen.
function mergeStatic() {
  const keep = new Set();
  for (const root of [doorPivot, ...clockHands]) root.traverse((o) => keep.add(o));
  const groups = new Map();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || keep.has(o)) return;
    const key = o.material.uuid + (o.castShadow ? "c" : "") + (o.receiveShadow ? "r" : "");
    if (!groups.has(key)) groups.set(key, { material: o.material, cast: o.castShadow, receive: o.receiveShadow, meshes: [] });
    groups.get(key).meshes.push(o);
  });
  for (const g of groups.values()) {
    if (g.meshes.length < 2) continue;
    const geos = g.meshes.map((m) => {
      const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(name)) geo.deleteAttribute(name);
      return geo;
    });
    const merged = new THREE.Mesh(mergeGeometries(geos), g.material);
    merged.castShadow = g.cast;
    merged.receiveShadow = g.receive;
    for (const m of g.meshes) m.removeFromParent();
    scene.add(merged);
  }
}
mergeStatic();

// ───────────────────────── Characters ─────────────────────────
const SKINS = ["#f2c9a0", "#d9a273", "#a8704a", "#7a4b2e", "#f5d7b8", "#c68a5c"];
const SHIRTS = ["#e0574f", "#4f8fe0", "#5fbf7a", "#9a6fd0", "#f08bb4", "#3fb5b0", "#6d7a8a", "#e9e4d8", "#2f6f4f"];
const HAIRS = ["#2b1d14", "#5a3a22", "#8a5a2b", "#d9a441", "#1a1a1a", "#b8462a"];
const HAIR_STYLES = ["cap", "spiky", "bun", "bob", "pigtails", "beanie", "cap", "bob"];
const HIP_SIT = 0.66, HIP_STAND = 0.6;

function addHair(head, style, color, accent) {
  const mat = clay(color, { side: THREE.DoubleSide });
  const cap = (r = 0.36, tilt = -0.35, cover = 0.5) => {
    const m = M(lumpy(new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, Math.PI * cover), 0.015, 8), mat, 0, 0.03, -0.02, head);
    m.rotation.x = tilt;
    return m;
  };
  if (style === "cap") cap();
  if (style === "short") cap(0.35, -0.3, 0.42);                  // close crop
  if (style === "spiky") {
    cap(0.355);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spike = M(lumpy(new THREE.ConeGeometry(0.09, 0.26, 8), 0.01, 8), mat, Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.2 - 0.05, head);
      spike.lookAt(head.localToWorld(new V3(Math.cos(a) * 2, 2.5, Math.sin(a) * 2 - 0.5)));
      spike.rotateX(Math.PI / 2);
    }
  }
  if (style === "bun") { cap(); M(sphere(0.15), mat, 0, 0.36, -0.14, head); }
  if (style === "bob") {
    cap(0.37, -0.2, 0.33);
    const sides = M(lumpy(new THREE.SphereGeometry(0.385, 24, 14, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.66), 0.015, 8), mat, 0, 0.02, -0.01, head);
    sides.rotation.x = -0.1;
  }
  if (style === "pigtails") {
    cap();
    for (const s of [-1, 1]) M(sphere(0.13), mat, s * 0.37, -0.05, -0.1, head).scale.set(0.8, 1.2, 0.8);
  }
  if (style === "beanie") {
    const hat = clay(accent);
    const m = M(lumpy(new THREE.SphereGeometry(0.375, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.46), 0.015, 8), hat, 0, 0.05, 0, head);
    m.rotation.x = -0.15;
    M(lumpy(new THREE.TorusGeometry(0.33, 0.06, 8, 24), 0.01, 8), hat, 0, 0.1, 0.03, head).rotation.x = Math.PI / 2 - 0.15;
    M(sphere(0.1), clay("#fbf6ea"), 0, 0.43, -0.06, head);
  }
}

function addFace(head, skin, browColor, scale = 1) {
  const eyes = [], brows = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 0.12 * scale, 0.04, 0.27);
    head.add(eye);
    M(sphere(0.085, 0.003), clay("#fbfbf6", { roughness: 0.4 }), 0, 0, 0, eye).scale.set(1, 1.1, 0.6);
    const pupil = M(sphere(0.045, 0.002), clay("#1b1410", { roughness: 0.3 }), 0, 0, 0.05, eye);
    eye.userData.pupil = pupil;
    eyes.push(eye);
    const brow = M(capsule(0.022, 0.1, 0.002), clay(browColor), s * 0.12 * scale, 0.17, 0.3, head);
    brow.rotation.z = Math.PI / 2;
    brow.userData.s = s;
    brows.push(brow);
  }
  M(sphere(0.06), clay(skin), 0, -0.04, 0.33, head);
  const mouth = M(sphere(0.04, 0.002), clay("#5a2424", { roughness: 0.5 }), 0, -0.15, 0.3, head);
  return { eyes, brows, mouth };
}

function setFace(ch, mode) {
  const browAngle = { neutral: 0, grumpy: 0.35, worried: -0.3, shock: -0.2, angry: 0.5 }[mode] ?? 0;
  const browLift = { shock: 0.05, worried: 0.02 }[mode] ?? 0;
  for (const b of ch.brows) {
    b.rotation.z = Math.PI / 2 + b.userData.s * browAngle;
    b.position.y = ch.browY + browLift;
  }
  const m = {
    neutral: [2.0, 0.55, 0.6], grumpy: [1.6, 0.4, 0.6], worried: [1.4, 0.7, 0.6],
    shock: [1.3, 1.7, 0.7], angry: [3.2, 2.6, 0.8], happy: [2.6, 1.0, 0.6]
  }[mode] ?? [2, 0.55, 0.6];
  ch.mouth.scale.set(...m);
  ch.face = mode;
}

// The six characters the player can choose from (all wear the player's yellow jumper).
const AVATARS = [
  { id: "asian-m", label: "Asian man", skin: "#f1d1ad", hair: "#17140f", style: "short" },
  { id: "asian-f", label: "Asian woman", skin: "#efcda8", hair: "#141210", style: "bob" },
  { id: "brown-m", label: "Light brown man", skin: "#c68a5c", hair: "#2b1d14", style: "spiky" },
  { id: "brown-f", label: "Light brown woman", skin: "#c48558", hair: "#33200f", style: "bun" },
  { id: "dark-m", label: "Dark-skinned man", skin: "#6b4127", hair: "#120e0b", style: "short" },
  { id: "dark-f", label: "Dark-skinned woman", skin: "#5e3a22", hair: "#120e0b", style: "pigtails" }
];

function makeStudent(isPlayer, avatar = null) {
  const skin = avatar ? avatar.skin : pick(SKINS);
  const shirt = isPlayer ? "#ffcc33" : pick(SHIRTS);
  const hair = avatar ? avatar.hair : pick(HAIRS);
  const style = avatar ? avatar.style : pick(HAIR_STYLES);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  scene.add(root);

  const legMat = clay(pick(["#3a4a7a", "#4b4b55", "#6a5040", "#2d3a5a"]));
  const legs = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.14, 0, 0);
    body.add(pivot);
    M(capsule(0.12, 0.28), legMat, 0, -0.27, 0, pivot);
    M(rbox(0.2, 0.12, 0.3, 0.05, 0.01), clay("#2a2220"), 0, -0.52, 0.06, pivot);
    pivot.userData.s = s;
    legs.push(pivot);
  }
  const torso = M(capsule(0.3, 0.36), clay(shirt), 0, 0.42, 0, body);
  torso.scale.set(1, 1, 0.82);
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.36, 0.72, 0);
    body.add(pivot);
    M(capsule(0.09, 0.3), clay(shirt), 0, -0.2, 0, pivot);
    M(sphere(0.1), clay(skin), 0, -0.42, 0, pivot);
    pivot.userData.s = s;
    arms.push(pivot);
  }
  const head = new THREE.Group();
  head.position.set(0, 1.1, 0);
  body.add(head);
  M(sphere(0.34), clay(skin), 0, 0, 0, head).scale.set(1, 0.94, 0.96);
  for (const s of [-1, 1]) M(sphere(0.07), clay(skin), s * 0.33, -0.02, 0, head).scale.set(0.5, 1, 0.8); // ears
  addHair(head, style, hair, pick(SHIRTS));
  const face = addFace(head, skin, hair === "#d9a441" ? "#8a5a2b" : hair);


  const ch = { root, body, legs, arms, head, torso, ...face, browY: 0.17, isPlayer,
    phase: rand(0, 10), lookYaw: 0, lookTarget: 0, nextLook: rand(1, 4), blinkUntil: 0, flinch: 0 };
  setPose(ch, 0);
  setFace(ch, "neutral");
  return ch;
}

// 0 = sitting with hands on desk, 1 = standing with arms down
function setPose(ch, s) {
  ch.pose = s;
  ch.body.position.y = lerp(HIP_SIT, HIP_STAND, s);
  for (const l of ch.legs) l.rotation.x = lerp(-Math.PI / 2, 0, s);
  for (const a of ch.arms) {
    a.rotation.x = lerp(-1.0, 0.05, s);
    a.rotation.z = a.userData.s * lerp(0.12, 0.18, s);
  }
}

function makeTeacher() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  scene.add(root);
  const skin = "#efb995";
  const shirt = "#a9c7de";
  const blond = "#d8b45e";
  const legs = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.18, 1.0, 0);
    body.add(pivot);
    M(capsule(0.15, 0.7), clay("#5b5f6b"), 0, -0.45, 0, pivot);
    M(rbox(0.24, 0.14, 0.38, 0.06, 0.01), clay("#3a2a20"), 0, -0.93, 0.08, pivot);
    legs.push(pivot);
  }
  const torso = M(capsule(0.4, 0.6), clay(shirt), 0, 1.45, 0, body);          // untucked light-blue shirt
  torso.scale.set(1, 1, 0.85);
  for (const s of [-1, 1]) {                                                   // open collar points
    const c = M(rbox(0.18, 0.1, 0.04, 0.02, 0.005), clay("#93b4cf"), s * 0.1, 1.86, 0.29, body);
    c.rotation.z = s * -0.5;
  }
  for (let i = 0; i < 3; i++) M(sphere(0.022, 0.001), clay("#f4f0e6"), 0, 1.7 - i * 0.18, 0.345, body);  // buttons
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.46, 1.8, 0);
    body.add(pivot);
    M(capsule(0.11, 0.55), clay(shirt), 0, -0.36, 0, pivot);
    M(sphere(0.12), clay(skin), 0, -0.72, 0, pivot);
    if (s === 1) {
      const pen = M(cyl(0.035, 0.035, 0.22, 8), clay("#2a4fbf"), 0, -0.8, 0.06, pivot);
      pen.rotation.x = 0.4;
    }
    pivot.rotation.z = s * 0.12;
    arms.push(pivot);
  }
  const head = new THREE.Group();
  head.position.set(0, 2.3, 0);
  body.add(head);
  M(sphere(0.38), clay(skin), 0, 0, 0, head).scale.set(1, 1.02, 0.96);
  // Messy blond hair: a cap plus tufts sticking out in all directions
  const hairMat = clay(blond, { side: THREE.DoubleSide });
  const cap = M(lumpy(new THREE.SphereGeometry(0.4, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), 0.02, 7), hairMat, 0, 0.04, -0.03, head);
  cap.rotation.x = -0.3;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rand(-0.2, 0.2);
    const up = rand(0.15, 0.35);
    const tuft = M(lumpy(new THREE.ConeGeometry(0.075, rand(0.2, 0.32), 7), 0.012, 9), hairMat,
      Math.cos(a) * 0.27, 0.22 + up * 0.3, Math.sin(a) * 0.27 - 0.06, head);
    tuft.lookAt(head.localToWorld(new V3(Math.cos(a) * 3, 2 + up * 4, Math.sin(a) * 3)));
    tuft.rotateX(Math.PI / 2);
  }
  for (const s of [-1, 1]) {
    M(sphere(0.075), clay(skin), s * 0.38, -0.02, 0.02, head).scale.set(0.5, 1, 0.8);              // ears
    M(sphere(0.13), hairMat, s * 0.33, 0.1, -0.12, head).scale.set(0.6, 1, 1.1);                   // side hair
    const lens = M(lumpy(new THREE.TorusGeometry(0.105, 0.014, 8, 20), 0.002, 10), clay("#8d939b", { metalness: 0.5, roughness: 0.35 }),
      s * 0.145, 0.05, 0.33, head);
    lens.scale.set(1.2, 0.8, 1);                                                                   // squarish frames
    lens.rotation.y = s * 0.1;
  }
  M(rbox(0.07, 0.015, 0.015, 0.006, 0.001), clay("#8d939b"), 0, 0.06, 0.37, head);
  // Stubbly beard covering the jaw
  const beard = M(lumpy(new THREE.SphereGeometry(0.395, 20, 10, Math.PI / 2 - 1.45, 2.9, Math.PI * 0.56, Math.PI * 0.4), 0.012, 9),
    clay("#b98b4a", { side: THREE.DoubleSide, roughness: 0.95 }), 0, 0, 0, head);
  beard.scale.set(1, 1.02, 0.97);
  const face = addFace(head, skin, "#9c7a3c", 1.15);
  face.eyes.forEach((e) => e.scale.setScalar(0.85));
  const tache = M(capsule(0.04, 0.16), clay("#b98b4a"), 0, -0.11, 0.36, head);
  tache.rotation.z = Math.PI / 2;
  face.mouth.position.set(0, -0.2, 0.36);
  const t = { root, body, legs, arms, head, torso, ...face, browY: 0.17, writing: true, turned: 0 };
  setFace(t, "grumpy");
  return t;
}

const teacher = makeTeacher();
const TEACHER_Z = -5.05;
teacher.root.position.set(BOARD.x, 0, TEACHER_Z);
teacher.root.rotation.y = Math.PI;

let player = makeStudent(true, AVATARS[0]);
const classmates = Array.from({ length: 9 }, () => makeStudent(false));
let students = [player, ...classmates];

function setAvatar(avatar) {
  player.root.removeFromParent();
  player = makeStudent(true, avatar);
  students = [player, ...classmates];
  try { localStorage.setItem("avatar", avatar.id); } catch {}
}

// ───────────────────────── Whiteboard writing ─────────────────────────
const boardFull = document.createElement("canvas");
boardFull.width = 1024; boardFull.height = 512;
const BOARD_LINES = [
  { text: "Verb patterns", color: "#1d1d1d", size: 66, y: 90, underline: true },
  { text: "enjoy + -ing", color: "#2a4fbf", size: 56, y: 195 },
  { text: "decide + to ...", color: "#c0392b", size: 56, y: 280 },
  { text: "want + me + to ...", color: "#2a4fbf", size: 56, y: 365 },
  { text: "spend 2 hours + -ing", color: "#1f8a4c", size: 56, y: 450 }
];
let boardSegments = [];
let boardTotal = 0;
let writeProgress = 0;
let boardPause = 0;
function prepareBoard() {
  const g = boardFull.getContext("2d");
  g.clearRect(0, 0, 1024, 512);
  boardSegments = [];
  boardTotal = 0;
  for (const l of BOARD_LINES) {
    g.font = `600 ${l.size}px "Comic Sans MS", "Chalkboard SE", Fredoka, cursive`;
    g.fillStyle = l.color;
    g.textBaseline = "alphabetic";
    const x0 = 60;
    const w = g.measureText(l.text).width;
    g.fillText(l.text, x0, l.y);
    if (l.underline) { g.fillRect(x0, l.y + 12, w, 6); }
    boardSegments.push({ x0, w, y: l.y, top: l.y - l.size, h: l.size + 24 });
    boardTotal += w;
  }
}
let boardFrame = 0;
function drawBoard() {
  bctx.fillStyle = "#fbfcfd";
  bctx.fillRect(0, 0, 1024, 512);
  bctx.fillStyle = "rgba(160,170,190,0.12)";       // ghost smudges of old lessons
  bctx.fillRect(560, 120, 380, 60);
  bctx.fillRect(620, 300, 300, 50);
  let left = writeProgress;
  for (const s of boardSegments) {
    const w = Math.min(s.w, left);
    if (w > 0) bctx.drawImage(boardFull, s.x0, s.top, w, s.h, s.x0, s.top, w, s.h);
    left -= s.w;
  }
  boardTex.needsUpdate = true;
}
function penPosition() {
  let left = writeProgress;
  for (const s of boardSegments) {
    if (left <= s.w) return { u: (s.x0 + left) / 1024, v: (s.y - 20) / 512 };
    left -= s.w;
  }
  const last = boardSegments[boardSegments.length - 1];
  return { u: (last.x0 + last.w) / 1024, v: last.y / 512 };
}
document.fonts.ready.then(() => { prepareBoard(); drawBoard(); });
prepareBoard();
drawBoard();

// ───────────────────────── Stop-motion clock & tweens ─────────────────────────
// Characters update at 12 fps like stop-motion animation; the camera stays smooth.
const SM_FPS = 12;
let clock = 0, smt = 0, lastSmFrame = -1;
const tweens = [];
function tween(dur, fn, ease = easeInOut) {
  return new Promise((res) => {
    tweens.push({ start: smt, dur, fn, ease, res });
    fn(0);
  });
}
const wait = (s) => tween(s, () => {});
function updateTweens() {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const p = Math.min(1, (smt - tw.start) / tw.dur);
    try { tw.fn(tw.ease(p)); } catch (err) { reportError(err); }
    if (p >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}

// ───────────────────────── Game state ─────────────────────────
const seats = new Array(10);
let playerSeat = 2;
let state = "playing";            // playing | busy | won | lost
let timerPaused = false;
// 15 s from the starting seat, shrinking to 10 s at the last chair.
const timeLimitFor = (seat) => (seat <= 2 ? 15 : 15 - ((seat - 2) * 5) / 7);
let timeLimit = 15;
let timeLeft = timeLimit;
let lastTickSecond = 99;
let question = null;
let typed = "";

function placeAt(ch, i) {
  ch.root.position.copy(SEATS[i].pos);
  ch.root.rotation.y = SEATS[i].yaw;
  ch.root.scale.setScalar(1);
  ch.root.visible = true;
  setPose(ch, 0);
  setFace(ch, "neutral");
}

function resetGame() {
  resetStats();
  tweens.length = 0;
  playerSeat = 2;
  const order = [...classmates].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 10; i++) {
    seats[i] = i === playerSeat ? player : order.pop();
    placeAt(seats[i], i);
  }
  teacher.root.rotation.y = Math.PI;
  teacher.root.position.set(BOARD.x, 0, TEACHER_Z);
  teacher.body.scale.set(1, 1, 1);
  teacher.head.rotation.set(0, 0, 0);
  teacher.body.rotation.set(0, 0, 0);
  for (const a of teacher.arms) a.rotation.x = 0;
  teacher.writing = true;
  setFace(teacher, "grumpy");
  setDoor(0);
  camWideOverride = null;
  closeup.classList.remove("show");
  bubble.style.display = "none";
  card.hidden = true;
  state = "playing";
  writeProgress = 0;
  newQuestion();
  updateTrack();
}

async function swapSeats(a, b) {
  const P = seats[a], O = seats[b];
  const sa = SEATS[a], sb = SEATS[b];
  const out = sa.out.clone().add(sb.out).normalize();
  setFace(O, "grumpy");
  sfx.scrape();
  await tween(0.25, (p) => { setPose(P, p); setPose(O, p); });
  [0, 0.23, 0.46].forEach((d) => setTimeout(() => sfx.boing(), d * 1000));
  await tween(0.7, (p) => {
    const e = easeInOut(p);
    const hop = Math.abs(Math.sin(p * Math.PI * 3)) * 0.2;
    P.root.position.lerpVectors(sa.pos, sb.pos, e).addScaledVector(out, Math.sin(Math.PI * p) * 0.85);
    P.root.position.y = hop;
    P.root.rotation.y = lerpAngle(sa.yaw, sb.yaw, e);
    O.root.position.lerpVectors(sb.pos, sa.pos, e).addScaledVector(out, Math.sin(Math.PI * p) * 0.15);
    O.root.position.y = hop * 0.6;
    O.root.rotation.y = lerpAngle(sb.yaw, sa.yaw, e);
  }, linear);
  seats[a] = O;
  seats[b] = P;
  await tween(0.25, (p) => { setPose(P, 1 - p); setPose(O, 1 - p); });
  setTimeout(() => { if (O.face === "grumpy") setFace(O, "neutral"); }, 900);
}

async function walkPath(ch, points, dur) {
  const lens = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) { lens.push(points[i].distanceTo(points[i - 1])); total += lens[i - 1]; }
  let lastHop = -1;
  await tween(dur, (p) => {
    let d = p * total, i = 0;
    while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i++; }
    const a = points[i], b = points[i + 1];
    ch.root.position.lerpVectors(a, b, Math.min(1, d / lens[i]));
    const hops = p * total * 2.2;
    ch.root.position.y = Math.abs(Math.sin(hops * Math.PI)) * 0.15;
    if (Math.floor(hops) !== lastHop) { lastHop = Math.floor(hops); sfx.key(); }
    ch.root.rotation.y = lerpAngle(ch.root.rotation.y, Math.atan2(b.x - a.x, b.z - a.z), 0.5);
  }, linear);
  ch.root.position.y = 0;
}

async function moveTowardDoor() {
  if (playerSeat === 9) return winSequence();
  await swapSeats(playerSeat, playerSeat + 1);
  playerSeat++;
  updateTrack();
}
async function moveTowardTeacher() {
  if (playerSeat === 0) return loseSequence();
  await swapSeats(playerSeat, playerSeat - 1);
  playerSeat--;
  updateTrack();
}

async function loseSequence() {
  state = "lost";
  teacher.writing = false;
  const tx = teacher.root.position.x;
  await tween(0.25, (p) => setPose(player, p));
  setFace(player, "worried");
  await walkPath(player, [SEATS[0].pos.clone(), new V3(-4.6, 0, -4.0), new V3(tx, 0, -4.0)], 1.1);
  player.root.rotation.y = Math.PI;
  await wait(0.3);
  // Teacher spins round
  setFace(teacher, "angry");
  await tween(0.35, (p) => {
    teacher.root.rotation.y = lerp(Math.PI, 0, p);
    teacher.head.rotation.y = lerp(teacher.head.rotation.y, 0, p);
  });
  teacher.body.scale.set(1.08, 1.12, 1.08);
  sfx.yell();
  camShake = 0.35;
  bubble.textContent = pick(["DETENTION!!", "WHAT was THAT?!", "SIT. DOWN!", "NOT GOOD ENOUGH!"]);
  bubble.style.display = "block";
  setFace(player, "shock");
  player.body.scale.set(1.1, 0.8, 1.1);
  for (const c of classmates) { setFace(c, "shock"); c.flinch = 1; }
  await wait(2.0);
  teacher.body.scale.set(1, 1, 1);
  sfx.doom();
  showSummary(false);
}

const DOOR_OPEN = 1.75;   // door swings into the room
const setDoor = (open) => { doorPivot.rotation.y = DOOR_OPEN * open; doorLight.intensity = 6 * open; };

// Comic-panel close-up of the teacher's furious face (an image the teacher artwork will replace).
const closeup = document.getElementById("closeup");
async function showCloseup(seconds) {
  closeup.classList.add("show");
  sfx.doom();
  await wait(seconds);
  closeup.classList.remove("show");
  await wait(0.2);
}

// Two taunting dances, both performed with the player's back to the teacher.
// Feet stay planted: after the hips move, each leg is re-aimed at its fixed foot spot and
// squashed to fit (in clay, a squashed leg reads as a bent knee).
const LEG_LEN = 0.52;                 // hip pivot to shoe centre
const DOWN = new V3(0, -1, 0);
const _hip = new V3(), _foot = new V3(), _q = new THREE.Quaternion();
function plantFeet(ch) {
  ch.root.updateMatrixWorld(true);
  ch.body.getWorldQuaternion(_q).invert();
  for (const leg of ch.legs) {
    leg.getWorldPosition(_hip);
    ch.root.localToWorld(_foot.set(leg.userData.s * 0.15, 0.08, 0.06));
    const dir = _foot.sub(_hip);
    const len = dir.length();
    leg.quaternion.setFromUnitVectors(DOWN, dir.applyQuaternion(_q).normalize());
    leg.scale.set(1, Math.min(1.05, len / LEG_LEN), 1);
  }
}

const DANCES = {
  // Hands in the air, hips swinging side to side, bouncing on the knees.
  handsUp(ch, t) {
    const sway = Math.sin(t * Math.PI * 4);                   // two hip swings a second
    ch.body.position.set(sway * 0.13, HIP_STAND - 0.06 - Math.abs(sway) * 0.05, 0);
    ch.body.rotation.set(0, 0, -sway * 0.18);                 // hips out one way, shoulders lean the other
    ch.head.rotation.set(0, Math.sin(t * Math.PI * 2) * 0.4, sway * 0.18);   // head level, turning
    for (const a of ch.arms) {
      a.rotation.x = -2.9 + Math.sin(t * Math.PI * 8 + a.userData.s) * 0.15;  // up and waving
      a.rotation.z = a.userData.s * (0.35 + Math.sin(t * Math.PI * 8) * 0.1);
    }
    plantFeet(ch);
  },
  // Hands on knees, bent forward, bottom pushed back and shaking; head turns side to side.
  bottomShake(ch, t) {
    const lean = 0.6;
    const shake = Math.sin(t * Math.PI * 6);                  // three shakes a second
    const bounce = Math.abs(Math.sin(t * Math.PI * 3));
    ch.body.position.set(shake * 0.09, HIP_STAND - 0.16 - bounce * 0.05, -0.12);  // knees bent, bottom back
    ch.body.rotation.set(lean, 0, shake * 0.1);
    ch.head.rotation.set(-lean * 0.8, Math.sin(t * Math.PI * 1.5) * 0.6, -shake * 0.1);  // look ahead, turn only
    for (const a of ch.arms) {
      a.rotation.x = -0.35;                                     // hands down on the knees
      a.rotation.z = a.userData.s * 0.12;
    }
    plantFeet(ch);
  }
};

async function taunt(ch, seconds) {
  setFace(ch, "happy");
  sfx.taunt();
  const dance = DANCES[window.game?.forceDance] || pick(Object.values(DANCES));
  ch.dancing = true;                                            // pauses idle head movement
  await tween(seconds, (p) => dance(ch, p * seconds), linear);
  ch.dancing = false;
  ch.body.rotation.set(0, 0, 0);
  ch.body.position.set(0, HIP_STAND, 0);
  ch.head.rotation.set(0, 0, 0);
  for (const l of ch.legs) { l.rotation.set(0, 0, 0); l.scale.set(1, 1, 1); }
  setPose(ch, 1);
}

async function winSequence() {
  state = "won";
  // The teacher comes out to just left of his desk; the player dances in the middle of the room.
  const teacherSpot = new V3(-1.2, 0, -3.35);
  const danceSpot = new V3(-0.2, 0, -1.3);
  const toMiddle = [SEATS[9].pos.clone(), new V3(4.6, 0, -4.0), new V3(2.4, 0, -4.0), new V3(1.9, 0, -3.2), danceSpot];
  const toDoor = [danceSpot.clone(), new V3(1.9, 0, -3.2), new V3(2.4, 0, -4.0),
    new V3(DOOR.x, 0, -4.4), new V3(DOOR.x, 0, -6.8)];

  // 1. The teacher spins round and we cut to his face.
  teacher.writing = false;
  setFace(teacher, "angry");
  await tween(0.35, (p) => {
    teacher.root.rotation.y = lerp(Math.PI, 0, p);
    teacher.head.rotation.y = lerp(teacher.head.rotation.y, 0, p);
    teacher.arms[1].rotation.x = lerp(teacher.arms[1].rotation.x, 0.05, p);
  });
  await showCloseup(1.6);

  // 2. He storms out from the board while the player sneaks into the middle of the room.
  await tween(0.25, (p) => setPose(player, p));
  setFace(player, "happy");
  await Promise.all([
    walkPath(teacher, [teacher.root.position.clone(), new V3(teacher.root.position.x, 0, -4.4), teacherSpot], 1.6),
    walkPath(player, toMiddle, 2.0)
  ]);
  teacher.root.rotation.y = Math.atan2(danceSpot.x - teacherSpot.x, danceSpot.z - teacherSpot.z);
  // Back to the teacher: face directly away from him.
  player.root.rotation.y = Math.atan2(danceSpot.x - teacherSpot.x, danceSpot.z - teacherSpot.z);
  for (const c of classmates) setFace(c, "shock");
  camWideOverride = 0.15;
  const shake = tween(2.4, () => { teacher.body.rotation.z = rand(-0.05, 0.05); }, linear);
  await taunt(player, 2.4);
  await shake;
  teacher.body.rotation.z = 0;

  // 3. Run for it — the teacher gives chase and gets the door shut in his face.
  camWideOverride = null;
  setFace(player, "worried");
  sfx.creak();
  tween(0.5, (p) => setDoor(p));
  const run = walkPath(player, toDoor, 1.6).then(() => { player.root.visible = false; });
  await wait(0.35);
  teacher.writing = false;
  const chasePath = [teacher.root.position.clone(), ...toDoor.slice(1, 4), new V3(DOOR.x, 0, -4.9)];
  for (const a of teacher.arms) a.rotation.x = -1.5;            // grabbing
  const chase = walkPath(teacher, chasePath, 1.9);
  await run;
  await tween(0.2, (p) => setDoor(1 - p));
  sfx.latch();
  await chase;
  teacher.body.scale.set(1.15, 0.85, 1.15);                    // splat against the door
  camShake = 0.15;
  setFace(teacher, "shock");
  await wait(0.4);
  teacher.body.scale.set(1, 1, 1);
  for (const a of teacher.arms) a.rotation.x = 0.05;
  for (const c of classmates) setFace(c, "happy");
  await wait(0.3);
  sfx.fanfare();
  showSummary(true);
}

// ───────────────────────── HUD: question, timer, keyboard ─────────────────────────
const sentenceEl = document.getElementById("sentence");
const timerEl = document.getElementById("timer");
const timerBar = timerEl.firstElementChild;
const trackEl = document.getElementById("track");
const bubble = document.getElementById("bubble");
const card = document.getElementById("card");
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function updateTrack() {
  let html = "<span>😠</span>";
  for (let i = 0; i < 10; i++) html += `<span class="dot${i === playerSeat ? " me" : ""}"></span>`;
  trackEl.innerHTML = html + "<span>🚪</span>";
}

function renderSentence(blankHtml, cls = "", verdict = "") {
  const q = question;
  sentenceEl.innerHTML = `${esc(q.before)} <span class="blank ${cls}">${blankHtml}</span> ` +
    `<span class="hint">(${esc(q.hint)})</span>${esc(q.after)}` +
    (verdict ? `<span class="verdict" style="color:var(--${cls === "right" ? "good" : "bad"})">${verdict}</span>` : "");
}
function renderTyping() {
  renderSentence(`${esc(typed)}<span class="caret"></span>`);
}
function newQuestion() {
  question = generateQuestion();
  typed = "";
  timeLimit = timeLimitFor(playerSeat);
  timeLeft = timeLimit;
  lastTickSecond = 99;
  renderTyping();
}

async function resolve(correct, verdict) {
  if (state !== "playing") return;
  state = "busy";
  if (correct) {
    stats.correct++;
    sfx.correct();
    renderSentence(esc(typed || question.answers[0]), "right", verdict || "Correct!");
    await wait(0.35);
    await moveTowardDoor();
  } else {
    stats.mistakes.push({ question, typed: typed.trim(), slow: verdict === "Too slow!" });
    sfx.wrong();
    const shown = typed ? `<s>${esc(typed)}</s>` : "";
    renderSentence(shown + esc(question.answers.join(" / ")), "wrong", verdict || "Not quite…");
    sentenceEl.classList.remove("shake");
    void sentenceEl.offsetWidth;
    sentenceEl.classList.add("shake");
    await wait(0.9);
    await moveTowardTeacher();
    await wait(0.5);
  }
  if (state === "busy") {
    state = "playing";
    newQuestion();
  }
}

function submit() {
  if (state !== "playing" || !typed.trim()) return;
  resolve(checkAnswer(question, typed));
}

function handleKey(k) {
  sfx.unlock();
  if (state !== "playing") return;
  if (k === "enter") return submit();
  sfx.key();
  if (k === "back") typed = typed.slice(0, -1);
  else if (k === "space") { if (typed && !typed.endsWith(" ")) typed += " "; }
  else if (typed.length < 24) typed += k;
  renderTyping();
}

const kb = document.getElementById("kb");
const ROWS = [
  "qwertyuiop".split(""),
  "asdfghjkl".split(""),
  ["z", "x", "c", "v", "b", "n", "m", "back"],
  ["space", "enter"]
];
const LABELS = { back: "⌫", space: "space", enter: "GO" };
for (const row of ROWS) {
  const r = document.createElement("div");
  r.className = "row";
  for (const k of row) {
    const el = document.createElement("div");
    el.className = "key" + (k === "back" ? " back" : k === "space" ? " space" : k === "enter" ? " go" : "");
    el.textContent = LABELS[k] || k;
    if (k.length === 1) el.dataset.k = k;
    // Keep the pressed look on screen for at least ~120 ms: a quick tap otherwise releases
    // before the next paint and the key never visibly goes down, which feels unresponsive.
    let downAt = 0;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.classList.add("down");
      downAt = performance.now();
      handleKey(k);
    });
    const release = () => setTimeout(() => el.classList.remove("down"), Math.max(0, 120 - (performance.now() - downAt)));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(ev, release);
    r.appendChild(el);
  }
  kb.appendChild(r);
}
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[a-z]$/i.test(e.key)) handleKey(e.key.toLowerCase());
  else if (e.key === "Backspace") handleKey("back");
  else if (e.key === " ") handleKey("space");
  else if (e.key === "Enter") handleKey("enter");
  else return;
  e.preventDefault();
});

// Testing tools, shown only with ?debug in the address
const DEBUG = new URLSearchParams(location.search).has("debug");
document.getElementById("debug").hidden = !DEBUG;
document.getElementById("debug").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  sfx.unlock();
  const a = b.dataset.dbg;
  if (a === "right") resolve(true, "(debug) Correct");
  if (a === "wrong") resolve(false, "(debug) Wrong");
  if (a === "pause") { timerPaused = !timerPaused; b.classList.toggle("on", timerPaused); }
  if (a === "reset") resetGame();
});
const muteBtn = document.getElementById("mute");
muteBtn.addEventListener("click", () => {
  sfx.unlock();
  sfx.muted = !sfx.muted;
  muteBtn.textContent = sfx.muted ? "🔇" : "🔊";
});
document.getElementById("again").addEventListener("click", () => { sfx.unlock(); resetGame(); });
document.getElementById("change").addEventListener("click", () => { sfx.unlock(); card.hidden = true; showPicker(); });

// ───────────────────────── Full screen ─────────────────────────
// Browsers only allow this from a tap, so it happens when the player picks a character,
// and the ⛶ button toggles it. Not available in iPhone Safari, so the button hides there.
const fsBtn = document.getElementById("fullscreen");
const canFullscreen = !!document.documentElement.requestFullscreen;
fsBtn.hidden = !canFullscreen;
function enterFullscreen() {
  if (!canFullscreen || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: "hide" })
    .then(() => screen.orientation?.lock?.("portrait").catch(() => {}))
    .catch(() => {});
}
fsBtn.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else enterFullscreen();
});

// ───────────────────────── Character picker ─────────────────────────
const picker = document.getElementById("picker");
function showPicker() {
  state = "choosing";
  let saved = null;
  try { saved = localStorage.getItem("avatar"); } catch {}
  picker.querySelector(".choices").innerHTML = AVATARS.map((a) => `
    <button class="choice${a.id === saved ? " last" : ""}" data-id="${a.id}" aria-label="${a.label}">
      <span class="face ${a.style}" style="--skin:${a.skin};--hair:${a.hair}"><i></i><b></b></span>
    </button>`).join("");
  picker.hidden = false;
}
picker.addEventListener("click", (e) => {
  const b = e.target.closest(".choice");
  if (!b) return;
  sfx.unlock();
  sfx.correct();
  enterFullscreen();
  setAvatar(AVATARS.find((a) => a.id === b.dataset.id));
  picker.hidden = true;
  resetGame();
});
// ───────────────────────── Score summary ─────────────────────────
const MAX_MISTAKES_SHOWN = 5;
const stats = { start: 0, end: 0, correct: 0, mistakes: [], won: false };
function resetStats() {
  stats.start = performance.now();
  stats.end = 0;
  stats.correct = 0;
  stats.mistakes = [];
}
const formatTime = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
// One mistake: the correct sentence with the answer in bold, plus what was typed.
function mistakeHtml(m) {
  const q = m.question;
  const said = m.slow ? "too slow" : `you typed “${esc(m.typed)}”`;
  return `<li>${esc(q.before)} <b>${esc(q.answers.join(" / "))}</b>${esc(q.after)} <span>(${said})</span></li>`;
}
function showSummary(won) {
  stats.end = performance.now();
  stats.won = won;
  card.classList.toggle("won", won);
  card.querySelector(".card-title").textContent = won ? "You Escaped from Luke!" : "Caught!";
  const total = stats.correct + stats.mistakes.length;
  card.querySelector(".card-stats").innerHTML =
    `<span>⏱ ${formatTime(stats.end - stats.start)}</span><span>✓ ${stats.correct} / ${total}</span>`;
  const shown = stats.mistakes.slice(-MAX_MISTAKES_SHOWN);
  const more = stats.mistakes.length - shown.length;
  card.querySelector(".card-mistakes").innerHTML = stats.mistakes.length
    ? `<div class="label">Check these:</div><ul>${shown.map(mistakeHtml).join("")}</ul>` +
      (more > 0 ? `<div class="more">…and ${more} more</div>` : "")
    : `<div class="label">No mistakes — perfect! 🌟</div>`;
  card.hidden = false;
}

// Save a picture of the result (classroom snapshot + summary) to share or show the teacher.
function wrapText(g, text, x, y, maxWidth, lineHeight) {
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > maxWidth && line) { g.fillText(line, x, y); y += lineHeight; line = word; }
    else line = test;
  }
  g.fillText(line, x, y);
  return y + lineHeight;
}
async function saveResultImage() {
  const W = 1080, H = 1440;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#f3e6cf";
  g.fillRect(0, 0, W, H);
  // Render now and copy straight away, while the frame is still in the WebGL buffer.
  renderer.render(scene, camera);
  const src = renderer.domElement;
  const sh = Math.min(src.height, src.width * 0.7);
  g.drawImage(src, 0, (src.height - sh) / 2, src.width, sh, 0, 0, W, W * 0.7);
  let y = W * 0.7 + 90;
  g.fillStyle = "#4a3426";
  g.textAlign = "center";
  g.font = "700 64px Fredoka, sans-serif";
  g.fillText(stats.won ? "You Escaped from Luke!" : "Caught!", W / 2, y);
  y += 70;
  g.font = "500 40px Fredoka, sans-serif";
  const total = stats.correct + stats.mistakes.length;
  g.fillText(`Time ${formatTime(stats.end - stats.start)}   ·   Correct ${stats.correct} / ${total}`, W / 2, y);
  y += 70;
  g.textAlign = "left";
  g.font = "500 32px Fredoka, sans-serif";
  for (const m of stats.mistakes.slice(-MAX_MISTAKES_SHOWN)) {
    const q = m.question;
    y = wrapText(g, `✗ ${q.before} ${q.answers.join(" / ")}${q.after}`, 60, y, W - 120, 40) + 8;
  }
  g.fillStyle = "#a08a70";
  g.font = "500 26px Fredoka, sans-serif";
  g.fillText(new Date().toLocaleString(), 60, H - 40);

  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  const file = new File([blob], "escape-result.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "My result" }); return; } catch { /* cancelled */ }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "escape-result.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
document.getElementById("shot").addEventListener("click", () => saveResultImage().catch(reportError));

// ───────────────────────── Per-frame update ─────────────────────────
const tmpV = new V3();
let tension = 0;

function stopMotionFrame(dt) {
  renderer.shadowMap.needsUpdate = true;
  updateTweens();
  const t = smt;

  // Teacher writes on the board, slowing and glancing round as time runs out.
  if (state === "playing" || state === "busy") {
    const glance = clamp((tension - 0.15) / 0.85, 0, 1);
    teacher.writing = tension < 0.55;
    teacher.head.rotation.y = lerp(teacher.head.rotation.y, -glance * 1.1, 0.5);
    teacher.head.rotation.x = -glance * 0.1;
    setFace(teacher, glance > 0.6 ? "angry" : "grumpy");
  }
  if (teacher.writing) {
    if (boardPause > 0) {
      boardPause -= dt;
      if (boardPause <= 0) writeProgress = 0;
    } else {
      writeProgress += dt * 240;
      if (writeProgress >= boardTotal) { writeProgress = boardTotal; boardPause = 3; }
      if (Math.random() < 0.35) sfx.squeak();
    }
    if (++boardFrame % 3 === 0) drawBoard();                 // 4 texture uploads a second is plenty
    const pen = penPosition();
    const targetX = BOARD.x + (pen.u - 0.5) * BOARD.w;
    const targetY = BOARD.y + (0.5 - pen.v) * BOARD.h;
    teacher.root.position.x = lerp(teacher.root.position.x, clamp(targetX + 0.45, -4.6, -1.6), 0.25);
    const dy = targetY - 1.8;
    const arm = teacher.arms[1];
    arm.rotation.x = -Math.acos(clamp(-dy / 0.85, -1, 1)) + Math.sin(t * 17) * 0.08;
    arm.rotation.z = 0.12 + Math.sin(t * 11) * 0.06;
  } else if (state === "playing" || state === "busy") {
    const arm = teacher.arms[1];
    arm.rotation.x = lerp(arm.rotation.x, -1.6, 0.3);
  }

  // Students: breathing, blinking, glancing around; freezing and staring at the teacher under tension.
  const freeze = 1 - tension;
  for (const ch of students) {
    if (!ch.root.visible) continue;
    ch.torso.scale.y = 1 + Math.sin(t * 2.2 + ch.phase) * 0.025 * freeze;
    if (t > ch.nextLook) {
      ch.lookTarget = rand(-0.6, 0.6);
      ch.nextLook = t + rand(1.5, 5);
      if (Math.random() < 0.15) ch.blinkUntil = t + 0.15;
    }
    let target = ch.lookTarget;
    if (tension > 0.3 || state === "lost") {
      tmpV.copy(teacher.root.position).sub(ch.root.position);
      target = clamp(lerpAngle(0, Math.atan2(tmpV.x, tmpV.z) - ch.root.rotation.y, 1), -1.3, 1.3);
    }
    if (!ch.dancing) ch.head.rotation.y = lerp(ch.head.rotation.y, target, 0.35);
    const blink = t < ch.blinkUntil || Math.random() < 0.006;
    if (blink && t >= ch.blinkUntil) ch.blinkUntil = t + 0.12;
    for (const e of ch.eyes) e.scale.y = t < ch.blinkUntil ? 0.15 : 1;
    if (ch.flinch > 0) { ch.body.rotation.x = -0.25 * ch.flinch; ch.flinch = Math.max(0, ch.flinch - 0.05); }
    else if (!ch.dancing) ch.body.rotation.x = 0;
    // "boil": tiny frame-to-frame jitter, like hand-posed clay
    if (!ch.dancing) {
      ch.body.rotation.z = rand(-0.012, 0.012);
      ch.head.rotation.z = rand(-0.015, 0.015);
    }
  }
  teacher.body.rotation.z = rand(-0.008, 0.008);

  const now = new Date();
  clockHands[0].rotation.z = -(now.getMinutes() / 60) * Math.PI * 2;
  clockHands[1].rotation.z = -((now.getHours() % 12) / 12) * Math.PI * 2;
}

const fpsEl = document.querySelector(".dlabel");
let fpsFrames = 0, fpsDraws = 0, fpsTime = 0;
const lastCamPos = new V3();
let prev = performance.now();
function frame(nowMs) {
  tick(nowMs);
  requestAnimationFrame(frame);
}
function tick(nowMs) {
  const dt = clamp((nowMs - prev) / 1000, 0, 0.1);
  prev = nowMs;
  clock += dt;

  if (state === "playing" && !timerPaused) {
    timeLeft -= dt;
    const sec = Math.ceil(timeLeft);
    if (timeLeft / timeLimit < 0.35 && sec !== lastTickSecond) { lastTickSecond = sec; sfx.tick(); }
    if (timeLeft <= 0) { timeLeft = 0; resolve(false, "Too slow!"); }
  }
  const frac = timeLeft / timeLimit;
  tension = state === "playing" ? clamp((0.4 - frac) / 0.4, 0, 1) : state === "busy" ? tension : 0;
  timerBar.style.transform = `scaleX(${clamp(frac, 0, 1)})`;
  timerEl.classList.toggle("low", frac < 0.35 && state === "playing");

  const smFrame = Math.floor(clock * SM_FPS);
  let dirty = false;
  if (smFrame !== lastSmFrame) {
    dirty = true;
    const smDt = lastSmFrame < 0 ? 1 / SM_FPS : (smFrame - lastSmFrame) / SM_FPS;
    lastSmFrame = smFrame;
    smt = smFrame / SM_FPS;
    stopMotionFrame(smDt);
  }

  const wideGoal = camWideOverride ?? (state === "playing" ? 0 : 1);
  camWide += (wideGoal - camWide) * Math.min(1, dt * (wideGoal ? 3.5 : 2.2));
  camFocusGoal.copy(player.root.position).setY(0.9);
  camFocusGoal.lerp(CAM_TARGET, easeInOut(camWide));
  camFocus.lerp(camFocusGoal, Math.min(1, dt * 6));
  const dist = camDistWide * lerp(CLOSE_ZOOM, 1, easeInOut(camWide));
  camBase.copy(camFocus).addScaledVector(CAM_DIR, dist);
  if (camBase.distanceToSquared(lastCamPos) > 1e-6 || camShake > 0 || bubble.style.display === "block") dirty = true;
  lastCamPos.copy(camBase);
  camera.position.copy(camBase);
  camera.lookAt(camFocus);
  if (camShake > 0) {
    camera.position.x += rand(-1, 1) * camShake;
    camera.position.y += rand(-1, 1) * camShake;
    camShake = Math.max(0, camShake - dt * 0.4);
  }

  if (bubble.style.display === "block") {
    teacher.head.getWorldPosition(tmpV);
    tmpV.y += 0.55;
    tmpV.project(camera);
    bubble.style.left = `${(tmpV.x * 0.5 + 0.5) * stage.clientWidth}px`;
    bubble.style.top = `${(-tmpV.y * 0.5 + 0.5) * stage.clientHeight}px`;
  }

  // Only redraw when something changed: characters move at 12 fps, so while the player is
  // typing the GPU (and the phone's main thread) mostly rests, keeping the keyboard snappy.
  // The meter shows loop rate (how responsive the page is) and how many frames were actually drawn.
  fpsFrames++; fpsTime += dt;
  if (dirty) fpsDraws++;
  if (fpsTime >= 1) {
    fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} fps · ${Math.round(fpsDraws / fpsTime)} draws`;
    fpsFrames = fpsDraws = 0; fpsTime = 0;
  }
  updateRing();
  checkPerformance(dt);
  if (!dirty) return;
  if (dust.visible) driftDust(clock);
  renderer.render(scene, camera);
}

resize();
resetGame();
showPicker();
requestAnimationFrame(frame);

// Handy for poking at the prototype from the browser console.
window.game = { forceDance: null, get seat() { return playerSeat + 1; }, get state() { return state; }, get question() { return question; },
  info() { let meshes = 0; scene.traverse((o) => { if (o.isMesh) meshes++; }); return { meshes, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pr: renderer.getPixelRatio() }; },
  debug() { return { cam: camera.position.toArray().map((v) => +v.toFixed(2)), wide: +camWide.toFixed(2), tweens: tweens.length, smt, clock, pos: player.root.position.toArray().map((v) => +v.toFixed(2)), pose: player.pose }; },
  // advance the simulation manually (rAF pauses when the tab is hidden)
  async step(seconds) {
    for (let i = 0; i < seconds * 30; i++) { tick(prev + 1000 / 30); for (let k = 0; k < 10; k++) await null; }
  } };
