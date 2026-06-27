// ============================================================
// background.js — The extension's "backend"
// ============================================================
// This runs in its OWN context. No DOM, no tab, no page.
// Think of it like a mini FastAPI server living inside Chrome.
//
// WHY IT EXISTS:
// - content.js can see the YouTube page but can't fetch YouTube's
//   caption API (CORS blocks it)
// - background.js has the extension's host_permissions, so it can
//   fetch anything in the manifest's host_permissions list — no CORS
// - The request goes out from the USER'S IP (residential), not a
//   datacenter, so YouTube doesn't block it
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
// TODO: Replace with your actual Render backend URL
const BACKEND_URL = "https://pinequest-s4-e2-sightahead.onrender.com";

// ── MESSAGE LISTENER ────────────────────────────────────────
// This is the "API router" of the extension.
// content.js sends messages here, we process them, send responses back.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Route 1: Fetch captions for a video
  if (message.type === "FETCH_CAPTIONS") {
    handleFetchCaptions(message.videoId)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));

    // ⚠️ CRITICAL: return true = "I will respond asynchronously"
    // Without this, Chrome closes the message channel IMMEDIATELY,
    // and your .then() above fires into the void. The content script
    // callback never gets called. No error, just silence.
    // This is the #1 Chrome extension gotcha.
    return true;
  }

  // Route 2: Send captions to backend for translation + TTS
  if (message.type === "TRANSLATE_AND_DUB") {
    handleTranslateAndDub(message.captions, message.videoId)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ── CAPTION FETCHING ────────────────────────────────────────
// This is the function that REPLACES yt-dlp in your pipeline.
// It hits YouTube's timedtext endpoint directly.
// Because we're in the background worker with host_permissions,
// there's no CORS and the request uses the user's residential IP.

async function handleFetchCaptions(videoId) {
  console.log(`[SightAhead] Fetching captions for: ${videoId}`);

  // Step 1: Get the video page to extract caption track info
  // We need to find the captions URL from YouTube's player config
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const pageResponse = await fetch(pageUrl);
  const pageHtml = await pageResponse.text();

  // Step 2: Extract captions data from the page
  // YouTube embeds a JSON blob called "captions" in the page source
  const captionsMatch = pageHtml.match(/"captions":\s*(\{.*?"playerCaptionsTracklistRenderer".*?\})\s*,\s*"/);

  if (!captionsMatch) {
    throw new Error("No captions found for this video. It might not have subtitles.");
  }

  // Parse out the caption tracks
  let captionsData;
  try {
    // The regex captures a JSON object but it might have trailing content
    // We need to carefully extract just the captions JSON
    const rawJson = captionsMatch[1];
    captionsData = JSON.parse(rawJson);
  } catch (e) {
    // Fallback: try a more targeted extraction
    captionsData = extractCaptionsFromPage(pageHtml);
  }

  const tracks = captionsData?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) {
    throw new Error("No caption tracks available for this video.");
  }

  // Step 3: Pick the best caption track
  // Prefer manual captions over auto-generated, prefer English
  const manualTrack = tracks.find(t => t.kind !== "asr");
  const englishTrack = tracks.find(t => t.languageCode === "en");
  const selectedTrack = manualTrack || englishTrack || tracks[0];

  console.log(`[SightAhead] Using caption track: ${selectedTrack.name?.simpleText || selectedTrack.languageCode}`);

  // Step 4: Fetch the actual caption data in JSON3 format
  // Append &fmt=json3 to get timestamped segments instead of XML
  const captionUrl = selectedTrack.baseUrl + "&fmt=json3";
  const captionResponse = await fetch(captionUrl);
  const captionJson = await captionResponse.json();

  // Step 5: Transform into your pipeline's expected format
  // Each event has: tStartMs, dDurationMs, segs[{utf8}]
  const segments = (captionJson.events || [])
    .filter(event => event.segs) // filter out non-text events
    .map(event => ({
      start: event.tStartMs / 1000,        // convert ms to seconds
      duration: event.dDurationMs / 1000,
      text: event.segs.map(s => s.utf8).join("").trim()
    }))
    .filter(seg => seg.text.length > 0);   // drop empty segments

  console.log(`[SightAhead] Got ${segments.length} caption segments`);
  return { segments, language: selectedTrack.languageCode };
}

// Fallback parser if the regex-based extraction fails
function extractCaptionsFromPage(html) {
  // Look for the captions in ytInitialPlayerResponse
  const playerMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  if (!playerMatch) {
    // Try another common pattern
    const altMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (!altMatch) throw new Error("Could not extract player response from page");
    const playerData = JSON.parse(altMatch[1]);
    return playerData.captions;
  }
  const playerData = JSON.parse(playerMatch[1]);
  return playerData.captions;
}

// ── BACKEND COMMUNICATION ───────────────────────────────────
// Sends caption text to YOUR backend (Render) for translation + TTS.
// Your backend never touches YouTube — it only does the AI work.

async function handleTranslateAndDub(captions, videoId) {
  console.log(`[SightAhead] Sending ${captions.length} segments to backend for dubbing`);

  const response = await fetch(`${BACKEND_URL}/api/dub`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_id: videoId,
      segments: captions
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Backend error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  // Expected: { audio_url: "https://...", translated_segments: [...] }
  return result;
}
