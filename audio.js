// Discovery sound, synthesized live with the Web Audio API (no audio files).
// Layers: a rising wind whoosh, a deep low boom, and a slow shimmering chord with reverb.

const DiscoverySound = (() => {
  let ctx = null;
  let reverb = null;

  // Browsers only allow audio after a user gesture, so call this from a tap.
  function unlock() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      reverb = makeReverb(4.5);
      reverb.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  function makeReverb(seconds) {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.55;
    conv.connect(g);
    // Sounds feed `input`; the wet signal leaves through the gain node.
    return { input: conv, connect: (dest) => g.connect(dest) };
  }

  function noiseBuffer(seconds) {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function out(node, dry = 1, wet = 0.6) {
    const d = ctx.createGain(); d.gain.value = dry;
    const w = ctx.createGain(); w.gain.value = wet;
    node.connect(d).connect(ctx.destination);
    node.connect(w).connect(reverb.input);
  }

  function whoosh(t) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(2.5);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(250, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + 1.1);
    bp.frequency.exponentialRampToValueAtTime(600, t + 2.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    src.connect(bp).connect(g);
    out(g, 0.8, 0.5);
    src.start(t); src.stop(t + 2.5);
  }

  function boom(t) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 2.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    osc.connect(g);
    out(g, 1, 0.4);
    osc.start(t); osc.stop(t + 3.1);

    // Soft thud texture on top of the sine
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(1);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 180;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.6, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    n.connect(lp).connect(ng);
    out(ng, 1, 0.3);
    n.start(t); n.stop(t + 1);
  }

  function shimmer(t) {
    // D minor add9 voicing, notes entering one after another
    const notes = [146.83, 220.0, 293.66, 349.23, 440.0, 659.25];
    notes.forEach((f, i) => {
      const start = t + i * 0.12;
      [0, 4].forEach((cents) => {          // two slightly detuned voices per note
        const o = ctx.createOscillator();
        o.type = i < 2 ? "sine" : "triangle";
        o.frequency.value = f;
        o.detune.value = cents;
        const g = ctx.createGain();
        const peak = (i < 2 ? 0.08 : 0.045);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(peak, start + 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 5.5);
        o.connect(g);
        out(g, 0.6, 1.0);
        o.start(start); o.stop(start + 5.6);
      });
    });
  }

  function play() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    whoosh(t);
    boom(t + 0.85);    // lands as the name starts to appear
    shimmer(t + 0.9);
  }

  return { unlock, play };
})();
