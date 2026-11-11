// Sound module: synthesises brush-on-paper scratches and soft thocks with WebAudio, no sample files.
const Sound = (() => {
  let ac = null, noise = null;

  // Lazily creates the audio context and a shared white-noise buffer on first use.
  function ensure() {
    if (ac) return true;
    try {
      ac = new AudioContext({ latencyHint: 'interactive' });
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; return false; }
    return true;
  }

  // Plays a band-passed noise burst whose pitch sweeps from f0 to f1 over dur seconds.
  function swish(delay, dur, f0, f1, vol, q) {
    const t = ac.currentTime + delay;
    const src = ac.createBufferSource(); src.buffer = noise;
    src.loopStart = 0; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(ac.destination);
    src.start(t, Math.random() * 0.8); src.stop(t + dur + 0.02);
  }

  // Plays a short low sine knock to give each stroke a soft physical landing.
  function thock(freq, vol, dur) {
    const t = ac.currentTime;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.5, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.03);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.01);
  }

  // Plays the stroke sound for a typed key: letters scratch, space whispers, enter sweeps, backspace scrapes back.
  function key(kind) {
    if (!ensure()) return;
    if (ac.state === 'suspended') ac.resume();
    const r = Math.random();
    if (kind === 'space') { swish(0, 0.11, 900, 500, 0.06, 0.8); thock(110, 0.1, 0.06); }
    else if (kind === 'enter') { swish(0, 0.28, 1200, 5200, 0.12, 1.1); thock(90, 0.16, 0.12); }
    else if (kind === 'back') { swish(0, 0.09, 6200, 3000, 0.13, 1.6); }
    else { swish(0, 0.07 + r * 0.05, 2400 + r * 1800, 4200 + r * 2200, 0.1 + r * 0.05, 1.3); thock(150 + r * 50, 0.08, 0.05); }
  }

  // Plays one long sweeping wash plus scattered ticks for the duration of a file loading in.
  function wave(ms) {
    if (!ensure()) return;
    if (ac.state === 'suspended') ac.resume();
    swish(0, ms / 1000 + 0.2, 700, 6000, 0.13, 0.7);
    for (let i = 0; i < 14; i++) swish(Math.random() * ms / 1000, 0.06, 2600 + Math.random() * 3000, 4000, 0.05, 1.4);
  }

  let penGain = null, penFilter = null;

  // Sets the continuous scratch level for pens currently moving (0 = silent), creating the looped noise on first use.
  function pen(level) {
    if (!ac) { if (level <= 0) return; if (!ensure()) return; }
    if (!penGain) {
      const src = ac.createBufferSource(); src.buffer = noise; src.loop = true;
      penFilter = ac.createBiquadFilter(); penFilter.type = 'bandpass'; penFilter.frequency.value = 3200; penFilter.Q.value = 0.9;
      penGain = ac.createGain(); penGain.gain.value = 0;
      src.connect(penFilter).connect(penGain).connect(ac.destination); src.start();
    }
    const t = ac.currentTime, v = Math.min(0.05, level * 0.012);
    penGain.gain.setTargetAtTime(v, t, 0.02);
    penFilter.frequency.setTargetAtTime(2400 + Math.min(level, 6) * 350 + Math.random() * 500, t, 0.03);
  }

  return { key, wave, pen };
})();
