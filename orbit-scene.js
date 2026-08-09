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

// Two camera positions: the normal low, close-in angle, and a bird's-eye
// pull-back that reads the orbit ring as a clear loop instead of edge-on.
// window.setHeroOverview() (called from toggleHeroDrawer(), script.js)
// switches the target the camera eases toward each frame.
const CAMERA_NORMAL = new THREE.Vector3(0, 2.6, 9.5);
const CAMERA_OVERVIEW = new THREE.Vector3(0, 10.5, 4.2);
const cameraTarget = CAMERA_NORMAL.clone();

// Same size, just shifted -- the panel opens over the left side of the
// scene, so in overview the camera looks at a point left of true centre,
// which pushes the whole rendered Earth+track to the right on screen,
// clear of the panel, without shrinking anything.
const LOOK_NORMAL = new THREE.Vector3(0, 0, 0);
const LOOK_OVERVIEW = new THREE.Vector3(-2.6, 0, 0);
const lookTarget = LOOK_NORMAL.clone();
let overviewOn = false;

camera.position.copy(CAMERA_NORMAL);
camera.lookAt(LOOK_NORMAL);

window.setHeroOverview = function (on) {
  overviewOn = on;
  cameraTarget.copy(on ? CAMERA_OVERVIEW : CAMERA_NORMAL);
  trackPoints.visible = on;
  stepMarkers.visible = on;
};

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

const earthTex = await loadEquirectangular("assets/equirectangular.jpg");

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
  const t = 0.8 + Math.random() * 0.2;
  out.setRGB(0.74 * t, 0.56 * t, 0.95 * t); // bright lavender
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
const moonGeo = pointCloudSphere(4500, 0.42, moonColor);
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

// The overview freeze's stop point isn't wherever the ambient spin
// happens to be -- it's a fixed position along a fixed arc, divided into
// as many steps as there are subtasks. Zero completed sits at the start
// of the arc; each completion moves one step toward the end. Adding or
// removing subtasks just redivides the same arc, so the step size
// changes but the arc itself doesn't.
// Swept across the far half of the circle (angle in [π, 2π], sin(angle)
// <= 0) so the moon's Z stays behind the origin from the overview
// camera's point of view -- the other half pushes Z past the camera's
// own position and off the edge of the frustum, invisible.
const FROZEN_START_ANGLE = Math.PI;
const FROZEN_SWEEP = Math.PI;

// ── Overview track — the arc the frozen moon actually stands on,
// divided into one step per subtask. A dense trail traces the curve
// (radius shrinks with angle here, same as the moon's own position, so
// it's a spiral, not a flat circle); bright markers sit at each step so
// the division itself reads clearly, not just the path. Both only show
// up in overview -- see window.setHeroOverview() below. ────────────────
function radiusForFrac(frac) {
  return APOGEE_RADIUS - (APOGEE_RADIUS - PERIGEE_RADIUS) * frac;
}

const trackGeo = new THREE.BufferGeometry();
const trackPoints = new THREE.Points(
  trackGeo,
  new THREE.PointsMaterial({ color: "#8fb8b0", size: 0.045, transparent: true, opacity: 0.75 }),
);
trackPoints.visible = false;
scene.add(trackPoints);

const stepGeo = new THREE.BufferGeometry();
const stepMarkers = new THREE.Points(
  stepGeo,
  new THREE.PointsMaterial({ color: "#f1e7dd", size: 0.11, transparent: true, opacity: 0.95 }),
);
stepMarkers.visible = false;
scene.add(stepMarkers);

const TRACK_TRAIL_SEGMENTS = 160;
function buildOverviewTrack(total) {
  if (!total) {
    trackGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    stepGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    return;
  }

  const trail = new Float32Array(TRACK_TRAIL_SEGMENTS * 3);
  for (let i = 0; i < TRACK_TRAIL_SEGMENTS; i++) {
    const frac = i / (TRACK_TRAIL_SEGMENTS - 1);
    const a = FROZEN_START_ANGLE + frac * FROZEN_SWEEP;
    const r = radiusForFrac(frac);
    trail[i * 3] = Math.cos(a) * r;
    trail[i * 3 + 1] = 0;
    trail[i * 3 + 2] = Math.sin(a) * r;
  }
  trackGeo.setAttribute("position", new THREE.BufferAttribute(trail, 3));

  const steps = new Float32Array((total + 1) * 3);
  for (let k = 0; k <= total; k++) {
    const frac = k / total;
    const a = FROZEN_START_ANGLE + frac * FROZEN_SWEEP;
    const r = radiusForFrac(frac);
    steps[k * 3] = Math.cos(a) * r;
    steps[k * 3 + 1] = 0;
    steps[k * 3 + 2] = Math.sin(a) * r;
  }
  stepGeo.setAttribute("position", new THREE.BufferAttribute(steps, 3));
}

// ── Starfield ────────────────────────────────────────────────────
const STAR_COUNT = 420;
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


const heroGoal = document.getElementById("heroGoal");
const heroSubtasks = document.getElementById("heroSubtasks");
const heroCoords = document.getElementById("heroCoords");
let orbitRadius = APOGEE_RADIUS;

// The overview freeze reads its angle off these instead of the
// free-running clock -- see tick() below.
let progressCompleted = 0;
let progressTotal = 0;

function updateReadout() {
  const data = readGoalData();
  const subtasks = data && data.subtasks ? data.subtasks : [];
  const total = subtasks.length;
  const completed = subtasks.filter((t) => t.status === "completed").length;
  const ratio = total ? completed / total : 0;
  orbitRadius = APOGEE_RADIUS - (APOGEE_RADIUS - PERIGEE_RADIUS) * ratio;
  progressCompleted = completed;
  progressTotal = total;
  buildOverviewTrack(total);

  if (!total) {
    heroGoal.textContent = "log a day to begin";
    heroSubtasks.innerHTML = "";
    heroCoords.textContent = "";
    return;
  }

  heroGoal.textContent = data.goalName || "Untitled goal";
  heroSubtasks.innerHTML = subtasks
    .map((t) => `<li class="status-${t.status}">${t.taskName}</li>`)
    .join("");
  heroCoords.textContent = `${String(completed).padStart(3, "0")} / ${String(total).padStart(3, "0")} CLOSED  ·  R = ${orbitRadius.toFixed(2)}`;
}
updateReadout();
setInterval(updateReadout, 1000);

function frozenAngle() {
  const frac = progressTotal ? progressCompleted / progressTotal : 0;
  return FROZEN_START_ANGLE + frac * FROZEN_SWEEP;
}

// ── Animate ──────────────────────────────────────────────────────
let angle = 0;
function tick() {
  // Overview mode (panel open) freezes both planets in place -- the
  // point is to read the current orbit position clearly, not watch it
  // keep moving. The starfield keeps drifting; it's just ambience.
  if (!overviewOn) {
    angle += 0.0035;
    moonGroup.position.set(
      Math.cos(angle) * orbitRadius,
      Math.sin(angle * 0.6) * 0.4,
      Math.sin(angle) * orbitRadius,
    );
    earthPoints.rotation.y += 0.0009;
    moonPoints.rotation.y += 0.0015;
  } else {
    const a = frozenAngle();
    moonGroup.position.set(Math.cos(a) * orbitRadius, 0, Math.sin(a) * orbitRadius);
  }
  stars.rotation.y += 0.00065;
  stars.rotation.x += 0.00018;

  camera.position.lerp(cameraTarget, 0.05);
  lookTarget.lerp(overviewOn ? LOOK_OVERVIEW : LOOK_NORMAL, 0.05);
  camera.lookAt(lookTarget);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// ── Player moon — a second, independent scene for the full-screen
// listening view. script.js isn't a module, so it reaches this through
// window.start/stopPlayerMoon rather than an import. ──────────────────
let playerMoon = null;

function startPlayerMoon(canvasEl) {
  stopPlayerMoon();

  const scene2 = new THREE.Scene();
  const camera2 = new THREE.PerspectiveCamera(38, 1, 0.1, 10);
  camera2.position.set(0, 0, 3.3);
  camera2.lookAt(0, 0, 0);

  const renderer2 = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer2.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const group = new THREE.Group();
  const geo = pointCloudSphere(3200, 1, moonColor);
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.95 }),
  );
  group.add(points);
  scene2.add(group);

  function resize2() {
    const w = canvasEl.clientWidth;
    const h = canvasEl.clientHeight;
    if (!w || !h) return;
    renderer2.setSize(w, h, false);
    camera2.aspect = w / h;
    camera2.updateProjectionMatrix();
  }
  resize2();
  const ro = new ResizeObserver(resize2);
  ro.observe(canvasEl);

  let raf = null;
  function tick2() {
    group.rotation.y += 0.006;
    renderer2.render(scene2, camera2);
    raf = requestAnimationFrame(tick2);
  }
  tick2();

  playerMoon = { renderer: renderer2, ro, cancel: () => cancelAnimationFrame(raf) };
}

function stopPlayerMoon() {
  if (!playerMoon) return;
  playerMoon.cancel();
  playerMoon.ro.disconnect();
  playerMoon.renderer.dispose();
  playerMoon = null;
}

window.startPlayerMoon = startPlayerMoon;
window.stopPlayerMoon = stopPlayerMoon;
