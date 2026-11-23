/**
 * Hệ thống âm thanh tổng hợp 100% Web Audio (không cần file MP3 ngoài, không vướng bản quyền):
 * - Nhạc nền đua xe sôi động 128 BPM (có bộ lọc ấm + Compressor)
 * - SFX riêng cho: Join, Sprint, Jetpack, Rocket, Rồng Thần VIP, Đếm ngược, Pháo hoa về đích
 * - Giọng MC Bình luận viên tiếng Việt qua /api/tts (Edge TTS)
 */

let audioCtx: AudioContext | null = null;
let bgmMaster: GainNode | null = null;
let bgmTimer = 0;
let bgmStep = 0;
let bgmNextAt = 0;
let bgmEnabled = true;
let sfxEnabled = true;
let ttsEnabled = true;
let activeTtsAudio: HTMLAudioElement | null = null;
let lastTtsAt = 0;

function getCtx(): AudioContext | null {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

export function setAudioSettings(opts: { bgm?: boolean; sfx?: boolean; tts?: boolean }) {
  if (typeof opts.bgm === 'boolean') {
    bgmEnabled = opts.bgm;
    if (bgmEnabled) startRaceBgm();
    else stopRaceBgm();
  }
  if (typeof opts.sfx === 'boolean') sfxEnabled = opts.sfx;
  if (typeof opts.tts === 'boolean') ttsEnabled = opts.tts;
}

// ---------- Nhạc nền 128 BPM sôi động ----------
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
  if (!audioCtx || !bgmMaster || !bgmEnabled) return;
  const c = audioCtx;
  const duck = activeTtsAudio && !activeTtsAudio.paused ? 0.35 : 0.72;
  bgmMaster.gain.setTargetAtTime(duck * 0.45, c.currentTime, 0.15);

  while (bgmNextAt < c.currentTime + 0.14) {
    const t = bgmNextAt;
    const s = bgmStep % 32;
    const bar = Math.floor(s / 8);

    // Kick drum on every quarter note (4-on-the-floor racing energy)
    if (s % 4 === 0) {
      playEnvOsc(c, bgmMaster, 'sine', 145, t, 0.16, 0.75, 42);
    }
    // Off-beat driving bass
    if (s % 2 === 1) {
      playEnvOsc(c, bgmMaster, 'sawtooth', BASS_NOTES[bar], t, STEP_SEC * 1.4, 0.22);
    }
    // Bright arcade lead
    const lead = LEAD_NOTES[s];
    if (lead > 0) {
      playEnvOsc(c, bgmMaster, 'triangle', lead, t, STEP_SEC * 1.9, 0.24);
    }
    bgmNextAt += STEP_SEC;
    bgmStep++;
  }
}

export function startRaceBgm() {
  if (!bgmEnabled || bgmTimer) return;
  const c = getCtx();
  if (!c) return;
  bgmMaster = c.createGain();
  bgmMaster.gain.value = 0.01;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  const comp = c.createDynamicsCompressor();
  bgmMaster.connect(lp).connect(comp).connect(c.destination);
  bgmNextAt = c.currentTime + 0.08;
  bgmStep = 0;
  bgmTimer = window.setInterval(scheduleBgm, 50);
}

export function stopRaceBgm() {
  clearInterval(bgmTimer);
  bgmTimer = 0;
  if (audioCtx && bgmMaster) {
    const m = bgmMaster;
    m.gain.setTargetAtTime(0, audioCtx.currentTime, 0.15);
    setTimeout(() => m.disconnect(), 600);
  }
  bgmMaster = null;
}

// ---------- Hiệu ứng âm thanh (SFX) riêng biệt ----------
export function playJoinSfx() {
  if (!sfxEnabled) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  playEnvOsc(c, c.destination, 'sine', 520, t, 0.1, 0.22, 780);
  playEnvOsc(c, c.destination, 'triangle', 780, t + 0.07, 0.12, 0.18, 1046);
}

export function playSprintSfx() {
  if (!sfxEnabled) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  playEnvOsc(c, c.destination, 'triangle', 440, t, 0.18, 0.2, 880);
}

export function playJetpackSfx() {
  if (!sfxEnabled) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  playEnvOsc(c, c.destination, 'sawtooth', 180, t, 0.35, 0.22, 520);
  playEnvOsc(c, c.destination, 'triangle', 660, t + 0.1, 0.25, 0.18, 990);
}

export function playRocketSfx() {
  if (!sfxEnabled) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  // Tiếng phóng tên lửa tăng tần số mạnh mẽ
  playEnvOsc(c, c.destination, 'sawtooth', 110, t, 0.55, 0.3, 680);
  playEnvOsc(c, c.destination, 'square', 220, t + 0.08, 0.45, 0.16, 1100);
}

export function playVipDragonSfx() {
  if (!sfxEnabled) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  // Âm thanh uy lực Rồng Thần + hợp âm kèn đồng chiến thắng
  playEnvOsc(c, c.destination, 'sawtooth', 95, t, 0.7, 0.35, 55);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
    playEnvOsc(c, c.destination, 'triangle', f, t + 0.12 + idx * 0.07, 0.55, 0.24);
  });
}

export function playCountdownBeep(final = false) {
  if (!sfxEnabled) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  playEnvOsc(c, c.destination, 'square', final ? 1046.5 : 660, t, final ? 0.32 : 0.14, 0.22);
}

export function playFinishFanfareSfx() {
  if (!sfxEnabled) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  // Tiếng pháo hoa + kèn chiến thắng
  const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
  notes.forEach((f, i) => {
    playEnvOsc(c, c.destination, 'triangle', f, t + i * 0.11, 0.28, 0.28);
  });
}

export function playCrowdCheerSfx() {
  if (!sfxEnabled) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  // Tiếng hò reo khán đài + hợp âm chiến thắng ngắn
  playEnvOsc(c, c.destination, 'triangle', 587.33, t, 0.18, 0.2, 880);
  playEnvOsc(c, c.destination, 'triangle', 880, t + 0.08, 0.24, 0.22, 1174.66);
}

// ---------- Giọng MC Bình Luận Viên Songấu (Nam Minh & Hoài My - Edge TTS tiếng Việt) ----------
let pendingTtsQueue: Array<{ text: string; hype: boolean; voice: 'm' | 'f'; createdAt: number }> = [];
let casterToggle: 'm' | 'f' = 'm';
let captionListener: ((text: string) => void) | null = null;
let speakingListener: ((speaking: boolean) => void) | null = null;
let speakingDecayTimer = 0;
let activeTtsIsPriority = false;
let activeTtsStartedAt = 0;
let ttsGeneration = 0;

export function setCommentatorCaptionListener(fn: ((text: string) => void) | null) {
  captionListener = fn;
}

export function setCommentatorSpeakingListener(fn: ((speaking: boolean) => void) | null) {
  speakingListener = fn;
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
      if (!activeTtsAudio || activeTtsAudio.paused) {
        speakingListener?.(false);
      }
    }, autoStopMs);
  }
}

/** Ngắt ngay câu MC cũ khi chuyển pha game (Lobby -> Đua -> Về đích -> Vinh danh) để MC không bị trễ nhịp */
export function stopCommentator() {
  ttsGeneration++;
  pendingTtsQueue = [];
  if (activeTtsAudio) {
    try {
      activeTtsAudio.pause();
      activeTtsAudio.src = '';
    } catch {}
    activeTtsAudio = null;
  }
  activeTtsIsPriority = false;
  notifyMcSpeaking(false);
}

function playNextInTtsQueue() {
  if (!ttsEnabled || pendingTtsQueue.length === 0) return;
  if (activeTtsAudio && !activeTtsAudio.paused) return;

  // Bỏ qua các câu bình luận đã cũ quá 2.4 giây để MC luôn khớp thời gian thực của game
  const now = Date.now();
  while (pendingTtsQueue.length > 0 && now - pendingTtsQueue[0].createdAt > 2400) {
    pendingTtsQueue.shift();
  }
  if (pendingTtsQueue.length === 0) {
    notifyMcSpeaking(false);
    return;
  }

  const next = pendingTtsQueue.shift()!;
  const myGen = ++ttsGeneration;
  lastTtsAt = now;
  activeTtsIsPriority = next.hype;
  activeTtsStartedAt = now;
  captionListener?.(next.text);

  try {
    const url = `/api/tts?text=${encodeURIComponent(next.text.slice(0, 220))}&voice=${next.voice}&hype=${next.hype ? '1' : '0'}`;
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.volume = 1.0;
    activeTtsAudio = audio;
    audio.onplaying = () => {
      if (myGen !== ttsGeneration) return;
      notifyMcSpeaking(true, 9000);
    };
    audio.onended = () => {
      if (myGen !== ttsGeneration) return;
      activeTtsAudio = null;
      activeTtsIsPriority = false;
      if (pendingTtsQueue.length > 0) {
        setTimeout(playNextInTtsQueue, 60);
      } else {
        notifyMcSpeaking(false);
      }
    };
    audio.onerror = () => {
      if (myGen !== ttsGeneration) return;
      activeTtsAudio = null;
      activeTtsIsPriority = false;
      if (pendingTtsQueue.length > 0) {
        setTimeout(playNextInTtsQueue, 60);
      } else {
        notifyMcSpeaking(false);
      }
    };
    void audio.play().catch(() => {
      if (myGen !== ttsGeneration) return;
      activeTtsAudio = null;
      activeTtsIsPriority = false;
      notifyMcSpeaking(false);
    });
  } catch {
    activeTtsAudio = null;
    activeTtsIsPriority = false;
    notifyMcSpeaking(false);
  }
}

export function speakCommentator(text: string, priority = false) {
  const clean = text.trim();
  if (!clean) return;
  captionListener?.(clean);
  if (!ttsEnabled) {
    // Trên Dashboard Preview (tắt tiếng): nhấp nháy sóng âm MC đồng bộ theo độ dài câu nói
    const estMs = Math.max(1800, Math.min(5200, clean.length * 42));
    notifyMcSpeaking(true, estMs);
    return;
  }

  const now = Date.now();
  const isSpeaking = Boolean(activeTtsAudio && !activeTtsAudio.paused);

  // Luân phiên 2 BLV Nam Minh & Hoài My
  casterToggle = casterToggle === 'm' ? 'f' : 'm';

  if (priority) {
    // Sự kiện quan trọng / Chuyển pha: ngắt ngay câu bình luận thường (hoặc câu cũ > 1.8s) để đọc NGAY LẬP TỨC không bị delay!
    if (isSpeaking && (!activeTtsIsPriority || now - activeTtsStartedAt > 1800)) {
      stopCommentator();
      pendingTtsQueue = [{ text: clean, hype: true, voice: casterToggle, createdAt: now }];
      playNextInTtsQueue();
      return;
    }
    if (isSpeaking) {
      pendingTtsQueue = [{ text: clean, hype: true, voice: casterToggle, createdAt: now }];
    } else {
      pendingTtsQueue = [{ text: clean, hype: true, voice: casterToggle, createdAt: now }];
      playNextInTtsQueue();
    }
    return;
  }

  // Bình luận diễn biến định kỳ: nếu đang nói hoặc vừa mới nói < 1.8s thì bỏ qua để không xếp hàng gây delay
  if (isSpeaking || pendingTtsQueue.length > 0 || now - lastTtsAt < 1800) return;
  pendingTtsQueue = [{ text: clean, hype: false, voice: casterToggle, createdAt: now }];
  playNextInTtsQueue();
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    () => {
      void getCtx();
      if (bgmEnabled && !bgmTimer) startRaceBgm();
    },
    { passive: true },
  );
}

