/**
 * Sound effects (e.g. new message ping).
 * Uses AudioContext (with webkit prefix for Safari); primed on first user gesture.
 * Resumes suspended context before playing; shared resume lock for concurrent calls.
 * Falls back to HTMLAudioElement beep on NotAllowedError (autoplay blocked).
 * Never throws; no-op if context unavailable or blocked.
 */

import { NOTIFICATION_SOUND_DEBUG } from "@/lib/notificationSoundDebug";

const Ctx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);

let audioContext = null;
let primed = false;
let fallbackAudio = null;

/** Shared promise so concurrent playMessageSound() calls await the same resume. */
let resumeInFlight = null;

/** Debug state (only updated when NOTIFICATION_SOUND_DEBUG or when we need lastError for fallback). */
let lastResumeAt = null;
let lastPlayAt = null;
let lastError = null;

function getFallbackBeepDataUrl() {
  const sampleRate = 8000;
  const duration = 0.12;
  const freq = 880;
  const numSamples = Math.round(sampleRate * duration);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freq * t) * (t < 0.01 ? t / 0.01 : t > duration - 0.01 ? (duration - t) / 0.01 : 1) * 0.15 * 32767;
    view.setInt16(44 + i * 2, sample | 0, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/**
 * Ensure AudioContext exists and is running. If suspended, resume with shared lock.
 * @returns {Promise<boolean>} true if context is ready to use, false if unavailable or resume failed.
 */
async function ensureResumed() {
  if (!audioContext) return false;
  if (audioContext.state === "running") return true;
  if (audioContext.state !== "suspended") return false;

  if (resumeInFlight) {
    try {
      await resumeInFlight;
    } catch (_) {
      return false;
    }
    return audioContext.state === "running";
  }

  const p = audioContext
    .resume()
    .then(() => {
      lastResumeAt = Date.now();
      resumeInFlight = null;
      return true;
    })
    .catch((err) => {
      lastError = err;
      resumeInFlight = null;
      if (NOTIFICATION_SOUND_DEBUG) {
        if (import.meta.env.DEV) console.log("[sound-debug] AudioContext resume failed", { name: err?.name, message: err?.message });
      }
      throw err;
    });
  resumeInFlight = p;
  await p;
  return audioContext.state === "running";
}

const BEEP_DURATION = 0.12;
const BEEP_FREQ = 880;
const BEEP_GAIN = 0.15;

/**
 * Play beep via AudioContext (oscillator + gain). Call only when context is running.
 */
function playBeepNow() {
  if (!audioContext || audioContext.state !== "running") return;
  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(BEEP_FREQ, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(BEEP_GAIN, now + 0.01);
  gain.gain.linearRampToValueAtTime(0, now + BEEP_DURATION);
  osc.start(now);
  osc.stop(now + BEEP_DURATION);
  lastPlayAt = Date.now();
}

/**
 * Fallback: play short beep via HTMLAudioElement (works when AudioContext is blocked by autoplay).
 */
function playFallbackBeep() {
  try {
    if (fallbackAudio === null) {
      fallbackAudio = new Audio(getFallbackBeepDataUrl());
    }
    fallbackAudio.currentTime = 0;
    fallbackAudio.play().catch((err) => {
      lastError = err;
      if (import.meta.env.DEV && NOTIFICATION_SOUND_DEBUG) {
        console.log("[sound-debug] fallback HTMLAudioElement play failed", { message: err?.message });
      }
    });
    lastPlayAt = Date.now();
  } catch (err) {
    lastError = err;
    if (import.meta.env.DEV && NOTIFICATION_SOUND_DEBUG) {
      console.log("[sound-debug] fallback beep failed", { message: err?.message });
    }
  }
}

/**
 * Internal async implementation: ensure context, await resume, then play. Handles NotAllowedError with fallback.
 */
async function playMessageSoundAsync() {
  if (typeof window === "undefined") return;
  try {
    if (!Ctx) return;
    if (!audioContext) {
      audioContext = new Ctx();
    }
    const ready = await ensureResumed();
    if (ready) {
      playBeepNow();
      return;
    }
    throw new Error("AudioContext not running after resume");
  } catch (err) {
    const isNotAllowed = err?.name === "NotAllowedError" || err?.message?.toLowerCase?.().includes("not allowed");
    if (isNotAllowed) {
      if (import.meta.env.DEV && NOTIFICATION_SOUND_DEBUG) {
        console.log("[sound-debug] sound suppressed (autoplay blocked), using fallback", { reason: err?.message });
      }
      playFallbackBeep();
      return;
    }
    lastError = err;
    if (import.meta.env.DEV && NOTIFICATION_SOUND_DEBUG) {
      console.log("[sound-debug] sound suppressed", { reason: err?.message, name: err?.name });
    }
  }
}

/**
 * Play a short pleasant beep (e.g. new message). No-op if context missing or blocked.
 * Deterministic across Chrome/Safari after backgrounding: awaits resume before playing.
 * On NotAllowedError, falls back to HTMLAudioElement beep.
 */
export function playMessageSound() {
  if (typeof window === "undefined") return;
  void playMessageSoundAsync();
}

function attachPrimeListeners() {
  if (primed) return;
  primed = true;
  const run = () => {
    try {
      if (!audioContext && Ctx) {
        audioContext = new Ctx();
      }
      if (audioContext && audioContext.state === "suspended") {
        void ensureResumed();
      }
    } catch (_) {}
  };
  const events = ["pointerdown", "keydown", "touchstart"];
  const once = () => {
    run();
    events.forEach((e) => window.removeEventListener(e, once));
  };
  events.forEach((e) => window.addEventListener(e, once, { passive: true, once: true }));
}

/** Minimum ms between safe-resume attempts from lifecycle (avoid spam). */
const SAFE_RESUME_DEBOUNCE_MS = 2000;
let lastSafeResumeAt = 0;

/**
 * Attempt to resume context when tab becomes visible again. Non-spam: debounced.
 */
function safeResume() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastSafeResumeAt < SAFE_RESUME_DEBOUNCE_MS) return;
  lastSafeResumeAt = now;
  try {
    if (!audioContext && Ctx) {
      audioContext = new Ctx();
    }
    if (audioContext && audioContext.state === "suspended") {
      void ensureResumed();
    }
  } catch (_) {}
}

function attachLifecycleListeners() {
  if (typeof window === "undefined") return;
  const onVisible = () => {
    if (document.visibilityState === "visible") safeResume();
  };
  window.addEventListener("visibilitychange", onVisible, { passive: true });

  window.addEventListener("focus", safeResume, { passive: true });
  window.addEventListener("pageshow", safeResume, { passive: true });
}

let lifecycleListenersAttached = false;

/**
 * Attach one-time listeners to user gesture events so the first gesture
 * creates/resumes the AudioContext. Also attaches visibilitychange/focus/pageshow to re-prime when returning to tab.
 * Call at app startup.
 */
export function primeAudio() {
  if (typeof window === "undefined") return;
  attachPrimeListeners();
  if (!lifecycleListenersAttached) {
    lifecycleListenersAttached = true;
    attachLifecycleListeners();
  }
}

/**
 * Debug state for sound (e.g. when sound is suppressed due to audio blocked).
 * @returns {{ audioState: string | null, lastResumeAt: number | null, lastPlayAt: number | null, lastError: string | null }}
 */
export function getSoundDebugState() {
  return {
    audioState: audioContext?.state ?? null,
    lastResumeAt: lastResumeAt ?? null,
    lastPlayAt: lastPlayAt ?? null,
    lastError: lastError?.message ?? lastError ?? null,
  };
}
