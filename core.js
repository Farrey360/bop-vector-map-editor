/* BoP Vector Map Editor - noyau géométrique (sans DOM, testable sous node).
   Modèle : anneau = tableau plat [x0,y0,x1,y1,...] (sans point de fermeture),
   polygone = [anneauExterieur, ...trous], province.polys = [polygone, ...].
   Coordonnées = degrés (x = longitude, y = latitude). */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- bases
  function ringArea(r) {
    let a = 0;
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) a += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
    return a / 2;
  }

  function ringBBox(r, bb) {
    bb = bb || [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < r.length; i += 2) {
      const x = r[i], y = r[i + 1];
      if (x < bb[0]) bb[0] = x;
      if (y < bb[1]) bb[1] = y;
      if (x > bb[2]) bb[2] = x;
      if (y > bb[3]) bb[3] = y;
    }
    return bb;
  }

  function polyBBox(poly) { return ringBBox(poly[0]); }

  function pointInRing(x, y, r) {
    let c = false;
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  function pointInPoly(x, y, poly) {
    let c = false;
    for (const r of poly) if (pointInRing(x, y, r)) c = !c;
    return c;
  }

  function pointInNodeRing(x, y, R) {
    let c = false;
    const n = R.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = R[i].x, yi = R[i].y, xj = R[j].x, yj = R[j].y;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  function pointInNodeRings(x, y, rings) {
    let c = false;
    for (const R of rings) if (pointInNodeRing(x, y, R)) c = !c;
    return c;
  }

  function clonePoly(p) { return p.map(r => r.slice()); }

  function cloneProv(p) {
    return {
      id: p.id, name: p.name, color: p.color, country: p.country, region: p.region,
      terrain: p.terrain, polys: p.polys.map(clonePoly),
    };
  }

  // ------------------------------------------------------- découpe (cut)
  function toNodes(r) {
    const a = [];
    for (let i = 0; i < r.length; i += 2) a.push({ x: r[i], y: r[i + 1] });
    return a;
  }

  function fromNodes(R) {
    const a = [];
    for (const nd of R) {
      const n = a.length;
      if (n >= 2 && a[n - 2] === nd.x && a[n - 1] === nd.y) continue;
      a.push(nd.x, nd.y);
    }
    const n = a.length;
    if (n >= 4 && a[0] === a[n - 2] && a[1] === a[n - 1]) a.length = n - 2;
    return a.length >= 6 ? a : null;
  }

  function nodeArea(R) {
    let a = 0;
    for (let i = 0, j = R.length - 1; i < R.length; j = i++) a += R[j].x * R[i].y - R[i].x * R[j].y;
    return a / 2;
  }

  function subRing(R, i, j) {
    const out = [];
    let k = i;
    for (;;) {
      out.push(R[k]);
      if (k === j) break;
      k = (k + 1) % R.length;
    }
    return out;
  }

  function rotRing(R, i) {
    const out = [];
    for (let k = 0; k < R.length; k++) out.push(R[(i + k) % R.length]);
    return out;
  }

  /* Coupe un polygone (avec trous) selon une polyligne `line` (tableau plat).
     Renvoie null si la ligne ne sépare rien, sinon
     { polys:[polygone,...], newPoints:[{x,y},...] } ; newPoints = sommets créés
     sur le contour (à répercuter sur les voisins pour éviter les T-jonctions). */
  function splitPoly(poly, line) {
    const rings = poly.map(toNodes);
    const nL = line.length / 2;
    if (nL < 2) return null;

    // 1. intersections ligne / contours
    let hits = [];
    for (let i = 0; i < nL - 1; i++) {
      const ax = line[2 * i], ay = line[2 * i + 1];
      const dx = line[2 * i + 2] - ax, dy = line[2 * i + 3] - ay;
      const last = i === nL - 2;
      for (let ri = 0; ri < rings.length; ri++) {
        const R = rings[ri], n = R.length;
        for (let k = 0; k < n; k++) {
          const P = R[k], Q = R[(k + 1) % n];
          const ex = Q.x - P.x, ey = Q.y - P.y;
          const den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-18) continue;
          const wx = P.x - ax, wy = P.y - ay;
          const t = (wx * ey - wy * ex) / den;
          const u = (wx * dy - wy * dx) / den;
          if (t < 0 || t > 1 || (t === 1 && !last) || u < 0 || u >= 1) continue;
          let node = null;
          if (u < 1e-10) node = P;
          else if (u > 1 - 1e-10) node = Q;
          hits.push({ pos: i + t, i, t, ri, k, u, node, x: ax + t * dx, y: ay + t * dy });
        }
      }
    }
    if (hits.length < 2) return null;
    hits.sort((a, b) => a.pos - b.pos || a.ri - b.ri || a.k - b.k);

    // 2. insertion des sommets d'intersection dans les contours
    const ins = new Map();
    for (const h of hits) {
      if (h.node) continue;
      const key = h.ri + ':' + h.k;
      if (!ins.has(key)) ins.set(key, []);
      ins.get(key).push(h);
    }
    const newNodes = [];
    for (let ri = 0; ri < rings.length; ri++) {
      const R = rings[ri], out = [];
      for (let k = 0; k < R.length; k++) {
        out.push(R[k]);
        const list = ins.get(ri + ':' + k);
        if (list) {
          list.sort((a, b) => a.u - b.u);
          for (const h of list) {
            const nd = { x: h.x, y: h.y, isNew: true };
            h.node = nd;
            newNodes.push(nd);
            out.push(nd);
          }
        }
      }
      rings[ri] = out;
    }
    // rattache les hits "snappés" à l'anneau de leur sommet (identité de noeud)
    // dédoublonnage : mêmes noeuds consécutifs
    const dd = [];
    for (const h of hits) {
      const p = dd[dd.length - 1];
      if (p && p.node === h.node && Math.abs(p.pos - h.pos) < 1e-9) continue;
      dd.push(h);
    }
    hits = dd;

    // 3. cordes : portions de ligne à l'intérieur entre deux intersections
    const chords = [];
    for (let j = 0; j + 1 < hits.length; j++) {
      const a = hits[j], b = hits[j + 1];
      if (a.node === b.node || b.pos - a.pos < 1e-12) continue;
      const m = (a.pos + b.pos) / 2;
      const si = Math.min(Math.floor(m), nL - 2);
      const tt = m - si;
      const mx = line[2 * si] + tt * (line[2 * si + 2] - line[2 * si]);
      const my = line[2 * si + 1] + tt * (line[2 * si + 3] - line[2 * si + 1]);
      if (!pointInNodeRings(mx, my, rings)) continue;
      const path = [];
      for (let v = a.i + 1; v <= b.i; v++) {
        if (v > a.pos + 1e-12 && v < b.pos - 1e-12) path.push({ x: line[2 * v], y: line[2 * v + 1] });
      }
      chords.push({ a: a.node, b: b.node, path, mx, my });
    }
    if (!chords.length) return null;

    // 4. application successive des cordes
    let faces = [{ rings }];
    const ringOf = (f, nd) => {
      for (let r = 0; r < f.rings.length; r++) if (f.rings[r].indexOf(nd) >= 0) return r;
      return -1;
    };
    for (const c of chords) {
      let cand = [];
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        if (ringOf(f, c.a) >= 0 && ringOf(f, c.b) >= 0) cand.push(fi);
      }
      if (!cand.length) continue;
      let fi = cand[0];
      if (cand.length > 1) {
        const hit = cand.find(k => pointInNodeRings(c.mx, c.my, faces[k].rings));
        if (hit !== undefined) fi = hit;
      }
      const f = faces[fi];
      const ra = ringOf(f, c.a), rb = ringOf(f, c.b);
      if (ra === rb) {
        if (ra !== 0) continue; // corde hole->même trou : non géré
        const R = f.rings[0];
        const ia = R.indexOf(c.a), ib = R.indexOf(c.b);
        const piece1 = subRing(R, ia, ib).concat(c.path.slice().reverse());
        const piece2 = subRing(R, ib, ia).concat(c.path);
        const f1 = { rings: [piece1] }, f2 = { rings: [piece2] };
        for (const h of f.rings.slice(1)) {
          if (pointInNodeRing(h[0].x, h[0].y, piece1)) f1.rings.push(h); else f2.rings.push(h);
        }
        faces.splice(fi, 1, f1, f2);
      } else {
        const A = f.rings[ra];
        let B = f.rings[rb];
        // extérieur+trou : sens opposés ; trou+trou : même sens (sinon le contour fusionné se recoupe)
        const wantOpposite = ra === 0 || rb === 0;
        if ((nodeArea(A) > 0) === (nodeArea(B) > 0) === wantOpposite) B = B.slice().reverse();
        const A2 = rotRing(A, A.indexOf(c.a));
        const B2 = rotRing(B, B.indexOf(c.b));
        const merged = A2.concat([c.a], c.path, B2, [c.b], c.path.slice().reverse());
        const rest = f.rings.filter((_, k) => k !== ra && k !== rb);
        // l'anneau extérieur reste en tête : fusionné s'il est concerné, sinon il est déjà dans `rest`
        f.rings = (ra === 0 || rb === 0) ? [merged].concat(rest) : rest.concat([merged]);
      }
    }
    if (faces.length < 2) return null;

    const polys = [];
    for (const f of faces) {
      const rs = f.rings.map(fromNodes).filter(Boolean);
      if (rs.length && fromNodes(f.rings[0])) polys.push(rs);
    }
    if (polys.length < 2) return null;
    return { polys, newPoints: newNodes.map(n => ({ x: n.x, y: n.y })) };
  }

  /* Insère le point (x,y) dans toute arête de `ring` qui le contient (hors extrémités).
     Renvoie true si inséré. */
  function insertOnRing(ring, x, y, tol) {
    const k = edgeIndexOn(ring, x, y, tol);
    if (k < 0) return false;
    ring.splice(2 * (k + 1), 0, x, y);
    return true;
  }

  /* Indice k de l'arête (k -> k+1) qui contient (x,y) hors extrémités, sinon -1. */
  function edgeIndexOn(ring, x, y, tol) {
    tol = tol || 1e-8;
    const n = ring.length / 2;
    for (let k = 0; k < n; k++) {
      const px = ring[2 * k], py = ring[2 * k + 1];
      const qx = ring[2 * ((k + 1) % n)], qy = ring[2 * ((k + 1) % n) + 1];
      const ex = qx - px, ey = qy - py;
      const len2 = ex * ex + ey * ey;
      if (len2 === 0) continue;
      const t = ((x - px) * ex + (y - py) * ey) / len2;
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const cx = px + t * ex - x, cy = py + t * ey - y;
      if (cx * cx + cy * cy > tol * tol) continue;
      return k;
    }
    return -1;
  }

  // ------------------------------------------- union / complément (arêtes)
  // Principe : on oriente tous les anneaux (extérieurs anti-horaires, trous horaires),
  // on annule les arêtes communes parcourues en sens opposé, puis on recolle les arêtes
  // restantes en boucles. Tous les sommets d'origine sont conservés (pas de simplification),
  // donc la topologie partagée avec les voisines reste intacte.
  const QK = 1e7;
  const vkey = (x, y) => Math.round(x * QK) + ',' + Math.round(y * QK);

  function reverseRing(r) {
    const n = r.length / 2, o = new Array(r.length);
    for (let i = 0; i < n; i++) { o[2 * i] = r[2 * (n - 1 - i)]; o[2 * i + 1] = r[2 * (n - 1 - i) + 1]; }
    return o;
  }

  function orientRing(r, ccw) { return (ringArea(r) > 0) === ccw ? r : reverseRing(r); }

  function polysArea(polys) {
    let a = 0;
    for (const p of polys) {
      a += Math.abs(ringArea(p[0]));
      for (let i = 1; i < p.length; i++) a -= Math.abs(ringArea(p[i]));
    }
    return a;
  }

  function pushEdges(r, out, reverse) {
    const n = r.length / 2;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      if (reverse) out.push({ x1: r[2 * j], y1: r[2 * j + 1], x2: r[2 * k], y2: r[2 * k + 1] });
      else out.push({ x1: r[2 * k], y1: r[2 * k + 1], x2: r[2 * j], y2: r[2 * j + 1] });
    }
  }

  function edgeLoops(edges) {
    const dir = new Map();
    for (const e of edges) {
      e.a = vkey(e.x1, e.y1); e.b = vkey(e.x2, e.y2);
      if (e.a === e.b) continue;
      const k = e.a + '>' + e.b;
      const l = dir.get(k);
      if (l) l.push(e); else dir.set(k, [e]);
    }
    const live = [];
    for (const list of dir.values()) {
      const opp = dir.get(list[0].b + '>' + list[0].a);
      const keep = list.length - Math.min(list.length, opp ? opp.length : 0);
      for (let i = 0; i < keep; i++) live.push(list[i]);
    }
    const outMap = new Map();
    for (const e of live) {
      const l = outMap.get(e.a);
      if (l) l.push(e); else outMap.set(e.a, [e]);
    }
    const used = new Set(), loops = [];
    for (const e0 of live) {
      if (used.has(e0)) continue;
      const ring = [];
      let cur = e0;
      for (;;) {
        used.add(cur);
        ring.push(cur.x1, cur.y1);
        if (cur.b === e0.a) break;
        const cands = (outMap.get(cur.b) || []).filter(c => !used.has(c));
        if (!cands.length) return { ok: false, loops };
        let best = cands[0];
        if (cands.length > 1) {
          const ix = cur.x2 - cur.x1, iy = cur.y2 - cur.y1;
          let ba = -Infinity;
          for (const c of cands) {
            const dx = c.x2 - c.x1, dy = c.y2 - c.y1;
            const ang = Math.atan2(ix * dy - iy * dx, ix * dx + iy * dy);
            if (ang > ba) { ba = ang; best = c; }
          }
        }
        cur = best;
      }
      loops.push(ring);
    }
    return { ok: true, loops };
  }

  /* Point-dans-anneau accéléré par tranches horizontales (pour les très gros anneaux). */
  function ringIndex(r) {
    const n = r.length / 2, bb = ringBBox(r), SL = Math.max(8, Math.min(1024, n >> 6));
    const h = (bb[3] - bb[1]) || 1, slabs = Array.from({ length: SL }, () => []);
    const sl = y => Math.max(0, Math.min(SL - 1, Math.floor((y - bb[1]) / h * SL)));
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = sl(r[2 * i + 1]), b = sl(r[2 * j + 1]);
      for (let s = Math.min(a, b); s <= Math.max(a, b); s++) slabs[s].push(j, i);
    }
    return {
      bb,
      has(x, y) {
        if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) return false;
        const list = slabs[sl(y)];
        let c = false;
        for (let k = 0; k < list.length; k += 2) {
          const j = list[k], i = list[k + 1];
          const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
          if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
        }
        return c;
      },
    };
  }

  /* boucles -> polygones [extérieur, trous...] ; null si un trou est orphelin */
  function assembleLoops(loops, minArea) {
    minArea = minArea === undefined ? 1e-14 : minArea;
    const outers = [], holes = [];
    for (const l of loops) {
      const a = ringArea(l);
      if (a > minArea) outers.push({ ring: l, area: a, holes: [], bb: ringBBox(l), idx: l.length > 4000 ? ringIndex(l) : null });
      else if (a < -minArea) holes.push({ ring: l, area: -a, bb: ringBBox(l) });
    }
    for (const h of holes) {
      let best = null;
      const n = h.ring.length / 2, S = Math.min(n, 5);
      for (const o of outers) {
        if (o.area <= h.area) continue;
        if (h.bb[0] < o.bb[0] || h.bb[2] > o.bb[2] || h.bb[1] < o.bb[1] || h.bb[3] > o.bb[3]) continue;
        let inside = 0;
        for (let s = 0; s < S; s++) {
          const i = Math.floor(s * n / S), x = h.ring[2 * i], y = h.ring[2 * i + 1];
          if (o.idx ? o.idx.has(x, y) : pointInRing(x, y, o.ring)) inside++;
        }
        if (inside * 2 >= S && (!best || o.area < best.area)) best = o;
      }
      if (!best) return null;
      best.holes.push(h.ring);
    }
    return outers.map(o => [o.ring].concat(o.holes));
  }

  /* Union de deux listes de polygones. null si les contours ne se recollent pas
     (arêtes non concordantes, chevauchement...) : l'appelant garde alors les deux. */
  function unionPolys(a, b) {
    const edges = [];
    for (const polys of [a, b]) for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) pushEdges(orientRing(poly[i], i === 0), edges, false);
    }
    const res = edgeLoops(edges);
    if (!res.ok) return null;
    const out = assembleLoops(res.loops);
    if (!out || !out.length) return null;
    const want = polysArea(a) + polysArea(b), got = polysArea(out);
    if (Math.abs(got - want) > 1e-9 * want + 1e-12) return null;
    return out;
  }

  /* Complément de `allPolys` dans le rectangle rect=[x0,y0,x1,y1] (sert à générer les océans). */
  function complementPolys(rect, allPolys) {
    const [x0, y0, x1, y1] = rect, tol = 1e-9, edges = [];
    for (const poly of allPolys) for (let i = 0; i < poly.length; i++) pushEdges(orientRing(poly[i], i === 0), edges, true);
    const side = { b: [x0, x1], r: [y0, y1], t: [x0, x1], l: [y0, y1] };
    for (const e of edges.slice()) {
      for (const [x, y] of [[e.x1, e.y1], [e.x2, e.y2]]) {
        if (Math.abs(y - y0) < tol) side.b.push(x);
        if (Math.abs(x - x1) < tol) side.r.push(y);
        if (Math.abs(y - y1) < tol) side.t.push(x);
        if (Math.abs(x - x0) < tol) side.l.push(y);
      }
    }
    const uniq = (arr, asc) => {
      const s = arr.slice().sort((p, q) => asc ? p - q : q - p), o = [];
      for (const v of s) if (!o.length || Math.abs(v - o[o.length - 1]) > tol) o.push(v);
      return o;
    };
    const B = uniq(side.b, true), R = uniq(side.r, true), T = uniq(side.t, false), L = uniq(side.l, false);
    for (let i = 0; i + 1 < B.length; i++) edges.push({ x1: B[i], y1: y0, x2: B[i + 1], y2: y0 });
    for (let i = 0; i + 1 < R.length; i++) edges.push({ x1: x1, y1: R[i], x2: x1, y2: R[i + 1] });
    for (let i = 0; i + 1 < T.length; i++) edges.push({ x1: T[i], y1: y1, x2: T[i + 1], y2: y1 });
    for (let i = 0; i + 1 < L.length; i++) edges.push({ x1: x0, y1: L[i], x2: x0, y2: L[i + 1] });
    const res = edgeLoops(edges);
    if (!res.ok) return null;
    return assembleLoops(res.loops, 1e-10);
  }

  /* intersection stricte (croisement propre) de deux segments */
  function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-18) return false;
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den;
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
    const e = 1e-9;
    return t > e && t < 1 - e && u > e && u < 1 - e;
  }

  // ---------------------------------------------------------- utilitaires
  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  function autoColor(i) {
    const h = (i * 137.508) % 360;
    return hsl(h, 48 + (i * 7) % 22, 42 + (i * 13) % 20);
  }

  // ------------------------------------------------------------------ zip
  let CRC = null;
  function crc32(b) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* files : [{name, data:Uint8Array}] -> Uint8Array (zip sans compression) */
  function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let off = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true);
      ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true);
      ch.setUint32(24, sz, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + sz;
    }
    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    let total = 0;
    for (const p of all) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  const api = {
    ringArea, ringBBox, polyBBox, pointInRing, pointInPoly, clonePoly, cloneProv,
    splitPoly, insertOnRing, edgeIndexOn, reverseRing, orientRing, polysArea, unionPolys, complementPolys, segCross, hsl, autoColor, crc32, makeZip,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BopCore = api;
})(typeof self !== 'undefined' ? self : this);
