/**
 * Retracts the stiff LeftHand-weighted cloth strip ("bandage") that sticks
 * straight out in the strum pose. Edits POSITION in-place for every Punaab GLB.
 */
import { readFileSync, writeFileSync } from "fs";

const FILES = [
  "public/assets/models/punaab-idle.glb",
  "public/assets/models/punaab-walk.glb",
  "public/assets/models/punaab-run.glb",
  "public/assets/models/punaab-strum-idle.glb",
];

function loadGlb(path) {
  const buf = readFileSync(path);
  if (buf.toString("utf8", 0, 4) !== "glTF") throw new Error(`not glb: ${path}`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  const binChunkStart = 20 + jsonLen;
  const binChunkLength = buf.readUInt32LE(binChunkStart);
  const binStart = binChunkStart + 8;
  const bin = Buffer.from(buf.subarray(binStart, binStart + binChunkLength));
  return { buf, json, jsonLen, binChunkStart, binChunkLength, bin, binStart };
}

function getAcc(json, bin, acc, comps, Type) {
  const view = json.bufferViews[acc.bufferView];
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  return new Type(bin.buffer, bin.byteOffset + start, acc.count * comps);
}

function fixFile(path) {
  const { buf, json, jsonLen, binChunkStart, binChunkLength, bin, binStart } =
    loadGlb(path);
  const prim = json.meshes[0].primitives[0];
  const jointNames = json.skins[0].joints.map((i) => json.nodes[i].name);
  const leftHand = jointNames.indexOf("LeftHand");
  if (leftHand < 0) throw new Error(`LeftHand missing in ${path}`);

  const posAcc = json.accessors[prim.attributes.POSITION];
  const jAcc = json.accessors[prim.attributes.JOINTS_0];
  const wAcc = json.accessors[prim.attributes.WEIGHTS_0];
  const pos = getAcc(json, bin, posAcc, 3, Float32Array);
  const joints =
    jAcc.componentType === 5121
      ? getAcc(json, bin, jAcc, 4, Uint8Array)
      : getAcc(json, bin, jAcc, 4, Uint16Array);
  const weights = getAcc(json, bin, wAcc, 4, Float32Array);

  // Palm cluster: LeftHand-dominated verts close to the densest hand mass.
  const handVerts = [];
  for (let i = 0; i < posAcc.count; i++) {
    let handW = 0;
    for (let k = 0; k < 4; k++) {
      if (joints[i * 4 + k] === leftHand) handW += weights[i * 4 + k];
    }
    if (handW < 0.85) continue;
    handVerts.push(i);
  }

  // Median of the compact palm (ignore the far flap when computing the target).
  const pts = handVerts.map((i) => [
    pos[i * 3],
    pos[i * 3 + 1],
    pos[i * 3 + 2],
  ]);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;

  // Retract verts that stick forward/out from the palm (the stiff bandage tip).
  let moved = 0;
  for (const i of handVerts) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    const dist = Math.hypot(dx, dy, dz);
    // Flap tips sit forward of the palm and farther than finger bulk.
    if (dist < 0.07) continue;
    if (z < cz + 0.02 && dist < 0.11) continue;

    // Pull hard toward the palm so the strip no longer sticks out when posed.
    const t = dist > 0.12 ? 0.92 : 0.75;
    pos[i * 3] = x + (cx - x) * t;
    pos[i * 3 + 1] = y + (cy - y) * t;
    pos[i * 3 + 2] = z + (cz - z) * t;
    moved += 1;
  }

  // Recompute POSITION min/max for the accessor.
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < posAcc.count; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  posAcc.min = [minX, minY, minZ];
  posAcc.max = [maxX, maxY, maxZ];

  const jsonText = JSON.stringify(json);
  // Pad JSON chunk to 4-byte alignment with spaces.
  const jsonPad = (4 - (jsonText.length % 4)) % 4;
  const jsonBytes = Buffer.from(jsonText + " ".repeat(jsonPad), "utf8");

  const binPad = (4 - (bin.length % 4)) % 4;
  const binPadded = Buffer.concat([bin, Buffer.alloc(binPad)]);

  const out = Buffer.alloc(12 + 8 + jsonBytes.length + 8 + binPadded.length);
  out.write("glTF", 0, "ascii");
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonBytes.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // JSON
  jsonBytes.copy(out, 20);
  const binHeader = 20 + jsonBytes.length;
  out.writeUInt32LE(binPadded.length, binHeader);
  out.writeUInt32LE(0x004e4942, binHeader + 4); // BIN
  binPadded.copy(out, binHeader + 8);

  writeFileSync(path, out);
  console.log(`${path}: retracted ${moved} hand-flap verts (of ${handVerts.length} hand verts)`);
}

for (const file of FILES) fixFile(file);
