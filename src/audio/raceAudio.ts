/**
 * Hệ thống âm thanh tổng hợp 100% đi qua LiveRuntime Master Audio Bus duy nhất:
 * - BGM 128 BPM -> liveRuntime.getBgmInput()
 * - SFX (Join, Sprint, Jetpack, Rocket, Siêu Nhân, Rồng Thần, Đếm ngược, Pháo hoa) -> liveRuntime.getSfxInput()
 * - Edge TTS (/api/tts -> ArrayBuffer -> decodeAudioData -> AudioBufferSourceNode) -> liveRuntime.getTtsInput()
 *   có hàng đợi ưu tiên (TtsQueue), timeout API riêng, gom quà liên tiếp và bảo vệ lời cảm ơn khi chuyển pha.
 */

import { liveRuntime } from './liveRuntime';

let bgmFilter: BiquadFilterNode | null = null;
let bgmTimer = 0;
let bgmStep = 0;
let bgmNextAt = 0;
let bgmEnabled = true;
let sfxEnabled = true;
let ttsEnabled = true;

function getCtx(): AudioContext | null {
  const ctx = liveRuntime.getAudioContext();
  if (!ctx) return null;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
  return ctx;
}

export function setAudioSettings(opts: { bgm?: boolean; sfx?: boolean; tts?: boolean }) {
  if (typeof opts.bgm === 'boolean') {
    bgmEnabled = opts.bgm;
    if (bgmEnabled) startRaceBgm();
    else stopRaceBgm();
  }
  if (typeof opts.sfx === 'boolean') sfxEnabled = opts.sfx;
  if (typeof opts.tts === 'boolean') {
    ttsEnabled = opts.tts;
    if (!ttsEnabled) stopCommentator();
  }
}

// ---------- Nhạc nền 128 BPM sôi động (đi qua liveRuntime.getBgmInput()) ----------
const BPM = 128;
const STEP_SEC = 60 / BPM / 4; // 16th note
const LEAD_NOTES = [
  523.25, 0, 659.25, 0, 783.99, 0, 659.25, 587.33,
  523.25, 0, 587.33, 0, 659.25, 0, 783.99, 0,
  880.0, 0, 783.99, 0, 659.25, 0, 587.33, 523.25,
  587.33, 0, 659.25, 0, 783.99, 0, 0, 0,
];
const BASS_NOTES = [130.81, 130.81, 174.61, 196.0]; // C3 C3 F3 G3

function playEnvOsc(
  c: AudioContext,
  out: AudioNode,
  type: OscillatorType,
  freq: number,
  at: number,
  dur: number,
  peak: number,
  endFreq?: number,
) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function scheduleBgm() {
  const c = liveRuntime.getAudioContext();
  const bgmBus = liveRuntime.getBgmInput();
  if (!c || !bgmBus || !bgmFilter || !bgmEnabled) return;
  if (c.state !== 'running') return;

  // Ducking nhạc nền mượt mà khi MC đang đọc TTS
  const duck = activeTtsSource !== null ? 0.24 : 0.48;
  bgmBus.gain.setTargetAtTime(duck, c.currentTime, 0.14);

  if (bgmNextAt < c.currentTime - 0.3) {
    bgmNextAt = c.currentTime + 0.04;
  }

  while (bgmNextAt < c.currentTime + 0.14) {
    const t = bgmNextAt;
    const s = bgmStep % 32;
    const bar = Math.floor(s / 8);

    if (s % 4 === 0) {
      playEnvOsc(c, bgmFilter, 'sine', 145, t, 0.16, 0.72, 42);
    }
    if (s % 2 === 1) {
      playEnvOsc(c, bgmFilter, 'sawtooth', BASS_NOTES[bar], t, STEP_SEC * 1.4, 0.2);
    }
    const lead = LEAD_NOTES[s];
    if (lead > 0) {
      playEnvOsc(c, bgmFilter, 'triangle', lead, t, STEP_SEC * 1.9, 0.22);
    }
    bgmNextAt += STEP_SEC;
    bgmStep++;
  }
}

export function startRaceBgm() {
  if (!bgmEnabled || bgmTimer) return;
  const c = getCtx();
  const bgmBus = liveRuntime.getBgmInput();
  if (!c || !bgmBus) return;
  if (!bgmFilter) {
    bgmFilter = c.createBiquadFilter();
    bgmFilter.type = 'lowpass';
    bgmFilter.frequency.value = 2400;
    bgmFilter.connect(bgmBus);
  }
  bgmBus.gain.setTargetAtTime(0.42, c.currentTime, 0.15);
  bgmNextAt = c.currentTime + 0.08;
  bgmStep = 0;
  bgmTimer = window.setInterval(scheduleBgm, 50);
}

export function stopRaceBgm() {
  clearInterval(bgmTimer);
  bgmTimer = 0;
  const c = liveRuntime.getAudioContext();
  const bgmBus = liveRuntime.getBgmInput();
  if (c && bgmBus) {
    bgmBus.gain.setTargetAtTime(0.0001, c.currentTime, 0.15);
  }
}

// ---------- Hiệu ứng âm thanh (SFX) đi qua liveRuntime.getSfxInput() ----------
function getSfxOut(): { c: AudioContext; out: AudioNode } | null {
  if (!sfxEnabled) return null;
  const c = getCtx();
  const out = liveRuntime.getSfxInput();
  if (!c || !out || c.state !== 'running') return null;
  return { c, out };
}

export function playJoinSfx() {
  const s = getSfxOut();
  if (!s) return;
  const t = s.c.currentTime;
  playEnvOsc(s.c, s.out, 'sine', 520, t, 0.1, 0.22, 780);
  playEnvOsc(s.c, s.out, 'triangle', 780, t + 0.07, 0.12, 0.18, 1046);
}

export function playSprintSfx() {
  const s = getSfxOut();
  if (!s) return;
  const t = s.c.currentTime;
  playEnvOsc(s.c, s.out, 'triangle', 440, t, 0.18, 0.2, 880);
}

export function playJetpackSfx() {
  const s = getSfxOut();
  if (!s) return;
  const t = s.c.currentTime;
  playEnvOsc(s.c, s.out, 'sawtooth', 180, t, 0.35, 0.22, 520);
  playEnvOsc(s.c, s.out, 'triangle', 660, t + 0.1, 0.25, 0.18, 990);
}

export function playRocketSfx() {
  const s = getSfxOut();
  if (!s) return;
  const t = s.c.currentTime;
  playEnvOsc(s.c, s.out, 'sawtooth', 110, t, 0.55, 0.3, 680);
  playEnvOsc(s.c, s.out, 'square', 220, t + 0.08, 0.45, 0.16, 1100);
}

export function playVipDragonSfx() {
  const s = getSfxOut();
  if (!s) return;
  const t = s.c.currentTime;
  playEnvOsc(s.c, s.out, 'sawtooth', 95, t, 0.7, 0.35, 55);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
    playEnvOsc(s.c, s.out, 'triangle', f, t + 0.12 + idx * 0.07, 0.55, 0.24);
  });
}

export function playCountdownBeep(final = false) {
  const s = getSfxOut();
  if (!s) return;
  const t = s.c.currentTime;
  playEnvOsc(s.c, s.out, 'square', final ? 1046.5 : 660, t, final ? 0.32 : 0.14, 0.22);
}

export function playFinishFanfareSfx() {
  const s = getSfxOut();
  if (!s) return;
  const t = s.c.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
  notes.forEach((f, i) => {
    playEnvOsc(s.c, s.out, 'triangle', f, t + i * 0.11, 0.28, 0.28);
  });
}

export function playCrowdCheerSfx() {
  const s = getSfxOut();
  if (!s) return;
  const t = s.c.currentTime;
  playEnvOsc(s.c, s.out, 'triangle', 587.33, t, 0.18, 0.2, 880);
  playEnvOsc(s.c, s.out, 'triangle', 880, t + 0.08, 0.24, 0.22, 1174.66);
}

// ============================================================================
// TtsQueue thông minh đi qua LiveRuntime Master Bus (decodeAudioData)
// - Tách riêng thời hạn sự kiện (eventExpiryMs) và timeout gọi API (6500ms)
// - Không bao giờ xóa nhầm lời cảm ơn quà tặng (gift) khi chuyển pha game
// - Gom quà tặng liên tiếp của cùng người xem trong cửa sổ 1.4s
// ============================================================================
export type TtsKind = 'normal' | 'event' | 'audience' | 'phase' | 'gift';

interface TtsQueueItem {
  text: string;
  kind: TtsKind;
  priority: number; // gift: 100, phase: 90, event: 60, normal: 20
  hype: boolean;
  voice: 'm' | 'f';
  createdAt: number;
  maxAgeMs: number;
}

const MAX_TTS_QUEUE = 20;
const TTS_FETCH_TIMEOUT_MS = 6500;

let ttsQueue: TtsQueueItem[] = [];
let activeTtsSource: AudioBufferSourceNode | null = null;
let activeTtsAbort: AbortController | null = null;
let activeTtsKind: TtsKind | null = null;
let isProcessingTts = false;
let lastTtsAt = 0;
let lastAudienceEndedAt = 0;
let casterToggle: 'm' | 'f' = 'm';
let ttsGeneration = 0;

let captionListener: ((text: string) => void) | null = null;
let speakingListener: ((speaking: boolean) => void) | null = null;
let speakingDecayTimer = 0;

// Bộ gom quà tặng liên tiếp theo userId (tránh spam hàng đợi khi khán giả bắn combo quà)
const pendingGiftBuckets = new Map<
  string,
  { nickname: string; giftName: string; totalCoins: number; count: number; timer: number }
>();

export function setCommentatorCaptionListener(fn: ((text: string) => void) | null) {
  captionListener = fn;
}

export function setCommentatorSpeakingListener(fn: ((speaking: boolean) => void) | null) {
  speakingListener = fn;
}

export function getTtsQueueLength(): number {
  return ttsQueue.length + (isProcessingTts ? 1 : 0);
}

function notifyMcSpeaking(speaking: boolean, autoStopMs = 0) {
  if (speakingDecayTimer) {
    clearTimeout(speakingDecayTimer);
    speakingDecayTimer = 0;
  }
  speakingListener?.(speaking);
  if (speaking && autoStopMs > 0) {
    speakingDecayTimer = window.setTimeout(() => {
      speakingDecayTimer = 0;
      if (!activeTtsSource) {
        speakingListener?.(false);
      }
    }, autoStopMs);
  }
}

/** Dừng toàn bộ TTS (dùng khi người dùng tắt giọng MC) */
export function stopCommentator() {
  ttsGeneration++;
  ttsQueue = [];
  if (activeTtsAbort) {
    try {
      activeTtsAbort.abort();
    } catch {}
    activeTtsAbort = null;
  }
  if (activeTtsSource) {
    try {
      activeTtsSource.onended = null;
      activeTtsSource.stop();
      activeTtsSource.disconnect();
    } catch {}
    activeTtsSource = null;
  }
  activeTtsKind = null;
  isProcessingTts = false;
  notifyMcSpeaking(false);
}

/**
 * Chuyển pha game: hủy các câu bình luận thường (normal/event/phase cũ) để không trễ nhịp,
 * NHƯNG giữ nguyên toàn bộ lời cảm ơn quà tặng (kind === 'gift') để không bao giờ bỏ sót cảm ơn khán giả!
 */
export function stopNonCriticalCommentator() {
  ttsQueue = ttsQueue.filter((item) => item.kind === 'gift' || item.kind === 'audience');
  if (activeTtsKind && activeTtsKind !== 'gift' && activeTtsKind !== 'audience') {
    ttsGeneration++;
    if (activeTtsAbort) {
      try {
        activeTtsAbort.abort();
      } catch {}
      activeTtsAbort = null;
    }
    if (activeTtsSource) {
      try {
        activeTtsSource.onended = null;
        activeTtsSource.stop();
        activeTtsSource.disconnect();
      } catch {}
      activeTtsSource = null;
    }
    activeTtsKind = null;
    isProcessingTts = false;
    notifyMcSpeaking(false);
    if (ttsQueue.length > 0) {
      void processNextTts();
    }
  }
}

/**
 * Khi có bình luận của khán giả cần MC trả lời:
 * Tạm dừng ngay các câu bình luận tự động đang chờ hoặc đang đọc dở (normal / event),
 * nhưng giữ nguyên lời cảm ơn quà tặng (gift) và câu trả lời khán giả khác (audience).
 */
export function pauseAutoCommentaryForAudience() {
  ttsQueue = ttsQueue.filter(
    (item) => item.kind === 'gift' || item.kind === 'audience' || item.kind === 'phase',
  );
  if (activeTtsKind === 'normal' || activeTtsKind === 'event') {
    ttsGeneration++;
    if (activeTtsAbort) {
      try {
        activeTtsAbort.abort();
      } catch {}
      activeTtsAbort = null;
    }
    if (activeTtsSource) {
      try {
        activeTtsSource.onended = null;
        activeTtsSource.stop();
        activeTtsSource.disconnect();
      } catch {}
      activeTtsSource = null;
    }
    activeTtsKind = null;
    isProcessingTts = false;
    notifyMcSpeaking(false);
    if (ttsQueue.length > 0) {
      void processNextTts();
    }
  }
}

/** Cho biết MC hiện có đang trả lời khán giả (hoặc vừa trả lời xong trong nhịp nghỉ 1.8s) hay không */
export function isAudienceInteractionActive(): boolean {
  if (activeTtsKind === 'audience') return true;
  if (ttsQueue.some((item) => item.kind === 'audience')) return true;
  if (lastAudienceEndedAt > 0 && Date.now() - lastAudienceEndedAt < 1800) return true;
  return false;
}

function pruneExpiredQueue() {
  const now = Date.now();
  ttsQueue = ttsQueue.filter((item) => now - item.createdAt <= item.maxAgeMs);
}

async function fetchTtsBuffer(
  text: string,
  voice: 'm' | 'f',
  hype: boolean,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const url = `/api/tts?text=${encodeURIComponent(text.slice(0, 220))}&voice=${voice}&hype=${hype ? '1' : '0'}`;
  const timeoutCtrl = new AbortController();
  const onParentAbort = () => timeoutCtrl.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });
  const timer = window.setTimeout(() => timeoutCtrl.abort(), TTS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: timeoutCtrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    return await res.arrayBuffer();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onParentAbort);
  }
}

async function processNextTts() {
  if (!ttsEnabled || isProcessingTts) return;
  pruneExpiredQueue();
  if (ttsQueue.length === 0) {
    notifyMcSpeaking(false);
    return;
  }

  const ctx = getCtx();
  const ttsBus = liveRuntime.getTtsInput();
  if (!ctx || !ttsBus) return;

  // Chọn câu có ưu tiên cao nhất (nếu bằng nhau thì lấy câu đến trước)
  ttsQueue.sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.createdAt - b.createdAt));
  const next = ttsQueue.shift()!;

  isProcessingTts = true;
  activeTtsKind = next.kind;
  const myGen = ++ttsGeneration;
  lastTtsAt = Date.now();
  captionListener?.(next.text);

  const abortCtrl = new AbortController();
  activeTtsAbort = abortCtrl;

  try {
    const arrayBuf = await fetchTtsBuffer(next.text, next.voice, next.hype, abortCtrl.signal);
    if (myGen !== ttsGeneration || !ttsEnabled) {
      isProcessingTts = false;
      activeTtsKind = null;
      return;
    }

    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    if (myGen !== ttsGeneration || !ttsEnabled) {
      isProcessingTts = false;
      activeTtsKind = null;
      return;
    }

    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ttsBus);
    activeTtsSource = src;
    activeTtsAbort = null;

    notifyMcSpeaking(true, Math.ceil(audioBuf.duration * 1000) + 600);
    src.onended = () => {
      if (myGen !== ttsGeneration) return;
      if (next.kind === 'audience') {
        lastAudienceEndedAt = Date.now();
      }
      try {
        src.disconnect();
      } catch {}
      activeTtsSource = null;
      activeTtsKind = null;
      isProcessingTts = false;
      if (ttsQueue.length > 0) {
        window.setTimeout(() => void processNextTts(), 70);
      } else {
        notifyMcSpeaking(false);
      }
    };
    src.start(0);
  } catch {
    if (myGen !== ttsGeneration) return;
    activeTtsAbort = null;
    activeTtsSource = null;
    activeTtsKind = null;
    isProcessingTts = false;
    if (ttsQueue.length > 0) {
      window.setTimeout(() => void processNextTts(), 120);
    } else {
      notifyMcSpeaking(false);
    }
  }
}

export function speakCommentator(text: string, priority = false, kind?: TtsKind) {
  const clean = text.trim();
  if (!clean) return;
  captionListener?.(clean);

  if (!ttsEnabled) {
    const estMs = Math.max(1800, Math.min(5200, clean.length * 42));
    notifyMcSpeaking(true, estMs);
    return;
  }

  const now = Date.now();
  casterToggle = casterToggle === 'm' ? 'f' : 'm';
  const resolvedKind: TtsKind = kind || (priority ? 'event' : 'normal');
  const priorityNum =
    resolvedKind === 'gift'
      ? 100
      : resolvedKind === 'audience'
        ? 95
        : resolvedKind === 'phase'
          ? 88
          : resolvedKind === 'event'
            ? 60
            : 20;
  // Thời hạn sự kiện riêng theo mức độ quan trọng (quà tặng giữ tới 22s, trả lời khán giả giữ 18s)
  const maxAgeMs =
    resolvedKind === 'gift'
      ? 22000
      : resolvedKind === 'audience'
        ? 18000
        : resolvedKind === 'phase'
          ? 5000
          : resolvedKind === 'event'
            ? 7500
            : 3800;

  if (resolvedKind === 'normal' || resolvedKind === 'event') {
    // Nếu đang trả lời khán giả thì không chèn bình luận tự động vào hàng đợi
    if (isAudienceInteractionActive()) return;
    if (resolvedKind === 'normal' && (isProcessingTts || ttsQueue.length > 0 || now - lastTtsAt < 2000)) return;
  }

  // Khi có câu trả lời khán giả mới -> tạm dừng ngay câu bình luận tự động đang đọc dở để tương tác liền!
  if (resolvedKind === 'audience') {
    pauseAutoCommentaryForAudience();
  } else if ((resolvedKind === 'gift' || resolvedKind === 'phase') && activeTtsKind === 'normal') {
    stopNonCriticalCommentator();
  }

  ttsQueue.push({
    text: clean,
    kind: resolvedKind,
    priority: priorityNum,
    hype: resolvedKind !== 'normal',
    voice: casterToggle,
    createdAt: now,
    maxAgeMs,
  });

  if (ttsQueue.length > MAX_TTS_QUEUE) {
    // Ưu tiên giữ các câu gift/phase/event, chỉ cắt bớt câu bình luận thường cũ nhất
    ttsQueue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    ttsQueue.length = MAX_TTS_QUEUE;
  }

  void processNextTts();
}

/**
 * Gom quà tặng liên tiếp của cùng 1 người xem trong 1.3 giây thành 1 lời cảm ơn trọn vẹn,
 * không làm nghẽn TTS Queue khi có combo quà!
 */
export function speakGiftThankYou(
  userId: string,
  nickname: string,
  giftName: string,
  coins: number,
  effectDesc: string,
) {
  const existing = pendingGiftBuckets.get(userId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.totalCoins += coins;
    existing.count += 1;
    existing.giftName = giftName || existing.giftName;
    existing.timer = window.setTimeout(() => {
      pendingGiftBuckets.delete(userId);
      const comboText =
        existing.count > 1
          ? `Cảm ơn ${existing.nickname} với combo ${existing.count} quà tổng ${existing.totalCoins} xu! ${effectDesc}!`
          : `Cảm ơn ${existing.nickname} tặng ${existing.giftName} ${existing.totalCoins} xu! ${effectDesc}!`;
      speakCommentator(comboText, true, 'gift');
    }, 1350);
    return;
  }

  const bucket = {
    nickname,
    giftName: giftName || 'quà VIP',
    totalCoins: coins,
    count: 1,
    timer: window.setTimeout(() => {
      pendingGiftBuckets.delete(userId);
      const line =
        bucket.count > 1
          ? `Cảm ơn ${bucket.nickname} với combo ${bucket.count} quà tổng ${bucket.totalCoins} xu! ${effectDesc}!`
          : `Cảm ơn ${bucket.nickname} tặng ${bucket.giftName}! ${effectDesc}!`;
      speakCommentator(line, true, 'gift');
    }, 650),
  };
  pendingGiftBuckets.set(userId, bucket);
}

/** Kiểm thử TTS thực tế cho Pre-Live Checklist (gọi /api/tts thật, decodeAudioData và phát qua Master Bus) */
export async function runTtsSelfTest(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = performance.now();
  try {
    const ctx = liveRuntime.ensureAudioGraph();
    const ttsBus = liveRuntime.getTtsInput();
    if (!ctx || !ttsBus) {
      return { ok: false, latencyMs: 0, error: 'Không khởi tạo được AudioContext' };
    }
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const ctrl = new AbortController();
    const buf = await fetchTtsBuffer(
      'Hệ thống âm thanh và bình luận viên trực tiếp đã sẵn sàng lên sóng!',
      'm',
      true,
      ctrl.signal,
    );
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(ttsBus);
    notifyMcSpeaking(true, Math.ceil(decoded.duration * 1000) + 300);
    src.onended = () => {
      try {
        src.disconnect();
      } catch {}
      if (!activeTtsSource) notifyMcSpeaking(false);
    };
    src.start(0);
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: err?.message || 'Lỗi kết nối /api/tts',
    };
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    () => {
      const ctx = liveRuntime.ensureAudioGraph();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      if (bgmEnabled && !bgmTimer) startRaceBgm();
    },
    { passive: true },
  );
}
