/**
 * LiveRuntime — Nguồn AudioContext duy nhất cho toàn bộ game (BGM + SFX + TTS)
 * Kiến trúc Master Audio Bus:
 *   BGM ──┐
 *   SFX ──┼──> Master Gain ──> DynamicsCompressor (Limiter) ──> AnalyserNode ──┬──> AudioContext.destination (Windows System Audio)
 *   TTS ──┘                                                                    └──> MediaStreamAudioDestinationNode (RTMP giai đoạn sau)
 *
 * Quản lý luôn Screen Wake Lock (chỉ chống tắt màn hình, không giả lập vòng lặp hay nhiễu nền giả).
 */

export type WakeLockStatus = 'active' | 'inactive' | 'unsupported';

class LiveRuntimeManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ttsBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;

  private wakeLock: WakeLockSentinel | null = null;
  private wakeLockDesired = false;
  private visibilityListenerBound = false;
  private liveModeStarted = false;

  /** Tạo hoặc trả về AudioContext duy nhất của toàn bộ ứng dụng */
  public ensureAudioGraph(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.ctx && this.ctx.state !== 'closed') {
      return this.ctx;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();

      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.92;

      const bgmBus = ctx.createGain();
      bgmBus.gain.value = 0.45;

      const sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.85;

      const ttsBus = ctx.createGain();
      ttsBus.gain.value = 1.0;

      // Bộ nén / giới hạn đỉnh âm thanh tránh rè vỡ tiếng khi SFX + BGM + TTS phát cùng lúc
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, ctx.currentTime);
      compressor.knee.setValueAtTime(18, ctx.currentTime);
      compressor.ratio.setValueAtTime(6, ctx.currentTime);
      compressor.attack.setValueAtTime(0.005, ctx.currentTime);
      compressor.release.setValueAtTime(0.18, ctx.currentTime);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;

      const streamDest = ctx.createMediaStreamDestination();

      // Kết nối đường tiếng duy nhất: BGM/SFX/TTS -> Master -> Compressor -> Analyser -> [System Audio + MediaStream]
      bgmBus.connect(masterGain);
      sfxBus.connect(masterGain);
      ttsBus.connect(masterGain);
      masterGain.connect(compressor);
      compressor.connect(analyser);
      analyser.connect(ctx.destination);
      analyser.connect(streamDest);

      this.ctx = ctx;
      this.masterGain = masterGain;
      this.bgmBus = bgmBus;
      this.sfxBus = sfxBus;
      this.ttsBus = ttsBus;
      this.compressor = compressor;
      this.analyser = analyser;
      this.streamDest = streamDest;
      this.timeData = new Uint8Array(new ArrayBuffer(analyser.fftSize));

      return ctx;
    } catch {
      return null;
    }
  }

  public getAudioContext(): AudioContext | null {
    return this.ensureAudioGraph();
  }

  public getBgmInput(): GainNode | null {
    this.ensureAudioGraph();
    return this.bgmBus;
  }

  public getSfxInput(): GainNode | null {
    this.ensureAudioGraph();
    return this.sfxBus;
  }

  public getTtsInput(): GainNode | null {
    this.ensureAudioGraph();
    return this.ttsBus;
  }

  public getMixedAudioStream(): MediaStream | null {
    this.ensureAudioGraph();
    return this.streamDest?.stream || null;
  }

  public isLiveStarted(): boolean {
    return this.liveModeStarted;
  }

  public getAudioState(): AudioContextState | 'uninitialized' {
    if (!this.ctx) return 'uninitialized';
    return this.ctx.state;
  }

  /** Đo mức biên độ âm thanh RMS thực tế từ AnalyserNode (0.0 -> 1.0) */
  public getAudioLevel(): number {
    if (!this.analyser || !this.timeData || !this.ctx || this.ctx.state !== 'running') {
      return 0;
    }
    this.analyser.getByteTimeDomainData(this.timeData);
    let sumSq = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const norm = (this.timeData[i] - 128) / 128;
      sumSq += norm * norm;
    }
    const rms = Math.sqrt(sumSq / this.timeData.length);
    return Math.min(1, rms * 3.4);
  }

  /**
   * Kích hoạt Chế Độ Live từ thao tác click thực tế của người vận hành:
   * 1) Mở khóa AudioContext (tránh bị chặn autoplay)
   * 2) Xin quyền Screen Wake Lock (nếu trình duyệt hỗ trợ)
   */
  public async startLiveMode(opts?: { keepScreenAwake?: boolean }): Promise<{
    audioState: AudioContextState | 'uninitialized';
    wakeLock: WakeLockStatus;
  }> {
    const ctx = this.ensureAudioGraph();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {}
    }

    this.liveModeStarted = true;

    let wakeLock: WakeLockStatus = 'unsupported';
    if (opts?.keepScreenAwake !== false) {
      wakeLock = await this.requestWakeLock();
    }

    return {
      audioState: this.getAudioState(),
      wakeLock,
    };
  }

  public isWakeLockSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  public isWakeLockActive(): boolean {
    return Boolean(this.wakeLock && !this.wakeLock.released);
  }

  public getWakeLockStatus(): WakeLockStatus {
    if (!this.isWakeLockSupported()) return 'unsupported';
    return this.isWakeLockActive() ? 'active' : 'inactive';
  }

  public async requestWakeLock(): Promise<WakeLockStatus> {
    if (!this.isWakeLockSupported()) return 'unsupported';
    this.wakeLockDesired = true;
    this.bindVisibilityReacquire();
    try {
      if (this.wakeLock && !this.wakeLock.released) return 'active';
      const sentinel = await navigator.wakeLock.request('screen');
      this.wakeLock = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.wakeLock === sentinel) {
          this.wakeLock = null;
        }
      });
      return 'active';
    } catch {
      return 'inactive';
    }
  }

  public async releaseWakeLock(): Promise<void> {
    this.wakeLockDesired = false;
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
      } catch {}
      this.wakeLock = null;
    }
  }

  private bindVisibilityReacquire() {
    if (this.visibilityListenerBound || typeof document === 'undefined') return;
    this.visibilityListenerBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wakeLockDesired && !this.isWakeLockActive()) {
        void this.requestWakeLock();
      }
    });
  }
}

export const liveRuntime = new LiveRuntimeManager();

