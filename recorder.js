// Records a video of the camera view with the place-name reveal and its sound.
//
// Browsers can't record a web page's screen directly, so each frame we draw the
// camera, the animated text and the light motes onto a hidden canvas, and record
// that canvas together with the discovery sound.

const Recorder = (() => {
  const RECORD_SECONDS = 8.6;   // the whole reveal, from whoosh to fade-out
  const VIDEO_WIDTH = 1080;     // output width in pixels; height follows the screen shape

  const ui = {
    controls: document.getElementById("controls"),
    btn: document.getElementById("recordBtn"),
    time: document.getElementById("recordTime"),
    preview: document.getElementById("preview"),
    video: document.getElementById("previewVideo"),
    share: document.getElementById("shareBtn"),
    save: document.getElementById("saveBtn"),
    discard: document.getElementById("discardBtn"),
  };

  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d");
  let recorder = null, chunks = [], startedAt = 0, stopTimer = null, raf = null;
  let lastFile = null, lastUrl = null;

  // ---------- Small animation helpers (match the CSS timeline in style.css) ----------
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const prog = (t, start, dur) => clamp01((t - start) / dur);
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const easeIn = (x) => x * x;

  // The "fade, blur and drift up" exit used by every text element.
  function outAmount(t, start, dur) { return easeIn(prog(t, start, dur)); }

  function pickMimeType() {
    const types = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
  }

  // ---------- Drawing one frame ----------
  function drawCamera(W, H) {
    const v = els.video;
    if (v.readyState >= 2 && v.videoWidth) {
      // Same as CSS object-fit: cover
      const s = Math.max(W / v.videoWidth, H / v.videoHeight);
      const dw = v.videoWidth * s, dh = v.videoHeight * s;
      g.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      const bg = g.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, H * 0.8);
      bg.addColorStop(0, "#2b3440"); bg.addColorStop(1, "#0b0d10");
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
    }
  }

  // An elliptical radial gradient, like CSS radial-gradient(ellipse ...).
  function ellipse(cx, cy, rx, ry, stops, alpha) {
    if (alpha <= 0) return;
    g.save();
    g.globalAlpha = alpha;
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    stops.forEach(([at, color]) => grad.addColorStop(at, color));
    g.fillStyle = grad;
    g.fillRect(-rx, -rx, rx * 2, rx * 2);
    g.restore();
  }

  // Text with the same soft glow as the CSS text-shadow.
  function glowText(text, x, y, glow, glowBlur) {
    g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = 7; g.shadowOffsetY = 1;
    g.fillText(text, x, y);
    if (glow) {
      g.shadowColor = glow; g.shadowBlur = glowBlur; g.shadowOffsetY = 0;
      g.fillText(text, x, y);
    }
    g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
  }

  function drawReveal(W, H, k, t) {
    const st = revealState;
    if (!st) return;
    const reveal = els.reveal;
    const top = reveal.offsetTop;
    const css = (el) => getComputedStyle(el);

    // Vignette around the screen edges (fades in with the reveal, out at 6.4s)
    const vig = Math.min(prog(t, 0, 1.2), 1 - prog(t, 6.4, 1.2));
    ellipse(W / 2, H / 2, (W / 2) * Math.SQRT2, (H / 2) * Math.SQRT2,
      [[0, "rgba(0,0,0,0)"], [0.55, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.45)"]], vig);

    g.textBaseline = "middle";

    // "Entering" / "Region Discovered": letters pull together from wide spacing
    {
      const el = els.label, cs = css(el);
      const size = parseFloat(cs.fontSize);
      const p = easeOut(prog(t, 0.2, 1.6));
      const out = outAmount(t, 6.2, 1.2);
      const spacing = (0.8 - 0.63 * p) * size;   // 0.8em → 0.17em, as in style.css
      g.font = `400 ${size}px Inter, system-ui, sans-serif`;
      g.letterSpacing = `${spacing}px`;
      g.textAlign = "center";
      g.fillStyle = "#fff";
      g.globalAlpha = p * (1 - out);
      const blur = (6 * (1 - p) + 10 * out) * k;
      g.filter = blur > 0.3 ? `blur(${blur}px)` : "none";
      glowText(st.label, W / 2 + spacing / 2, top + el.offsetTop + el.offsetHeight / 2 - 6 * out, null, 0);
      g.filter = "none"; g.letterSpacing = "0px"; g.globalAlpha = 1;
    }

    // The place name, one letter at a time from the middle outwards
    {
      const nameEl = els.name, cs = css(nameEl);
      const size = parseFloat(cs.fontSize);
      g.font = `400 ${size}px "New Amsterdam", Inter, sans-serif`;
      g.textAlign = "center";
      g.letterSpacing = "0px";
      g.fillStyle = "#fff";
      const halfSpacing = parseFloat(cs.letterSpacing) / 2 || 0;
      const out = outAmount(t, 6.4, 1.4);
      [...nameEl.children].forEach((span, i) => {
        const p = prog(t, st.delays[i], 1.4);
        if (p <= 0) return;
        const e = easeOut(p);
        const x = span.offsetLeft + span.offsetWidth / 2 - halfSpacing; // ignore trailing letter-spacing
        const y = top + span.offsetTop + span.offsetHeight / 2 + 10 * (1 - e) - 6 * out;
        const scale = 1.35 - 0.35 * e;
        const flash = p < 0.6 ? p / 0.6 : 1 - (p - 0.6) / 0.4;  // brief bright glow mid-way
        g.save();
        g.globalAlpha = Math.min(1, p / 0.6) * (1 - out);
        const blur = (14 * (1 - e) + 10 * out) * k;
        g.filter = blur > 0.3 ? `blur(${blur}px)` : "none";
        g.translate(x, y); g.scale(scale, scale);
        glowText(span.textContent.toUpperCase(), 0, 0, `rgba(255,244,220,${0.22 + 0.78 * flash})`, 10 + 38 * flash);
        g.restore();
      });
      g.filter = "none";
    }

    // Country (or City · Country) underneath
    if (st.sub) {
      const el = els.sub, cs = css(el);
      const size = parseFloat(cs.fontSize);
      const p = easeOut(prog(t, 2.2, 1.4));
      const out = outAmount(t, 6.0, 1.2);
      const spacing = (0.45 - 0.28 * p) * size;  // 0.45em → 0.17em, as in style.css
      g.font = `400 ${size}px Inter, system-ui, sans-serif`;
      g.letterSpacing = `${spacing}px`;
      g.textAlign = "center";
      g.fillStyle = "#fff";
      g.globalAlpha = p * (1 - out);
      g.filter = out ? `blur(${10 * out * k}px)` : "none";
      glowText(st.sub, W / 2 + spacing / 2, top + el.offsetTop + el.offsetHeight / 2 + 6 * (1 - p) - 6 * out, null, 0);
      g.filter = "none"; g.letterSpacing = "0px"; g.globalAlpha = 1;
    }
  }

  function drawFrame() {
    const W = innerWidth, H = innerHeight;
    const k = canvas.width / W;
    g.setTransform(k, 0, 0, k, 0, 0);
    drawCamera(W, H);
    if (revealState) {
      const t = (performance.now() - revealState.start) / 1000;
      if (t < 8.5) {
        drawReveal(W, H, k, t);
        g.drawImage(els.motes, 0, 0, W, H);
      }
    }
    const secs = (performance.now() - startedAt) / 1000;
    ui.time.textContent = `0:${String(Math.floor(secs)).padStart(2, "0")}`;
    raf = requestAnimationFrame(drawFrame);
  }

  // ---------- Recording ----------
  function start() {
    const place = placeForReplay();
    if (!place) { setStatus("Still finding where you are. Try again in a moment."); return; }
    if (!window.MediaRecorder || !canvas.captureStream) { setStatus("Recording isn't supported in this browser."); return; }

    const k = VIDEO_WIDTH / innerWidth;
    canvas.width = VIDEO_WIDTH;
    canvas.height = Math.round((innerHeight * k) / 2) * 2; // encoders want even sizes

    const stream = canvas.captureStream(30);
    const audio = DiscoverySound.stream();
    if (audio) audio.getAudioTracks().forEach((tr) => stream.addTrack(tr));

    const mimeType = pickMimeType();
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
    chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => finish(place, recorder.mimeType || mimeType);

    startedAt = performance.now();
    drawFrame();
    recorder.start(250);
    ui.controls.classList.add("recording");

    // Recordings always use the full "discovered" moment, since it's the one worth sharing.
    showReveal(place.title, place.sub, "Region Discovered");
    stopTimer = setTimeout(stop, RECORD_SECONDS * 1000);
  }

  function stop() {
    clearTimeout(stopTimer);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    cancelAnimationFrame(raf);
    ui.controls.classList.remove("recording");
  }

  function finish(place, mimeType) {
    const type = mimeType.split(";")[0] || "video/webm";
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const blob = new Blob(chunks, { type });
    const slug = place.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "place";
    const date = new Date().toISOString().slice(0, 10);
    lastFile = new File([blob], `places-${slug}-${date}.${ext}`, { type });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);

    ui.video.src = lastUrl;
    ui.video.play().catch(() => {});
    const canShare = navigator.canShare && navigator.canShare({ files: [lastFile] });
    ui.share.hidden = !canShare;
    ui.preview.classList.add("open");
    ui.controls.hidden = true;
  }

  function closePreview() {
    ui.preview.classList.remove("open");
    ui.controls.hidden = false;
    ui.video.pause();
    ui.video.removeAttribute("src");
    ui.video.load();
  }

  // ---------- Buttons ----------
  ui.btn.addEventListener("click", () => {
    if (recorder && recorder.state === "recording") stop();
    else start();
  });

  ui.share.addEventListener("click", async () => {
    try { await navigator.share({ files: [lastFile], title: "Places" }); }
    catch (e) { if (e.name !== "AbortError") setStatus("Couldn't share. Try Save instead."); }
  });

  ui.save.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = lastUrl; a.download = lastFile.name;
    document.body.appendChild(a); a.click(); a.remove();
  });

  ui.discard.addEventListener("click", closePreview);

  return { start, stop };
})();
