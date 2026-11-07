# Places

Open-world-game style place discovery for the real world.

Open the app, point your camera around, and when you arrive somewhere new the
name of the place appears with a cinematic animation and sound, like the
"region discovered" moments in open-world games.

Built for phones first, with smart glasses as the eventual target.

## How it works

- **Camera**: the rear camera fills the screen as the background.
- **Location**: your position is watched with the browser's Geolocation API.
  When you move more than ~60 m, it looks up where you are using
  OpenStreetMap's free [Nominatim](https://nominatim.org/) reverse geocoder.
- **Place name**: it prefers a landmark you're in (a park, lake, monument),
  then the neighbourhood, then the town or city. The country/city appears underneath.
- **Discovery**: places you've seen before are remembered on your device.
  New places show **Region Discovered**; places you've been before show **Entering**.
- **Sound**: synthesized live with the Web Audio API (whoosh, low boom, shimmering chord).
  No audio files.

Tap the screen to replay the current reveal.

## Recording a video

Tap the red button at the bottom to record the reveal. It replays the
"Region Discovered" moment for where you are and records about 9 seconds
(camera, animation and sound), then opens a preview where you can
**Share** (to WhatsApp, Instagram, etc.) or **Save** the video.

Browsers can't screen-record a web page, so `recorder.js` redraws the camera
and the animation onto a hidden canvas each frame and records that with the
sound. Videos are MP4 where the browser supports it, otherwise WebM.

## Try it

Camera and location need HTTPS, so open it through GitHub Pages (or any HTTPS host).

Demo mode shows the animation without needing location:

```
?demo=Fort%20Kochi&sub=Kerala%20·%20India
```

Run locally:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/?demo=Kyoto (desktop browsers allow camera on localhost).

## Files

- `index.html`: page structure
- `style.css`: the reveal animation and layout
- `app.js`: camera, location, place lookup and the reveal
- `audio.js`: the discovery sound
- `recorder.js`: records the reveal to a video
- `fonts/`: New Amsterdam, used for place names (SIL Open Font License, see `fonts/OFL.txt`).
  Other text uses Inter from Google Fonts.
