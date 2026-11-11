// Paper module: the selectable greyscale/sepia stocks and the pre-rendered textured background.
const Paper = (() => {
  const STOCKS = [
    { name: 'white',   bg: [251, 250, 247], ink: [24, 22, 20] },
    { name: 'sepia',   bg: [241, 228, 204], ink: [44, 30, 18] },
    { name: 'parchment', bg: [226, 208, 174], ink: [52, 36, 20] },
    { name: 'silver',  bg: [214, 214, 214], ink: [28, 28, 30] },
    { name: 'slate',   bg: [92, 94, 98],    ink: [238, 236, 230] },
    { name: 'night',   bg: [26, 26, 28],    ink: [232, 228, 218] }
  ];
  let index = 0;
  let tile = null;

  // Formats an [r,g,b] triple as a CSS colour string.
  function css(rgb, a = 1) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }

  // Returns the currently selected stock.
  function current() { return STOCKS[index]; }

  // Selects a stock by index, wrapping around, and returns it.
  function select(i) { index = ((i % STOCKS.length) + STOCKS.length) % STOCKS.length; tile = null; return current(); }

  // Advances to the next stock and returns it.
  function next() { return select(index + 1); }

  // Returns the index of the selected stock.
  function currentIndex() { return index; }

  // Builds a small grain tile with faint fibres that can be repeated across the page.
  function buildTile(stock) {
    const s = 384, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const img = g.createImageData(s, s);
    const dark = (stock.bg[0] + stock.bg[1] + stock.bg[2]) / 3 < 128;
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * (dark ? 7 : 11);
      img.data[i] = stock.bg[0] + n; img.data[i + 1] = stock.bg[1] + n; img.data[i + 2] = stock.bg[2] + n; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = dark ? 'rgba(255,255,255,0.035)' : 'rgba(80,60,30,0.05)';
    for (let i = 0; i < 90; i++) {
      g.lineWidth = Math.random() * 0.8 + 0.2;
      g.beginPath();
      const x = Math.random() * s, y = Math.random() * s, a = Math.random() * 6.28, l = 6 + Math.random() * 22;
      g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 3, y + Math.sin(a) * l * 0.5 - 3, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    return c;
  }

  // Paints the textured stock plus a soft vignette onto a canvas context of the given pixel size.
  function paint(ctx, w, h) {
    const stock = current();
    if (!tile) tile = buildTile(stock);
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, w, h);
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.78);
    const dark = (stock.bg[0] + stock.bg[1] + stock.bg[2]) / 3 < 128;
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, dark ? 'rgba(0,0,0,0.35)' : 'rgba(70,45,15,0.16)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }

  return { current, currentIndex, select, next, paint, css, STOCKS };
})();
