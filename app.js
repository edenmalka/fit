// Fit – milestone 1
// Flow: load .glb → rotate (optional) → scale to real cm → put bottom on floor (min Y = 0),
// center in X/Z → export a new .glb → show it in <model-viewer> and offer it for download.
// glTF units are meters, Y is up. Width = X, height = Y, depth = Z.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const $ = (id) => document.getElementById(id);
const mv = $('mv');

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/libs/draco/gltf/');
loader.setDRACOLoader(draco);
loader.setMeshoptDecoder(MeshoptDecoder);
const exporter = new GLTFExporter();

// Bump ?v= whenever assets/demo-sofa.glb changes, so phones don't show a cached old copy.
const DEMO = { url: 'assets/demo-sofa.glb?v=2', name: 'ספת דוגמה', file: 'demo-sofa', w: 200, d: 90, h: 85 };

const state = {
  source: null,     // original loaded scene (never modified)
  baseName: 'model',
  label: '',
  quarterTurns: 0,  // rotation around the vertical axis, in 90° steps
  blobUrl: null,
  blob: null,
  lastSize: null,   // final size in cm {w, d, h, minY}
};

const cm = (m) => Math.round(m * 1000) / 10; // meters → cm, 1 decimal

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}
function setLoading(on) { $('loading').hidden = !on; }

function readDims() {
  const v = (id) => parseFloat($(id).value);
  return { w: v('w'), d: v('d'), h: v('h') };
}
function mode() { return document.querySelector('input[name="mode"]:checked').value; }

/** Exact axis-aligned box of an object, from every vertex. */
function measure(obj) {
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj, true);
}

/** Builds the scaled, floored, centered copy. Returns { root, size, minY } (meters). */
function buildScaled() {
  const { w, d, h } = readDims();
  const model = state.source.clone(true);

  const turn = new THREE.Group();   // rotation
  turn.name = 'rotate';
  turn.add(model);
  turn.rotation.y = state.quarterTurns * Math.PI / 2;

  const scaler = new THREE.Group(); // scale
  scaler.name = 'scale';
  scaler.add(turn);

  const root = new THREE.Group();   // position (floor + center)
  root.name = state.baseName;
  root.add(scaler);

  const raw = measure(root).getSize(new THREE.Vector3());
  if (!(raw.x > 0 && raw.y > 0 && raw.z > 0)) throw new Error('flat model');

  if (mode() === 'stretch') {
    // Option A: each axis on its own → exact W × D × H.
    scaler.scale.set((w / 100) / raw.x, (h / 100) / raw.y, (d / 100) / raw.z);
  } else {
    // Option B: one factor for all axes, chosen so the width matches.
    const s = (w / 100) / raw.x;
    scaler.scale.set(s, s, s);
  }

  // Bottom on the floor (min Y = 0), centered horizontally.
  const box = measure(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.set(-c.x, -box.min.y, -c.z);

  const finalBox = measure(root);
  return { root, size: finalBox.getSize(new THREE.Vector3()), minY: finalBox.min.y };
}

function showSize({ w, d, h }) {
  const chip = $('sizeChip');
  chip.innerHTML = '';
  const nums = document.createElement('bdi');
  nums.dir = 'ltr';
  nums.textContent = `${w} × ${d} × ${h}`;
  chip.append(nums, ' ס״מ');
  chip.title = 'רוחב × עומק × גובה';
  chip.hidden = false;
}

let busy = false, again = false;
async function rebuild() {
  if (!state.source) return;
  if (busy) { again = true; return; }
  const { w, d, h } = readDims();
  const needed = mode() === 'stretch' ? [w, d, h] : [w];
  if (needed.some((n) => !(n > 0))) { setStatus('נא להזין מידות גדולות מ־0', true); return; }

  busy = true;
  setLoading(true);
  try {
    const { root, size, minY } = buildScaled();
    const glb = await exporter.parseAsync(root, { binary: true });
    const blob = new Blob([glb], { type: 'model/gltf-binary' });

    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
    state.blob = blob;
    state.blobUrl = URL.createObjectURL(blob);
    state.lastSize = { w: cm(size.x), d: cm(size.z), h: cm(size.y), minY };
    mv.src = state.blobUrl;

    if (mode() === 'fit') { $('d').value = cm(size.z); $('h').value = cm(size.y); }
    showSize(state.lastSize);
    $('download').disabled = false;
    $('arBtn').disabled = false;
    setStatus('');
  } catch (err) {
    console.error(err);
    setLoading(false);
    setStatus('לא הצלחנו לעבד את הדגם. נסו קובץ אחר.', true);
  } finally {
    busy = false;
    if (again) { again = false; rebuild(); }
  }
}

let timer;
function rebuildSoon() { clearTimeout(timer); timer = setTimeout(rebuild, 350); }

async function loadArrayBuffer(buffer, { baseName, label }) {
  setLoading(true);
  $('empty').hidden = true;
  try {
    const gltf = await loader.parseAsync(buffer, '');
    state.source = gltf.scene;
    state.baseName = baseName || 'model';
    state.label = label;
    state.quarterTurns = 0;
    $('nameChip').textContent = label;
    $('nameChip').hidden = false;
    await rebuild();
  } catch (err) {
    console.error(err);
    setLoading(false);
    if (!state.source) $('empty').hidden = false;
    setStatus('הקובץ לא נפתח. ודאו שזה קובץ GLB תקין.', true);
  }
}

async function loadDemo() {
  $('w').value = DEMO.w; $('d').value = DEMO.d; $('h').value = DEMO.h;
  const res = await fetch(DEMO.url);
  await loadArrayBuffer(await res.arrayBuffer(), { baseName: DEMO.file, label: DEMO.name });
}

// ---- UI wiring ----
$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const baseName = file.name.replace(/\.glb$/i, '');
  await loadArrayBuffer(await file.arrayBuffer(), { baseName, label: file.name });
  e.target.value = '';
});

$('demo').addEventListener('click', loadDemo);

for (const id of ['w', 'd', 'h']) $(id).addEventListener('input', rebuildSoon);

document.querySelectorAll('input[name="mode"]').forEach((r) =>
  r.addEventListener('change', () => {
    const fit = mode() === 'fit';
    $('d').disabled = fit; $('h').disabled = fit;
    $('modeHint').textContent = fit
      ? 'הדגם נשמר בפרופורציות שלו ומותאם לפי הרוחב'
      : 'כל ציר מותאם בדיוק למידה שהזנתם';
    rebuild();
  }));

$('rotate').addEventListener('click', () => {
  state.quarterTurns = (state.quarterTurns + 1) % 4;
  rebuild();
});

$('download').addEventListener('click', () => {
  if (!state.blob) return;
  const { w, d, h } = state.lastSize;
  const a = document.createElement('a');
  a.href = state.blobUrl;
  a.download = `${state.baseName}-${w}x${d}x${h}cm.glb`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

$('arBtn').addEventListener('click', () => {
  if (mv.canActivateAR) {
    mv.activateAR();
  } else {
    $('arHint').hidden = false;
  }
});

mv.addEventListener('load', () => setLoading(false));
mv.addEventListener('error', () => {
  setLoading(false);
  setStatus('התצוגה לא נטענה. נסו לרענן את העמוד.', true);
});

// Show the demo sofa right away so the preview is never empty.
loadDemo().catch(() => { $('empty').hidden = false; setLoading(false); });

// For checking in the browser console: window.fit.state.lastSize
window.fit = { state, rebuild, loadArrayBuffer };
