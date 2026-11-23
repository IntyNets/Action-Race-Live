import { WakeLockStatus } from '../audio/liveRuntime';

export type WebcamStatus = 'off' | 'starting' | 'active' | 'lost' | 'denied';

export interface WebcamRect {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'circle' | 'rounded';
}

export interface StageHealthSnapshot {
  fps: number;
  /** Số giây liên tục FPS dưới 15 (chỉ cảnh báo khi >= 4 giây liên tục) */
  lowFpsStreakSec: number;
  visibilityState: DocumentVisibilityState;
  audioState: AudioContextState | 'uninitialized';
  /** Mức biên độ âm thanh RMS thực tế từ AnalyserNode (0..1) */
  audioLevel: number;
  wakeLockStatus: WakeLockStatus;
  webcamState: WebcamStatus;
  liveStarted: boolean;
  ttsQueueLen: number;
  timestamp: number;
}

export interface TtsTestResult {
  status: 'untested' | 'testing' | 'ok' | 'error';
  latencyMs?: number;
  error?: string;
  testedAt?: number;
}

export const STAGE_HEALTH_CHANNEL = 'action-race-live-health';

export type StageHealthMessage =
  | { type: 'heartbeat'; data: StageHealthSnapshot }
  | { type: 'requestTtsTest' }
  | { type: 'ttsTestResult'; data: TtsTestResult };

export function openHealthChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  try {
    return new BroadcastChannel(STAGE_HEALTH_CHANNEL);
  } catch {
    return null;
  }
}
