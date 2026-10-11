/* BoP Vector Map Editor - vectorisation d'une image (sans DOM, testable sous node / navigateur).
   segment()   : image RGBA -> carte d'étiquettes (une étiquette par zone « plate » : province de l'image).
   vectorize() : carte d'étiquettes -> polygones (pixels) avec frontières PARTAGÉES entre voisines
                 (chaque frontière est simplifiée une seule fois puis réutilisée des deux côtés). */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------ segmentation */
  // min/max glissant séparable (fenêtre (2r+1)²) sur un canal
  function minMaxFilter(src, W, H, r, isMax) {
    const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 0; x < W; x++) {
        let v = src[o + x];
        const a = Math.max(0, x - r), b = Math.min(W - 1, x + r);
        for (let k = a; k <= b; k++) { const s = src[o + k]; if (isMax ? s > v : s < v) v = s; }
        tmp[o + x] = v;
      }
    }
    for (let y = 0; y < H; y++) {
      const a = Math.max(0, y - r), b = Math.min(H - 1, y + r);
      for (let x = 0; x < W; x++) {
        let v = tmp[y * W + x];
        for (let k = a; k <= b; k++) { const s = tmp[k * W + x]; if (isMax ? s > v : s < v) v = s; }
        out[y * W + x] = v;
      }
    }
    return out;
  }

  /* img = {data (RGBA), width, height}.
     opts : tol (écart de couleur max dans une zone plate, 0-255), r (rayon : épaisseur des traits à franchir),
            minArea (pixels : en dessous, la zone est ignorée = bruit/texte).
     Retour : { W, H, labels (Int32Array, 1..n, jamais 0), n, info[1..n] = {area, color, bg, border} } */
  function segment(img, opts) {
    opts = opts || {};
    const tol = opts.tol === undefined ? 24 : opts.tol, r = opts.r === undefined ? 1 : opts.r;
    const W = img.width, H = img.height, N = W * H, d = img.data;
    const ch = [new Uint8Array(N), new Uint8Array(N), new Uint8Array(N)];
    const transparent = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const a = d[4 * i + 3] / 255;
      if (a < 0.5) transparent[i] = 1;
      for (let c = 0; c < 3; c++) ch[c][i] = Math.round(d[4 * i + c] * a + 255 * (1 - a));
    }
    // zone plate = fenêtre sans contraste (trait, texte, bord de couleur => non plate)
    const flat = new Uint8Array(N).fill(1);
    for (let c = 0; c < 3; c++) {
      const mx = minMaxFilter(ch[c], W, H, r, true), mn = minMaxFilter(ch[c], W, H, r, false);
      for (let i = 0; i < N; i++) if (mx[i] - mn[i] > tol) flat[i] = 0;
    }
    // composantes connexes (4) des pixels plats
    const comp = new Int32Array(N);            // 0 = pas de composante
    const stack = new Int32Array(N);
    const raw = [];                            // {area, sum, border}
    for (let s = 0; s < N; s++) {
      if (!flat[s] || comp[s]) continue;
      const id = raw.length + 1;
      let sp = 0, area = 0, sr = 0, sg = 0, sb = 0, border = false, tr = 0;
      stack[sp++] = s; comp[s] = id;
      while (sp) {
        const p = stack[--sp], x = p % W, y = (p - x) / W;
        area++; sr += ch[0][p]; sg += ch[1][p]; sb += ch[2][p]; tr += transparent[p];
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
        if (x > 0 && flat[p - 1] && !comp[p - 1]) { comp[p - 1] = id; stack[sp++] = p - 1; }
        if (x < W - 1 && flat[p + 1] && !comp[p + 1]) { comp[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && flat[p - W] && !comp[p - W]) { comp[p - W] = id; stack[sp++] = p - W; }
        if (y < H - 1 && flat[p + W] && !comp[p + W]) { comp[p + W] = id; stack[sp++] = p + W; }
      }
      raw.push({ area, color: [Math.round(sr / area), Math.round(sg / area), Math.round(sb / area)], border, transp: tr > area / 2 });
    }
    // on garde les zones assez grandes ; les petites zones sombres (lettres épaisses) sont du texte
    const minArea = opts.minArea === undefined ? 30 : opts.minArea;
    const map = new Int32Array(raw.length + 1);
    const info = [null];
    for (let i = 0; i < raw.length; i++) {
      const q = raw[i], lum = (q.color[0] + q.color[1] + q.color[2]) / 3;
      if (q.area < minArea || (lum < 110 && q.area < Math.max(minArea * 12, 500))) continue;
      map[i + 1] = info.length;
      info.push({ area: 0, color: q.color, border: q.border, bg: q.transp || (q.color[0] >= 250 && q.color[1] >= 250 && q.color[2] >= 250) });
    }
    const n = info.length - 1;
    const labels = new Int32Array(N);
    if (!n) return { W, H, labels, n: 0, info };
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) { if (comp[i] && map[comp[i]]) { labels[i] = map[comp[i]]; } }
    // absorption : les pixels de trait/texte/dégradé prennent l'étiquette voisine la plus proche
    for (let p = 0; p < N; p++) {
      if (!labels[p]) continue;
      const x = p % W, y = (p - x) / W;
      if ((x > 0 && !labels[p - 1]) || (x < W - 1 && !labels[p + 1]) || (y > 0 && !labels[p - W]) || (y < H - 1 && !labels[p + W])) queue[qt++] = p;
    }
    while (qh < qt) {
      const p = queue[qh++], x = p % W, y = (p - x) / W, l = labels[p];
      if (x > 0 && !labels[p - 1]) { labels[p - 1] = l; queue[qt++] = p - 1; }
      if (x < W - 1 && !labels[p + 1]) { labels[p + 1] = l; queue[qt++] = p + 1; }
      if (y > 0 && !labels[p - W]) { labels[p - W] = l; queue[qt++] = p - W; }
      if (y < H - 1 && !labels[p + W]) { labels[p + W] = l; queue[qt++] = p + W; }
    }
    for (let i = 0; i < N; i++) info[labels[i]].area++;
    return { W, H, labels, n, info };
  }

  /* ------------------------------------------------------------ vectorisation */
  function dp(pts, eps) {      // Douglas-Peucker sur [x0,y0,x1,y1...] (extrémités conservées)
    const n = pts.length / 2;
    if (n <= 2) return pts.slice();
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const st = [[0, n - 1]];
    while (st.length) {
      const [a, b] = st.pop();
      const ax = pts[2 * a], ay = pts[2 * a + 1], bx = pts[2 * b], by = pts[2 * b + 1];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      let md = -1, mi = -1;
      for (let i = a + 1; i < b; i++) {
        const px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay;
        const dd = L < 1e-12 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / L;
        if (dd > md) { md = dd; mi = i; }
      }
      if (md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
    return out;
  }
  function smooth(pts, it) {   // lissage léger des escaliers de pixels, extrémités fixes
    let a = pts;
    const n = a.length / 2;
    if (n < 4) return a;
    for (let k = 0; k < it; k++) {
      const b = a.slice();
      for (let i = 1; i < n - 1; i++) {
        b[2 * i] = 0.25 * a[2 * i - 2] + 0.5 * a[2 * i] + 0.25 * a[2 * i + 2];
        b[2 * i + 1] = 0.25 * a[2 * i - 1] + 0.5 * a[2 * i + 1] + 0.25 * a[2 * i + 3];
      }
      a = b;
    }
    return a;
  }
  function ringArea(r) {
    let a = 0; const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) a += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
    return a / 2;
  }
  function inRing(x, y, r) {
    let c = false; const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  /* labels : Int32Array W*H ; keep : Uint8Array indexé par étiquette (1 = on vectorise, 0 = ignorée).
     Retour : Map étiquette -> polys [[extérieur, ...trous], ...] (anneaux plats en pixels, y vers le bas). */
  function vectorize(labels, W, H, keep, opts) {
    opts = opts || {};
    const eps = opts.eps === undefined ? 0.6 : opts.eps, sm = opts.smooth === undefined ? 2 : opts.smooth;
    const M = new Int32Array(W * H);
    for (let i = 0; i < M.length; i++) M[i] = keep[labels[i]] ? labels[i] : 0;
    const lab = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : M[y * W + x];
    const HN = W * (H + 1), VN = (W + 1) * H, NW = W + 1;
    const used = new Uint8Array(HN + VN), exists = new Uint8Array(HN + VN);
    const deg = new Uint8Array((W + 1) * (H + 1));
    for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) if (lab(x, y - 1) !== lab(x, y)) { exists[y * W + x] = 1; deg[y * NW + x]++; deg[y * NW + x + 1]++; }
    for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) if (lab(x - 1, y) !== lab(x, y)) { exists[HN + y * NW + x] = 1; deg[y * NW + x]++; deg[(y + 1) * NW + x]++; }
    // arêtes incidentes d'un coin : [id arête, nœud d'arrivée, dx, dy]
    const around = (cx, cy) => {
      const o = [];
      if (cx < W && exists[cy * W + cx]) o.push([cy * W + cx, cy * NW + cx + 1, 1, 0]);
      if (cx > 0 && exists[cy * W + cx - 1]) o.push([cy * W + cx - 1, cy * NW + cx - 1, -1, 0]);
      if (cy < H && exists[HN + cy * NW + cx]) o.push([HN + cy * NW + cx, (cy + 1) * NW + cx, 0, 1]);
      if (cy > 0 && exists[HN + (cy - 1) * NW + cx]) o.push([HN + (cy - 1) * NW + cx, (cy - 1) * NW + cx, 0, -1]);
      return o;
    };
    const chains = [];
    const trace = (sx, sy, first) => {
      const pts = [sx, sy];
      let cx = sx, cy = sy, e = first, fdx = first[2], fdy = first[3], ldx = 0, ldy = 0;
      for (;;) {
        used[e[0]] = 1;
        cx += e[2]; cy += e[3]; ldx = e[2]; ldy = e[3];
        pts.push(cx, cy);
        const nid = cy * NW + cx;
        if (deg[nid] !== 2 || (cx === sx && cy === sy)) break;
        const nx = around(cx, cy).find(q => q[0] !== e[0] && !used[q[0]]);
        if (!nx) break;
        e = nx;
      }
      // pixels à gauche / à droite de la première arête
      let L, R;
      if (fdx === 1) { L = lab(sx, sy - 1); R = lab(sx, sy); }
      else if (fdx === -1) { L = lab(sx - 1, sy); R = lab(sx - 1, sy - 1); }
      else if (fdy === 1) { L = lab(sx, sy); R = lab(sx - 1, sy); }
      else { L = lab(sx - 1, sy - 1); R = lab(sx, sy - 1); }
      chains.push({ s: sy * NW + sx, e: cy * NW + cx, pts, L, R, d0: [fdx, fdy], d1: [ldx, ldy] });
    };
    for (let cy = 0; cy <= H; cy++) for (let cx = 0; cx <= W; cx++) {
      if (deg[cy * NW + cx] === 2 || !deg[cy * NW + cx]) continue;
      for (const q of around(cx, cy)) if (!used[q[0]]) trace(cx, cy, q);
    }
    for (let cy = 0; cy <= H; cy++) for (let cx = 0; cx <= W; cx++) {   // boucles pures (sans jonction)
      if (deg[cy * NW + cx] !== 2) continue;
      for (const q of around(cx, cy)) if (!used[q[0]]) trace(cx, cy, q);
    }
    // simplification unique par chaîne (donc frontière identique des deux côtés)
    for (const c of chains) c.sp = dp(smooth(c.pts, sm), eps);
    // demi-arêtes par étiquette
    const byLabel = new Map();
    const add = (l, h) => {
      if (!l) return;
      let m = byLabel.get(l); if (!m) byLabel.set(l, m = { all: [], start: new Map() });
      m.all.push(h);
      let a = m.start.get(h.from); if (!a) m.start.set(h.from, a = []);
      a.push(h);
    };
    for (const c of chains) {
      add(c.L, { pts: c.sp, from: c.s, to: c.e, dOut: c.d0, dIn: c.d1, used: false });
      const rv = []; for (let i = c.sp.length - 2; i >= 0; i -= 2) rv.push(c.sp[i], c.sp[i + 1]);
      add(c.R, { pts: rv, from: c.e, to: c.s, dOut: [-c.d1[0], -c.d1[1]], dIn: [-c.d0[0], -c.d0[1]], used: false });
    }
    const result = new Map();
    for (const [l, m] of byLabel) {
      const rings = [];
      for (const h0 of m.all) {
        if (h0.used) continue;
        let h = h0, ring = [];
        for (;;) {
          h.used = true;
          for (let i = 0; i < h.pts.length - 2; i += 2) ring.push(h.pts[i], h.pts[i + 1]);
          const cands = (m.start.get(h.to) || []).filter(q => !q.used || q === h0);
          if (!cands.length) { ring = null; break; }
          let best = cands[0], bt = -9;
          if (cands.length > 1) for (const q of cands) {
            const t = Math.atan2(h.dIn[0] * q.dOut[1] - h.dIn[1] * q.dOut[0], h.dIn[0] * q.dOut[0] + h.dIn[1] * q.dOut[1]);
            if (t > bt) { bt = t; best = q; }
          }
          if (best === h0) break;
          h = best;
        }
        if (ring && ring.length >= 6) rings.push(ring);
      }
      if (!rings.length) continue;
      const areas = rings.map(ringArea);
      let big = 0; for (let i = 1; i < areas.length; i++) if (Math.abs(areas[i]) > Math.abs(areas[big])) big = i;
      const sgn = Math.sign(areas[big]), outers = [], holes = [];
      rings.forEach((r, i) => { (Math.sign(areas[i]) === sgn ? outers : holes).push({ r, a: Math.abs(areas[i]) }); });
      const polys = outers.map(o => [o.r]);
      for (const h of holes) {
        let host = -1, ha = Infinity;
        outers.forEach((o, i) => { if (o.a > h.a && o.a < ha && inRing(h.r[0], h.r[1], o.r)) { host = i; ha = o.a; } });
        if (host >= 0) polys[host].push(h.r);
      }
      result.set(l, polys);
    }
    return result;
  }

  const api = { segment, vectorize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VEC = api;
})(typeof window !== 'undefined' ? window : globalThis);
