// Places: shows a cinematic place-name reveal when you arrive somewhere new.

const els = {
  video: document.getElementById("camera"),
  reveal: document.getElementById("reveal"),
  label: document.getElementById("revealLabel"),
  name: document.getElementById("revealName"),
  sub: document.getElementById("revealSub"),
  start: document.getElementById("start"),
  startBtn: document.getElementById("startBtn"),
  status: document.getElementById("status"),
  motes: document.getElementById("motes"),
};

const params = new URLSearchParams(location.search);
const VISITED_KEY = "places.visited";
const MIN_MOVE_METERS = 60;      // ignore GPS jitter smaller than this
const MIN_LOOKUP_GAP_MS = 15000; // be polite to the free geocoding service

let current = null;      // place currently "entered"
let lastLookup = { at: 0, lat: null, lon: null };
let lookupInFlight = false;

// ---------- Storage (wrapped: may be unavailable in private mode) ----------
function loadVisited() {
  try { return new Set(JSON.parse(localStorage.getItem(VISITED_KEY) || "[]")); }
  catch { return new Set(); }
}
function markVisited(key) {
  const v = loadVisited(); v.add(key);
  try { localStorage.setItem(VISITED_KEY, JSON.stringify([...v])); } catch {}
}

function setStatus(text) { els.status.textContent = text || ""; }

// ---------- Camera ----------
let cameraInfo = "";

// Browsers default to a small feed (often 640×480) unless asked for more,
// which looks blurry when stretched over a large phone screen.
async function startCamera() {
  const attempts = [
    { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } },
    { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    { facingMode: { ideal: "environment" } },
  ];
  for (const video of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      els.video.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      // Keep the picture sharp as you look around, where supported.
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.focusMode && caps.focusMode.includes("continuous")) {
        track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
      }
      const s = track.getSettings();
      cameraInfo = s.width ? `${s.width}×${s.height}` : "";
      return;
    } catch (e) {
      console.warn("Camera attempt failed:", video, e);
    }
  }
  setStatus("Camera unavailable. Showing the reveal without it.");
}

// ---------- Location → place name ----------
function distanceMeters(a, b, c, d) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (c - a) * rad, dLon = (d - b) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Uses OpenStreetMap's free Nominatim reverse geocoder.
async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${lat}&lon=${lon}&accept-language=${encodeURIComponent(navigator.language || "en")}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Geocoding failed: " + res.status);
  return pickPlace(await res.json());
}

// Choose the most interesting nearby name: a landmark (park, lake, monument)
// if we're in one, otherwise the neighbourhood, then the town or city.
function pickPlace(data) {
  const a = data.address || {};
  const landmarkTypes = ["leisure", "tourism", "historic", "natural", "waterway", "boundary"];
  const landmark = landmarkTypes.includes(data.category) && data.name ? data.name : null;

  const area = a.neighbourhood || a.quarter || a.suburb || a.hamlet || a.village ||
               a.town || a.city_district || a.city || a.municipality || a.county;
  const city = a.city || a.town || a.village || a.municipality || a.county;
  const region = a.state || a.region || a.country;

  const title = landmark || area || city || region || "Uncharted Lands";
  const subParts = [];
  if (city && city !== title) subParts.push(city);
  if (a.country && a.country !== title) subParts.push(a.country);
  else if (region && region !== title) subParts.push(region);

  return { key: (title + "|" + (city || "") + "|" + (a.country || "")).toLowerCase(), title, sub: subParts.join(" · ") };
}

async function onPosition(pos) {
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;
  const now = Date.now();
  const moved = lastLookup.lat == null ? Infinity : distanceMeters(lastLookup.lat, lastLookup.lon, lat, lon);

  if (lookupInFlight) return;
  if (moved < MIN_MOVE_METERS) return;
  if (now - lastLookup.at < MIN_LOOKUP_GAP_MS && current) return;

  lookupInFlight = true;
  lastLookup = { at: now, lat, lon };
  try {
    const place = await reverseGeocode(lat, lon);
    setStatus(`± ${Math.round(accuracy)} m` + (cameraInfo ? ` · camera ${cameraInfo}` : ""));
    if (!current || current.key !== place.key) enterPlace(place);
  } catch (e) {
    console.warn(e);
    setStatus("Couldn't look up this place. Will retry.");
    lastLookup.lat = null; // allow retry on next update
  } finally {
    lookupInFlight = false;
  }
}

function startLocation() {
  if (!("geolocation" in navigator)) { setStatus("Location isn't available on this device."); return; }
  setStatus("Finding where you are…");
  navigator.geolocation.watchPosition(onPosition, (err) => {
    setStatus(err.code === 1 ? "Location permission denied. Enable it to discover places." : "Waiting for a location fix…");
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
}

// ---------- The reveal ----------
function enterPlace(place) {
  current = place;
  const isNew = !loadVisited().has(place.key);
  markVisited(place.key);
  showReveal(place.title, place.sub, isNew ? "Region Discovered" : "Entering");
}

// The wide letter spacing makes long names overflow, so shrink the name until it
// fits on one line. Very long names stop shrinking at a readable size and wrap.
const MIN_NAME_PX = 28;
function fitName() {
  const name = els.name;
  name.style.fontSize = "";
  name.style.whiteSpace = "nowrap";
  const available = els.reveal.clientWidth - 32; // minus the side padding
  const needed = name.scrollWidth;
  if (needed > available) {
    const size = parseFloat(getComputedStyle(name).fontSize);
    name.style.fontSize = `${Math.max(MIN_NAME_PX, Math.floor(size * available / needed))}px`;
  }
  name.style.whiteSpace = "";
}

let hideTimer = null;
// What the reveal is currently showing, and when it started.
// The video recorder reads this to draw the same animation into the video.
let revealState = null;

function showReveal(title, sub, label) {
  els.reveal.classList.remove("show");
  void els.reveal.offsetWidth; // restart CSS animations

  els.label.textContent = label;
  els.sub.textContent = sub || "";
  els.name.textContent = "";
  // One span per letter so each can materialize on its own, from the middle outwards.
  const chars = [...title];
  const mid = (chars.length - 1) / 2;
  const delays = chars.map((c, i) => 0.9 + Math.abs(i - mid) * 0.07 + Math.random() * 0.12);
  chars.forEach((c, i) => {
    const s = document.createElement("span");
    s.className = "ch";
    s.textContent = c;
    s.style.animationDelay = `${delays[i]}s, 6.4s`;
    els.name.appendChild(s);
  });
  fitName();
  revealState = { title, sub: sub || "", label, delays, start: performance.now() };

  els.reveal.classList.add("show");
  document.body.classList.add("revealing");
  DiscoverySound.play();
  burstMotes();

  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => els.reveal.classList.remove("show"), 8200);
  clearTimeout(showReveal.dimTimer);
  showReveal.dimTimer = setTimeout(() => document.body.classList.remove("revealing"), 6400);
}

// ---------- Drifting light motes during the reveal ----------
const ctx2d = els.motes.getContext("2d");
let motes = [], motesUntil = 0, rafId = null;

function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  els.motes.width = innerWidth * dpr;
  els.motes.height = innerHeight * dpr;
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", sizeCanvas);
sizeCanvas();

function burstMotes() {
  const cy = innerHeight * 0.3;
  for (let i = 0; i < 70; i++) {
    motes.push({
      x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.9,
      y: cy + (Math.random() - 0.5) * 140,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -0.1 - Math.random() * 0.35,
      r: 0.6 + Math.random() * 1.8,
      born: performance.now() + Math.random() * 1500,
      life: 3500 + Math.random() * 3500,
    });
  }
  motesUntil = performance.now() + 8000;
  if (!rafId) rafId = requestAnimationFrame(tick);
}

function tick(now) {
  ctx2d.clearRect(0, 0, innerWidth, innerHeight);
  motes = motes.filter((m) => now < m.born + m.life);
  for (const m of motes) {
    if (now < m.born) continue;
    const t = (now - m.born) / m.life;
    const alpha = Math.sin(Math.PI * t) * 0.8;
    m.x += m.vx; m.y += m.vy;
    ctx2d.beginPath();
    ctx2d.fillStyle = `rgba(255, 240, 210, ${alpha})`;
    ctx2d.shadowColor = "rgba(255, 230, 180, 0.9)";
    ctx2d.shadowBlur = 8;
    ctx2d.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx2d.fill();
  }
  if (motes.length || now < motesUntil) rafId = requestAnimationFrame(tick);
  else { rafId = null; ctx2d.clearRect(0, 0, innerWidth, innerHeight); }
}

// ---------- Start ----------
els.startBtn.addEventListener("click", async () => {
  DiscoverySound.unlock();
  els.start.classList.add("hidden");
  await startCamera();

  // Demo mode for testing anywhere: ?demo=Kyoto&sub=Japan
  if (params.has("demo")) {
    if (cameraInfo) setStatus(`camera ${cameraInfo}`);
    setTimeout(() => showReveal(params.get("demo"), params.get("sub") || "", "Region Discovered"), 600);
    return;
  }
  startLocation();
});

// The place to show when replaying or recording, if we know one yet.
function placeForReplay() {
  if (current) return current;
  if (params.has("demo")) return { title: params.get("demo"), sub: params.get("sub") || "" };
  return null;
}

// Tap anywhere (except on the controls) to replay the current place's reveal.
document.addEventListener("click", (e) => {
  if (!els.start.classList.contains("hidden")) return;
  if (e.target.closest("button, #controls, #preview")) return;
  const place = placeForReplay();
  if (place) showReveal(place.title, place.sub, current ? "You Are In" : "Region Discovered");
});
