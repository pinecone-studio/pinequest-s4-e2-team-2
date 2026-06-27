# SightAhead Chrome Extension

YouTube video dubbing into Mongolian — fetches captions client-side (no bot detection), sends to backend for translation + TTS.

## Setup (takes 30 seconds)

1. Open Chrome → navigate to `chrome://extensions/`
2. Toggle **Developer mode** (top right corner)
3. Click **Load unpacked** → select this folder
4. Open any YouTube video → you should see a "🎙 Dub to Mongolian" button

## Before it works end-to-end

Edit `background.js` line 16 — replace `BACKEND_URL` with your actual Render backend URL.

Your backend needs a `POST /api/dub` endpoint that accepts:
```json
{
  "video_id": "dQw4w9WgXcQ",
  "segments": [
    { "start": 0.0, "duration": 2.5, "text": "Hello world" },
    { "start": 2.5, "duration": 3.0, "text": "This is a test" }
  ]
}
```

And returns:
```json
{
  "audio_url": "https://your-storage.com/dubbed-audio.mp3"
}
```

## Debugging

- Extension console: `chrome://extensions/` → click "Inspect views: service worker" on your extension card
- Content script console: normal browser DevTools (F12) on the YouTube tab, look for `[SightAhead]` logs

## File overview

- `manifest.json` — tells Chrome what the extension does and what permissions it needs
- `background.js` — fetches captions from YouTube, sends to backend (runs headlessly, no DOM)
- `content.js` — injects UI into YouTube page, orchestrates the flow
- `content.css` — styles for the injected button
