// ---------------------------------------------------------------------------
// Procedural tree skeletons (recursive branching along noisy curves) and bark
// tube meshing. Species generators return:
//   { branches: [{pts, rads, pd, level}], leaves|clusters|pads, env }
// pd = path distance from the root (metres) per point -> wind flex.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const TAU = Math.PI * 2;
const GOLD = 2.39996323;

// ------------------------------------------------------------ small helpers
export function randUnit(rng) { const s = rng.sphere(); return V3(s[0], s[1], s[2]); }
export function perpOf(T) {
  const a = Math.abs(T.y) < 0.9 ? UP : V3(1, 0, 0);
  return V3().crossVectors(T, a).normalize();
}
function lerpV(a, b, t) { return a.clone().lerp(b, t); }

// hash based 3D value noise (CPU) for trunk displacement
function h3(x, y, z, s) {
  let n = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function vnoise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h3(xi, yi, zi, s), h3(xi + 1, yi, zi, s), u), l(h3(xi, yi + 1, zi, s), h3(xi + 1, yi + 1, zi, s), u), v),
    l(l(h3(xi, yi, zi + 1, s), h3(xi + 1, yi, zi + 1, s), u), l(h3(xi, yi + 1, zi + 1, s), h3(xi + 1, yi + 1, zi + 1, s), u), v),
    w
  );
}

// point / tangent / radius at parameter t (0..1) along a polyline
export function sampleBranch(br, t) {
  const n = br.pts.length - 1;
  const f = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const p = lerpV(br.pts[i], br.pts[i + 1], u);
  const T = br.pts[i + 1].clone().sub(br.pts[i]).normalize();
  const r = br.rads[i] + (br.rads[i + 1] - br.rads[i]) * u;
  const pd = br.pd[i] + (br.pd[i + 1] - br.pd[i]) * u;
  return { p, T, r, pd };
}

// ellipsoid envelope: max distance along dir from pos staying inside
export function fitInEnvelope(pos, dir, len, env) {
  if (!env) return len;
  const q = V3((pos.x - env.c.x) / env.r.x, (pos.y - env.c.y) / env.r.y, (pos.z - env.c.z) / env.r.z);
  const d = V3(dir.x / env.r.x, dir.y / env.r.y, dir.z / env.r.z);
  const a = d.dot(d), b = q.dot(d), c = q.dot(q) - 1;
  if (c > 0) return len * 0.35;
  const disc = b * b - a * c;
  const s = (-b + Math.sqrt(Math.max(disc, 0))) / a;
  return Math.min(len, Math.max(s, len * 0.3));
}
export function envRho(p, env) {
  return Math.sqrt(((p.x - env.c.x) / env.r.x) ** 2 + ((p.y - env.c.y) / env.r.y) ** 2 + ((p.z - env.c.z) / env.r.z) ** 2);
}
export function envNormal(p, env) {
  return V3((p.x - env.c.x) / (env.r.x * env.r.x), (p.y - env.c.y) / (env.r.y * env.r.y), (p.z - env.c.z) / (env.r.z * env.r.z)).normalize();
}

// Grow one branch along a smoothly wandering curve.
// P: seg, wobble, curlDecay, up, droop (grows with t), flatten, taper, kink, outward(vec3 horiz), outPush
export function growCurve(rng, start, dir, length, r0, r1, P = {}) {
  const seg = P.seg || 0.25;
  const n = Math.max(2, Math.ceil(length / seg));
  const ds = length / n;
  const pts = [start.clone()], rads = [r0];
  const d = dir.clone().normalize();
  const curl = V3();
  const p = start.clone();
  const decay = P.curlDecay ?? 0.72;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    curl.multiplyScalar(decay).add(randUnit(rng).multiplyScalar(P.wobble ?? 0.5));
    curl.addScaledVector(d, -curl.dot(d));
    d.addScaledVector(curl, ds);
    d.y += ((P.up || 0) - (P.droop || 0) * Math.pow(t, P.droopPow || 1)) * ds;
    if (P.flatten) d.y *= Math.max(0, 1 - P.flatten * ds);
    if (P.outward && P.outPush) {
      const o = P.outward;
      d.x += o.x * P.outPush * ds; d.z += o.z * P.outPush * ds;
    }
    if (P.kink && rng.chance(P.kink * ds)) {
      const a = rng.range(-0.55, 0.55);
      d.applyAxisAngle(UP, a);
    }
    if (P.minY !== undefined && d.y < P.minY) d.y = P.minY;
    if (P.maxY !== undefined && d.y > P.maxY) d.y = P.maxY;
    d.normalize();
    p.addScaledVector(d, ds);
    pts.push(p.clone());
    rads.push(r1 + (r0 - r1) * Math.pow(1 - t, P.taper ?? 1.0));
    // stay inside the crown envelope: stop growing once outside (keep >= 2 points)
    if (P.env && i >= 1 && envRho(p, P.env) > (P.envMax || 1.0)) {
      rads[rads.length - 1] = Math.min(rads[rads.length - 1], r1 + (r0 - r1) * 0.25);
      break;
    }
  }
  return { pts, rads };
}

export function makeBranch(curve, level, pd0 = 0, extra = {}) {
  const pd = [pd0];
  for (let i = 1; i < curve.pts.length; i++) pd.push(pd[i - 1] + curve.pts[i].distanceTo(curve.pts[i - 1]));
  return { pts: curve.pts, rads: curve.rads, pd, level, ...extra };
}

// direction rotated away from T by `angle`, around azimuth `az`
export function spreadDir(T, angle, az, ref = null) {
  const N = ref ? V3().crossVectors(T, ref).normalize() : perpOf(T);
  if (N.lengthSq() < 1e-6) N.copy(perpOf(T));
  const B = V3().crossVectors(T, N).normalize();
  const side = N.multiplyScalar(Math.cos(az)).addScaledVector(B, Math.sin(az));
  return T.clone().multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle)).normalize();
}

// ===========================================================================
// Bark tube meshing into an accumulator
// ===========================================================================
export class BarkAccum {
  constructor() { this.pos = []; this.nrm = []; this.a = []; this.b = []; this.idx = []; this.vc = 0; }
  // br: branch; opts: { flexOf(pd)->flex, seed, cellW, disp(theta, s, r, br)->mul, radialOverride }
  addBranch(br, opts) {
    const pts = br.pts, rads = br.rads, n = pts.length;
    if (n < 2) return;
    const r0 = rads[0];
    let S = opts.radial ? opts.radial(r0) : Math.round(4 + r0 * 55);
    S = Math.max(3, Math.min(22, S));
    const cellW = opts.cellW || 0.07;
    const k = Math.max(2, Math.round((TAU * Math.max(r0, 0.004)) / cellW));
    const cw = (TAU * Math.max(r0, 0.004)) / k;
    const seed = opts.seed || 0;
    // tangents & parallel transport frames
    const T = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
      T.push(b.clone().sub(a).normalize());
    }
    const N = [perpOf(T[0])];
    for (let i = 1; i < n; i++) {
      const v = N[i - 1].clone();
      const ax = V3().crossVectors(T[i - 1], T[i]);
      const s = ax.length();
      if (s > 1e-6) { ax.divideScalar(s); v.applyAxisAngle(ax, Math.atan2(s, T[i - 1].dot(T[i]))); }
      v.addScaledVector(T[i], -v.dot(T[i])).normalize();
      N.push(v);
    }
    // ring positions (grid n x S)
    const grid = new Array(n * S);
    const dirs = new Array(n * S);
    let sAcc = opts.vStart || 0;
    const sArr = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) sAcc += pts[i].distanceTo(pts[i - 1]);
      sArr.push(sAcc);
      const B = V3().crossVectors(T[i], N[i]).normalize();
      for (let j = 0; j < S; j++) {
        const th = (j / S) * TAU;
        const dir = N[i].clone().multiplyScalar(Math.cos(th)).addScaledVector(B, Math.sin(th));
        let r = rads[i];
        if (opts.disp) r *= opts.disp(th, sArr[i], rads[i], br, dir);
        grid[i * S + j] = pts[i].clone().addScaledVector(dir, r);
        dirs[i * S + j] = dir;
      }
    }
    const base = this.vc;
    const tmp1 = V3(), tmp2 = V3(), nn = V3();
    for (let i = 0; i < n; i++) {
      const flex = opts.flexOf ? opts.flexOf(br.pd[i]) : 0;
      for (let j = 0; j <= S; j++) {
        const jj = j % S;
        const P = grid[i * S + jj];
        // normal from grid differences
        const pa = grid[i * S + ((jj + 1) % S)], pb = grid[i * S + ((jj + S - 1) % S)];
        const pc = grid[Math.min(i + 1, n - 1) * S + jj], pdn = grid[Math.max(i - 1, 0) * S + jj];
        tmp1.subVectors(pa, pb);
        tmp2.subVectors(pc, pdn);
        nn.crossVectors(tmp1, tmp2);
        if (nn.lengthSq() < 1e-12 || rads[i] < 1e-5) nn.copy(dirs[i * S + jj]);
        nn.normalize();
        if (nn.dot(dirs[i * S + jj]) < 0) nn.negate();
        // blend with the pure radial direction for stability on very thin twigs
        if (rads[i] < 0.01) nn.lerp(dirs[i * S + jj], 0.5).normalize();
        this.pos.push(P.x, P.y, P.z);
        this.nrm.push(nn.x, nn.y, nn.z);
        this.a.push((j / S) * k, sArr[i], rads[i], flex);
        this.b.push(k, seed, cw);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < S; j++) {
        const a = base + i * (S + 1) + j, b = a + 1, c = a + S + 1, d = c + 1;
        this.idx.push(a, b, c, b, d, c);
      }
    }
    this.vc += n * (S + 1);
  }
  get triCount() { return this.idx.length / 3; }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aBarkA', new THREE.Float32BufferAttribute(this.a, 4));
    g.setAttribute('aBarkB', new THREE.Float32BufferAttribute(this.b, 3));
    g.setIndex(this.vc > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// trunk displacement: gnarled bumps + root flare (periodic in theta)
export function trunkDisp({ seed = 0, bump = 0.08, flare = 0.6, roots = 5, flareH = 0.5, flute = 0.04, fluteN = 7 }) {
  return (th, s, r, br, dir) => {
    const c = Math.cos(th), sn = Math.sin(th);
    let m = 1 + bump * (vnoise3(c * 1.7 + seed, sn * 1.7, s * 1.3, seed) - 0.5) * 2
      + bump * 0.5 * (vnoise3(c * 4.0, sn * 4.0 + seed, s * 4.0, seed + 1) - 0.5) * 2;
    m += flute * Math.sin(th * fluteN + s * 0.7 + seed);
    if (flare > 0 && br.level === 0) {
      const f = Math.exp(-s / flareH);
      const lobe = Math.pow(0.5 + 0.5 * Math.cos(th * roots + seed * 3.1 + vnoise3(c, sn, 0, seed) * 2), 2.0);
      m += flare * f * (0.35 + 0.9 * lobe);
    }
    return m;
  };
}

// ===========================================================================
// Species: Japanese maple (momiji) — broad layered dome, sinuous leaders
// ===========================================================================
// opts: { h, base:Vector3, lean:Vector3 (horiz offset of crown centre), spread, detail(0..1), red:boolean }
export function genMaple(rng, o) {
  const h = o.h, base = o.base;
  const spread = (o.spread || 0.62) * h;
  const lean = o.lean || V3();
  const env = { c: V3(base.x + lean.x, base.y + h * 0.58, base.z + lean.z), r: V3(spread * (o.sx || 1), h * 0.43, spread * (o.sz || 1)) };
  if (o.envR) env.r.copy(o.envR);
  const branches = [], twigs = [];
  const det = o.detail ?? 1;
  const rT = 0.02 * h + 0.04;
  const ctx = { env, det, h, maxL3: 0.7 + 0.1 * h };
  // trunk: short, gently leaning toward the crown centre
  const trunkLen = h * rng.range(0.17, 0.26);
  const tdir = V3(lean.x * 0.22, trunkLen, lean.z * 0.22).normalize();
  const trunk = makeBranch(growCurve(rng, base.clone().add(V3(0, -0.3, 0)), tdir, trunkLen + 0.3, rT, rT * 0.84, { seg: 0.2, wobble: 0.12, curlDecay: 0.85 }), 0, 0);
  branches.push(trunk);
  const top = trunk.pts[trunk.pts.length - 1];
  const nLead = o.leaders || rng.int(2, 4);
  const az0 = rng.range(0, TAU);
  for (let li = 0; li < nLead; li++) {
    const az = az0 + (li / nLead) * TAU + rng.range(-0.35, 0.35);
    const target = V3(env.c.x + Math.cos(az) * env.r.x * rng.range(0.3, 0.55), env.c.y + env.r.y * rng.range(0.5, 0.85), env.c.z + Math.sin(az) * env.r.z * rng.range(0.3, 0.55));
    const dir = target.clone().sub(top).normalize();
    const len = top.distanceTo(target) * 1.04;
    const lead = makeBranch(growCurve(rng, top.clone().add(V3(0, -0.15, 0)), dir, len, rT * (nLead > 2 ? 0.66 : 0.76), rT * 0.14, { seg: 0.25, wobble: 0.32, curlDecay: 0.8 }), 1, trunk.pd[trunk.pd.length - 1]);
    branches.push(lead);
    const nLimb = Math.round((3.5 + h * 0.45) * (0.75 + 0.25 * det));
    let laz = az + rng.range(-1, 1);
    for (let k = 0; k < nLimb; k++) {
      const t = 0.08 + ((k + rng.range(0.1, 0.9)) / nLimb) * 0.9;
      const s = sampleBranch(lead, t);
      laz += GOLD + rng.range(-0.3, 0.3);
      const hd = V3(Math.cos(laz), 0, Math.sin(laz));
      const out = V3(s.p.x - env.c.x, 0, s.p.z - env.c.z);
      if (out.lengthSq() > 0.09) hd.addScaledVector(out.normalize(), 0.9).normalize();
      const el = rng.range(0.12, 0.6) + 0.25 * t;
      const d = hd.clone().multiplyScalar(Math.cos(el)).addScaledVector(UP, Math.sin(el));
      const L = fitInEnvelope(s.p, d, 40, env) * rng.range(0.72, 0.9);
      if (L < 0.5) continue;
      const limb = makeBranch(growCurve(rng, s.p, d, L, Math.min(s.r * 0.75, rT * 0.42), 0.012, { seg: 0.22, wobble: 0.22, curlDecay: 0.7, up: 0.06, droop: 0.16, droopPow: 1.5, env, envMax: 0.95 }), 2, s.pd);
      branches.push(limb);
      growMapleSub(rng, limb, ctx, branches, twigs, 3, 0.12);
    }
    growMapleSub(rng, lead, ctx, branches, twigs, 3, 0.55);
  }
  // full, lumpy, layered outer shell of leaf sprays
  const made = shellFill(rng, branches, twigs, env, {
    density: (o.shellDensity ?? 4.2) * (0.6 + 0.4 * det), clump: o.clump ?? 0.4, clumpFreq: 0.5, tiers: o.tiers ?? 1.6,
    depth0: 0.8, depth1: 1.0, minDirY: -0.45, minY: base.y + 1.2, twigR: 0.0038, leafLen: o.leafLen ?? 0.5, minLevel: 2, maxTwig: o.maxTwig, keepOut: o.keepOut,
  });
  return { branches, twigs, env, rT, shellSprays: made };
}

// ---------------------------------------------------------------------------
// Crown shell fill: sample (clumpy) points on the crown envelope and connect
// each one with a fine twig to the nearest existing branch, so the foliage
// forms a full, lumpy outer shell instead of thin plumes along the limbs.
// ---------------------------------------------------------------------------
export function ellipsoidArea(r) {
  const p = 1.6, a = Math.pow(r.x, p), b = Math.pow(r.y, p), c = Math.pow(r.z, p);
  return 4 * Math.PI * Math.pow((a * b + a * c + b * c) / 3, 1 / p);
}
export function shellFill(rng, branches, twigs, env, o = {}) {
  const cand = [];
  const G = 1.2;
  const grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / G)},${Math.floor(y / G)},${Math.floor(z / G)}`;
  for (const b of branches) {
    if (b.level < (o.minLevel ?? 1) || b.rads[0] > (o.maxR ?? 0.09)) continue;
    const len = b.pd[b.pd.length - 1] - b.pd[0];
    const n = Math.max(2, Math.ceil(len / 0.22));
    for (let i = 1; i <= n; i++) {
      const s = sampleBranch(b, i / n);
      if (s.r > (o.maxR ?? 0.09)) continue;
      const c = { p: s.p, pd: s.pd, r: s.r };
      const k = key(s.p.x, s.p.y, s.p.z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(c);
      cand.push(c);
    }
  }
  if (!cand.length) return 0;
  const nearest = (p) => {
    const gx = Math.floor(p.x / G), gy = Math.floor(p.y / G), gz = Math.floor(p.z / G);
    for (let R = 1; R <= 4; R++) {
      let best = null, bd = Infinity;
      for (let x = gx - R; x <= gx + R; x++) for (let y = gy - R; y <= gy + R; y++) for (let z = gz - R; z <= gz + R; z++) {
        const l = grid.get(`${x},${y},${z}`);
        if (!l) continue;
        for (const c of l) { const d = c.p.distanceToSquared(p); if (d < bd && d > 0.04) { bd = d; best = c; } }
      }
      if (best) return best;
    }
    return null;
  };
  const area = ellipsoidArea(env.r);
  const N = Math.round(area * (o.density ?? 4));
  const cf = o.clumpFreq ?? 0.55, ct = o.clump ?? 0.42;
  const seed = rng.int(0, 9999);
  let made = 0;
  for (let it = 0; it < N * 4 && made < N; it++) {
    const s = rng.sphere();
    if (s[1] < (o.minDirY ?? -0.3)) continue;
    const f = rng.range(o.depth0 ?? 0.8, o.depth1 ?? 1.0);
    const tip = V3(env.c.x + env.r.x * s[0] * f, env.c.y + env.r.y * s[1] * f, env.c.z + env.r.z * s[2] * f);
    if (o.minY !== undefined && tip.y < o.minY) continue;
    if (boxBlocked(o.keepOut, tip, 0.6, 0.6)) continue;
    // clumpy cloud structure + optional horizontal tiers
    let nv = vnoise3(tip.x * cf, tip.y * cf * 1.3, tip.z * cf, seed) * 0.7 + vnoise3(tip.x * cf * 2.3, tip.y * cf * 2.3, tip.z * cf * 2.3, seed + 1) * 0.3;
    if (o.tiers) nv += 0.18 * Math.sin((tip.y / o.tiers) * TAU + vnoise3(tip.x * 0.3, 0, tip.z * 0.3, seed + 2) * 4);
    if (nv < ct) continue;
    const a = nearest(tip);
    if (!a) continue;
    const dv = tip.clone().sub(a.p);
    let len = dv.length();
    if (len > (o.maxTwig ?? 2.6)) continue;
    dv.normalize();
    dv.y += 0.12; dv.normalize();
    const tw = o.twigR ?? 0.004;
    const br = makeBranch(growCurve(rng, a.p, dv, Math.max(0.15, len), Math.max(tw, Math.min(a.r * 0.6, tw * 2.5)), tw * 0.45, { seg: o.twigSeg ?? 0.4, wobble: o.twigWobble ?? 0.35, curlDecay: 0.6, up: 0.08 }), 4, a.pd);
    branches.push(br);
    twigs.push({ br, t0: Math.max(0.0, 1 - (o.leafLen ?? 0.45) / Math.max(len, 0.15)), shell: true });
    made++;
  }
  return made;
}

function growMapleSub(rng, parent, ctx, branches, twigs, level, tStart = 0.15) {
  const { env, det } = ctx;
  const plen = parent.pd[parent.pd.length - 1] - parent.pd[0];
  if (level === 3) {
    const n = Math.max(3, Math.round(plen * 2.6 * (0.7 + 0.3 * det)));
    let side = rng.chance(0.5) ? 1 : -1;
    for (let k = 0; k < n; k++) {
      const t = tStart + ((k + rng.range(0.1, 0.9)) / n) * (1 - tStart);
      const s = sampleBranch(parent, t);
      side = -side;
      const H = V3().crossVectors(s.T, UP);
      if (H.lengthSq() < 1e-4) H.copy(perpOf(s.T));
      H.normalize();
      const a = rng.range(0.6, 1.05);
      const d = s.T.clone().multiplyScalar(Math.cos(a)).addScaledVector(H, side * Math.sin(a));
      d.y = d.y * 0.5 + rng.range(-0.1, 0.28);
      d.normalize();
      let L = Math.min(fitInEnvelope(s.p, d, 20, env) * rng.range(0.8, 1.0), ctx.maxL3 * rng.range(0.6, 1.0));
      if (L < 0.15) L = 0.15;
      const br = makeBranch(growCurve(rng, s.p, d, L, Math.max(0.004, Math.min(s.r * 0.6, 0.016)), 0.003, { seg: 0.22, wobble: 0.6, curlDecay: 0.6, up: 0.12, droop: 0.25, flatten: 1.2, env, envMax: 1.03 }), 3, s.pd);
      branches.push(br);
      growMapleSub(rng, br, ctx, branches, twigs, 4);
    }
    twigs.push({ br: parent, t0: 0.5 });
  } else {
    const n = Math.max(1, Math.round(plen * 2.4 * (0.6 + 0.4 * det)));
    let side = rng.chance(0.5) ? 1 : -1;
    for (let k = 0; k < n; k++) {
      const t = 0.15 + ((k + rng.range(0.1, 0.9)) / n) * 0.85;
      const s = sampleBranch(parent, t);
      side = -side;
      const H = V3().crossVectors(s.T, UP);
      if (H.lengthSq() < 1e-4) H.copy(perpOf(s.T));
      H.normalize();
      const a = rng.range(0.5, 1.0);
      const d = s.T.clone().multiplyScalar(Math.cos(a)).addScaledVector(H, side * Math.sin(a));
      d.y = d.y * 0.35 + rng.range(-0.08, 0.15);
      d.normalize();
      const L = rng.range(0.16, 0.36) * (1 - 0.2 * t);
      const br = makeBranch(growCurve(rng, s.p, d, L, Math.max(0.003, Math.min(s.r * 0.7, 0.005)), 0.0018, { seg: 0.14, wobble: 1.0, curlDecay: 0.5, up: 0.15, droop: 0.2 }), 4, s.pd);
      branches.push(br);
      twigs.push({ br, t0: 0.1 });
    }
    twigs.push({ br: parent, t0: 0.45 });
  }
}

// ===========================================================================
// Species: cherry (sakura) — short thick trunk, vase of scaffold limbs,
// spreading umbrella crown with drooping tips
// ===========================================================================
export function genCherry(rng, o) {
  const h = o.h, base = o.base;
  const spread = (o.spread || 0.88) * h;
  const lean = o.lean || V3();
  const env = { c: V3(base.x + lean.x, base.y + h * 0.58, base.z + lean.z), r: V3(spread, h * 0.45, spread) };
  const branches = [], twigs = [];
  const det = o.detail ?? 1;
  const rT = 0.028 * h + 0.05;
  const trunkLen = h * rng.range(0.2, 0.27);
  const tdir = V3(lean.x * 0.2, 1, lean.z * 0.2).normalize().add(randUnit(rng).multiplyScalar(0.1)).normalize();
  const trunk = makeBranch(growCurve(rng, base.clone().add(V3(0, -0.3, 0)), tdir, trunkLen + 0.3, rT, rT * 0.85, { seg: 0.2, wobble: 0.3 }), 0, 0);
  branches.push(trunk);
  const nScaf = o.scaffolds || rng.int(3, 5);
  const az0 = rng.range(0, TAU);
  for (let si = 0; si < nScaf; si++) {
    const t = 0.72 + rng.range(0, 0.28);
    const s = sampleBranch(trunk, t);
    const az = az0 + (si / nScaf) * TAU + rng.range(-0.35, 0.35);
    const out = V3(Math.cos(az), 0, Math.sin(az));
    let dir = V3(out.x * 1.15, 1, out.z * 1.15).normalize();
    const len = fitInEnvelope(s.p, dir, h * rng.range(0.7, 0.85), env);
    const scaf = makeBranch(growCurve(rng, s.p, dir, len, rT * 0.62, 0.02, { seg: 0.25, wobble: o.scaffoldWobble ?? 0.5, up: 0.0, droop: 0.4 * (o.droopScale ?? 1), droopPow: 1.4, outward: out, outPush: 0.12 }), 1, s.pd);
    branches.push(scaf);
    const nL2 = Math.round(rng.range(8, 11) * (0.7 + 0.3 * det));
    let laz = rng.range(0, TAU);
    for (let k = 0; k < nL2; k++) {
      const tt = 0.2 + (k + rng.range(0.1, 0.9)) / nL2 * 0.78;
      const ss = sampleBranch(scaf, tt);
      laz += GOLD;
      let d = spreadDir(ss.T, rng.range(0.6, 1.05), laz);
      if (d.x * out.x + d.z * out.z < -0.2) { d.x += out.x; d.z += out.z; d.normalize(); }
      d.y *= 0.7;
      d.normalize();
      const L = fitInEnvelope(ss.p, d, h * rng.range(0.28, 0.4) * (1 - 0.4 * tt), env);
      if (L < 0.35) continue;
      const l2 = makeBranch(growCurve(rng, ss.p, d, L, Math.min(ss.r * 0.72, rT * 0.32), 0.008, { seg: 0.2, wobble: 0.65, up: 0.1, droop: 0.7 * (o.droopScale ?? 1), droopPow: 1.3, outward: out, outPush: 0.1 }), 2, ss.pd);
      branches.push(l2);
      // level 3
      const plen = L;
      const n3 = Math.round(Math.max(3, plen * 4.5) * (0.6 + 0.4 * det));
      for (let j = 0; j < n3; j++) {
        const t3 = 0.2 + (j + rng.range(0.1, 0.9)) / n3 * 0.8;
        const s3 = sampleBranch(l2, t3);
        let d3 = spreadDir(s3.T, rng.range(0.5, 0.95), rng.range(0, TAU));
        d3.y = d3.y * 0.6 + 0.05;
        d3.normalize();
        const L3 = fitInEnvelope(s3.p, d3, rng.range(0.5, 1.3) * (1 - 0.3 * t3), env);
        if (L3 < 0.15) continue;
        const l3 = makeBranch(growCurve(rng, s3.p, d3, L3, Math.max(0.005, Math.min(s3.r * 0.7, 0.025)), 0.004, { seg: 0.25, wobble: 0.8, up: 0.15, droop: 0.6 * (o.droopScale ?? 1) }), 3, s3.pd);
        branches.push(l3);
        twigs.push({ br: l3, t0: 0.1 });
      }
      twigs.push({ br: l2, t0: 0.3 });
    }
    twigs.push({ br: scaf, t0: 0.75 });
  }
  // blossom cloud: fill the crown shell with flowering spurs
  shellFill(rng, branches, twigs, env, {
    density: (o.shellDensity ?? 3.2) * (0.6 + 0.4 * det), clump: 0.38, clumpFreq: 0.6, depth0: 0.75, depth1: 1.0,
    minDirY: -0.55, minY: base.y + 1.6, twigR: 0.004, leafLen: 0.5, minLevel: 1, maxR: 0.12, keepOut: o.keepOut,
  });
  return { branches, twigs, env, rT };
}

// ===========================================================================
// Smooth branch between two points: lifted arc + lateral wander (Catmull-Rom
// through jittered control points), resampled every `seg` metres.
// ===========================================================================
export function arcCurve(rng, a, b, r0, r1, P = {}) {
  const d = b.clone().sub(a);
  const len = Math.max(1e-3, d.length());
  const T = d.clone().divideScalar(len);
  const side = perpOf(T);
  const up2 = V3().crossVectors(side, T).normalize();
  const nc = P.nc ?? (len > 1.2 ? 3 : 2);
  const cps = [a.clone()];
  // optional initial direction (continuity with the parent / sun-seeking rise)
  if (P.startDir) cps.push(a.clone().addScaledVector(P.startDir, Math.min(len * 0.22, 0.6)));
  for (let k = 1; k <= nc; k++) {
    const t = k / (nc + 1);
    const p = a.clone().lerp(b, t);
    p.y += (P.lift ?? 0.12) * len * Math.sin(Math.PI * t);
    p.y -= (P.sag ?? 0) * len * t * t;
    const w = (P.wander ?? 0.08) * len * Math.sin(Math.PI * t);
    p.addScaledVector(side, rng.range(-1, 1) * w);
    p.addScaledVector(up2, rng.range(-1, 1) * w * 0.5);
    cps.push(p);
  }
  cps.push(b.clone());
  const c = new THREE.CatmullRomCurve3(cps, false, 'centripetal');
  const n = Math.max(2, Math.ceil(len / (P.seg || 0.22)));
  const pts = c.getSpacedPoints(n);
  const rads = pts.map((_, i) => r1 + (r0 - r1) * Math.pow(1 - i / n, P.taper ?? 1));
  return { pts, rads };
}

// ===========================================================================
// Layered broadleaf crown (Japanese maple / cherry).
// Foliage lives in discrete flattened "pads" (leaf sprays) arranged in loose
// horizontal tiers over an irregular dome / umbrella envelope, with sky gaps
// between them. The skeleton grows *to* the pads: a few sinuous leaders split
// from a short trunk (vase form), each pad is fed by a limb from the nearest
// suitable point of its sector, and twigs fan out inside the pad. Branch radii
// follow the pipe model (r ~ sqrt(leaf area carried)).
// returns { branches, twigs:[{br,t0,pad}], pads, env, rT }
// ===========================================================================
export function genTiered(rng, o) {
  const cherry = o.species === 'cherry';
  const h = o.h, base = o.base;
  const lean = o.lean || V3();
  const R = (o.spread ?? (cherry ? 0.8 : 0.6)) * h;
  const sx = o.sx || 1, sz = o.sz || 1;
  const y0 = base.y + h * (o.crownBase ?? (cherry ? 0.36 : 0.3));
  const yTop = base.y + h;
  const yW = base.y + h * (o.widest ?? (cherry ? 0.52 : 0.6));
  const cx = base.x + lean.x, cz = base.z + lean.z;
  const env = { c: V3(cx, (y0 + yTop) * 0.5, cz), r: V3(R * sx, (yTop - y0) * 0.5, R * sz) };
  const seed = rng.int(0, 9999);
  // asymmetric, lobed outline
  const lob = [2, 3, 5].map((f, k) => ({ f, ph: rng.range(0, TAU), a: [0.16, 0.1, 0.06][k] * (o.lobes ?? 1) }));
  const lobeAt = (az) => { let m = 1; for (const l of lob) m += l.a * Math.sin(l.f * az + l.ph); return m; };
  const topP = o.topPow ?? (cherry ? 3.2 : 2.0);
  const profile = (y) => {
    if (y >= yW) { const u = Math.min(1, (y - yW) / Math.max(0.1, yTop - yW)); return Math.sqrt(Math.max(0, 1 - Math.pow(u, topP))); }
    const u = Math.min(1, (yW - y) / Math.max(0.1, yW - y0));
    return 1 - (o.bottomIn ?? (cherry ? 0.1 : 0.3)) * u * u;
  };
  const padR0 = (o.padR ?? Math.min(1.9, Math.max(0.7, 0.12 * h + 0.45))) * (cherry ? 0.85 : 1);
  const squash = o.squash ?? (cherry ? 0.28 : 0.3);
  const step = o.tierStep ?? padR0 * (cherry ? 0.62 : 0.72);
  const gf = 0.5 / padR0;
  const pads = [];
  const fits = (c, rx, ry) => {
    for (const q of pads) {
      const dh = Math.hypot(q.c.x - c.x, q.c.z - c.z), dy = Math.abs(q.c.y - c.y);
      if (dh < (q.rx + rx) * (o.packing ?? 0.7) && dy < (q.ry + ry) * 1.7) return false;
    }
    return true;
  };
  const nT = Math.max(2, Math.round((yTop - y0) / step));
  const span = yTop - y0 - padR0 * squash * 0.8;
  for (let ti = 0; ti < nT; ti++) {
    const u = (ti + 0.5) / nT;
    const yt = y0 + u * span;
    const rr = R * profile(yt);
    const rAbove = ti < nT - 1 ? R * profile(y0 + ((ti + 1.5) / nT) * span) : 0;
    const tierS = 1 - 0.22 * u;
    if (rr < padR0 * 0.75) {
      const rx = Math.max(padR0 * 0.65, rr);
      const c = V3(cx + rng.range(-0.2, 0.2) * rx, yt, cz + rng.range(-0.2, 0.2) * rx);
      if (!boxBlocked(o.keepOut, c, rx * 1.1, rx * squash + 0.3) && fits(c, rx, rx * squash)) pads.push({ c, rx, ry: rx * squash * 1.15, rz: rx * rng.range(0.8, 1.0), yaw: rng.range(0, TAU), tier: ti, u });
      continue;
    }
    const tries = Math.ceil((TAU * rr) / (padR0 * 1.2)) * 6 + 10;
    for (let k = 0; k < tries; k++) {
      const az = rng.range(0, TAU);
      const lo = lobeAt(az);
      const rx = padR0 * rng.range(0.7, 1.2) * tierS;
      const ry = rx * squash * rng.range(0.85, 1.2);
      const inner = rng.chance(o.innerP ?? 0.18);
      let d = (rr * lo - rx * 0.55) * (inner ? rng.range(0.1, 0.65) : rng.range(0.74, 1.0));
      d = Math.max(0, d);
      if (d < rAbove * 0.75 && !inner) continue;
      const c = V3(cx + Math.cos(az) * d * sx, yt + rng.range(-0.45, 0.45) * step, cz + Math.sin(az) * d * sz);
      // big sky holes through the crown
      const g = vnoise3(c.x * gf, c.y * gf * 1.4, c.z * gf, seed) * 0.75 + vnoise3(c.x * gf * 2.1, c.y * gf * 2.1, c.z * gf * 2.1, seed + 1) * 0.25;
      if (g < (o.gaps ?? 0.3)) continue;
      if (boxBlocked(o.keepOut, c, rx * 1.1, ry + 0.3)) continue;
      if (!fits(c, rx, ry)) continue;
      pads.push({ c, rx, ry, rz: rx * rng.range(0.7, 0.95), yaw: Math.atan2(c.z - cz, c.x - cx) + rng.range(-0.4, 0.4), tier: ti, u });
    }
  }
  // per-pad helpers and crown-level shade (pads beneath other pads are darker)
  for (const P of pads) {
    P.cy = Math.cos(P.yaw); P.sy = Math.sin(P.yaw);
    P.axisD = Math.hypot(P.c.x - cx, P.c.z - cz);
    const out = Math.min(1, P.axisD / R);
    P.droopM = (cherry ? 0.22 + 0.4 * out : 0.1 + 0.32 * out * (1 - 0.4 * P.u)) * (P.rx / 1.2) * (o.droop ?? 1);
    P.radial = P.axisD > 0.05 ? V3((P.c.x - cx) / P.axisD, 0, (P.c.z - cz) / P.axisD) : V3(P.cy, 0, P.sy);
  }
  for (const P of pads) {
    let occ = 0;
    for (const Q of pads) {
      if (Q === P || Q.c.y < P.c.y + P.ry * 0.5) continue;
      const dh = Math.hypot(Q.c.x - P.c.x, Q.c.z - P.c.z);
      occ += Math.max(0, 1 - dh / (Q.rx + P.rx)) * Math.min(1, (Q.c.y - P.c.y) / (2 * step) + 0.4);
    }
    P.shade = Math.min(1, Math.max(0.28, (1 / (1 + 0.55 * occ)) * (0.7 + 0.3 * Math.min(1, P.axisD / (R * 0.8)))));
  }

  // ------------------------------------------------------------ skeleton
  const branches = [], twigs = [];
  const rT = o.rT ?? (cherry ? 0.028 * h + 0.05 : 0.02 * h + 0.04);
  const trunkLen = h * (o.trunkFrac ?? (cherry ? rng.range(0.2, 0.27) : rng.range(0.14, 0.22)));
  const tdir = V3(lean.x * 0.25, trunkLen, lean.z * 0.25).normalize();
  const trunk = makeBranch(growCurve(rng, base.clone().add(V3(0, -0.3, 0)), tdir, trunkLen + 0.3, rT, rT * 0.84, { seg: 0.2, wobble: cherry ? 0.3 : 0.14, curlDecay: 0.85 }), 0, 0);
  trunk.children = [];
  branches.push(trunk);
  const top = trunk.pts[trunk.pts.length - 1];
  const nLead = o.leaders || (cherry ? rng.int(3, 5) : rng.int(2, 4));
  const a0 = rng.range(0, TAU);
  const sectorOf = (P) => {
    const az = Math.atan2(P.c.z - top.z, P.c.x - top.x);
    return Math.floor((((az - a0) % TAU) + TAU) % TAU / (TAU / nLead)) % nLead;
  };
  const sectors = Array.from({ length: nLead }, () => []);
  for (const P of pads) sectors[sectorOf(P)].push(P);
  const yLead = y0 + (yTop - y0) * (cherry ? 0.12 : 0.28);
  for (let si = 0; si < nLead; si++) {
    const S = sectors[si];
    if (!S.length) continue;
    let mx = 0, mz = 0, wsum = 0;
    for (const P of S) { const w = P.rx * P.rz; mx += P.c.x * w; mz += P.c.z * w; wsum += w; }
    mx /= wsum; mz /= wsum;
    const f = cherry ? rng.range(0.5, 0.62) : rng.range(0.36, 0.5);
    const E = V3(top.x + (mx - top.x) * f, Math.max(top.y + 0.5, yLead + rng.range(-0.25, 0.35) * step), top.z + (mz - top.z) * f);
    const ti = Math.max(0, trunk.pts.length - 1 - rng.int(0, 2));
    const lead = makeBranch(arcCurve(rng, trunk.pts[ti], E, rT * 0.6, rT * 0.2, { lift: cherry ? 0.04 : 0.08, wander: cherry ? 0.1 : 0.14, seg: 0.22, startDir: V3(0, 1, 0) }), 1, trunk.pd[ti]);
    lead.parent = trunk; lead.attachIdx = ti; lead.children = []; trunk.children.push(lead);
    branches.push(lead);
    const pool = [lead];
    // feed the pads of this sector, nearest to the leader first
    S.sort((p, q) => p.c.distanceToSquared(E) - q.c.distanceToSquared(E));
    for (const P of S) {
      const A = P.c.clone().addScaledVector(P.radial, -P.rx * 0.42);
      A.y -= P.ry * 0.45;
      const aD = Math.hypot(A.x - cx, A.z - cz);
      let best = null, bc = Infinity;
      for (const b of pool) {
        const nmax = b.pts.length - (b === lead ? 1 : 2);
        for (let i = 1; i <= nmax; i++) {
          const p = b.pts[i];
          const dist = p.distanceTo(A);
          const nd = Math.hypot(p.x - cx, p.z - cz);
          const vy = A.y - p.y, vh = Math.hypot(A.x - p.x, A.z - p.z);
          const cost = dist + 0.35 * Math.max(0, -vy) + 0.9 * Math.max(0, vy - 0.9 * vh) + 1.2 * Math.max(0, nd - aD + 0.2) + (b.pad ? 0.15 : 0);
          if (cost < bc) { bc = cost; best = { b, i }; }
        }
      }
      if (!best) continue;
      const sp = best.b.pts[best.i];
      const len = sp.distanceTo(A);
      const rise = V3(A.x - sp.x, 0, A.z - sp.z).normalize().multiplyScalar(0.7);
      rise.y = cherry ? 0.55 : 0.75;
      const limb = makeBranch(arcCurve(rng, sp, A, 0.03, 0.012, { lift: cherry ? 0.05 : 0.1, sag: cherry ? 0.06 : 0.02, wander: 0.1, seg: 0.2, startDir: rise.normalize() }), 2, best.b.pd[best.i]);
      limb.parent = best.b; limb.attachIdx = best.i; limb.children = []; limb.pad = P;
      best.b.children.push(limb);
      branches.push(limb);
      pool.push(limb);
      P.limb = limb;
    }
  }
  // pipe model radii
  const k = rT / Math.sqrt(Math.max(1e-3, pads.reduce((s, P) => s + (P.limb ? P.rx * P.rz : 0), 0)));
  const loadOf = (b) => {
    if (b.load !== undefined) return b.load;
    let l = b.pad ? b.pad.rx * b.pad.rz : 0;
    for (const c of b.children || []) l += loadOf(c);
    return (b.load = l);
  };
  loadOf(trunk);
  const setRadii = (b, rMax) => {
    const n = b.pts.length;
    const ch = (b.children || []).slice().sort((p, q) => q.attachIdx - p.attachIdx);
    const L = new Array(n).fill(b.pad ? b.pad.rx * b.pad.rz : 0);
    let acc = L[0], ci = 0;
    for (let i = n - 1; i >= 0; i--) {
      while (ci < ch.length && ch[ci].attachIdx >= i) { acc += ch[ci].load; ci++; }
      L[i] = acc;
    }
    const rMin = b.level === 0 ? rT * 0.6 : b.level === 1 ? 0.025 : 0.012;
    for (let i = 0; i < n; i++) b.rads[i] = Math.min(rMax, Math.max(rMin * (b.level >= 2 ? 1 : 0.6), k * Math.sqrt(L[i]) * (1 - 0.12 * i / n)));
    if (b.level === 0) for (let i = 0; i < n; i++) b.rads[i] = Math.max(b.rads[i], rT * (1 - 0.2 * i / n));
    for (const c of b.children || []) setRadii(c, b.rads[c.attachIdx] * 0.92);
  };
  setRadii(trunk, rT * 1.2);
  // trim leaders past their last fed child
  for (const b of branches) {
    if (b.level !== 1) continue;
    if (!b.children.length) { b.dead = true; continue; }
    const last = Math.max(...b.children.map((c) => c.attachIdx));
    const keep = Math.min(b.pts.length, last + 2);
    b.pts.length = keep; b.rads.length = keep; b.pd.length = keep;
    b.rads[keep - 1] *= 0.6;
  }
  for (let i = branches.length - 1; i >= 0; i--) if (branches[i].dead) branches.splice(i, 1);

  // ------------------------------------------------------------ twigs fanning inside each pad
  const twigDens = o.twigDens ?? (cherry ? 4.5 : 4.0);
  const det = o.detail ?? 1;
  for (const P of pads) {
    const limb = P.limb;
    if (!limb) continue;
    const area = Math.PI * P.rx * P.rz;
    const nt = Math.max(4, Math.min(det < 0.9 ? 18 : 26, Math.round(area * twigDens * (0.6 + 0.4 * det))));
    for (let j = 0; j < nt; j++) {
      const a = (j / nt) * TAU + rng.range(-0.4, 0.4);
      const rr = Math.sqrt(rng.range(0.2, 1.0));
      const lx = Math.cos(a) * rr * P.rx, lz = Math.sin(a) * rr * P.rz;
      let ly = P.ry * rng.range(-0.15, 0.5) * (1 - rr * rr * 0.5);
      ly -= padDroop(P, lx / P.rx, lz / P.rz); // spray tips hang down, most on the outer side
      const T = V3(P.c.x + lx * P.cy - lz * P.sy, P.c.y + ly, P.c.z + lx * P.sy + lz * P.cy);
      const s0 = sampleBranch(limb, rng.range(0.55, 1.0));
      if (s0.p.distanceTo(T) < 0.12) continue;
      const tw = makeBranch(arcCurve(rng, s0.p, T, Math.min(0.01, s0.r * 0.6), 0.0028, { lift: 0.14, sag: cherry ? 0.14 : 0.08, wander: 0.16, seg: det < 0.9 ? 0.2 : 0.14, nc: 2 }), 3, s0.pd);
      tw.padRef = P;
      branches.push(tw);
      twigs.push({ br: tw, t0: 0.12, pad: P });
      const tl = tw.pd[tw.pd.length - 1] - tw.pd[0];
      const ns = Math.round(tl * (cherry ? 2.2 : 2.6) * (0.5 + 0.5 * det));
      for (let q = 0; q < ns; q++) {
        const t = rng.range(0.3, 0.92);
        const s = sampleBranch(tw, t);
        const H = V3().crossVectors(s.T, UP);
        if (H.lengthSq() < 1e-4) H.copy(perpOf(s.T));
        H.normalize();
        const d = s.T.clone().multiplyScalar(0.55).addScaledVector(H, (q % 2 ? 1 : -1) * 0.85);
        d.y = d.y * 0.3 + rng.range(-0.05, 0.18);
        d.normalize();
        const L = rng.range(0.12, 0.3) * Math.min(1, P.rx);
        const sub = makeBranch(arcCurve(rng, s.p, s.p.clone().addScaledVector(d, L), 0.0035, 0.0018, { lift: 0.1, wander: 0.2, seg: 0.12, nc: 1 }), 4, s.pd);
        branches.push(sub);
        twigs.push({ br: sub, t0: 0.1, pad: P });
      }
    }
  }
  return { branches, twigs, pads: pads.filter((P) => P.limb), env, rT };
}

// Framing control. avoid: [{pos,f,r,u,tx,ty, rects:[[x0,x1,y0,y1],...] (NDC), minD}]
// true if a foliage mass at c (radius r) would cover a protected screen rectangle of a film
// camera, or come closer than minD to it.
export function screenBlocked(avoid, c, r, yScale = 1) {
  if (!avoid) return false;
  for (const A of avoid) {
    const v = c.clone().sub(A.pos);
    if (A.minD && v.length() < A.minD + r) return true;
    const z = v.dot(A.f);
    if (z < 0.3) continue;
    const x = v.dot(A.r) / (z * A.tx), y = v.dot(A.u) / (z * A.ty);
    const rx = r / (z * A.tx), ry = (r * yScale) / (z * A.ty);
    for (const R of A.rects) if (x + rx > R[0] && x - rx < R[1] && y + ry > R[2] && y - ry < R[3]) return true;
  }
  return false;
}

// keep-out volumes: [{x0,x1,z0,z1,y0?,y1}] — true if a foliage mass at c (horizontal radius r,
// vertical half-extent ry) would intrude
export function boxBlocked(boxes, c, r, ry = r) {
  if (!boxes) return false;
  for (const B of boxes) {
    if (c.x + r > B.x0 && c.x - r < B.x1 && c.z + r > B.z0 && c.z - r < B.z1 && c.y - ry < B.y1 && c.y + ry > (B.y0 ?? -1e9)) return true;
  }
  return false;
}

// pad-local helpers (used by the foliage placement)
export function padDroop(P, ux, uz) {
  return (P.droopM || 0) * (ux * ux + uz * uz) * (0.4 + 0.6 * Math.max(0, ux));
}
export function padLocal(P, p) {
  const dx = p.x - P.c.x, dz = p.z - P.c.z;
  return { x: (dx * P.cy + dz * P.sy) / P.rx, y: (p.y - P.c.y) / P.ry, z: (-dx * P.sy + dz * P.cy) / P.rz };
}
// 0 = underside of the spray, 1 = its sunlit top (droop compensated)
export function padTopF(P, p) {
  const l = padLocal(P, p);
  const y = l.y + padDroop(P, Math.min(1.2, l.x), Math.min(1.2, l.z)) / P.ry;
  return Math.min(1, Math.max(0, (y + 0.9) / 1.5));
}
export function padNormal(P, p) {
  const l = padLocal(P, p);
  const nx = l.x / P.rx, ny = l.y / P.ry, nz = l.z / P.rz;
  return V3(nx * P.cy - nz * P.sy, ny, nx * P.sy + nz * P.cy).normalize();
}

// ===========================================================================
// Species: Japanese black pine (kuromatsu), niwaki style.
// Twisting leaning trunk, near-horizontal zig-zag limbs ending in flat domed
// "cloud" pads; crown pad at the apex.
// ===========================================================================
export function genPine(rng, o) {
  const h = o.h, base = o.base;
  const branches = [], pads = [];
  const leanAz = o.leanAz ?? rng.range(0, TAU);
  const lean = o.lean ?? rng.range(0.22, 0.42);
  const L = V3(Math.cos(leanAz), 0, Math.sin(leanAz));
  const S = V3(-L.z, 0, L.x);
  const sideA = rng.range(-1, 1);
  const rT = 0.022 * h + 0.06;
  const cps = [
    base.clone().add(V3(0, -0.4, 0)),
    base.clone().add(V3(0, h * 0.18, 0)).addScaledVector(L, h * lean * 0.25),
    base.clone().add(V3(0, h * 0.42, 0)).addScaledVector(L, h * lean * 0.85).addScaledVector(S, h * 0.1 * sideA),
    base.clone().add(V3(0, h * 0.68, 0)).addScaledVector(L, h * lean * 0.95).addScaledVector(S, -h * 0.08 * sideA),
    base.clone().add(V3(0, h * 0.9, 0)).addScaledVector(L, h * lean * (o.topBack ?? 0.55)),
  ];
  const curve = new THREE.CatmullRomCurve3(cps, false, 'centripetal');
  const tl = curve.getLength();
  const nP = Math.max(8, Math.ceil(tl / 0.18));
  const tpts = [], trads = [];
  for (let i = 0; i <= nP; i++) {
    const t = i / nP;
    const p = curve.getPointAt(t);
    // gentle wobble
    p.x += (vnoise3(t * 6, 0, 0, 11) - 0.5) * 0.18 * h * 0.04;
    p.z += (vnoise3(0, t * 6, 0, 12) - 0.5) * 0.18 * h * 0.04;
    tpts.push(p);
    trads.push(Math.max(0.035, rT * Math.pow(1 - t * 0.82, 1.1)));
  }
  const trunk = makeBranch({ pts: tpts, rads: trads }, 0, 0);
  branches.push(trunk);

  // framing control: pads whose projection would land inside a camera's protected region are dropped
  const blocked = (c, r) => screenBlocked(o.avoid, c, r, 0.6) || boxBlocked(o.keepOut, c, r, r * 0.35);
  const addPad = (c, rp, yaw, attach, pd, squash = 0.2) => {
    // clipped niwaki pad = a flat-topped, lobed cushion of upright needle tufts carried by a fan of
    // zig-zag branchlets (see buildPine). A few lower / higher sub-cushions break the outline.
    const lobes = () => [rng.range(0.08, 0.17), rng.range(0.05, 0.11), rng.range(0.03, 0.07), rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)];
    const main = { c, rx: rp, ry: rp * squash, rz: rp * rng.range(0.72, 0.95), yaw, attach, pd, lobes: lobes() };
    pads.push(main);
    const nsub = rp > 0.7 ? rng.int(2, 4) : rng.int(1, 2);
    for (let k = 0; k < nsub; k++) {
      const a = yaw + (k / nsub) * TAU + rng.range(-0.5, 0.5), d = rp * rng.range(0.6, 0.9);
      const rs = rp * rng.range(0.36, 0.55);
      const sc = V3(c.x + Math.cos(a) * d, c.y + rp * squash * rng.range(-0.3, 0.12), c.z + Math.sin(a) * d);
      if (boxBlocked(o.keepOut, sc, rs, rs * 0.3)) continue;
      pads.push({ c: sc, rx: rs, ry: rs * squash * rng.range(0.9, 1.25), rz: rs * rng.range(0.75, 1.0), yaw: rng.range(0, TAU), attach, pd, sub: true, lobes: lobes() });
    }
    // branchlets: a fan of forking, zig-zagging twigs just under the cushion (visible from below
    // and through the dark gaps between tufts)
    const yb = c.y - rp * squash * 0.5;
    const nt = rp > 0.9 ? rng.int(4, 6) : rng.int(3, 5);
    for (let i = 0; i < nt; i++) {
      const a = yaw + (i / nt) * TAU + rng.range(-0.35, 0.35);
      const L1 = rp * rng.range(0.38, 0.55);
      const mid = V3(c.x + Math.cos(a) * L1, yb - rng.range(0, 0.06), c.z + Math.sin(a) * L1 * 0.9);
      if (mid.distanceTo(attach) < 0.08) continue;
      const b1 = makeBranch(arcCurve(rng, attach, mid, 0.022, 0.012, { lift: 0.12, wander: 0.22, seg: 0.12, nc: 2 }), 4, pd);
      branches.push(b1);
      const nf = rng.int(2, 3);
      for (let j = 0; j < nf; j++) {
        const b = a + (j - (nf - 1) / 2) * rng.range(0.35, 0.6);
        const L2 = rp * rng.range(0.82, 1.0);
        const end = V3(c.x + Math.cos(b) * L2, yb + rp * squash * rng.range(0.05, 0.3), c.z + Math.sin(b) * L2 * 0.9);
        branches.push(makeBranch(arcCurve(rng, mid, end, 0.011, 0.005, { lift: 0.1, wander: 0.3, seg: 0.12, nc: 1 }), 4, pd + L1));
      }
    }
  };

  const nB = o.nBranches || Math.round(3 + h * 0.42);
  let az = leanAz + Math.PI + rng.range(-0.5, 0.5);
  const hStart = o.hStart ?? 0.3;
  for (let i = 0; i < nB; i++) {
    const t = hStart + (i + rng.range(0.15, 0.85)) / nB * (0.86 - hStart);
    const s = sampleBranch(trunk, t);
    az += GOLD + rng.range(-0.35, 0.35);
    const out = V3(Math.cos(az), 0, Math.sin(az));
    const el = rng.range(-0.16, 0.14) - 0.06 * (1 - t);
    const dir = V3(out.x, el, out.z).normalize();
    const Lb = h * (0.56 - 0.38 * t) * rng.range(0.8, 1.15) * (o.reach || 1);
    const r0 = Math.min(s.r * 0.6, rT * 0.45);
    const limb = makeBranch(growCurve(rng, s.p, dir, Lb, r0, 0.03, { seg: 0.2, wobble: 0.35, droop: 0.12, up: 0.05, kink: 0.9, minY: -0.35, maxY: 0.35, flatten: 0.3 }), 1, s.pd);
    const tip = limb.pts[limb.pts.length - 1];
    const rp = Math.min(2.0, Math.max(0.55, Lb * 0.4 + 0.3)) * (o.padScale || 1);
    if (blocked(tip.clone().add(V3(0, rp * 0.18, 0)), rp * 1.15)) continue;
    branches.push(limb);
    addPad(tip.clone().add(V3(0, rp * 0.18, 0)), rp, az + rng.range(-0.4, 0.4), tip, limb.pd[limb.pd.length - 1]);
    // side pads
    const nSide = Lb > 1.6 ? rng.int(0, 2) : rng.int(0, 1);
    for (let k = 0; k < nSide; k++) {
      const tt = rng.range(0.4, 0.75);
      const ss = sampleBranch(limb, tt);
      const sgn = rng.chance(0.5) ? 1 : -1;
      const sd = spreadDir(ss.T, rng.range(0.7, 1.1), sgn * Math.PI / 2, UP);
      sd.y = rng.range(0.0, 0.25); sd.normalize();
      const sl = rng.range(0.35, 0.8) * Math.min(1.4, Lb / 2);
      const sb = makeBranch(growCurve(rng, ss.p, sd, sl, Math.min(ss.r * 0.7, 0.05), 0.02, { seg: 0.15, wobble: 0.4, kink: 1 }), 2, ss.pd);
      const st = sb.pts[sb.pts.length - 1];
      const rs = rp * rng.range(0.55, 0.8);
      if (blocked(st.clone().add(V3(0, rs * 0.2, 0)), rs * 1.15)) continue;
      branches.push(sb);
      addPad(st.clone().add(V3(0, rs * 0.2, 0)), rs, rng.range(0, TAU), st, sb.pd[sb.pd.length - 1]);
    }
  }
  // apex pad
  const tt = trunk.pts[trunk.pts.length - 1];
  const ra = Math.max(0.6, h * 0.11 + 0.3) * (o.padScale || 1);
  if (!blocked(tt.clone().add(V3(0, ra * 0.25, 0)), ra)) addPad(tt.clone().add(V3(0, ra * 0.25, 0)), ra, rng.range(0, TAU), tt, trunk.pd[trunk.pd.length - 1], 0.42);
  // a couple of small pads hugging the upper trunk
  for (let i = 0; i < 2; i++) {
    const s = sampleBranch(trunk, rng.range(0.7, 0.92));
    const a = rng.range(0, TAU);
    const d = V3(Math.cos(a), 0.15, Math.sin(a)).normalize();
    const sb = makeBranch(growCurve(rng, s.p, d, rng.range(0.35, 0.6), 0.04, 0.02, { seg: 0.15 }), 2, s.pd);
    const st = sb.pts[sb.pts.length - 1];
    const rs = ra * rng.range(0.5, 0.7);
    if (blocked(st.clone().add(V3(0, rs * 0.15, 0)), rs)) continue;
    branches.push(sb);
    addPad(st.clone().add(V3(0, rs * 0.15, 0)), rs, a, st, sb.pd[sb.pd.length - 1]);
  }
  return { branches, pads, rT };
}
