// Stroke module: derives a pen path (ordered centreline strokes) from any glyph and paints the glyph in along that path.
const Stroke = (() => {
  const R = 2;            // skeleton raster scale (pixels per css px)
  const MASK_W = 7.5;     // css-px width of the brush swath that reveals the glyph
  const cache = new Map();
  const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

  // Empties every cached glyph (needed when device scale or ink colour changes).
  function clear() { cache.clear(); }

  // Thins a binary bitmap to a one-pixel centreline using Zhang-Suen thinning, in place.
  function thin(b, w, h) {
    let changed = true;
    const kill = [];
    while (changed) {
      changed = false;
      for (let step = 0; step < 2; step++) {
        kill.length = 0;
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!b[i]) continue;
          const p2 = b[i - w], p3 = b[i - w + 1], p4 = b[i + 1], p5 = b[i + w + 1], p6 = b[i + w], p7 = b[i + w - 1], p8 = b[i - 1], p9 = b[i - w - 1];
          const n = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (n < 2 || n > 6) continue;
          const t = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (t !== 1) continue;
          if (step === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
          kill.push(i);
        }
        if (kill.length) { changed = true; for (const i of kill) b[i] = 0; }
      }
    }
  }

  // Lists the set neighbours of pixel index i in a bitmap.
  function nbrs(b, w, i) {
    const x = i % w, y = (i / w) | 0, out = [];
    for (const [dx, dy] of N8) { const j = (y + dy) * w + x + dx; if (b[j]) out.push(j); }
    return out;
  }

  // Walks a thinned bitmap into pen strokes, starting top-left first and preferring straight continuation at junctions.
  function trace(b, w, h) {
    const seen = new Uint8Array(b.length), strokes = [];
    const pts = [];
    for (let i = 0; i < b.length; i++) if (b[i]) pts.push(i);
    let pen = null, left = pts.length;
    while (left > 0) {
      let start = -1, best = Infinity;
      for (const i of pts) {
        if (seen[i]) continue;
        const x = i % w, y = (i / w) | 0;
        const open = nbrs(b, w, i).filter(j => !seen[j]).length;
        const score = (pen ? Math.hypot(x - pen[0], y - pen[1]) * 1.0 : x * 0.6 + y) + (open <= 1 ? 0 : 6);
        if (score < best) { best = score; start = i; }
      }
      if (start < 0) break;
      const line = []; let cur = start;
      while (cur >= 0) {
        seen[cur] = 1; left--; line.push([cur % w, (cur / w) | 0]);
        const cand = nbrs(b, w, cur).filter(j => !seen[j]);
        if (!cand.length) break;
        if (cand.length === 1) { cur = cand[0]; continue; }
        const back = line[Math.max(0, line.length - 5)], dx = line[line.length - 1][0] - back[0], dy = line[line.length - 1][1] - back[1];
        let bj = cand[0], bs = -Infinity;
        for (const j of cand) {
          const sx = j % w - line[line.length - 1][0], sy = ((j / w) | 0) - line[line.length - 1][1];
          const s = (sx * dx + sy * dy) / (Math.hypot(sx, sy) * (Math.hypot(dx, dy) || 1));
          if (s > bs) { bs = s; bj = j; }
        }
        cur = bj;
      }
      strokes.push(line); pen = line[line.length - 1];
    }
    return strokes;
  }

  // Converts traced strokes into flat css-space segments with cumulative lengths for incremental drawing.
  function toSegments(strokes, padX, oy) {
    const segs = []; let cum = 0;
    for (const s of strokes) {
      if (s.length === 1) { const x = s[0][0] / R - padX, y = s[0][1] / R - oy; segs.push({ x0: x, y0: y, x1: x + 0.01, y1: y, c0: cum, c1: cum + 3, up: true }); cum += 3; continue; }
      for (let i = 0; i < s.length - 1; i += 1) {
        const x0 = s[i][0] / R - padX, y0 = s[i][1] / R - oy, x1 = s[i + 1][0] / R - padX, y1 = s[i + 1][1] / R - oy;
        const l = Math.hypot(x1 - x0, y1 - y0);
        segs.push({ x0, y0, x1, y1, c0: cum, c1: cum + l, up: i === 0 }); cum += l;
      }
    }
    return { segs, L: cum };
  }

  // Builds (or fetches) the cached glyph image, scratch canvas and pen path for one character.
  function get(ch, font, size, dpr, adv) {
    const key = ch + '|' + font + '|' + dpr;
    let e = cache.get(key);
    if (e) return e;
    const padX = size * 0.4, oy = size * 1.15, cw = Math.ceil(adv + padX * 2), chh = Math.ceil(size * 1.9);
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr); return c; };
    const G = mk(cw, chh), gx = G.getContext('2d');
    gx.scale(dpr, dpr); gx.font = font; gx.fillStyle = Stroke.ink || '#000'; gx.strokeStyle = gx.fillStyle; gx.lineWidth = 1.1; gx.lineJoin = 'round'; gx.fillText(ch, padX, oy); gx.strokeText(ch, padX, oy);
    const S = document.createElement('canvas'); S.width = Math.ceil(cw * R); S.height = Math.ceil(chh * R);
    const sx = S.getContext('2d', { willReadFrequently: true });
    sx.scale(R, R); sx.font = font; sx.fillStyle = '#000'; sx.fillText(ch, padX, oy);
    const d = sx.getImageData(0, 0, S.width, S.height).data, b = new Uint8Array(S.width * S.height);
    for (let i = 0; i < b.length; i++) b[i] = d[i * 4 + 3] > 110 ? 1 : 0;
    thin(b, S.width, S.height);
    const { segs, L } = toSegments(trace(b, S.width, S.height), padX, oy);
    e = { G, cw, ch: chh, padX, oy, segs, L, dpr };
    cache.set(key, e);
    return e;
  }

  // Advances a glyph's pen along its path up to distance d, calling emit for each newly covered segment.
  function sweep(e, an, d, emit) {
    const s = e.segs;
    while (an.k < s.length && s[an.k].c1 <= d) { const q = s[an.k++]; emit(q.x0, q.y0, q.x1, q.y1); an.x = q.x1; an.y = q.y1; }
    if (an.k < s.length && s[an.k].c0 < d) {
      const q = s[an.k], f = (d - q.c0) / (q.c1 - q.c0);
      an.x = q.x0 + (q.x1 - q.x0) * f; an.y = q.y0 + (q.y1 - q.y0) * f;
      emit(q.x0, q.y0, an.x, an.y);
    }
    an.d = d;
  }

  return { get, sweep, clear, MASK_W, ink: null };
})();
