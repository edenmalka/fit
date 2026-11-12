// Scaling engine shared by the store side.
// Load a GLB → rotate (90° steps) → scale to real cm → bottom on the floor (min Y = 0),
// centered in X/Z → export a new GLB. glTF units are meters, Y is up.
// Width = X, height = Y, depth = Z.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/libs/draco/gltf/');
loader.setDRACOLoader(draco);
loader.setMeshoptDecoder(MeshoptDecoder);
const exporter = new GLTFExporter();

export const cm = (m) => Math.round(m * 1000) / 10; // meters → cm, 1 decimal

/** Parses GLB bytes. Returns the scene (never modified afterwards). */
export async function parseGlb(buffer) {
  const gltf = await loader.parseAsync(buffer, '');
  return gltf.scene;
}

function measure(obj) {
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj, true);
}

/**
 * Builds a scaled copy and exports it.
 * dims: {w, d, h} in cm. mode: 'stretch' (exact W×D×H) or 'fit' (keep proportions, match width).
 * Returns { blob, size: {w, d, h} in cm, minY }.
 */
export async function scaleToGlb(source, { w, d, h }, mode, quarterTurns, name = 'model') {
  const model = source.clone(true);

  const turn = new THREE.Group();
  turn.name = 'rotate';
  turn.add(model);
  turn.rotation.y = quarterTurns * Math.PI / 2;

  const scaler = new THREE.Group();
  scaler.name = 'scale';
  scaler.add(turn);

  const root = new THREE.Group();
  root.name = name;
  root.add(scaler);

  const raw = measure(root).getSize(new THREE.Vector3());
  if (!(raw.x > 0 && raw.y > 0 && raw.z > 0)) throw new Error('flat model');

  if (mode === 'stretch') {
    scaler.scale.set((w / 100) / raw.x, (h / 100) / raw.y, (d / 100) / raw.z);
  } else {
    const s = (w / 100) / raw.x;
    scaler.scale.set(s, s, s);
  }

  const box = measure(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.set(-c.x, -box.min.y, -c.z);

  const finalBox = measure(root);
  const size = finalBox.getSize(new THREE.Vector3());
  const glb = await exporter.parseAsync(root, { binary: true });
  return {
    blob: new Blob([glb], { type: 'model/gltf-binary' }),
    size: { w: cm(size.x), d: cm(size.z), h: cm(size.y) },
    minY: finalBox.min.y,
  };
}
