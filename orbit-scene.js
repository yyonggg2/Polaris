// Point-cloud Earth–Moon orbit, rendered in the hero section.
// The Moon's orbit radius is driven by real progress: it pulls toward
// perigee as subtasks close. Reads Logic's data (getFullGoalData, from
// script.js) — this file has no state of its own.

import * as THREE from "./three.module.js";

const APOGEE_RADIUS = 6.4;
const PERIGEE_RADIUS = 3.0;

const canvas = document.getElementById("orbitCanvas");
const hero = document.querySelector(".hero");

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 2.6, 9.5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

function resize() {
  const w = hero.clientWidth;
  const h = hero.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ── Point-cloud sphere builder ─────────────────────────────────────
// Fibonacci sphere sampling gives an even spread of points with no
// pole-crowding, which is what a real photogrammetry scan looks like.
function pointCloudSphere(count, radius, colorFn) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const tmp = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;

    // Slight radial jitter so it reads as a scan, not a perfect shell.
    const jitter = radius * (0.985 + Math.random() * 0.03);
    positions[i * 3] = x * jitter;
    positions[i * 3 + 1] = y * jitter;
    positions[i * 3 + 2] = z * jitter;

    colorFn(tmp, x, y, z);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// ── Earth: colors sampled from a real equirectangular photo ────────
// Loads the image, draws it to an offscreen canvas, and reads back pixel
// data so any (x,y,z) on the sphere can look up its true surface color.
function loadEquirectangular(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, img.width, img.height);
      resolve({ data, width: img.width, height: img.height });
    };
    img.onerror = reject;
    img.src = url;
  });
}

const earthTex = await loadEquirectangular("equirectangular.jpg");

function sampleEarthTexture(x, y, z) {
  // (x,y,z) is a point on the unit sphere -> latitude/longitude -> image UV.
  const lat = Math.asin(y);
  const lon = Math.atan2(z, x);
  const u = 0.5 + lon / (Math.PI * 2);
  const v = 0.5 - lat / Math.PI;
  const px = Math.min(earthTex.width - 1, Math.max(0, Math.floor(u * earthTex.width)));
  const py = Math.min(earthTex.height - 1, Math.max(0, Math.floor(v * earthTex.height)));
  const idx = (py * earthTex.width + px) * 4;
  return [earthTex.data[idx] / 255, earthTex.data[idx + 1] / 255, earthTex.data[idx + 2] / 255];
}

// Push sampled colors away from mid-grey so land/ocean/cloud read as
// distinct at point-cloud scale, instead of collapsing into one speckle.
const CONTRAST = 1.5;
function stretch(v) {
  return Math.min(1, Math.max(0, 0.5 + (v - 0.5) * CONTRAST));
}

function earthColor(out, x, y, z) {
  const [r, g, b] = sampleEarthTexture(x, y, z);
  const t = 0.85 + Math.random() * 0.15; // slight per-point jitter, keeps the scan texture
  out.setRGB(stretch(r) * t, stretch(g) * t, stretch(b) * t);
}

function moonColor(out) {
  const t = 0.7 + Math.random() * 0.3;
  out.setRGB(0.66 * t, 0.6 * t, 0.55 * t); // taupe/stone, like the reference's markers
}

const earthGeo = pointCloudSphere(32000, 1.6, earthColor);
const earthPoints = new THREE.Points(
  earthGeo,
  new THREE.PointsMaterial({
    size: 0.045,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    // Additive blending was tried for glow, but it sums overlapping/adjacent
    // point colors toward grey-white and erased the continent contrast --
    // normal blending keeps each point's true sampled color legible.
  }),
);
scene.add(earthPoints);

const moonGroup = new THREE.Group();
const moonGeo = pointCloudSphere(1800, 0.42, moonColor);
const moonPoints = new THREE.Points(
  moonGeo,
  new THREE.PointsMaterial({ size: 0.02, vertexColors: true, transparent: true, opacity: 0.95 }),
);
moonGroup.add(moonPoints);
scene.add(moonGroup);

// A faint orbit ring, drawn as points rather than a solid line to stay
// in the point-cloud language.
const ringGeo = new THREE.BufferGeometry();
const RING_SEGMENTS = 240;
function buildRing(radius) {
  const pos = new Float32Array(RING_SEGMENTS * 3);
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * radius;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = Math.sin(a) * radius;
  }
  ringGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
}
buildRing(APOGEE_RADIUS);
const ringPoints = new THREE.Points(
  ringGeo,
  new THREE.PointsMaterial({ color: "#c9b8b3", size: 0.02, transparent: true, opacity: 0.22 }),
);
scene.add(ringPoints);

// ── Starfield ────────────────────────────────────────────────────
const STAR_COUNT = 1400;
const starPos = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  const r = 22 + Math.random() * 30;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(Math.random() * 2 - 1);
  starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPos[i * 3 + 1] = r * Math.cos(phi);
  starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(
  starGeo,
  new THREE.PointsMaterial({ color: "#f1e7dd", size: 0.03, transparent: true, opacity: 0.5 }),
);
scene.add(stars);

// ── Progress -> perigee ──────────────────────────────────────────
function readGoalData() {
  try {
    return window.getFullGoalData ? window.getFullGoalData() : null;
  } catch (e) {
    return null;
  }
}

const STATUS_MARK = { completed: "✓", given_up: "✕", active: "·" };

const heroGoal = document.getElementById("heroGoal");
const heroSubtasks = document.getElementById("heroSubtasks");
const heroCoords = document.getElementById("heroCoords");
let orbitRadius = APOGEE_RADIUS;

function updateReadout() {
  const data = readGoalData();
  const subtasks = data && data.subtasks ? data.subtasks : [];
  const total = subtasks.length;
  const completed = subtasks.filter((t) => t.status === "completed").length;
  const ratio = total ? completed / total : 0;
  orbitRadius = APOGEE_RADIUS - (APOGEE_RADIUS - PERIGEE_RADIUS) * ratio;

  if (!total) {
    heroGoal.textContent = "— log a day to begin —";
    heroSubtasks.innerHTML = "";
    heroCoords.textContent = "";
    return;
  }

  heroGoal.textContent = data.goalName || "Untitled goal";
  heroSubtasks.innerHTML = subtasks
    .map((t) => `<li class="status-${t.status}"><span class="mark">${STATUS_MARK[t.status] || "·"}</span> ${t.taskName}</li>`)
    .join("");
  heroCoords.textContent = `${String(completed).padStart(3, "0")} / ${String(total).padStart(3, "0")} CLOSED  ·  R = ${orbitRadius.toFixed(2)}`;
}
updateReadout();
setInterval(updateReadout, 1000);

// ── Animate ──────────────────────────────────────────────────────
let angle = 0;
function tick() {
  angle += 0.0035;
  moonGroup.position.set(
    Math.cos(angle) * orbitRadius,
    Math.sin(angle * 0.6) * 0.4,
    Math.sin(angle) * orbitRadius,
  );
  earthPoints.rotation.y += 0.0009;
  moonPoints.rotation.y += 0.0015;
  stars.rotation.y += 0.00005;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
