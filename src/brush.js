// Brush module: text model, styled markdown layout, and the per-glyph painted-in animation; knows nothing about DOM events or files.
const Brush = (() => {
  const SIZE = 38, LINE = 62, MARGIN = 140, ASC = 0.72, KDUR = 0.28, VDUR = 0.24, BLUR = 3;
  const PLAIN = Markdown.plain(SIZE);
  const ADV = new Map();
  const state = { chars: [], caret: 0, scroll: 0, scrollTarget: 0, cx: MARGIN, cy: LINE, w: 0, h: 0, dpr: 1, rows: [], car: new Float64Array(3), lines: Markdown.parse('', SIZE).lines, spans: [null] };
  const active = new Set();
  const anim = new Set();
  let lineAnim = false;
  let wetG = null, wetW = null, wetT = null, wetGC = null, wetWC = null, wetTC = null, wetCanvasW = 0, wetCanvasH = 0, wetDirty = true, wetUsed = false, ink = null, inkCtx = null, inkScroll = -1, measure = null, measureFont = '', tx = [MARGIN, MARGIN, SIZE];

  // Creates a text-model glyph with its own random hand-made jitter.
  function makeChar(c, born) {
    return { c, born, x: 0, y: 0, rot: (Math.random() - 0.5) * 0.07, dy: (Math.random() - 0.5) * 3.5, sc: 0.96 + Math.random() * 0.09, adv: 0, st: PLAIN, pst: null, k: 1, vis: 1, sz: SIZE, fresh: true, hide: 0, span: 0, hidden: false, ln: 0 };
  }

  // Returns the advance width of a character in a style's font, cached.
  function advance(ch, st) {
    const key = st.font + '|' + ch;
    if (ADV.has(key)) return ADV.get(key);
    if (!measure) measure = document.createElement('canvas').getContext('2d');
    if (measureFont !== st.font) { measure.font = st.font; measureFont = st.font; }
    const w = ch === '\t' ? measure.measureText(' ').width * 4 : measure.measureText(ch).width;
    ADV.set(key, w);
    return w;
  }

  // Resizes the visible canvases and the settled-ink cache to the window at device resolution.
  function resize(canvas, w, h, dpr) {
    state.w = w; state.h = h; state.dpr = dpr;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ink = document.createElement('canvas'); ink.width = canvas.width; ink.height = canvas.height;
    inkCtx = ink.getContext('2d'); inkScroll = -1;
    wetCanvasW = canvas.width; wetCanvasH = canvas.height;
    [wetGC, wetWC, wetTC] = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; return c; });
    wetG = wetGC.getContext('2d'); wetW = wetWC.getContext('2d'); wetT = wetTC.getContext('2d'); wetDirty = true;
    Stroke.clear(); Stroke.ink = Paper.css(Paper.current().ink);
    relayout(false);
  }

  // Eases 0..1 progress with a smoothstep curve.
  function ease(t) { return t * t * (3 - 2 * t); }

  // Re-parses the markdown and copies each character's style, marker flag and span id onto the glyph model.
  function restyle() {
    const cs = state.chars, P = Markdown.parse(text(), SIZE);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i], st = P.styles[i];
      if (c.st !== st) {
        if (!c.fresh && c.vis > 0.01 && c.c !== '\n' && !active.has(c)) { c.pst = c.st; c.k = 0; anim.add(c); } else { c.pst = null; c.k = 1; }
        c.st = st; c.dur = 0; wetDirty = true;
      }
      c.hide = P.hide[i]; c.span = P.span[i];
    }
    const old = state.lines;
    P.lines.forEach((L, i) => { if (old[i]) L.rv = old[i].rv; });
    state.lines = P.lines; state.spans = P.spans;
  }

  // Lays out the styled document: marker reveal, word-wrap into rows, per-row heights, glyph positions and the caret target.
  function relayout(follow = true) {
    const cs = state.chars, n = cs.length, lines = state.lines, spans = state.spans, k = Math.min(state.caret, n), maxX = state.w - MARGIN;
    for (const L of lines) L.rev = k >= L.start && k <= L.end;
    for (const c of cs) {
      const sp = c.span ? spans[c.span] : null;
      c.hidden = !!c.hide && !(sp && k >= sp[0] && k <= sp[1]);
      if (c.fresh) { c.vis = c.hidden ? 0 : 1; c.fresh = false; } else if (c.vis !== (c.hidden ? 0 : 1)) anim.add(c);
      const e = c.k < 1 && c.pst ? ease(c.k) : 1;
      c.sz = e < 1 ? c.pst.size + (c.st.size - c.pst.size) * e : c.st.size;
      c.adv = c.c === '\n' ? 0 : (e < 1 ? advance(c.c, c.pst) + (advance(c.c, c.st) - advance(c.c, c.pst)) * e : advance(c.c, c.st)) * ease(c.vis);
    }
    lineAnim = lines.some(L => L.rv !== (L.rev ? 0 : 1));
    // Where a row starts: its first row hangs left by the visible prefix so content stays put.
    const startX = (L, first) => {
      let x = MARGIN + L.indent;
      if (first) for (let j = L.start; j < L.prefixEnd; j++) x -= cs[j].adv;
      return x;
    };
    const rows = [];
    let rs = 0, ln = 0, first = true, x = startX(lines[0], true), lastSp = -1;
    for (let i = 0; i < n; i++) {
      const c = cs[i]; c.ln = ln;
      if (c.c === '\n') {
        rows.push({ start: rs, end: i + 1, line: lines[ln], first });
        rs = i + 1; ln++; first = true; x = startX(lines[ln], true); lastSp = -1; continue;
      }
      if (x + c.adv > maxX && i > rs && c.c !== ' ') {
        const b = lastSp >= rs ? lastSp + 1 : i;
        rows.push({ start: rs, end: b, line: lines[ln], first });
        rs = b; first = false; x = startX(lines[ln], false);
        for (let j = rs; j < i; j++) x += cs[j].adv;
        lastSp = -1;
      }
      x += c.adv;
      if (c.c === ' ') lastSp = i;
    }
    rows.push({ start: rs, end: n, line: lines[ln], first });
    const car = new Float64Array((n + 1) * 3);
    let top = MARGIN - ASC * LINE;
    for (let r = 0; r < rows.length; r++) {
      const R = rows[r];
      let s = Math.max(SIZE, R.line.size);
      for (let j = R.start; j < R.end; j++) if (cs[j].sz > s) s = cs[j].sz;
      R.s = s; R.h = LINE * s / SIZE;
      if (R.first && R.line.kind === 'h' && r > 0) top += R.h * 0.3;
      R.top = top; R.y = top + ASC * R.h; top += R.h;
      let px = startX(R.line, R.first);
      for (let j = R.start; j < R.end; j++) { const c = cs[j]; c.x = px; c.y = R.y; px += c.adv; car[3 * j] = c.x; car[3 * j + 1] = R.y; car[3 * j + 2] = R.s; }
      R.x1 = px;
      if (r === rows.length - 1) { car[3 * n] = px; car[3 * n + 1] = R.y; car[3 * n + 2] = R.s; }
    }
    state.rows = rows; state.car = car;
    tx = [car[3 * k], car[3 * k + 1], car[3 * k + 2]];
    state.docEnd = rows[rows.length - 1].y;
    let t = state.scrollTarget;
    if (follow) {
      if (tx[1] - LINE * 1.6 < t) t = tx[1] - LINE * 1.6;
      if (tx[1] + LINE * 1.6 > t + state.h) t = tx[1] + LINE * 1.6 - state.h;
    }
    state.scrollTarget = Math.max(0, Math.min(t, Math.max(0, state.docEnd + LINE * 2 - state.h)));
    inkScroll = -1; wetDirty = true;
  }

  // Inserts text at the caret; each glyph gets its own birth time (delayFn staggers them).
  function insert(text, now, delayFn) {
    const made = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\r') continue;
      made.push(makeChar(text[i], now + (delayFn ? delayFn(i) : 0)));
    }
    state.chars.splice(state.caret, 0, ...made);
    state.caret += made.length;
    restyle(); relayout(); warmChars(made);
    for (const c of made) if (c.c.trim() && !c.hidden) active.add(c);
    return made;
  }

  // Replaces the whole document, then paints every glyph in as a parallel diagonal wave.
  function load(text, now) {
    state.chars = []; state.caret = 0; active.clear(); anim.clear();
    const clean = text.replace(/\r/g, '');
    insert(clean, now, null);
    const maxX = state.w - MARGIN, rows = new Set();
    for (const c of state.chars) rows.add(c.y);
    for (const c of state.chars) {
      c.born = now + Math.min(1400, (c.x - MARGIN) * 0.35 + (c.y - MARGIN) * 0.9 + Math.random() * 40);
    }
    state.caret = 0; state.scroll = 0; state.scrollTarget = 0; state.cur = null; relayout();
    return Math.min(1400, maxX * 0.35 + rows.size * LINE * 0.9);
  }

  // Deletes one glyph before (dir<0) or after (dir>0) the caret and reports whether anything changed.
  function remove(dir) {
    const i = dir < 0 ? state.caret - 1 : state.caret;
    if (i < 0 || i >= state.chars.length) return false;
    active.delete(state.chars[i]); anim.delete(state.chars[i]); wetDirty = true;
    state.chars.splice(i, 1);
    if (dir < 0) state.caret--;
    restyle(); relayout();
    return true;
  }

  // Returns the row index holding the caret.
  function caretRow() {
    const i = state.rows.findIndex(R => Math.abs(R.y - tx[1]) < 0.5);
    return i < 0 ? 0 : i;
  }

  // Returns the last caret index that belongs to a row (the final row also owns the end of the document).
  function rowEnd(r) { return r === state.rows.length - 1 ? state.chars.length : state.rows[r].end - 1; }

  // Moves the caret by a column delta or a row delta, clamped to the document.
  function move(dCol, dRow) {
    const cs = state.chars;
    if (dRow) {
      const r = Math.max(0, Math.min(state.rows.length - 1, caretRow() + dRow)), R = state.rows[r];
      let best = state.caret, bestD = Infinity;
      for (let i = R.start; i <= rowEnd(r); i++) {
        const d = Math.abs(state.car[3 * i] - tx[0]);
        if (d < bestD) { bestD = d; best = i; }
      }
      state.caret = best;
    } else state.caret = Math.max(0, Math.min(cs.length, state.caret + dCol));
    relayout();
  }

  // Builds the pen path for every distinct glyph in a plain string so no frame pays that cost mid-animation.
  function warm(str) {
    for (const ch of new Set(str)) if (ch.trim()) Stroke.get(ch, PLAIN.font, PLAIN.size, state.dpr, advance(ch, PLAIN));
  }

  // Builds the pen path for every distinct visible (glyph, style) pair in a list of characters.
  function warmChars(list) {
    const seen = new Set();
    for (const c of list) {
      if (!c.c.trim() || c.hidden) continue;
      const key = c.st.font + c.c;
      if (seen.has(key)) continue;
      seen.add(key);
      Stroke.get(c.c, c.st.font, c.st.size, state.dpr, advance(c.c, c.st));
    }
  }

  // Scrolls the page by a pixel delta without moving the caret, clamped to the document.
  function scrollBy(dy) {
    const max = Math.max(0, state.docEnd + LINE * 2 - state.h);
    state.scrollTarget = Math.max(0, Math.min(max, state.scrollTarget + dy));
  }

  // Finds the caret index nearest a window-space click point.
  function indexAt(px, py) {
    const ty = py + state.scrollTarget + SIZE * 0.35, car = state.car, n = state.chars.length;
    let best = n, bd = Infinity;
    for (let i = 0; i <= n; i++) {
      const d = Math.abs(car[3 * i + 1] - ty) * 4 + Math.abs(car[3 * i] - px);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Puts the caret at a window-space point.
  function placeCaret(px, py) { state.caret = indexAt(px, py); relayout(); }

  // Returns the caret index one word away: backward lands on the word start, forward on the next word start.
  function wordTarget(dir) {
    const cs = state.chars, ws = i => !cs[i].c.trim();
    let i = state.caret;
    if (dir < 0) { while (i > 0 && ws(i - 1)) i--; while (i > 0 && !ws(i - 1)) i--; }
    else { while (i < cs.length && !ws(i)) i++; while (i < cs.length && ws(i)) i++; }
    return i;
  }

  // Moves the caret by one word.
  function moveWord(dir) { state.caret = wordTarget(dir); relayout(); }

  // Deletes from the caret to the neighbouring word boundary.
  function removeWord(dir) {
    const t = wordTarget(dir), a = Math.min(t, state.caret), n = Math.abs(t - state.caret);
    if (!n) return false;
    for (const c of state.chars.slice(a, a + n)) { active.delete(c); anim.delete(c); }
    state.chars.splice(a, n); state.caret = a;
    restyle(); relayout();
    return true;
  }

  // Jumps the caret to the start or end of its row (dir<0 start, dir>0 end) or of the whole document when whole is set.
  function jump(dir, whole) {
    if (whole) state.caret = dir < 0 ? 0 : state.chars.length;
    else { const r = caretRow(); state.caret = dir < 0 ? state.rows[r].start : rowEnd(r); }
    relayout();
  }

  // Returns the whole document as a plain string.
  function text() { return state.chars.map(c => c.c).join(''); }

  // Draws a glyph's underline or strike-through (skipped for plain text) in its jittered local space.
  function drawMark(g, c, st) {
    if (!st.link && !st.strike) return;
    g.lineWidth = 1.4; g.lineCap = 'round';
    g.beginPath();
    if (st.link) { g.moveTo(0, 6); g.lineTo(c.adv, 6); }
    if (st.strike) { g.moveTo(0, -st.size * 0.3); g.lineTo(c.adv, -st.size * 0.3); }
    g.stroke();
  }

  // Draws one glyph in one style at its jittered position, optionally faded and soft-focused.
  function paintGlyph(g, c, st, rgb, alpha, blur) {
    g.save();
    g.translate(c.x, c.y + c.dy);
    g.rotate(c.rot);
    g.scale(c.sc, c.sc);
    g.globalAlpha = st.alpha * alpha;
    if (blur > 0.2) g.filter = `blur(${(blur * state.dpr).toFixed(2)}px)`;
    g.font = st.font;
    g.fillStyle = Paper.css(rgb); g.strokeStyle = g.fillStyle; g.lineWidth = 1.1; g.lineJoin = 'round';
    if (c.c.trim()) { g.fillText(c.c, 0, 0); g.strokeText(c.c, 0, 0); }
    drawMark(g, c, st);
    g.restore();
  }

  // Draws one settled glyph, cross-blurring from its previous style while a restyle or marker fade is in flight.
  function drawGlyph(g, c, rgb) {
    const k = c.pst ? ease(c.k) : 1, v = ease(c.vis);
    if (k >= 1 && v >= 1) { paintGlyph(g, c, c.st, rgb, 1, 0); return; }
    if (k < 1) paintGlyph(g, c, c.pst, rgb, (1 - k) * v, k * BLUR);
    paintGlyph(g, c, c.st, rgb, k * v, ((1 - k) + (1 - v)) * BLUR);
  }

  // Draws a glyph's full image into the wet-ink layer at its jittered position (it stays hidden until swept by the pen).
  function stampWet(c, e) {
    const g = wetG;
    g.save();
    g.translate(c.x, c.y + c.dy);
    g.rotate(c.rot);
    g.scale(c.sc, c.sc);
    g.globalAlpha = c.st.alpha;
    g.drawImage(e.G, -e.padX, -e.oy, e.cw, e.ch);
    g.restore();
  }

  // Sweeps every active pen forward, adds the new swath to the shared mask, and paints the revealed wet ink plus pen tips.
  function paintWet(ctx, now, rgb, settle) {
    const g = wetG, w = wetW;
    if (wetDirty) {
      for (const c of settle.all) c.an = null;
      for (const L of [g, w]) { L.setTransform(1, 0, 0, 1, 0, 0); L.clearRect(0, 0, wetCanvasW, wetCanvasH); }
      wetDirty = false;
    }
    const sx = state.dpr, ty = -state.scroll * state.dpr;
    g.setTransform(sx, 0, 0, sx, 0, ty);
    w.setTransform(sx, 0, 0, sx, 0, ty);
    w.strokeStyle = '#fff'; w.lineCap = 'round'; w.lineJoin = 'round'; w.lineWidth = Stroke.MASK_W;
    w.beginPath();
    const tips = [];
    state.pens = 0;
    for (const c of settle.all) {
      if (c.hidden) { settle.done.push(c); continue; }
      if (now < c.born) continue;
      const e = Stroke.get(c.c, c.st.font, c.st.size, state.dpr, c.adv);
      if (!c.an) { c.an = { k: 0, x: 0, y: 0, d: 0 }; stampWet(c, e); if (!c.dur) c.dur = Math.max(130, Math.min(560, (e.L || 20) * 3.4)); }
      const q = Math.min(1, (now - c.born) / c.dur), t = q < 0.5 ? 2 * q * q : 1 - 2 * (1 - q) * (1 - q);
      const co = Math.cos(c.rot) * c.sc, si = Math.sin(c.rot) * c.sc, ox = c.x, oy = c.y + c.dy;
      Stroke.sweep(e, c.an, t * e.L, (x0, y0, x1, y1) => { w.moveTo(ox + x0 * co - y0 * si, oy + x0 * si + y0 * co); w.lineTo(ox + x1 * co - y1 * si, oy + x1 * si + y1 * co); });
      if (q < 1) state.pens++;
      if (q < 1) tips.push(ox + c.an.x * co - c.an.y * si, oy + c.an.x * si + c.an.y * co);
      else settle.done.push(c);
    }
    w.stroke();
    const t = wetT;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, wetCanvasW, wetCanvasH);
    t.drawImage(wetGC, 0, 0);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(wetWC, 0, 0);
    t.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(wetTC, 0, 0);
    ctx.setTransform(sx, 0, 0, sx, 0, ty);
    for (const [r, a] of [[2.6, 0.95]]) {
      ctx.fillStyle = Paper.css(rgb, a);
      ctx.beginPath();
      for (let i = 0; i < tips.length; i += 2) { ctx.moveTo(tips[i] + r, tips[i + 1]); ctx.arc(tips[i], tips[i + 1], r, 0, 6.283); }
      ctx.fill();
    }
  }

  // Draws one list bullet, hollow ring, checkbox or ticked box in the gutter beside a line's first row.
  function drawBullet(g, L, R, rgb) {
    const x = MARGIN + L.indent - 22, y = R.y - R.s * 0.3, j = ((L.start * 37) % 7 - 3) * 0.2;
    g.save();
    g.translate(x, y); g.rotate(j * 0.1);
    g.strokeStyle = g.fillStyle = Paper.css(rgb, 0.9); g.lineWidth = 1.7; g.lineCap = 'round'; g.lineJoin = 'round';
    if (L.bullet === 'dot') {
      g.beginPath(); g.arc(0, 0, L.level ? 3.4 : 3.9, 0, 6.283);
      if (L.level) g.stroke(); else g.fill();
    } else {
      g.beginPath(); g.roundRect(-9, -10, 18, 18, 4); g.stroke();
      if (L.bullet === 'tick') { g.beginPath(); g.moveTo(-5, -1); g.lineTo(-1, 4); g.lineTo(7, -9); g.lineWidth = 2.4; g.stroke(); }
    }
    g.restore();
  }

  // Draws the block decorations behind settled ink: code washes, quote bars, bullets and horizontal rules.
  function decorate(g, rgb) {
    const top = state.scroll - LINE * 2, bot = state.scroll + state.h + LINE * 2, cs = state.chars, maxX = state.w - MARGIN;
    for (const R of state.rows) {
      if (R.y < top || R.y > bot) continue;
      const L = R.line;
      if (L.kind === 'fence' || L.kind === 'code') {
        g.fillStyle = Paper.css(rgb, 0.06); g.fillRect(MARGIN - 18, R.top, maxX - MARGIN + 36, R.h);
        continue;
      }
      let x0 = -1, x1 = 0;
      const flush = () => {
        if (x0 < 0) return;
        g.fillStyle = Paper.css(rgb, 0.08); g.beginPath(); g.roundRect(x0 - 3, R.y - R.s * 0.82, x1 - x0 + 6, R.s * 1.12, 5); g.fill(); x0 = -1;
      };
      for (let j = R.start; j < R.end; j++) {
        const c = cs[j];
        if (c.st.code && c.vis > 0.01) { if (x0 < 0) x0 = c.x; x1 = c.x + c.adv; } else if (x0 >= 0 && c.adv) flush();
      }
      flush();
      const rv = ease(L.rv);
      if (rv < 0.02) continue;
      g.globalAlpha = rv;
      if (L.kind === 'quote') { g.fillStyle = Paper.css(rgb, 0.35); g.fillRect(MARGIN + 6, R.top + 4, 3, R.h - 8); }
      if (L.bullet && L.bullet !== 'num' && R.first) drawBullet(g, L, R, rgb);
      if (L.kind === 'hr') {
        g.strokeStyle = Paper.css(rgb, 0.55); g.lineWidth = 2.2; g.lineCap = 'round';
        g.beginPath();
        const y = R.y - R.s * 0.3;
        for (let x = MARGIN; x <= maxX; x += 4) { const yy = y + Math.sin(x / 19 + L.start) * 1.6; x === MARGIN ? g.moveTo(x, yy) : g.lineTo(x, yy); }
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  }

  // Redraws block decorations and every settled, on-screen glyph into the ink cache at the current scroll.
  function redrawInk() {
    const g = inkCtx, rgb = Paper.current().ink;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, ink.width, ink.height);
    g.setTransform(state.dpr, 0, 0, state.dpr, 0, -state.scroll * state.dpr);
    decorate(g, rgb);
    const top = state.scroll - LINE * 2, bot = state.scroll + state.h + LINE * 2;
    for (const c of state.chars) {
      if (c.y < top || c.y > bot || c.vis < 0.01 || c.c === '\n' || active.has(c)) continue;
      if (c.c.trim() || c.st.link || c.st.strike) drawGlyph(g, c, rgb);
    }
    inkScroll = state.scroll; wetDirty = true;
  }

  // Marks the settled-ink cache stale so a paper or ink change repaints it.
  function invalidate() { inkScroll = -1; }

  // Moves the caret toward its target with a critically damped spring in small fixed steps so motion is silky at any refresh rate.
  function springCaret(dt) {
    const c = state.cur, w = 30, h = 0.002;
    for (let t = dt; t > 0; t -= h) {
      const s = Math.min(h, t);
      c.vx += (w * w * (tx[0] - c.x) - 2 * w * c.vx) * s; c.vy += (w * w * (tx[1] - c.y) - 2 * w * c.vy) * s;
      c.x += c.vx * s; c.y += c.vy * s;
    }
    if (Math.abs(tx[0] - c.x) + Math.abs(tx[1] - c.y) < 0.01 && Math.abs(c.vx) + Math.abs(c.vy) < 0.5) { c.x = tx[0]; c.y = tx[1]; c.vx = c.vy = 0; }
  }

  // Records the real mouse position as the target the drawn pointer glides toward (first sight snaps to it).
  function pointer(x, y) {
    if (!state.ptr) state.ptr = { x, y, vx: 0, vy: 0, tx: x, ty: y, on: true };
    state.ptr.tx = x; state.ptr.ty = y; state.ptr.on = true;
  }

  // Hides the drawn pointer when the mouse leaves the window.
  function pointerOff() { if (state.ptr) state.ptr.on = false; }

  // Springs the drawn pointer toward the mouse with a stiff critically damped spring in small fixed steps.
  function springPointer(dt) {
    const p = state.ptr, w = 70, h = 0.001;
    for (let t = dt; t > 0; t -= h) {
      const s = Math.min(h, t);
      p.vx += (w * w * (p.tx - p.x) - 2 * w * p.vx) * s; p.vy += (w * w * (p.ty - p.y) - 2 * w * p.vy) * s;
      p.x += p.vx * s; p.y += p.vy * s;
    }
  }

  // Draws the brush-tip pointer in window space, stretched slightly along its motion.
  function drawPointer(ctx, rgb) {
    const p = state.ptr;
    if (!p || !p.on) return;
    const sp = Math.hypot(p.vx, p.vy), ang = Math.atan2(p.vy, p.vx), st = 1 + Math.min(sp / 1400, 1.6);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(sp > 30 ? ang : 0);
    ctx.fillStyle = Paper.css(rgb, 0.9);
    ctx.beginPath(); ctx.ellipse(-(st - 1) * 3, 0, 4.2 * st, 4.2 / Math.sqrt(st), 0, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  // Advances restyle cross-fades, marker collapses and decoration fades, re-laying out while anything is in flight.
  function step(dt) {
    if (!anim.size && !lineAnim) return;
    for (const c of anim) {
      if (c.k < 1) c.k = Math.min(1, c.k + dt / KDUR);
      const tv = c.hidden ? 0 : 1;
      if (c.vis !== tv) c.vis = c.vis < tv ? Math.min(tv, c.vis + dt / VDUR) : Math.max(tv, c.vis - dt / VDUR);
      if (c.k >= 1 && c.vis === tv) { c.pst = null; anim.delete(c); }
    }
    for (const L of state.lines) {
      const tv = L.rev ? 0 : 1;
      if (L.rv !== tv) L.rv = L.rv < tv ? Math.min(tv, L.rv + dt / VDUR) : Math.max(tv, L.rv - dt / VDUR);
    }
    relayout(false);
  }

  // Advances smoothing and renders one frame: paper, settled ink, animating glyphs, then the brush-tip caret.
  function frame(ctx, paperCanvas, now, dt) {
    step(dt);
    state.scroll += (state.scrollTarget - state.scroll) * (1 - Math.exp(-dt * 10));
    if (Math.abs(state.scrollTarget - state.scroll) < 0.05) state.scroll = state.scrollTarget;
    if (!state.cur) state.cur = { x: tx[0], y: tx[1], vx: 0, vy: 0 };
    springCaret(dt);
    if (inkScroll !== state.scroll) redrawInk();
    const rgb = Paper.current().ink;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(paperCanvas, 0, 0);
    ctx.drawImage(ink, 0, 0);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, -state.scroll * state.dpr);
    if (active.size) {
      const settle = { all: [...active], done: [] };
      paintWet(ctx, now, rgb, settle);
      for (const c of settle.done) { active.delete(c); c.an = null; if (!c.hidden) drawGlyph(inkCtx, c, rgb); }
      inkCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, -state.scroll * state.dpr);
      wetUsed = true;
    } else if (wetUsed) { wetDirty = true; paintWet(ctx, now, rgb, { all: [], done: [] }); wetUsed = false; state.pens = 0; }
    const c = state.cur, sp = Math.hypot(c.vx, c.vy), ang = sp > 20 ? Math.atan2(c.vy, c.vx) : 0.5;
    const stretch = 1 + Math.min(sp / 900, 2.2);
    ctx.save();
    ctx.translate(c.x + 3, c.y - tx[2] * 0.35);
    ctx.fillStyle = Paper.css(rgb, 0.5);
    if (sp > 20) { ctx.rotate(ang); ctx.beginPath(); ctx.ellipse(0, 0, 3 * stretch + 1, 3, 0, 0, 6.283); }
    else { ctx.rotate(0.5); ctx.beginPath(); ctx.ellipse(0, 0, 2.4, tx[2] * 0.22, 0, 0, 6.283); }
    ctx.fill();
    ctx.restore();
    if (state.ptr) { springPointer(dt); drawPointer(ctx, rgb); }
  }

  return { pointer, pointerOff, scrollBy, placeCaret, moveWord, removeWord, jump, warm, resize, relayout, insert, load, remove, move, text, frame, invalidate, state, SIZE };
})();
