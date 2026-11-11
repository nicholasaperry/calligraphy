// App module: wires keyboard, swatch, files and the render loop together.
(() => {
  const canvas = document.getElementById('paper');
  const swatch = document.getElementById('swatch');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const paperCanvas = document.createElement('canvas');
  let filePath = null, last = performance.now();

  // Shows the current paper stock in the corner swatch and persists the choice.
  function syncSwatch() {
    const s = Paper.current();
    swatch.style.background = Paper.css(s.bg);
    swatch.style.boxShadow = `0 2px 10px rgba(0,0,0,.3), inset 0 0 0 4px ${Paper.css(s.ink, 0.12)}`;
    try { localStorage.setItem('paper', String(Paper.currentIndex())); } catch (e) {}
  }

  // Rebuilds the textured paper bitmap and the ink cache at the current window size.
  function rebuild() {
    const dpr = window.devicePixelRatio || 1, w = window.innerWidth, h = window.innerHeight;
    Brush.resize(canvas, w, h, dpr);
    paperCanvas.width = canvas.width; paperCanvas.height = canvas.height;
    Paper.paint(paperCanvas.getContext('2d'), canvas.width, canvas.height);
    document.body.style.background = Paper.css(Paper.current().bg);
  }

  // Switches to the next paper stock and repaints.
  function cyclePaper() { Paper.next(); rebuild(); syncSwatch(); }

  // Classifies a key for sound selection.
  function kindOf(ch) { return ch === ' ' ? 'space' : ch === '\n' ? 'enter' : 'key'; }

  // Types a string at the caret with a single fast brush stroke each.
  function type(ch) { Brush.insert(ch, performance.now()); Sound.key(kindOf(ch)); }

  // Opens a text file via the main process and paints it in as a synchronized wave.
  async function openFile() {
    const f = await window.files.open();
    if (!f) return;
    filePath = f.path;
    const ms = Brush.load(f.text, performance.now());
    Brush.relayout();
    Sound.wave(ms);
  }

  // Saves the document, letting the main process show the native dialog for new files.
  async function saveFile() {
    const p = await window.files.save(filePath, Brush.text());
    if (p) filePath = p;
  }

  // Handles all keyboard input: shortcuts, navigation, deletion and printable characters.
  function onKey(e) {
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); saveFile(); } else if (k === 'o') { e.preventDefault(); openFile(); }
      else if (e.code === 'KeyA') { e.preventDefault(); if (e.altKey) Brush.selectSection(); else Brush.selectAll(); }
      else if (k === 'c' || k === 'x') {
        const t = Brush.selectedText();
        if (t) { e.preventDefault(); try { navigator.clipboard.writeText(t); } catch (err) {} if (k === 'x') { Brush.deleteSel(); Sound.key('back'); } }
      }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); Brush.moveWord(-1, e.shiftKey); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); Brush.moveWord(1, e.shiftKey); }
      else if (e.key === 'Backspace') { e.preventDefault(); if (Brush.removeWord(-1)) Sound.key('back'); }
      else if (e.key === 'Delete') { e.preventDefault(); if (Brush.removeWord(1)) Sound.key('back'); }
      else if (e.key === 'Home') { e.preventDefault(); Brush.jump(-1, true, e.shiftKey); }
      else if (e.key === 'End') { e.preventDefault(); Brush.jump(1, true, e.shiftKey); }
      return;
    }
    if (e.altKey) return;
    switch (e.key) {
      case 'Backspace': e.preventDefault(); if (Brush.remove(-1)) Sound.key('back'); return;
      case 'Delete': e.preventDefault(); if (Brush.remove(1)) Sound.key('back'); return;
      case 'ArrowLeft': Brush.move(-1, 0, e.shiftKey); return;
      case 'ArrowRight': Brush.move(1, 0, e.shiftKey); return;
      case 'ArrowUp': Brush.move(0, -1, e.shiftKey); return;
      case 'ArrowDown': Brush.move(0, 1, e.shiftKey); return;
      case 'Home': e.preventDefault(); Brush.jump(-1, false, e.shiftKey); return;
      case 'End': e.preventDefault(); Brush.jump(1, false, e.shiftKey); return;
      case 'PageUp': e.preventDefault(); Brush.scrollBy(-window.innerHeight * 0.8); return;
      case 'PageDown': e.preventDefault(); Brush.scrollBy(window.innerHeight * 0.8); return;
      case 'Enter': e.preventDefault(); type('\n'); return;
      case 'Tab': e.preventDefault(); type('    '); return;
    }
    if (e.key.length === 1) { e.preventDefault(); type(e.key); }
  }

  // Pastes clipboard text as a parallel staggered wave of strokes.
  function onPaste(e) {
    const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (!t) return;
    e.preventDefault();
    const now = performance.now();
    Brush.insert(t, now, i => Math.min(600, i * 3));
    Sound.wave(Math.min(600, t.length * 3));
  }

  // Runs the uncapped requestAnimationFrame loop so the panel refresh rate sets the pace.
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    Brush.frame(ctx, paperCanvas, now, dt);
    Sound.pen(Brush.state.pens || 0);
    requestAnimationFrame(loop);
  }

  // Restores the saved paper, binds events, and starts rendering.
  function init() {
    try { const s = parseInt(localStorage.getItem('paper'), 10); if (!isNaN(s)) Paper.select(s); } catch (e) {}
    rebuild(); syncSwatch();
    window.addEventListener('resize', rebuild);
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    window.addEventListener('wheel', e => { e.preventDefault(); Brush.scrollBy(e.deltaY); }, { passive: false });
    window.addEventListener('mousemove', e => Brush.pointer(e.clientX, e.clientY));
    document.documentElement.addEventListener('mouseleave', () => Brush.pointerOff());
    canvas.addEventListener('mousedown', e => Brush.placeCaret(e.clientX, e.clientY));
    window.addEventListener('mousemove', e => { if (e.buttons & 1) Brush.dragTo(e.clientX, e.clientY); });
    swatch.addEventListener('click', cyclePaper);
    requestAnimationFrame(loop);
    setTimeout(() => Brush.warm('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?-()'), 300);
  }

  init();
})();
