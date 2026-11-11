// Brush module: text model, layout, and the per-glyph painted-in animation; knows nothing about DOM events or files.
const Brush = (() => {
  const SIZE = 38, LINE = 62, MARGIN = 140, WIPE = 0.55;
  const FONT = `${SIZE}px "Segoe Script","Ink Free","Lucida Handwriting",cursive`;
  const ADV = new Map();
  const state = { chars: [], caret: 0, scroll: 0, scrollTarget: 0, cx: MARGIN, cy: LINE, w: 0, h: 0, dpr: 1 };
  const active = new Set();
  let wetG = null, wetW = null, wetT = null, wetGC = null, wetWC = null, wetTC = null, wetCanvasW = 0, wetCanvasH = 0, wetDirty = true, wetUsed = false, ink = null, inkCtx = null, inkScroll = -1, measure = null, tx = null;

  // Creates a text-model glyph with its own random hand-made jitter.
  function makeChar(c, born) {
    return { c, born, x: 0, y: 0, rot: (Math.random() - 0.5) * 0.07, dy: (Math.random() - 0.5) * 3.5, sc: 0.96 + Math.random() * 0.09, adv: 0 };
  }

  // Returns the advance width of a character in the brush font, cached.
  function advance(ch) {
    if (ADV.has(ch)) return ADV.get(ch);
    if (!measure) { measure = document.createElement('canvas').getContext('2d'); measure.font = FONT; }
    const w = ch === '\t' ? measure.measureText(' ').width * 4 : measure.measureText(ch).width;
    ADV.set(ch, w);
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

  // Positions every glyph with word-wrapping and updates the caret target.
  function relayout(follow = true) {
    const maxX = state.w - MARGIN;
    let x = MARGIN, y = MARGIN, lastSpace = -1;
    const cs = state.chars;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      c.adv = c.c === '\n' ? 0 : advance(c.c);
      if (c.c === '\n') { c.x = x; c.y = y; x = MARGIN; y += LINE; lastSpace = -1; continue; }
      if (x + c.adv > maxX && x > MARGIN && c.c !== " ") {
        y += LINE; x = MARGIN;
        if (lastSpace >= 0 && c.c !== ' ') {
          let j = lastSpace + 1;
          for (; j < i; j++) { cs[j].x = x; cs[j].y = y; x += cs[j].adv; }
        }
        lastSpace = -1;
      }
      c.x = x; c.y = y; x += c.adv;
      if (c.c === ' ') lastSpace = i;
    }
    const k = Math.min(state.caret, cs.length);
    if (k < cs.length) { tx = [cs[k].x, cs[k].y]; }
    else if (k === 0) tx = [MARGIN, MARGIN];
    else if (cs[k - 1].c === '\n') tx = [MARGIN, cs[k - 1].y + LINE];
    else tx = [cs[k - 1].x + cs[k - 1].adv, cs[k - 1].y];
    state.docEnd = Math.max(y, tx[1]);
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
      const ch = text[i] === '\r' ? null : text[i];
      if (ch === null) continue;
      const c = makeChar(ch, now + (delayFn ? delayFn(i) : 0));
      made.push(c);
    }
    warm(text);
    state.chars.splice(state.caret, 0, ...made);
    state.caret += made.length;
    relayout();
    for (const c of made) if (c.c.trim()) active.add(c);
    return made;
  }

  // Replaces the whole document, then paints every glyph in as a parallel diagonal wave.
  function load(text, now) {
    state.chars = []; state.caret = 0; active.clear();
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
    active.delete(state.chars[i]); wetDirty = true;
    state.chars.splice(i, 1);
    if (dir < 0) state.caret--;
    relayout();
    return true;
  }

  // Moves the caret by a column delta or a row delta, clamped to the document.
  function move(dCol, dRow) {
    const cs = state.chars;
    if (dRow) {
      const cur = tx; let best = state.caret, bestD = Infinity;
      const targetY = cur[1] + dRow * LINE;
      for (let i = 0; i <= cs.length; i++) {
        const p = i < cs.length ? [cs[i].x, cs[i].y] : (i && cs[i - 1].c !== '\n' ? [cs[i - 1].x + cs[i - 1].adv, cs[i - 1].y] : [MARGIN, i ? cs[i - 1].y + LINE : MARGIN]);
        if (Math.abs(p[1] - targetY) > 1) continue;
        const d = Math.abs(p[0] - cur[0]);
        if (d < bestD) { bestD = d; best = i; }
      }
      state.caret = best;
    } else state.caret = Math.max(0, Math.min(cs.length, state.caret + dCol));
    relayout();
  }

  // Builds the pen path for every distinct character in a string so no frame pays that cost mid-animation.
  function warm(str) {
    for (const ch of new Set(str)) if (ch.trim()) Stroke.get(ch, FONT, SIZE, state.dpr, advance(ch));
  }

  // Returns the document-space position of the caret when placed before character index i.
  function caretPos(i) {
    const cs = state.chars;
    if (i < cs.length) return [cs[i].x, cs[i].y];
    if (i === 0) return [MARGIN, MARGIN];
    if (cs[i - 1].c === '\n') return [MARGIN, cs[i - 1].y + LINE];
    return [cs[i - 1].x + cs[i - 1].adv, cs[i - 1].y];
  }

  // Scrolls the page by a pixel delta without moving the caret, clamped to the document.
  function scrollBy(dy) {
    const max = Math.max(0, state.docEnd + LINE * 2 - state.h);
    state.scrollTarget = Math.max(0, Math.min(max, state.scrollTarget + dy));
  }

  // Finds the caret index nearest a window-space click point.
  function indexAt(px, py) {
    const ty = py + state.scrollTarget + SIZE * 0.35;
    let best = state.chars.length, bd = Infinity;
    for (let i = 0; i <= state.chars.length; i++) {
      const p = caretPos(i), d = Math.abs(p[1] - ty) * 4 + Math.abs(p[0] - px);
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
    for (const c of state.chars.slice(a, a + n)) active.delete(c);
    state.chars.splice(a, n); state.caret = a;
    relayout();
    return true;
  }

  // Jumps the caret to the start or end of its line (dir<0 start, dir>0 end) or of the whole document when whole is set.
  function jump(dir, whole) {
    if (whole) state.caret = dir < 0 ? 0 : state.chars.length;
    else {
      const y = caretPos(state.caret)[1]; let r = state.caret;
      for (let i = 0; i <= state.chars.length; i++) if (Math.abs(caretPos(i)[1] - y) < 1) { if (dir < 0) { r = i; break; } r = i; }
      state.caret = r;
    }
    relayout();
  }

  // Returns the whole document as a plain string.
  function text() { return state.chars.map(c => c.c).join(''); }

  // Draws one fully inked glyph into a context at its jittered position.
  function drawGlyph(g, c, inkRgb) {
    g.save();
    g.translate(c.x, c.y + c.dy);
    g.rotate(c.rot);
    g.scale(c.sc, c.sc);
    g.font = FONT;
    g.fillStyle = Paper.css(inkRgb); g.strokeStyle = g.fillStyle; g.lineWidth = 1.1; g.lineJoin = 'round';
    g.fillText(c.c, 0, 0); g.strokeText(c.c, 0, 0);
    g.restore();
  }

  // Draws a glyph's full image into the wet-ink layer at its jittered position (it stays hidden until swept by the pen).
  function stampWet(c, e) {
    const g = wetG;
    g.save();
    g.translate(c.x, c.y + c.dy);
    g.rotate(c.rot);
    g.scale(c.sc, c.sc);
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
      if (now < c.born) continue;
      const e = Stroke.get(c.c, FONT, SIZE, state.dpr, c.adv);
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

  // Redraws every settled, on-screen glyph into the ink cache at the current scroll.
  function redrawInk() {
    const g = inkCtx, rgb = Paper.current().ink;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, ink.width, ink.height);
    g.setTransform(state.dpr, 0, 0, state.dpr, 0, -state.scroll * state.dpr);
    const top = state.scroll - LINE, bot = state.scroll + state.h + LINE;
    for (const c of state.chars) {
      if (c.y < top || c.y > bot || !c.c.trim() || active.has(c)) continue;
      drawGlyph(g, c, rgb);
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

  // Advances smoothing and renders one frame: paper, settled ink, animating glyphs, then the brush-tip caret.
  function frame(ctx, paperCanvas, now, dt) {
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
      for (const c of settle.done) { active.delete(c); c.an = null; drawGlyph(inkCtx, c, rgb); }
      inkCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, -state.scroll * state.dpr);
      wetUsed = true;
    } else if (wetUsed) { wetDirty = true; paintWet(ctx, now, rgb, { all: [], done: [] }); wetUsed = false; state.pens = 0; }
    const c = state.cur, sp = Math.hypot(c.vx, c.vy), ang = sp > 20 ? Math.atan2(c.vy, c.vx) : 0.5;
    const stretch = 1 + Math.min(sp / 900, 2.2);
    ctx.save();
    ctx.translate(c.x + 3, c.y - SIZE * 0.35);
    ctx.fillStyle = Paper.css(rgb, 0.5);
    if (sp > 20) { ctx.rotate(ang); ctx.beginPath(); ctx.ellipse(0, 0, 3 * stretch + 1, 3, 0, 0, 6.283); }
    else { ctx.rotate(0.5); ctx.beginPath(); ctx.ellipse(0, 0, 2.4, 8.5, 0, 0, 6.283); }
    ctx.fill();
    ctx.restore();
    if (state.ptr) { springPointer(dt); drawPointer(ctx, rgb); }
  }

  return { pointer, pointerOff, scrollBy, placeCaret, moveWord, removeWord, jump, warm, resize, relayout, insert, load, remove, move, text, frame, invalidate, state, SIZE };
})();
