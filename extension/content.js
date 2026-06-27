// ============================================================
// content.js — Runs INSIDE the YouTube tab
// ============================================================
// Chrome injects this into every page matching the "matches"
// pattern in manifest.json ("*://www.youtube.com/watch*").
//
// WHAT IT CAN DO:
// - Read/modify the YouTube page DOM (inject buttons, overlays)
// - Read window.location to get the video ID
// - Send messages to background.js and receive responses
//
// WHAT IT CAN'T DO:
// - Access YouTube's JavaScript variables (isolated world)
// - Make CORS-free fetches (that's background.js's job)
// ============================================================

// ── STATE ───────────────────────────────────────────────────
let currentVideoId = null;
let isProcessing = false;
let dubButton = null;
let activeAudio = null;        // the currently playing dub <Audio>
let audioListeners = null;     // AbortController to detach video sync listeners

// ── INITIALIZATION ──────────────────────────────────────────
// YouTube is a Single Page App (SPA). When you click a new video,
// the URL changes but the page doesn't fully reload — so our
// content script doesn't re-run. We need to watch for URL changes.

function init() {
  console.log("[SightAhead] Content script loaded");
  injectDubButton();
  watchForNavigation();
}

// YouTube's SPA navigation: the URL changes without a page reload.
// We use a MutationObserver on the <title> element as a reliable
// signal that the video changed (YouTube updates the title on navigation).
function watchForNavigation() {
  let lastUrl = location.href;

  // Check periodically — simplest reliable approach
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log("[SightAhead] Navigation detected:", lastUrl);
      onVideoChanged();
    }
  }, 1000);
}

function onVideoChanged() {
  const videoId = extractVideoId();
  if (videoId && videoId !== currentVideoId) {
    currentVideoId = videoId;
    resetUI();
    // YouTube may have re-rendered the actions bar and dropped our button.
    if (!document.getElementById("sightahead-dub-btn")) {
      injectDubButton();
    }
    console.log("[SightAhead] New video:", currentVideoId);
  }
}

// ── VIDEO ID EXTRACTION ─────────────────────────────────────
function extractVideoId() {
  const url = new URL(window.location.href);
  return url.searchParams.get("v"); // youtube.com/watch?v=THIS_PART
}

// ── UI: INJECT THE DUB BUTTON ───────────────────────────────
// We inject a button into YouTube's page, next to the like/share buttons.
// This is the main user interaction point.

function injectDubButton() {
  // Wait for YouTube's UI to load (it's an SPA, elements load async).
  // Give up after ~30s so we don't poll forever on pages without the bar.
  let attempts = 0;
  const maxAttempts = 60;

  const waitForElement = setInterval(() => {
    if (++attempts > maxAttempts) {
      clearInterval(waitForElement);
      console.warn("[SightAhead] Actions bar not found; button not injected.");
      return;
    }

    // This is the container for like/share/etc buttons below the video
    const actionsBar = document.querySelector("#actions #top-level-buttons-computed")
      || document.querySelector("#actions");

    if (actionsBar) {
      clearInterval(waitForElement);

      // Don't inject twice
      if (document.getElementById("sightahead-dub-btn")) return;

      dubButton = document.createElement("button");
      dubButton.id = "sightahead-dub-btn";
      dubButton.textContent = "🎙 Dub to Mongolian";
      dubButton.className = "sightahead-btn";
      dubButton.addEventListener("click", onDubClick);

      actionsBar.appendChild(dubButton);
      currentVideoId = extractVideoId();
      console.log("[SightAhead] Button injected, video:", currentVideoId);
    }
  }, 500);
}

function resetUI() {
  stopDubbedAudio();
  if (dubButton) {
    dubButton.textContent = "🎙 Dub to Mongolian";
    dubButton.className = "sightahead-btn";
    dubButton.disabled = false;
  }
  isProcessing = false;
}

// ── MAIN FLOW: THE DUB BUTTON CLICK ─────────────────────────
// This orchestrates the full pipeline:
// 1. Send videoId to background.js → it fetches captions
// 2. Send captions to background.js → it calls your Render backend
// 3. Receive audio URL → play it

async function onDubClick() {
  if (isProcessing) return;
  isProcessing = true;

  const videoId = extractVideoId();
  if (!videoId) {
    showError("Can't find video ID in URL");
    return; // showError already resets isProcessing
  }

  try {
    // ── STEP 1: Fetch captions ──────────────────────────────
    updateButton("⏳ Fetching captions...", true);

    const captionResult = await sendMessage({
      type: "FETCH_CAPTIONS",
      videoId: videoId
    });

    if (!captionResult.success) {
      throw new Error(captionResult.error || "Failed to fetch captions");
    }

    const { segments, language } = captionResult.data;
    console.log(`[SightAhead] Got ${segments.length} segments in ${language}`);

    // ── STEP 2: Send to backend for translation + TTS ───────
    updateButton(`⏳ Translating ${segments.length} segments...`, true);

    const dubResult = await sendMessage({
      type: "TRANSLATE_AND_DUB",
      captions: segments,
      videoId: videoId
    });

    if (!dubResult.success) {
      throw new Error(dubResult.error || "Backend dubbing failed");
    }

    // ── STEP 3: Play the dubbed audio ───────────────────────
    updateButton("🔊 Playing dubbed audio", false);
    playDubbedAudio(dubResult.data);

    // Flow is done — release the lock so the user can re-trigger.
    isProcessing = false;

  } catch (err) {
    console.error("[SightAhead] Error:", err);
    showError(err.message);
  }
}

// ── MESSAGE PASSING WRAPPER ─────────────────────────────────
// Wraps chrome.runtime.sendMessage in a Promise so we can await it.
// The raw API uses callbacks — this makes it cleaner.

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      // chrome.runtime.lastError fires if background worker crashed
      // or the message channel broke
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ── AUDIO PLAYBACK ──────────────────────────────────────────
// TODO: This is the part you'll customize based on your backend's
// response format. Options:
// 1. Single audio URL → play alongside video
// 2. Per-segment audio → sync each to video timestamps

function playDubbedAudio(dubData) {
  // Stop and detach any dub from a previous run before starting a new one.
  stopDubbedAudio();

  // Simple version: single audio file
  if (dubData.audio_url) {
    const audio = new Audio(dubData.audio_url);
    activeAudio = audio;

    // Sync with the YouTube video player
    const video = document.querySelector("video");
    if (video) {
      // AbortController lets us remove all three listeners at once later.
      audioListeners = new AbortController();
      const { signal } = audioListeners;

      // Match audio position to video position
      audio.currentTime = video.currentTime;
      audio.play();

      // Pause/play audio when video pauses/plays
      video.addEventListener("pause", () => audio.pause(), { signal });
      video.addEventListener("play", () => {
        audio.currentTime = video.currentTime;
        audio.play();
      }, { signal });
      video.addEventListener("seeked", () => {
        audio.currentTime = video.currentTime;
      }, { signal });

      // Optional: lower video volume so dub is heard over original
      video.volume = 0.1;
    } else {
      audio.play();
    }
  }

  // TODO: If your backend returns per-segment audio, you'd iterate
  // segments and schedule each audio clip at the right timestamp
}

// Stops the current dub audio and removes the video sync listeners.
function stopDubbedAudio() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio = null;
  }
  if (audioListeners) {
    audioListeners.abort();
    audioListeners = null;
  }
}

// ── UI HELPERS ──────────────────────────────────────────────
function updateButton(text, disabled) {
  if (dubButton) {
    dubButton.textContent = text;
    dubButton.disabled = disabled;
  }
}

function showError(message) {
  isProcessing = false;
  if (dubButton) {
    dubButton.textContent = "❌ " + message;
    dubButton.className = "sightahead-btn sightahead-error";
    dubButton.disabled = false;

    // Reset after 3 seconds
    setTimeout(() => resetUI(), 3000);
  }
}

// ── START ────────────────────────────────────────────────────
init();
