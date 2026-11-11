// Markdown module: turns raw text into per-character styles, marker-hide flags, reveal spans and block-line info; knows nothing about layout or drawing.
const Markdown = (() => {
  const SCRIPT = '"Segoe Script","Ink Free","Lucida Handwriting",cursive';
  const MONO = 'Consolas,"Cascadia Mono","Courier New",monospace';
  // Style bit flags; bits 8-10 hold the heading level (0 = body text).
  const B = 1, I = 2, M = 4, S = 8, L = 16, C = 32, D = 64, Q = 128;
  const SCALE = [1, 1.5, 1.25, 1.12, 1];
  const cache = new Map();
  const EMPH = [
    [/(\*\*\*)(?=\S)(.+?)(?<=\S)\1/g, B | I, 3],
    [/(\*\*)(?=\S)(.+?)(?<=\S)\1/g, B, 2],
    [/(?<!\w)(__)(?=\S)(.+?)(?<=\S)\1(?!\w)/g, B, 2],
    [/(~~)(?=\S)(.+?)(?<=\S)\1/g, S, 2],
    [/(\*)(?=[^\s*])(.+?)(?<=[^\s*])\1/g, I, 1],
    [/(?<!\w)(_)(?=\S)(.+?)(?<=\S)\1(?!\w)/g, I, 1]
  ];

  // Returns the shared immutable style object for a bit set at a base size.
  function style(key, base) {
    const ck = key + base * 4096;
    let st = cache.get(ck);
    if (!st) {
      const lv = key >> 8, mono = !!(key & M), size = Math.round(base * SCALE[lv] * (mono && !lv ? 0.9 : 1));
      st = Object.freeze({
        size, level: lv, link: !!(key & L), strike: !!(key & S), code: !!(key & C),
        alpha: key & D ? 0.4 : key & Q ? 0.72 : 1,
        font: `${key & I ? 'italic ' : ''}${key & B ? 'bold ' : ''}${size}px ${mono ? MONO : SCRIPT}`
      });
      cache.set(ck, st);
    }
    return st;
  }

  // Parses inline constructs (code, links, emphasis) in src[a,b), adding style bits and flagging marker characters.
  function inline(src, a, b, bits, hide, span, spans) {
    const m = src.slice(a, b).split('');
    // Registers one construct: its marker positions hide until the caret enters [lo, hi].
    const claim = (lo, hi, marks) => {
      const id = spans.push([lo, hi]) - 1;
      for (const p of marks) { hide[p] = 1; span[p] = id; m[p - a] = '\0'; }
    };
    const range = (x, y) => { const r = []; for (let p = x; p < y; p++) r.push(p); return r; };

    for (const r of m.join('').matchAll(/(?<!`)(`{1,3})([^`\n]+?)\1(?!`)/g)) {
      const lo = a + r.index, t = r[1].length, hi = lo + r[0].length;
      for (let p = lo + t; p < hi - t; p++) { bits[p] |= M | C; m[p - a] = '\0'; }
      claim(lo, hi, [...range(lo, lo + t), ...range(hi - t, hi)]);
    }
    for (const r of m.join('').matchAll(/(!?)\[([^\]\n]+)\]\(([^)\s]*)\)/g)) {
      const lo = a + r.index, hi = lo + r[0].length, ts = lo + r[1].length + 1, te = ts + r[2].length;
      for (let p = ts; p < te; p++) bits[p] |= L;
      claim(lo, hi, [...range(lo, ts), ...range(te, hi)]);
    }
    for (const [re, flag, len] of EMPH) {
      for (const r of m.join('').matchAll(re)) {
        const lo = a + r.index, hi = lo + r[0].length;
        for (let p = lo + len; p < hi - len; p++) bits[p] |= flag;
        claim(lo, hi, [...range(lo, lo + len), ...range(hi - len, hi)]);
      }
    }
  }

  // Parses a whole document into per-character styles, hide flags, span ids, the span table and per-line block info.
  function parse(text, base) {
    const n = text.length, bits = new Uint16Array(n), hide = new Uint8Array(n), span = new Int32Array(n);
    const spans = [null], lines = [];
    let pos = 0, fence = false;
    for (;;) {
      const nl = text.indexOf('\n', pos), end = nl < 0 ? n : nl, s = text.slice(pos, end);
      const ln = { start: pos, end, kind: 'p', indent: 0, prefixEnd: pos, bullet: null, level: 0, hl: 0, size: base, rev: false, rv: 1 };
      let lb = 0, cs = pos, m;
      // Hides [x, y) as line-prefix markers that reveal while the caret is anywhere on the line.
      const hidePrefix = (x, y) => { const id = spans.push([pos, end]) - 1; for (let p = x; p < y; p++) { hide[p] = 1; span[p] = id; } };
      if (/^ {0,3}(`{3,}|~{3,})/.test(s)) { ln.kind = 'fence'; fence = !fence; lb = M | C | D; }
      else if (fence) { ln.kind = 'code'; lb = M | C; }
      else if ((m = /^ {0,3}(#{1,6})[ \t]+/.exec(s))) {
        const lv = Math.min(m[1].length, 4);
        ln.kind = 'h'; ln.hl = m[1].length; ln.size = Math.round(base * SCALE[lv]); lb = (lv << 8) | B;
        cs = ln.prefixEnd = pos + m[0].length; hidePrefix(pos, cs);
      } else if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(s)) { ln.kind = 'hr'; hidePrefix(pos, end); cs = end; }
      else if ((m = /^ {0,3}>[ \t]?/.exec(s))) {
        ln.kind = 'quote'; ln.indent = 30; lb = Q; cs = ln.prefixEnd = pos + m[0].length; hidePrefix(pos, cs);
      } else if ((m = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)/.exec(s))) {
        const ws = m[1].replace(/\t/g, '    ').length, ordered = /\d/.test(m[2]);
        ln.kind = 'li'; ln.level = ws ? Math.ceil(ws / 4) : 0; ln.indent = 44 + ln.level * 36; ln.bullet = ordered ? 'num' : 'dot';
        let pe = pos + m[0].length;
        const t = !ordered && /^\[([ xX])\][ \t]+/.exec(s.slice(m[0].length));
        if (t) { ln.bullet = t[1] === ' ' ? 'box' : 'tick'; pe += t[0].length; }
        cs = ln.prefixEnd = pe;
        hidePrefix(pos, pos + m[1].length);
        if (!ordered) hidePrefix(pos + m[1].length, pe);
      }
      bits.fill(lb, pos, nl < 0 ? end : nl + 1);
      if (ln.kind !== 'fence' && ln.kind !== 'code' && ln.kind !== 'hr') inline(text, cs, end, bits, hide, span, spans);
      lines.push(ln);
      if (nl < 0) break;
      pos = nl + 1;
    }
    const styles = new Array(n);
    for (let i = 0; i < n; i++) styles[i] = style(bits[i] | (hide[i] ? D : 0), base);
    return { styles, hide, span, spans, lines };
  }

  // Returns the plain body-text style at a size (used to pre-warm glyphs).
  function plain(base) { return style(0, base); }

  return { parse, plain };
})();
