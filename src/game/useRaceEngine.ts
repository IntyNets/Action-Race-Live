import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoostKind,
  DEFAULT_FOOTER_BANNER,
  DroneRect,
  FooterBannerConfig,
  GraphicsQuality,
  LiveStatus,
  MatchPhase,
  MinimapDot,
  RACE_CONSTANTS,
  RacerState,
  SpectatorInfo,
  UserProfile,
  VipBannerEvent,
} from './raceTypes';
import { getActiveMapId, sampleCircuit, setActiveMap, worldToMinimap } from './trackCurve';
import { resolveAvatarColor } from './avatarColor';
import {
  AiDirectorModes,
  CameraDirector,
  CameraHudState,
  CameraModeOverride,
} from './camera/CameraDirector';
import {
  getTtsQueueLength,
  playCountdownBeep,
  playCrowdCheerSfx,
  playFinishFanfareSfx,
  playJetpackSfx,
  playJoinSfx,
  playRocketSfx,
  playSprintSfx,
  playVipDragonSfx,
  runTtsSelfTest,
  setAudioSettings,
  setCommentatorCaptionListener,
  setCommentatorSpeakingListener,
  speakCommentator,
  speakGiftThankYou,
  startRaceBgm,
  stopNonCriticalCommentator,
} from '../audio/raceAudio';
import { liveRuntime } from '../audio/liveRuntime';
import {
  StageHealthMessage,
  StageHealthSnapshot,
  TtsTestResult,
  WebcamRect,
  WebcamStatus,
  openHealthChannel,
} from '../live/stageHealth';
import {
  BroadcastOutputModeId,
  detectStageOutputModeFromUrl,
  isBroadcastOutputModeId,
} from '../live/broadcastModes';

// Phân tách Chế Độ Live (/?view=stage) và Bảng Điều Khiển (/) giống npc-action-live
export const IS_STAGE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('view') === 'stage';

export const STAGE_OUTPUT_MODE: BroadcastOutputModeId = detectStageOutputModeFromUrl();
export const IS_BROWSER_SOURCE = IS_STAGE && STAGE_OUTPUT_MODE === 'browser_source';

const SHIRT_PALETTE = [
  0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x06b6d4,
  0x3b82f6, 0x8b5cf6, 0xec4899, 0x14b8a6, 0xf43f5e,
];
const PANTS_PALETTE = [0x1e293b, 0x1d4ed8, 0x334155, 0x0f172a, 0x3f3f46, 0x312e81];
const SKIN_PALETTE = [0xfde68a, 0xfed7aa, 0xfdba74, 0xf5d0a9, 0xe5b887];
const HAT_PALETTE = [0xfacc15, 0x38bdf8, 0xfb7185, 0x4ade80, 0xc084fc, 0xffffff, 0xf97316];

const BOT_NAMES = [
  'Tốc Độ 99', 'Sói Cô Độc', 'Bánh Mì Trứng', 'Hỏa Tiễn Nhí',
  'Mèo Béo Đua Xe', 'Cà Phê Sữa Đá', 'Trùm Bứt Phá', 'Thần Gió VN',
  'Rồng Lửa 2026', 'Ninja Đỏ', 'Bé Na Chạy Bộ', 'Đỉnh Cao 60FPS',
];

const MOCK_NAMES = [
  'Minh Quân', 'Ngọc Hân', 'Hoàng Nam', 'Thảo Vy', 'Tuấn Kiệt',
  'Khánh Linh', 'Gia Bảo', 'Phương Anh', 'Đức Thắng', 'Hải Yến',
  'Quốc Bảo', 'Lan Chi', 'Việt Hoàng', 'Mỹ Duyên', 'Thanh Tùng',
];

const NOTBLOX_PET_NAMES = [
  '🐱 Mèo',
  '🐶 Cún',
  '🐺 Sói Con',
  '🐴 Ngựa Con',
  '🦝 Gấu Mèo',
  '🐷 Heo Con',
  '🐑 Cừu Non',
  '🐥 Gà Con',
];

const BOOST_PRIORITY: Record<BoostKind, number> = {
  none: 0,
  chat: 1,
  join: 2,
  sprint: 3,
  jetpack: 4,
  rocket: 5,
  superman: 6,
  dragon: 7,
};

const BOOST_MULTIPLIER: Record<BoostKind, number> = {
  none: 1.0,
  chat: 1.45,
  join: 1.72, // Tăng tốc nhẹ nhập cuộc lấy cảm hứng cho người chơi vào sau
  sprint: 1.88,
  jetpack: 2.35,
  rocket: 3.35,
  superman: 3.95,
  dragon: 4.8,
};

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function makeAvatarDataUrl(name: string, bgHex: number): string {
  const initial = (name.trim()[0] || '?').toUpperCase();
  const hex = '#' + bgHex.toString(16).padStart(6, '0');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="${hex}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="900" font-size="44">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface ActivityFeedItem {
  id: number;
  text: string;
  tone: 'join' | 'sprint' | 'jetpack' | 'rocket' | 'dragon' | 'system';
}

export function useRaceEngine() {
  const racersRef = useRef<Map<string, RacerState>>(new Map());
  const spectatorsRef = useRef<Map<string, SpectatorInfo>>(new Map());
  const phaseRef = useRef<MatchPhase>('lobby');
  const timerRef = useRef<number>(RACE_CONSTANTS.LOBBY_SECONDS);
  const totalLapsRef = useRef<number>(RACE_CONSTANTS.DEFAULT_LAPS);
  const autoBotsRef = useRef<boolean>(true);
  const lastBeepSecRef = useRef<number>(-1);
  const announcedFinalLapRef = useRef<boolean>(false);
  const raceElapsedRef = useRef<number>(0);
  const lastTop1IdRef = useRef<string>('');
  const cameraDirectorRef = useRef<CameraDirector>(new CameraDirector());
  const nextRoundVipQueueRef = useRef<
    Array<{
      userId: string;
      username: string;
      nickname: string;
      avatar: string;
      coins: number;
    }>
  >([]);
  const feedSeqRef = useRef<number>(1);
  const bannerSeqRef = useRef<number>(1);
  const mockSeqRef = useRef<number>(1);
  const tabIdRef = useRef<string>(Math.random().toString(36).slice(2, 10));
  const matchNoRef = useRef<number>(1);
  const droneCamOnRef = useRef<boolean>(true);
  const wsRef = useRef<WebSocket | null>(null);
  const syncAccumRef = useRef<number>(0);
  const lastMasterSyncAtRef = useRef<number>(0);
  const liveCommentAccumRef = useRef<number>(0);
  const lobbyHypeDoneRef = useRef<boolean>(false);
  const commentIdxRef = useRef<number>(0);
  const lastJoinVoiceAtRef = useRef<number>(0);
  const [commentatorText, setCommentatorText] = useState<string>(
    '🎙️ Chào mừng cả nhà đến với Đấu Trường Đua Tốc Độ 3D! Bình luận bất kỳ hoặc thả tim để vào sân ngay!',
  );

  const [mapId, setMapIdState] = useState<string>(getActiveMapId());
  const pendingMapRef = useRef<string | null>(null);

  const raceDurationRef = useRef<number>(180);
  const [raceDuration, setRaceDurationState] = useState<number>(180);

  const [cameraHud, setCameraHud] = useState<CameraHudState>(() =>
    cameraDirectorRef.current.getHudState(),
  );

  const [phase, setPhase] = useState<MatchPhase>('lobby');
  const [timerSec, setTimerSec] = useState<number>(RACE_CONSTANTS.LOBBY_SECONDS);
  const [matchNo, setMatchNo] = useState<number>(1);
  const [totalLaps, setTotalLapsState] = useState<number>(RACE_CONSTANTS.DEFAULT_LAPS);
  const [leaderLap, setLeaderLap] = useState<number>(1);
  const [racerCount, setRacerCount] = useState<number>(0);
  const [top5, setTop5] = useState<RacerState[]>([]);
  const [podiumTop3, setPodiumTop3] = useState<RacerState[]>([]);
  const [minimapDots, setMinimapDots] = useState<MinimapDot[]>([]);
  const [leaderProgress, setLeaderProgress] = useState<number>(0);
  const [vipBanner, setVipBanner] = useState<VipBannerEvent | null>(null);
  const [feed, setFeed] = useState<ActivityFeedItem[]>([]);
  const [autoBots, setAutoBotsState] = useState<boolean>(true);
  const [droneCamOn, setDroneCamOnState] = useState<boolean>(true);
  const defaultDroneRect: DroneRect = { x: 63, y: 58, w: 34, h: 22 };
  const droneRectRef = useRef<DroneRect>(defaultDroneRect);
  const [droneRect, setDroneRectState] = useState<DroneRect>(() => {
    try {
      const saved = localStorage.getItem('droneRect');
      if (saved) {
        const p = JSON.parse(saved);
        if (p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.w === 'number' && typeof p.h === 'number') {
          droneRectRef.current = p;
          return p;
        }
      }
    } catch {}
    return defaultDroneRect;
  });
  const graphicsQualityRef = useRef<GraphicsQuality>('medium');
  const [graphicsQuality, setGraphicsQualityState] = useState<GraphicsQuality>(() => {
    try {
      const q = localStorage.getItem('graphicsQuality');
      if (q === 'low' || q === 'medium' || q === 'high') {
        graphicsQualityRef.current = q;
        return q;
      }
    } catch {}
    return 'medium';
  });
  const [isMcSpeaking, setIsMcSpeaking] = useState<boolean>(false);
  const [focusedRacer, setFocusedRacer] = useState<(RacerState & { gapSec: number }) | null>(null);
  // Webcam Host PiP — mặc định TẮT, chỉ xin quyền camera sau thao tác chủ động của người vận hành
  const webcamEnabledRef = useRef<boolean>(false);
  const [webcamEnabled, setWebcamEnabledState] = useState<boolean>(false);
  const defaultWebcamRect: WebcamRect = { x: 4, y: 63, w: 28, h: 16, shape: 'circle' };
  const webcamRectRef = useRef<WebcamRect>(defaultWebcamRect);
  const [webcamRect, setWebcamRectState] = useState<WebcamRect>(() => {
    try {
      const saved = localStorage.getItem('webcamRect');
      if (saved) {
        const p = JSON.parse(saved);
        if (p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.w === 'number' && typeof p.h === 'number') {
          webcamRectRef.current = p;
          return p;
        }
      }
    } catch {}
    return defaultWebcamRect;
  });
  const webcamStatusRef = useRef<WebcamStatus>('off');
  const [webcamStatus, setWebcamStatusState] = useState<WebcamStatus>('off');
  const [liveModeStarted, setLiveModeStarted] = useState<boolean>(false);
  const stageFpsRef = useRef<number>(60);
  const lowFpsStreakRef = useRef<number>(0);
  const lastStageBeatAtRef = useRef<number>(0);
  const ttsTestRunningRef = useRef<boolean>(false);
  const healthChannelRef = useRef<BroadcastChannel | null>(null);
  const [stageHealth, setStageHealth] = useState<StageHealthSnapshot | null>(null);
  const [stageOnline, setStageOnline] = useState<boolean>(false);
  const [ttsTestResult, setTtsTestResult] = useState<TtsTestResult>({ status: 'untested' });
  const [broadcastMode, setBroadcastModeState] = useState<BroadcastOutputModeId>(() => {
    try {
      const saved = localStorage.getItem('broadcastOutputMode');
      if (isBroadcastOutputModeId(saved)) {
        return saved;
      }
    } catch {}
    return 'window_capture';
  });
  const footerBannerRef = useRef<FooterBannerConfig>(DEFAULT_FOOTER_BANNER);
  const [footerBanner, setFooterBannerState] = useState<FooterBannerConfig>(() => {
    try {
      const saved = localStorage.getItem('footerBanner');
      if (saved) {
        const p = JSON.parse(saved);
        if (
          p &&
          typeof p.text === 'string' &&
          typeof p.fontSize === 'number' &&
          typeof p.x === 'number' &&
          typeof p.y === 'number'
        ) {
          const merged: FooterBannerConfig = {
            ...DEFAULT_FOOTER_BANNER,
            ...p,
          };
          footerBannerRef.current = merged;
          return merged;
        }
      }
    } catch {}
    return DEFAULT_FOOTER_BANNER;
  });
  const cameraModeRef = useRef<CameraModeOverride>('auto');
  const [cameraMode, setCameraModeState] = useState<CameraModeOverride>('auto');
  const defaultAiModes: AiDirectorModes = {
    chase: true,
    front: true,
    side: true,
    overview: true,
  };
  const aiCameraModesRef = useRef<AiDirectorModes>(defaultAiModes);
  const [aiCameraModes, setAiCameraModesState] = useState<AiDirectorModes>(() => {
    try {
      const saved = localStorage.getItem('aiCameraModes');
      if (saved) {
        const p = JSON.parse(saved);
        if (p && typeof p.chase === 'boolean') {
          aiCameraModesRef.current = p;
          cameraDirectorRef.current.setAiModes(p);
          return p;
        }
      }
    } catch {}
    return defaultAiModes;
  });
  const savedUsersRef = useRef<Map<string, UserProfile>>(new Map());
  const [savedUsers, setSavedUsers] = useState<UserProfile[]>([]);
  const followersRef = useRef<Set<string>>(new Set());
  const hostUserIdsRef = useRef<Set<string>>(new Set());
  /** Người chơi từng tham gia đua rồi bị out do rời live (không tương tác quá thời gian AFK) */
  const departedRacersRef = useRef<Map<string, { nickname: string; departedAt: number }>>(new Map());
  /** Tránh MC chào lặp cùng 1 khán giả trong vòng 3 phút */
  const greetedViewersRef = useRef<Map<string, number>>(new Map());
  const lastNeedFollowVoiceAtRef = useRef<number>(0);
  const lastWelcomeVoiceAtRef = useRef<number>(0);
  const lastReturnVoiceAtRef = useRef<number>(0);
  const lastFollowVoiceAtRef = useRef<number>(0);
  /** Thời gian tự động cho nhân vật rời cuộc đua khi không còn tương tác / rời live (mặc định 300s = 5 phút; 0 = tắt) */
  const afkTimeoutSecRef = useRef<number>(300);
  const [afkTimeoutSec, setAfkTimeoutSecState] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('afkTimeoutSec'));
      if (Number.isFinite(saved) && saved >= 0 && saved <= 3600) {
        afkTimeoutSecRef.current = saved;
        return saved;
      }
    } catch {}
    return 300;
  });
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({
    connected: false,
    connecting: false,
    username: '',
    viewerCount: 0,
    totalLikes: 0,
    error: '',
    fb: {
      isConnected: false,
      isConnecting: false,
      mode: '',
      videoId: '',
      pageName: '',
      viewerCount: 0,
      totalReactions: 0,
      commentsReceived: 0,
      error: '',
    },
  });

  const applySavedUsersList = useCallback((list: UserProfile[]) => {
    if (!Array.isArray(list)) return;
    const nextMap = new Map<string, UserProfile>();
    for (const u of list) {
      if (u && u.userId) {
        nextMap.set(u.userId, u);
        if (u.username) nextMap.set(u.username, u);
        if (u.isFollower) {
          followersRef.current.add(u.userId);
          if (u.username) followersRef.current.add(u.username);
        }
      }
    }
    savedUsersRef.current = nextMap;
    setSavedUsers(list);
  }, []);

  const syncRacerProfilesToServer = useCallback(
    (racersToSave: RacerState[], podiumBonusMap?: Map<string, { addPoints: number; addWin: number; addPodium: number }>) => {
      const payloadUsers: UserProfile[] = [];
      for (const r of racersToSave) {
        if (!r || r.isBot || r.id.startsWith('bot_')) continue;
        const prev = savedUsersRef.current.get(r.id) || savedUsersRef.current.get(r.username);
        const bonus = podiumBonusMap?.get(r.id);
        const nextPoints = Math.max(0, (r.points || prev?.points || 10) + (bonus?.addPoints || 0));
        const nextLevel = Math.max(1, 1 + Math.floor(nextPoints / 100));
        const nextWins = Math.max(0, (r.wins ?? prev?.wins ?? 0) + (bonus?.addWin || 0));
        const nextPodiums = Math.max(0, (prev?.podiums ?? 0) + (bonus?.addPodium || 0));
        r.points = nextPoints;
        r.level = nextLevel;
        r.wins = nextWins;

        const profile: UserProfile = {
          userId: r.id,
          username: r.username || r.id,
          nickname: r.nickname,
          avatar: r.avatar,
          platform: r.platform || prev?.platform || 'tiktok',
          level: nextLevel,
          points: nextPoints,
          wins: nextWins,
          podiums: nextPodiums,
          matches: Math.max(1, r.matches || prev?.matches || 1),
          totalCoins: Math.max(r.coinsSpent || 0, prev?.totalCoins || 0),
          characterIdx: r.characterIdx,
          shirtColor: r.shirtColor,
          pantsColor: r.pantsColor,
          skinColor: r.skinColor,
          hatColor: r.hatColor,
          petIdx: r.petIdx,
          petName: r.petName,
          petSpeedBonus: r.petSpeedBonus,
          isFollower: Boolean(
            prev?.isFollower ||
              followersRef.current.has(r.id) ||
              (r.username && followersRef.current.has(r.username)),
          ),
          updatedAt: Date.now(),
        };
        savedUsersRef.current.set(profile.userId, profile);
        payloadUsers.push(profile);
      }

      if (payloadUsers.length === 0) return;
      void fetch('/api/users/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: payloadUsers }),
      }).catch(() => { });
    },
    [],
  );

  const setAutoBots = useCallback((v: boolean) => {
    autoBotsRef.current = v;
    setAutoBotsState(v);
  }, []);

  const setTotalLaps = useCallback((laps: number) => {
    const safe = Math.max(1, Math.min(10, Math.round(laps)));
    totalLapsRef.current = safe;
    setTotalLapsState(safe);
  }, []);

  const setRaceDuration = useCallback((sec: number) => {
    const safe = Math.max(60, Math.min(600, Math.round(sec)));
    raceDurationRef.current = safe;
    setRaceDurationState(safe);
    if (phaseRef.current === 'racing') {
      timerRef.current = safe;
      setTimerSec(safe);
    }
  }, []);

  const pushFeed = useCallback((text: string, tone: ActivityFeedItem['tone']) => {
    const id = feedSeqRef.current++;
    setFeed((prev) => [{ id, text, tone }, ...prev].slice(0, 6));
  }, []);

  const showVipBanner = useCallback((evt: Omit<VipBannerEvent, 'id'>) => {
    const id = bannerSeqRef.current++;
    setVipBanner({ ...evt, id });
    const duration = evt.tier === 'dragon' ? 5200 : evt.tier === 'rocket' ? 3400 : 2200;
    window.setTimeout(() => {
      setVipBanner((curr) => (curr && curr.id === id ? null : curr));
    }, duration);
  }, []);

  const addSpectator = useCallback((userId: string, nickname: string, avatar: string) => {
    if (!userId || userId.startsWith('bot_') || racersRef.current.has(userId)) return;
    const map = spectatorsRef.current;
    const h = hashCode(userId || nickname);
    const shirtColor = SHIRT_PALETTE[h % SHIRT_PALETTE.length];
    map.set(userId, {
      id: userId,
      nickname: nickname || 'Khán giả',
      avatar: avatar || makeAvatarDataUrl(nickname || 'K', shirtColor),
      shirtColor,
      joinedAt: Date.now(),
    });
    if (map.size > 24) {
      const oldestKey = map.keys().next().value;
      if (oldestKey) map.delete(oldestKey);
    }
  }, []);

  // Xếp toàn bộ nhân vật ở Phòng Chờ (Lobby) thành lưới xuất phát F1 so le, trải đều toàn mặt đường, tuyệt đối không chồng chéo!
  const layoutLobbyStartingGrid = useCallback(() => {
    if (phaseRef.current !== 'lobby') return;
    const racers = Array.from(racersRef.current.values());
    if (racers.length === 0) return;

    // Ưu tiên người chơi thật đứng hàng đầu, Bot đứng sau
    racers.sort((a, b) => {
      if (Boolean(a.isBot) !== Boolean(b.isBot)) return a.isBot ? 1 : -1;
      return a.id.localeCompare(b.id);
    });

    const usableHalfW = RACE_CONSTANTS.TRACK_WIDTH / 2 - 2.0; // ~7.0m mỗi bên -> tổng bề ngang 14m
    const cols = 5;
    const rowSpacing = 3.2;

    for (let idx = 0; idx < racers.length; idx++) {
      const r = racers[idx];
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      const itemsInRow = Math.min(cols, racers.length - row * cols);

      // Căn đều ngang giữa mặt đường cho từng hàng (nếu hàng cuối ít hơn 5 người cũng tự dàn đều cân đối)
      let xPos = 0;
      if (itemsInRow > 1) {
        const spanW = itemsInRow >= cols ? usableHalfW * 2 : (usableHalfW * 2 * (itemsInRow - 1)) / (cols - 1);
        xPos = -spanW / 2 + (col / (itemsInRow - 1)) * spanW;
      }
      // So le nhẹ giữa hàng chẵn và hàng lẻ kiểu vạch xuất phát F1 để thoáng tầm nhìn & không che nhau
      const staggerX = row % 2 === 1 && itemsInRow < cols ? 0.65 : 0;
      const finalX = Math.max(-usableHalfW, Math.min(usableHalfW, xPos + staggerX));
      const finalZ = -1.2 - row * rowSpacing - (col % 2) * 0.45;

      r.x = finalX;
      r.targetX = finalX;
      r.z = finalZ;
    }
  }, []);

  const ensureRacer = useCallback(
    (
      userId: string,
      username: string,
      nickname: string,
      avatar: string,
      isBot = false,
      platform: 'tiktok' | 'facebook' = 'tiktok',
    ): { racer: RacerState; created: boolean } => {
      const map = racersRef.current;
      const existing = map.get(userId);
      if (existing) {
        if (avatar && !existing.avatar.startsWith('http') && avatar.startsWith('http')) {
          existing.avatar = avatar;
          existing.shirtColor = resolveAvatarColor(avatar, existing.shirtColor, (hex) => {
            existing.shirtColor = hex;
          });
        }
        if (nickname && existing.nickname !== nickname) existing.nickname = nickname;
        return { racer: existing, created: false };
      }

      // Kiểm tra Hồ sơ đã lưu của User (nếu từng join trước đó thì tự động khôi phục Cấp độ, Điểm, Đặc điểm nhân vật & Thú cưng VIP)
      const saved = !isBot
        ? savedUsersRef.current.get(userId) || savedUsersRef.current.get(username)
        : undefined;

      const h = hashCode(userId || nickname);
      const fallbackShirt = saved?.shirtColor ?? SHIRT_PALETTE[h % SHIRT_PALETTE.length];
      const pantsColor = saved?.pantsColor ?? PANTS_PALETTE[(h >> 3) % PANTS_PALETTE.length];
      const skinColor = saved?.skinColor ?? SKIN_PALETTE[(h >> 5) % SKIN_PALETTE.length];
      const hatColor = saved?.hatColor ?? HAT_PALETTE[(h >> 7) % HAT_PALETTE.length];
      const bestAvatar =
        (avatar && avatar.startsWith('http') ? avatar : '') ||
        (saved?.avatar && saved.avatar.startsWith('http') ? saved.avatar : '') ||
        avatar ||
        saved?.avatar ||
        makeAvatarDataUrl(nickname || username || 'R', fallbackShirt);
      const shirtColor = saved?.shirtColor
        ? saved.shirtColor
        : resolveAvatarColor(bestAvatar, fallbackShirt, (hex) => {
          const found = racersRef.current.get(userId);
          if (found) found.shirtColor = hex;
        });

      const halfW = RACE_CONSTANTS.TRACK_WIDTH / 2 - 2.2;
      const laneX = ((h % 100) / 100) * (halfW * 2) - halfW;

      const isMidRace = phaseRef.current === 'racing' || phaseRef.current === 'countdown';
      let spawnZ = -((h % 12) * 0.45);
      let initialBoost: BoostKind = 'none';
      let initialBoostUntil = 0;
      let initialBoostLabel = '';

      if (isMidRace) {
        let lastPlaceZ = Infinity;
        map.forEach((r) => {
          if (r.z < lastPlaceZ) lastPlaceZ = r.z;
        });
        spawnZ = Number.isFinite(lastPlaceZ) ? Math.max(0, lastPlaceZ) : 0;

        if (!isBot) {
          initialBoost = 'join';
          initialBoostUntil = performance.now() + RACE_CONSTANTS.JOIN_BOOST_MS;
          initialBoostLabel = '⚡ NHẬP CUỘC';
        }
      }

      const currentLap = Math.min(
        totalLapsRef.current,
        Math.max(1, Math.floor(Math.max(0, spawnZ) / RACE_CONSTANTS.LAP_LENGTH) + 1),
      );

      const nextPoints = isBot ? 0 : (saved?.points ?? 0) + 10;
      const nextLevel = isBot ? 1 : Math.max(1, 1 + Math.floor(nextPoints / 100));
      const levelSpeedBonus = isBot ? 0 : Math.min(0.15, (nextLevel - 1) * 0.008);

      const racer: RacerState = {
        id: userId,
        username: username || userId,
        nickname: nickname || saved?.nickname || username || 'Tay Đua',
        avatar: bestAvatar,
        platform: saved?.platform || platform,
        isBot,
        level: nextLevel,
        points: nextPoints,
        wins: saved?.wins ?? 0,
        matches: (saved?.matches ?? 0) + 1,
        characterIdx: saved?.characterIdx ?? h % 2,
        petIdx: saved?.petIdx ?? null,
        petName: saved?.petName ?? '',
        petSpeedBonus: Math.max(saved?.petSpeedBonus ?? 0, levelSpeedBonus),
        z: spawnZ,
        lap: currentLap,
        x: laneX,
        targetX: laneX,
        baseSpeed: 19.5 + (h % 19) * 0.12 + levelSpeedBonus * 4,
        speed: isMidRace ? 20 : 0,
        shirtColor,
        pantsColor,
        skinColor,
        hatColor,
        likeEnergy: 0,
        lastChatBoostAt: 0,
        lastInteractAt: performance.now(),
        boost: initialBoost,
        boostUntil: initialBoostUntil,
        boostLabel: initialBoostLabel,
        finishedAt: null,
        rank: map.size + 1,
        coinsSpent: saved?.totalCoins ?? 0,
      };

      // Nếu đang ở phòng chờ (lobby) và đã đủ 10 tay đua có kèm Bot -> nhường 1 chỗ Bot cho người chơi thật!
      if (!isBot && phaseRef.current === 'lobby' && map.size >= 10) {
        const botToReplace = Array.from(map.values()).find((r) => r.isBot);
        if (botToReplace) {
          map.delete(botToReplace.id);
        }
      }

      // Khi người xem chính thức join vào đường đua thì rời hàng khán giả cổ vũ
      spectatorsRef.current.delete(userId);
      map.set(userId, racer);
      if (phaseRef.current === 'lobby') {
        layoutLobbyStartingGrid();
      }
      setRacerCount(map.size);
      if (!isBot) {
        syncRacerProfilesToServer([racer]);
        // Sự kiện PLAYER_JOIN: camera ưu tiên giới thiệu nhân vật mới vừa tham gia vào cuộc đua
        cameraDirectorRef.current.pushEvent({
          type: 'PLAYER_JOIN',
          userId: racer.id,
          nickname: racer.nickname,
          label: `👋 Lv.${racer.level} VÀO ĐUA!`,
          durationSec: 2.2,
        });
        const nowMs = Date.now();
        if (saved) {
          playJoinSfx();
          pushFeed(
            `👑 Lv.${racer.level} ${racer.nickname} (${racer.points}đ${racer.petName ? ' · ' + racer.petName : ''}) đã trở lại đường đua!`,
            'join',
          );
          if (nowMs - lastJoinVoiceAtRef.current > 3800) {
            lastJoinVoiceAtRef.current = nowMs;
            speakCommentator(
              `Oa! Chào mừng cao thủ cấp ${racer.level} ${racer.nickname} đã trở lại đường đua${racer.petName ? ' cùng thú cưng ' + racer.petName.replace(/^[^\s]+\s/, '') : ''}!`,
            );
          }
        } else if (isMidRace) {
          playSprintSfx();
          pushFeed(`⚡ ${racer.nickname} (Lv.1) lao vào đường đua + Kích hoạt Tia Sét Nhập Cuộc!`, 'sprint');
          if (nowMs - lastJoinVoiceAtRef.current > 3800) {
            lastJoinVoiceAtRef.current = nowMs;
            speakCommentator(
              `Tay đua ${racer.nickname} vừa nhảy vào cuộc đua và bật tia sét nhập cuộc bám đuổi đoàn đua!`,
            );
          }
        } else {
          playJoinSfx();
          pushFeed(`🏁 ${racer.nickname} (Lv.1) đã vào vạch xuất phát!`, 'join');
          if (nowMs - lastJoinVoiceAtRef.current > 3800) {
            lastJoinVoiceAtRef.current = nowMs;
            speakCommentator(
              `Chào mừng tay đua ${racer.nickname} đã lên vạch xuất phát! Chạm thả tim liên tục để chuẩn bị bứt tốc nhé!`,
            );
          }
        }
      }
      return { racer, created: true };
    },
    [layoutLobbyStartingGrid, pushFeed, syncRacerProfilesToServer],
  );

  const applyBoost = useCallback(
    (racer: RacerState, kind: BoostKind, durationMs: number, label: string) => {
      const now = performance.now();
      racer.lastInteractAt = now;
      const activeStronger =
        racer.boost !== 'none' &&
        racer.boostUntil > now &&
        BOOST_PRIORITY[racer.boost] > BOOST_PRIORITY[kind];
      if (activeStronger) return;
      racer.boost = kind;
      racer.boostUntil = Math.max(racer.boostUntil, now + durationMs);
      racer.boostLabel = label;
    },
    [],
  );

  const fillBotsIfNeeded = useCallback(() => {
    if (!autoBotsRef.current) return;
    const targetCount = 10;
    const current = racersRef.current.size;
    if (current >= targetCount) return;
    const needed = targetCount - current;
    for (let i = 0; i < needed; i++) {
      const name = BOT_NAMES[i % BOT_NAMES.length];
      const botId = `bot_slot_${i + 1}`;
      ensureRacer(botId, botId, name, '', true);
    }
  }, [ensureRacer]);

  // Phát gói đồng bộ trạng thái cuộc đua từ Bảng Điều Khiển (/) sang Màn Hình Live (/?view=stage)
  const pushRaceSync = useCallback((immediate = false) => {
    if (IS_STAGE) return;
    const now = performance.now();
    const racersList = Array.from(racersRef.current.values()).map((r) => ({
      id: r.id,
      username: r.username,
      nickname: r.nickname,
      avatar: r.avatar,
      platform: r.platform || 'tiktok',
      isBot: Boolean(r.isBot),
      level: r.level || 1,
      points: r.points || 0,
      wins: r.wins || 0,
      matches: r.matches || 1,
      characterIdx: r.characterIdx,
      petIdx: r.petIdx,
      petName: r.petName,
      petSpeedBonus: r.petSpeedBonus,
      z: Math.round(r.z * 100) / 100,
      lap: r.lap,
      x: Math.round(r.x * 100) / 100,
      targetX: Math.round(r.targetX * 100) / 100,
      baseSpeed: r.baseSpeed,
      speed: Math.round(r.speed * 100) / 100,
      shirtColor: r.shirtColor,
      pantsColor: r.pantsColor,
      skinColor: r.skinColor,
      hatColor: r.hatColor,
      boost: r.boost,
      boostRemainMs: r.boost !== 'none' ? Math.max(0, Math.round(r.boostUntil - now)) : 0,
      boostLabel: r.boostLabel,
      isFinished: r.finishedAt !== null,
      rank: r.rank,
      coinsSpent: r.coinsSpent,
    }));

    const snap = {
      senderId: tabIdRef.current,
      matchNo: matchNoRef.current,
      phase: phaseRef.current,
      timer: Math.round(timerRef.current * 100) / 100,
      mapId: getActiveMapId(),
      totalLaps: totalLapsRef.current,
      raceDuration: raceDurationRef.current,
      autoBots: autoBotsRef.current,
      droneCamOn: droneCamOnRef.current,
      droneRect: droneRectRef.current,
      graphicsQuality: graphicsQualityRef.current,
      cameraMode: cameraModeRef.current,
      aiCameraModes: aiCameraModesRef.current,
      webcamEnabled: webcamEnabledRef.current,
      webcamRect: webcamRectRef.current,
      footerBanner: footerBannerRef.current,
      afkTimeoutSec: afkTimeoutSecRef.current,
      racers: racersList,
      spectators: Array.from(spectatorsRef.current.values()),
    };

    if (!immediate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'raceSync', data: snap }));
        return;
      } catch { }
    }

    void fetch('/api/race/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snap),
    }).catch(() => { });
  }, []);

  const applyRaceSync = useCallback((snap: any) => {
    if (!snap || typeof snap !== 'object') return;
    if (snap.senderId === tabIdRef.current) return;
    // Chỉ trang Stage (/?view=stage) nhận đồng bộ từ trang Dashboard (/), hoặc trang mới mở nhận snapshot lần đầu
    if (!IS_STAGE && lastMasterSyncAtRef.current > 0) return;
    lastMasterSyncAtRef.current = performance.now();

    if (typeof snap.mapId === 'string' && snap.mapId !== getActiveMapId()) {
      setActiveMap(snap.mapId);
      setMapIdState(getActiveMapId());
    }
    if (typeof snap.matchNo === 'number') {
      matchNoRef.current = snap.matchNo;
      setMatchNo(snap.matchNo);
    }
    if (typeof snap.totalLaps === 'number' && snap.totalLaps !== totalLapsRef.current) {
      totalLapsRef.current = snap.totalLaps;
      setTotalLapsState(snap.totalLaps);
    }
    if (typeof snap.raceDuration === 'number' && snap.raceDuration !== raceDurationRef.current) {
      raceDurationRef.current = snap.raceDuration;
      setRaceDurationState(snap.raceDuration);
    }
    if (typeof snap.autoBots === 'boolean' && snap.autoBots !== autoBotsRef.current) {
      autoBotsRef.current = snap.autoBots;
      setAutoBotsState(snap.autoBots);
    }
    if (typeof snap.droneCamOn === 'boolean' && snap.droneCamOn !== droneCamOnRef.current) {
      droneCamOnRef.current = snap.droneCamOn;
      setDroneCamOnState(snap.droneCamOn);
    }
    if (
      snap.droneRect &&
      typeof snap.droneRect.x === 'number' &&
      typeof snap.droneRect.y === 'number' &&
      typeof snap.droneRect.w === 'number' &&
      typeof snap.droneRect.h === 'number'
    ) {
      const dr = snap.droneRect as DroneRect;
      const cur = droneRectRef.current;
      if (cur.x !== dr.x || cur.y !== dr.y || cur.w !== dr.w || cur.h !== dr.h) {
        droneRectRef.current = dr;
        setDroneRectState(dr);
      }
    }
    if (
      (snap.graphicsQuality === 'low' ||
        snap.graphicsQuality === 'medium' ||
        snap.graphicsQuality === 'high') &&
      snap.graphicsQuality !== graphicsQualityRef.current
    ) {
      graphicsQualityRef.current = snap.graphicsQuality;
      setGraphicsQualityState(snap.graphicsQuality);
    }
    if (
      typeof snap.cameraMode === 'string' &&
      (snap.cameraMode === 'auto' ||
        snap.cameraMode === 'chase' ||
        snap.cameraMode === 'front' ||
        snap.cameraMode === 'side' ||
        snap.cameraMode === 'overview') &&
      snap.cameraMode !== cameraModeRef.current
    ) {
      cameraModeRef.current = snap.cameraMode;
      setCameraModeState(snap.cameraMode);
      cameraDirectorRef.current.setModeOverride(snap.cameraMode);
    }
    if (snap.aiCameraModes && typeof snap.aiCameraModes.chase === 'boolean') {
      const m = snap.aiCameraModes as AiDirectorModes;
      const cur = aiCameraModesRef.current;
      if (
        cur.chase !== m.chase ||
        cur.front !== m.front ||
        cur.side !== m.side ||
        cur.overview !== m.overview
      ) {
        aiCameraModesRef.current = m;
        setAiCameraModesState(m);
        cameraDirectorRef.current.setAiModes(m);
      }
    }
    if (typeof snap.webcamEnabled === 'boolean' && snap.webcamEnabled !== webcamEnabledRef.current) {
      webcamEnabledRef.current = snap.webcamEnabled;
      setWebcamEnabledState(snap.webcamEnabled);
    }
    if (
      snap.webcamRect &&
      typeof snap.webcamRect.x === 'number' &&
      typeof snap.webcamRect.y === 'number'
    ) {
      const wr = snap.webcamRect as WebcamRect;
      const cur = webcamRectRef.current;
      if (cur.x !== wr.x || cur.y !== wr.y || cur.w !== wr.w || cur.h !== wr.h || cur.shape !== wr.shape) {
        webcamRectRef.current = wr;
        setWebcamRectState(wr);
      }
    }
    if (
      snap.footerBanner &&
      typeof snap.footerBanner.text === 'string' &&
      typeof snap.footerBanner.x === 'number' &&
      typeof snap.footerBanner.y === 'number'
    ) {
      const fb = { ...DEFAULT_FOOTER_BANNER, ...snap.footerBanner } as FooterBannerConfig;
      const cur = footerBannerRef.current;
      if (
        cur.text !== fb.text ||
        cur.fontSize !== fb.fontSize ||
        cur.x !== fb.x ||
        cur.y !== fb.y ||
        cur.w !== fb.w ||
        cur.visible !== fb.visible
      ) {
        footerBannerRef.current = fb;
        setFooterBannerState(fb);
      }
    }
    if (
      typeof snap.afkTimeoutSec === 'number' &&
      snap.afkTimeoutSec !== afkTimeoutSecRef.current
    ) {
      afkTimeoutSecRef.current = snap.afkTimeoutSec;
      setAfkTimeoutSecState(snap.afkTimeoutSec);
    }
    if (typeof snap.timer === 'number') {
      timerRef.current = snap.timer;
    }

    const prevPhase = phaseRef.current;
    if (
      snap.phase === 'lobby' ||
      snap.phase === 'racing' ||
      snap.phase === 'countdown' ||
      snap.phase === 'podium'
    ) {
      if (prevPhase !== snap.phase) {
        phaseRef.current = snap.phase;
        setPhase(snap.phase);
        if (IS_STAGE) {
          stopNonCriticalCommentator();
          if (snap.phase === 'racing') {
            playCountdownBeep(true);
            playCrowdCheerSfx();
            speakCommentator('Xuất phát! Các tay đua đang lao vọt lên phía trước!', true, 'phase');
          } else if (snap.phase === 'countdown') {
            playFinishFanfareSfx();
            speakCommentator('Đã có tay đua cán đích! Còn 5 giây cuối tranh Top 3!', true, 'phase');
          } else if (snap.phase === 'podium') {
            playFinishFanfareSfx();
            playCrowdCheerSfx();
          } else if (snap.phase === 'lobby') {
            speakCommentator('Mở ván đua mới! Follow kênh và nhắn join để vào sân ngay!', true, 'phase');
          }
        }
        if (snap.phase === 'lobby') {
          cameraDirectorRef.current.resetForNewMatch();
          setPodiumTop3([]);
        }
      }
    }

    if (Array.isArray(snap.racers)) {
      const now = performance.now();
      const map = racersRef.current;
      const incomingIds = new Set<string>();

      for (const sr of snap.racers) {
        if (!sr || !sr.id) continue;
        incomingIds.add(sr.id);
        const existing = map.get(sr.id);
        if (!existing) {
          map.set(sr.id, {
            id: sr.id,
            username: sr.username || sr.id,
            nickname: sr.nickname || 'Tay Đua',
            avatar: sr.avatar || makeAvatarDataUrl(sr.nickname || 'R', sr.shirtColor || 0x3b82f6),
            platform: sr.platform || 'tiktok',
            isBot: Boolean(sr.isBot),
            level: sr.level || 1,
            points: sr.points || 0,
            wins: sr.wins || 0,
            matches: sr.matches || 1,
            characterIdx: sr.characterIdx ?? 0,
            petIdx: sr.petIdx ?? null,
            petName: sr.petName || '',
            petSpeedBonus: sr.petSpeedBonus || 0,
            z: Number(sr.z || 0),
            lap: Number(sr.lap || 1),
            x: Number(sr.x || 0),
            targetX: Number(sr.targetX || 0),
            baseSpeed: Number(sr.baseSpeed || 20),
            speed: Number(sr.speed || 0),
            shirtColor: Number(sr.shirtColor || 0x3b82f6),
            pantsColor: Number(sr.pantsColor || 0x1e293b),
            skinColor: Number(sr.skinColor || 0xfde68a),
            hatColor: Number(sr.hatColor || 0xfacc15),
            likeEnergy: 0,
            lastChatBoostAt: 0,
            lastInteractAt: now,
            boost: sr.boost || 'none',
            boostUntil: sr.boost && sr.boost !== 'none' ? now + Number(sr.boostRemainMs || 1500) : 0,
            boostLabel: sr.boostLabel || '',
            finishedAt: sr.isFinished ? now : null,
            rank: Number(sr.rank || 1),
            coinsSpent: Number(sr.coinsSpent || 0),
          });
        } else {
          existing.nickname = sr.nickname || existing.nickname;
          if (sr.avatar && sr.avatar.startsWith('http')) existing.avatar = sr.avatar;
          existing.level = sr.level || existing.level;
          existing.points = sr.points ?? existing.points;
          existing.wins = sr.wins ?? existing.wins;
          existing.characterIdx = sr.characterIdx ?? existing.characterIdx;
          existing.petIdx = sr.petIdx ?? existing.petIdx;
          existing.petName = sr.petName ?? existing.petName;
          existing.petSpeedBonus = sr.petSpeedBonus ?? existing.petSpeedBonus;
          existing.shirtColor = sr.shirtColor ?? existing.shirtColor;
          existing.baseSpeed = sr.baseSpeed ?? existing.baseSpeed;
          existing.speed = sr.speed ?? existing.speed;
          existing.targetX = sr.targetX ?? existing.targetX;
          existing.lap = sr.lap ?? existing.lap;
          existing.rank = sr.rank ?? existing.rank;
          existing.coinsSpent = sr.coinsSpent ?? existing.coinsSpent;

          // Nội suy mượt vị trí z & x để 60 FPS không bị khựng nhưng vẫn khớp 100% với màn hình Preview
          const targetZ = Number(sr.z ?? existing.z);
          const targetX = Number(sr.x ?? existing.x);
          if (Math.abs(targetZ - existing.z) > 4.0 || phaseRef.current === 'lobby') {
            existing.z = targetZ;
            existing.x = targetX;
          } else {
            existing.z += (targetZ - existing.z) * 0.45;
            existing.x += (targetX - existing.x) * 0.45;
          }

          if (sr.boost && sr.boost !== 'none') {
            existing.boost = sr.boost;
            existing.boostUntil = now + Number(sr.boostRemainMs || 1500);
            existing.boostLabel = sr.boostLabel || existing.boostLabel;
          } else if (sr.boost === 'none') {
            existing.boost = 'none';
            existing.boostLabel = '';
          }
          existing.finishedAt = sr.isFinished ? existing.finishedAt || now : null;
        }
      }

      // Xóa các tay đua / bot cũ không còn trong danh sách của Master
      Array.from(map.keys()).forEach((k) => {
        if (!incomingIds.has(k)) {
          map.delete(k);
        }
      });

      if (phaseRef.current === 'podium') {
        const sorted = Array.from(map.values()).sort((a, b) => a.rank - b.rank);
        setPodiumTop3(sorted.slice(0, 3));
      }
    }

    if (Array.isArray(snap.spectators)) {
      const nextSpec = new Map<string, SpectatorInfo>();
      for (const sp of snap.spectators) {
        if (sp && sp.id) nextSpec.set(sp.id, sp as SpectatorInfo);
      }
      spectatorsRef.current = nextSpec;
    }
  }, []);

  const startNewLobby = useCallback(
    (incrementMatch: boolean) => {
      // Áp dụng map được chọn (chỉ đổi map ở Lobby để không phá ván đang đua)
      if (pendingMapRef.current) {
        setActiveMap(pendingMapRef.current);
        setMapIdState(getActiveMapId());
        pendingMapRef.current = null;
      }
      racersRef.current.clear();
      phaseRef.current = 'lobby';
      timerRef.current = RACE_CONSTANTS.LOBBY_SECONDS;
      lastBeepSecRef.current = -1;
      announcedFinalLapRef.current = false;
      raceElapsedRef.current = 0;
      lastTop1IdRef.current = '';
      cameraDirectorRef.current.resetForNewMatch();
      setCameraHud(cameraDirectorRef.current.getHudState());
      setPhase('lobby');
      setTimerSec(RACE_CONSTANTS.LOBBY_SECONDS);
      setLeaderLap(1);
      setRacerCount(0);
      setTop5([]);
      setPodiumTop3([]);
      setMinimapDots([]);
      setLeaderProgress(0);
      if (incrementMatch) {
        matchNoRef.current += 1;
        setMatchNo(matchNoRef.current);
      }

      // Tự động đưa các khán giả đã báo danh / tặng quà trong lúc Podium vào vạch xuất phát!
      if (nextRoundVipQueueRef.current.length > 0) {
        const queued = nextRoundVipQueueRef.current.splice(0);
        queued.forEach((v) => {
          const { racer } = ensureRacer(v.userId, v.username, v.nickname, v.avatar);
          if (v.coins > 0) {
            if (racer.petIdx === null) {
              const randPet = Math.floor(Math.random() * NOTBLOX_PET_NAMES.length);
              racer.petIdx = randPet;
              racer.petName = NOTBLOX_PET_NAMES[randPet];
            }
            racer.petSpeedBonus = Math.max(racer.petSpeedBonus, v.coins >= 100 ? 0.25 : 0.18);
            racer.coinsSpent += v.coins;
          }
        });
      }

      // Cho các nhân vật xuất hiện sẵn trên vạch xuất phát ngay trong thời gian chờ Lobby!
      fillBotsIfNeeded();

      lobbyHypeDoneRef.current = false;
      liveCommentAccumRef.current = 0;

      stopNonCriticalCommentator();
      pushFeed(
        `🚦 Ván mới #${matchNoRef.current} (${totalLapsRef.current} vòng)! Follow kênh & nhắn "join" để vào đường đua!`,
        'system',
      );
      speakCommentator(
        `Mở ván ${matchNoRef.current}! Follow kênh và nhắn join để vào đua ngay nào!`,
        true,
        'phase',
      );
      pushRaceSync(true);
    },
    [ensureRacer, fillBotsIfNeeded, pushFeed, pushRaceSync],
  );

  const startRacingPhase = useCallback(() => {
    fillBotsIfNeeded();
    // Giữ nguyên khoảng cách hàng xuất phát gọn gàng (chỉ nâng nhẹ tiến sát vạch 0 để không chồng chéo khi chạy)
    racersRef.current.forEach((r) => {
      r.z = r.z + 1.2;
      r.lap = 1;
    });
    phaseRef.current = 'racing';
    timerRef.current = raceDurationRef.current;
    lastBeepSecRef.current = -1;
    announcedFinalLapRef.current = false;
    raceElapsedRef.current = 0;
    liveCommentAccumRef.current = 0;
    lastTop1IdRef.current = '';
    setPhase('racing');
    setTimerSec(raceDurationRef.current);
    stopNonCriticalCommentator();
    playCountdownBeep(true);
    playCrowdCheerSfx();
    pushFeed(
      `🔥 XUẤT PHÁT ${totalLapsRef.current} VÒNG! Thả tim bật Tia Sét & tặng quà hóa Siêu Nhân / Rồng Thần!`,
      'system',
    );
    speakCommentator(
      `Xuất phát rồi! Cuộc đua ${totalLapsRef.current} vòng chính thức bắt đầu!`,
      true,
      'phase',
    );
    pushRaceSync(true);
  }, [fillBotsIfNeeded, pushFeed, pushRaceSync]);

  const enterPodiumPhase = useCallback(() => {
    phaseRef.current = 'podium';
    timerRef.current = RACE_CONSTANTS.PODIUM_SECONDS;
    setPhase('podium');
    setTimerSec(RACE_CONSTANTS.PODIUM_SECONDS);

    const sorted = Array.from(racersRef.current.values()).sort((a, b) => a.rank - b.rank);
    const winners = sorted.slice(0, 3);
    setPodiumTop3(winners);
    stopNonCriticalCommentator();
    playFinishFanfareSfx();
    playCrowdCheerSfx();

    // Cộng điểm kinh nghiệm (XP) & cập nhật Cấp Độ + Số trận thắng vào Hồ sơ người chơi đã lưu
    const bonusMap = new Map<string, { addPoints: number; addWin: number; addPodium: number }>();
    const humanRacers: RacerState[] = [];
    sorted.forEach((r) => {
      if (r.isBot || r.id.startsWith('bot_')) return;
      humanRacers.push(r);
      const addPoints =
        r.rank === 1
          ? 100
          : r.rank === 2
            ? 60
            : r.rank === 3
              ? 40
              : r.finishedAt !== null
                ? 25
                : 10;
      bonusMap.set(r.id, {
        addPoints,
        addWin: r.rank === 1 ? 1 : 0,
        addPodium: r.rank <= 3 ? 1 : 0,
      });
    });
    if (humanRacers.length > 0) {
      syncRacerProfilesToServer(humanRacers, bonusMap);
    }

    if (winners[0]) {
      const top2Text = winners[1] ? `, Á quân là ${winners[1].nickname}` : '';
      const top3Text = winners[2] ? ` và hạng ba thuộc về ${winners[2].nickname}` : '';
      pushFeed(
        `🏆 QUÁN QUÂN VÁN #${matchNoRef.current}: ${winners[0].nickname} (Lv.${winners[0].level})!`,
        'dragon',
      );
      speakCommentator(
        `Xin chúc mừng nhà vô địch ${winners[0].nickname} đã xuất sắc cán đích đầu tiên sau ${totalLapsRef.current} vòng đua nghẹt thở${top2Text}${top3Text}! Ván đua mới sẽ mở lại sau 10 giây nữa!`,
        true,
      );
    }
    pushRaceSync(true);
  }, [pushFeed, pushRaceSync, syncRacerProfilesToServer]);

  // ---------- Xử lý sự kiện TikTok LIVE & Facebook Live ----------
  const queueForNextRound = useCallback(
    (payload: {
      userId: string;
      username: string;
      nickname: string;
      avatar: string;
      coins: number;
    }) => {
      const already = nextRoundVipQueueRef.current.find((q) => q.userId === payload.userId);
      if (already) {
        already.coins += payload.coins;
      } else {
        nextRoundVipQueueRef.current.push({ ...payload });
        pushFeed(
          `✅ ${payload.nickname} đã báo danh — Tự động xuất phát ngay khi mở ván mới!`,
          'join',
        );
      }
    },
    [pushFeed],
  );

  const handleFollow = useCallback(
    (payload: {
      userId: string;
      username: string;
      nickname: string;
      avatar: string;
      platform?: 'tiktok' | 'facebook';
    }) => {
      followersRef.current.add(payload.userId);
      if (payload.username) followersRef.current.add(payload.username);
      departedRacersRef.current.delete(payload.userId);
      if (payload.username) departedRacersRef.current.delete(payload.username);

      const existing = racersRef.current.get(payload.userId);
      if (existing) {
        existing.lastInteractAt = performance.now();
        pushFeed(`➕ ${payload.nickname} đã Follow kênh!`, 'join');
        return;
      }

      playJoinSfx();
      pushFeed(
        `➕ ${payload.nickname} vừa Follow kênh & tự động vào đường đua ngay!`,
        'join',
      );
      const nowMs = Date.now();
      if (nowMs - lastFollowVoiceAtRef.current > 4500) {
        lastFollowVoiceAtRef.current = nowMs;
        speakCommentator(
          `Cảm ơn bạn ${payload.nickname} đã Follow kênh! Nhân vật của bạn đã chính thức vào đường đua rồi nhé!`,
        );
      }

      if (phaseRef.current === 'podium') {
        queueForNextRound({
          userId: payload.userId,
          username: payload.username,
          nickname: payload.nickname,
          avatar: payload.avatar,
          coins: 0,
        });
        return;
      }

      ensureRacer(
        payload.userId,
        payload.username,
        payload.nickname,
        payload.avatar,
        false,
        payload.platform || 'tiktok',
      );
      pushRaceSync(true);
    },
    [ensureRacer, pushFeed, pushRaceSync, queueForNextRound],
  );

  const handleChat = useCallback(
    (payload: {
      userId: string;
      username: string;
      nickname: string;
      avatar: string;
      comment: string;
      isFollower?: boolean;
      platform?: 'tiktok' | 'facebook';
    }) => {
      if (payload.isFollower) {
        followersRef.current.add(payload.userId);
        if (payload.username) followersRef.current.add(payload.username);
      }

      const existingRacer = racersRef.current.get(payload.userId);
      // Nếu người chơi ĐÃ có mặt trên đường đua -> cập nhật tương tác & bình luận giúp tăng tốc (+TỐC)
      if (existingRacer) {
        existingRacer.lastInteractAt = performance.now();
        if (phaseRef.current !== 'podium') {
          const now = performance.now();
          if (now - existingRacer.lastChatBoostAt >= RACE_CONSTANTS.CHAT_COOLDOWN_MS) {
            existingRacer.lastChatBoostAt = now;
            applyBoost(existingRacer, 'chat', 1800, '💬 +TỐC');
            pushRaceSync(true);
          }
        }
        return;
      }

      // Luật vào đua mới: chỉ cần đã Follow kênh rồi thì nhắn BẤT KỲ 1 tin nhắn nào cũng được vào đua ngay!
      const commentTrim = String(payload.comment || '').trim();
      if (!commentTrim) return;

      const savedProf =
        savedUsersRef.current.get(payload.userId) ||
        savedUsersRef.current.get(payload.username);
      const hasFollowed = Boolean(
        payload.isFollower ||
          followersRef.current.has(payload.userId) ||
          (payload.username && followersRef.current.has(payload.username)) ||
          savedProf?.isFollower ||
          payload.platform === 'facebook',
      );

      if (!hasFollowed) {
        addSpectator(payload.userId, payload.nickname, payload.avatar);
        pushFeed(
          `🔒 ${payload.nickname} ơi, bấm Follow kênh là vào đua ngay (hoặc đã Follow thì nhắn bất kỳ 1 tin nhé)!`,
          'system',
        );
        const nowMs = Date.now();
        if (nowMs - lastNeedFollowVoiceAtRef.current > 5500) {
          lastNeedFollowVoiceAtRef.current = nowMs;
          speakCommentator(
            `Bạn ${payload.nickname} ơi, hãy bấm Follow kênh là nhân vật sẽ tự vào đường đua ngay cùng cả nhà nhé!`,
          );
        }
        return;
      }

      // Đã Follow + nhắn 1 tin bất kỳ -> cho vào đường đua hoặc xếp hàng ván mới!
      followersRef.current.add(payload.userId);
      if (payload.username) followersRef.current.add(payload.username);
      departedRacersRef.current.delete(payload.userId);
      if (payload.username) departedRacersRef.current.delete(payload.username);

      if (phaseRef.current === 'podium') {
        queueForNextRound({
          userId: payload.userId,
          username: payload.username,
          nickname: payload.nickname,
          avatar: payload.avatar,
          coins: 0,
        });
        return;
      }

      ensureRacer(
        payload.userId,
        payload.username,
        payload.nickname,
        payload.avatar,
        false,
        payload.platform || 'tiktok',
      );
      pushRaceSync(true);
    },
    [addSpectator, applyBoost, ensureRacer, pushFeed, pushRaceSync, queueForNextRound],
  );

  const handleLike = useCallback(
    (payload: {
      userId: string;
      username: string;
      nickname: string;
      avatar: string;
      likeCount: number;
      platform?: 'tiktok' | 'facebook';
    }) => {
      // Thả tim chỉ tăng tốc Sprint cho những tay đua đã Follow + nhắn "join" vào sân
      const racer = racersRef.current.get(payload.userId);
      if (!racer || phaseRef.current === 'podium') return;

      racer.likeEnergy += Math.max(1, payload.likeCount || 1);
      racer.lastInteractAt = performance.now();
      if (racer.likeEnergy >= RACE_CONSTANTS.LIKE_SPRINT_THRESHOLD) {
        racer.likeEnergy = 0;
        applyBoost(racer, 'sprint', 2200, '⚡ SPRINT');
        playSprintSfx();
        pushFeed(`⚡ ${racer.nickname} thả tim kích hoạt SPRINT!`, 'sprint');
        pushRaceSync(true);
      }
    },
    [applyBoost, pushFeed, pushRaceSync],
  );

  const handleGift = useCallback(
    (payload: {
      userId: string;
      username: string;
      nickname: string;
      avatar: string;
      giftName: string;
      coins: number;
      platform?: 'tiktok' | 'facebook';
    }) => {
      const coins = Math.max(1, Number(payload.coins || 1));
      if (phaseRef.current === 'podium') {
        queueForNextRound({
          userId: payload.userId,
          username: payload.username,
          nickname: payload.nickname,
          avatar: payload.avatar,
          coins,
        });
        return;
      }

      // Cho phép người tặng quà join thẳng vào đường đua ngay lập tức (kể cả giữa trận) kèm Thú Cưng VIP + Tăng Tốc!
      const { racer } = ensureRacer(
        payload.userId,
        payload.username,
        payload.nickname,
        payload.avatar,
        false,
        payload.platform || 'tiktok',
      );
      racer.coinsSpent += coins;
      racer.points += coins * 2;
      racer.level = Math.max(1, 1 + Math.floor(racer.points / 100));

      // Nhân vật VIP (tặng quà) sẽ được tặng ngẫu nhiên 1 Thú Cưng NotBlox đi theo tăng tốc (và được lưu vĩnh viễn vào hồ sơ!)
      const targetPetBonus = coins >= 100 ? 0.25 : 0.18;
      if (racer.petIdx === null) {
        const randPet = Math.floor(Math.random() * NOTBLOX_PET_NAMES.length);
        racer.petIdx = randPet;
        racer.petName = NOTBLOX_PET_NAMES[randPet];
        racer.petSpeedBonus = Math.max(racer.petSpeedBonus, targetPetBonus);
        pushFeed(
          `🐾 ${racer.nickname} nhận Thú Cưng VIP ${racer.petName} (+${Math.round(targetPetBonus * 100)}% tốc độ - Đã lưu vào hồ sơ)!`,
          'sprint',
        );
      } else if (targetPetBonus > racer.petSpeedBonus) {
        racer.petSpeedBonus = targetPetBonus;
      }
      syncRacerProfilesToServer([racer]);

      if (coins >= 100) {
        applyBoost(racer, 'dragon', 10000, '🐉 RỒNG THẦN VIP');
        playVipDragonSfx();
        playCrowdCheerSfx();
        cameraDirectorRef.current.pushEvent({
          type: 'MAJOR_GIFT_BOOST',
          userId: racer.id,
          nickname: racer.nickname,
          label: `🐉 ${payload.giftName || 'Rồng Thần VIP'} (${coins} xu)`,
          durationSec: 4.8,
        });
        showVipBanner({
          nickname: racer.nickname,
          avatar: racer.avatar,
          giftName: payload.giftName || 'Quà VIP',
          coins,
          tier: 'dragon',
        });
        pushFeed(
          `🐉 ĐẠI GIA ${racer.nickname} tặng ${payload.giftName} (${coins} xu) - TRIỆU HỒI RỒNG THẦN HOÀNG KIM!`,
          'dragon',
        );
        speakGiftThankYou(
          racer.id,
          racer.nickname,
          payload.giftName || 'Rồng Thần VIP',
          coins,
          'Triệu hồi Rồng Thần bay vút qua cả đoàn đua',
        );
      } else if (coins >= 50) {
        applyBoost(racer, 'superman', 7000, '🦸 SIÊU NHÂN BAY');
        playRocketSfx();
        playCrowdCheerSfx();
        cameraDirectorRef.current.pushEvent({
          type: 'MAJOR_GIFT_BOOST',
          userId: racer.id,
          nickname: racer.nickname,
          label: `🦸 ${payload.giftName || 'Siêu Nhân Bay'} (${coins} xu)`,
          durationSec: 4.5,
        });
        showVipBanner({
          nickname: racer.nickname,
          avatar: racer.avatar,
          giftName: payload.giftName || 'Siêu Nhân',
          coins,
          tier: 'superman',
        });
        pushFeed(
          `🦸 ${racer.nickname} tặng ${payload.giftName} (${coins} xu) - HÓA SIÊU NHÂN BAY VÚT XÉ GIÓ!`,
          'rocket',
        );
        speakGiftThankYou(
          racer.id,
          racer.nickname,
          payload.giftName || 'Siêu Nhân',
          coins,
          'Hóa Siêu Nhân bay vút xé gió vượt mặt đối thủ',
        );
      } else if (coins >= 11) {
        applyBoost(racer, 'rocket', 6000, '🚀 TÊN LỬA');
        playRocketSfx();
        playCrowdCheerSfx();
        cameraDirectorRef.current.pushEvent({
          type: 'NORMAL_GIFT_BOOST',
          userId: racer.id,
          nickname: racer.nickname,
          label: `🚀 ${payload.giftName || 'Tên Lửa'} (${coins} xu)`,
          durationSec: 3.4,
        });
        showVipBanner({
          nickname: racer.nickname,
          avatar: racer.avatar,
          giftName: payload.giftName || 'Pháo giấy',
          coins,
          tier: 'rocket',
        });
        pushFeed(
          `🚀 ${racer.nickname} tặng ${payload.giftName} (${coins} xu) - PHÓNG TÊN LỬA SIÊU TỐC!`,
          'rocket',
        );
        speakGiftThankYou(
          racer.id,
          racer.nickname,
          payload.giftName || 'Tên Lửa',
          coins,
          'Kích hoạt Tên Lửa Siêu Tốc bứt phá thần sầu',
        );
      } else {
        applyBoost(racer, 'jetpack', 4000, '🎒 JETPACK');
        playJetpackSfx();
        cameraDirectorRef.current.pushEvent({
          type: 'NORMAL_GIFT_BOOST',
          userId: racer.id,
          nickname: racer.nickname,
          label: `🎒 ${payload.giftName || 'Jetpack'} (${coins} xu)`,
          durationSec: 2.8,
        });
        showVipBanner({
          nickname: racer.nickname,
          avatar: racer.avatar,
          giftName: payload.giftName || 'Hoa hồng',
          coins,
          tier: 'jetpack',
        });
        pushFeed(
          `🎒 ${racer.nickname} tặng ${payload.giftName} (${coins} xu) - BẬT JETPACK + 🐾 ${racer.petName}!`,
          'jetpack',
        );
        speakGiftThankYou(
          racer.id,
          racer.nickname,
          payload.giftName || 'Hoa hồng',
          coins,
          'Bật động cơ Jetpack cùng thú cưng VIP tăng tốc',
        );
      }
      pushRaceSync(true);
    },
    [applyBoost, ensureRacer, pushFeed, pushRaceSync, queueForNextRound, showVipBanner, syncRacerProfilesToServer],
  );

  const requestMap = useCallback((id: string) => {
    if (phaseRef.current === 'lobby') {
      pendingMapRef.current = null;
      setActiveMap(id);
      setMapIdState(getActiveMapId());
    } else {
      // Đang đua: chờ sang ván mới mới đổi map
      pendingMapRef.current = id;
    }
  }, []);

  // Trang Bảng Điều Khiển (/) mặc định im lặng, chỉ Chế Độ Live (/?view=stage) phát tiếng giống npc-action-live
  useEffect(() => {
    setCommentatorCaptionListener((txt) => setCommentatorText(txt));
    setCommentatorSpeakingListener((speaking) => setIsMcSpeaking(speaking));
    if (!IS_STAGE) {
      setAudioSettings({ bgm: false, sfx: false, tts: false });
    }
    // Tải danh sách Hồ sơ Người chơi đã lưu khi khởi động
    void fetch('/api/users')
      .then((r) => r.json())
      .then((j) => {
        if (j?.success && Array.isArray(j.data)) {
          applySavedUsersList(j.data);
        }
      })
      .catch(() => { });
    // Đồng bộ ngay trạng thái cuộc đua hiện tại từ Server; nếu đang ở Lobby chưa có ai thì xếp nhân vật lên vạch xuất phát ngay!
    void fetch('/api/race/sync')
      .then((r) => r.json())
      .then((j) => {
        if (j?.success && j.data) {
          applyRaceSync(j.data);
        }
        if (phaseRef.current === 'lobby' && racersRef.current.size === 0) {
          fillBotsIfNeeded();
          pushRaceSync(true);
        }
      })
      .catch(() => {
        if (phaseRef.current === 'lobby' && racersRef.current.size === 0) {
          fillBotsIfNeeded();
        }
      });
  }, [applyRaceSync, applySavedUsersList, fillBotsIfNeeded, pushRaceSync]);

  // ---------- Kết nối Backend qua cả SSE (/api/tiktok/events giống npc-action-live) + WebSocket (/ws) ----------
  useEffect(() => {
    let ws: WebSocket | null = null;
    let sse: EventSource | null = null;
    let wsReconnectTimer = 0;
    let sseReconnectTimer = 0;
    let alive = true;
    const seenEventIds = new Set<number>();

    const dispatchIncoming = (type: string, data: any) => {
      if (!data) return;
      if (type === 'raceSync') {
        applyRaceSync(data);
        return;
      }
      if (typeof data._eid === 'number') {
        if (seenEventIds.has(data._eid)) return;
        seenEventIds.add(data._eid);
        if (seenEventIds.size > 2000) {
          const first = seenEventIds.values().next().value;
          if (first !== undefined) seenEventIds.delete(first);
        }
      }

      if (type === 'status') {
        setLiveStatus(data);
      } else if (type === 'users' && Array.isArray(data)) {
        applySavedUsersList(data);
      } else if (type === 'control') {
        const { action, value } = data;
        if (action === 'skipPhase') {
          if (phaseRef.current === 'lobby') startRacingPhase();
          else if (phaseRef.current === 'racing' || phaseRef.current === 'countdown') enterPodiumPhase();
          else startNewLobby(true);
        } else if (action === 'resetMatch') {
          startNewLobby(false);
        } else if (action === 'setMap' && typeof value === 'string') {
          requestMap(value);
        } else if (action === 'setLaps' && typeof value === 'number') {
          setTotalLaps(value);
        } else if (action === 'setDuration' && typeof value === 'number') {
          setRaceDuration(value);
        } else if (action === 'setAutoBots' && typeof value === 'boolean') {
          setAutoBots(value);
        } else if (action === 'setDroneCam' && typeof value === 'boolean') {
          droneCamOnRef.current = value;
          setDroneCamOnState(value);
        } else if (
          action === 'setDroneRect' &&
          value &&
          typeof value.x === 'number' &&
          typeof value.y === 'number' &&
          typeof value.w === 'number' &&
          typeof value.h === 'number'
        ) {
          droneRectRef.current = value as DroneRect;
          setDroneRectState(value as DroneRect);
        } else if (
          action === 'setGraphicsQuality' &&
          (value === 'low' || value === 'medium' || value === 'high')
        ) {
          graphicsQualityRef.current = value;
          setGraphicsQualityState(value);
        } else if (
          action === 'setCameraMode' &&
          (value === 'auto' ||
            value === 'chase' ||
            value === 'front' ||
            value === 'side' ||
            value === 'overview')
        ) {
          cameraModeRef.current = value;
          setCameraModeState(value);
          cameraDirectorRef.current.setModeOverride(value);
          setCameraHud(cameraDirectorRef.current.getHudState());
        } else if (action === 'setAiCameraModes' && value && typeof value.chase === 'boolean') {
          const nextModes = value as AiDirectorModes;
          aiCameraModesRef.current = nextModes;
          setAiCameraModesState(nextModes);
          cameraDirectorRef.current.setAiModes(nextModes);
          setCameraHud(cameraDirectorRef.current.getHudState());
        } else if (action === 'setWebcamEnabled' && typeof value === 'boolean') {
          webcamEnabledRef.current = value;
          setWebcamEnabledState(value);
        } else if (
          action === 'setWebcamRect' &&
          value &&
          typeof value.x === 'number' &&
          typeof value.y === 'number'
        ) {
          webcamRectRef.current = value as WebcamRect;
          setWebcamRectState(value as WebcamRect);
        } else if (
          action === 'setFooterBanner' &&
          value &&
          typeof value.text === 'string' &&
          typeof value.x === 'number' &&
          typeof value.y === 'number'
        ) {
          const nextBanner = { ...DEFAULT_FOOTER_BANNER, ...value } as FooterBannerConfig;
          footerBannerRef.current = nextBanner;
          setFooterBannerState(nextBanner);
        } else if (action === 'setAfkTimeout' && typeof value === 'number') {
          afkTimeoutSecRef.current = value;
          setAfkTimeoutSecState(value);
        } else if (action === 'speak' && typeof value === 'string' && value.trim()) {
          pushFeed(`🎙️ BLV: ${value.trim()}`, 'dragon');
          speakCommentator(value.trim(), true);
        } else if (action === 'setAudio' && value && IS_STAGE) {
          setAudioSettings(value);
        } else if (action === 'requestTtsTest' && IS_STAGE) {
          if (!ttsTestRunningRef.current) {
            ttsTestRunningRef.current = true;
            const testing: TtsTestResult = { status: 'testing' };
            try {
              healthChannelRef.current?.postMessage({ type: 'ttsTestResult', data: testing });
            } catch {}
            try {
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'ttsTestResult', data: testing }));
              }
            } catch {}
            void runTtsSelfTest()
              .then((res) => {
                const finalRes: TtsTestResult = {
                  status: res.ok ? 'ok' : 'error',
                  latencyMs: res.latencyMs,
                  error: res.error,
                  testedAt: Date.now(),
                };
                try {
                  healthChannelRef.current?.postMessage({ type: 'ttsTestResult', data: finalRes });
                } catch {}
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  try {
                    wsRef.current.send(JSON.stringify({ type: 'ttsTestResult', data: finalRes }));
                  } catch {}
                } else {
                  fetch('/api/stage/tts-test-result', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(finalRes),
                  }).catch(() => {});
                }
              })
              .finally(() => {
                ttsTestRunningRef.current = false;
              });
          }
        }
      } else if (type === 'stageHealth' && data && !IS_STAGE) {
        lastStageBeatAtRef.current = Date.now();
        setStageHealth(data as StageHealthSnapshot);
        setStageOnline(true);
      } else if (type === 'ttsTestResult' && data && !IS_STAGE) {
        setTtsTestResult(data as TtsTestResult);
      } else if (type === 'chat') {
        handleChat({
          userId: String(data.userId || data.username || data.nickname || 'viewer'),
          username: String(data.username || data.userId || 'viewer'),
          nickname: String(data.nickname || data.username || 'Tay đua'),
          avatar: String(data.avatar || ''),
          comment: String(data.comment || ''),
          isFollower: Boolean(data.isFollower),
          platform: data.platform === 'facebook' ? 'facebook' : 'tiktok',
        });
      } else if (type === 'follow') {
        handleFollow({
          userId: String(data.userId || data.username || data.nickname || 'viewer'),
          username: String(data.username || data.userId || 'viewer'),
          nickname: String(data.nickname || data.username || 'Tay đua'),
          avatar: String(data.avatar || ''),
          platform: data.platform === 'facebook' ? 'facebook' : 'tiktok',
        });
      } else if (type === 'member') {
        const uid = String(data.userId || data.username || data.nickname || 'viewer');
        const uname = String(data.username || data.userId || 'viewer');
        const nick = String(data.nickname || data.username || 'Khán giả');
        if (data.isFollower) {
          followersRef.current.add(uid);
          if (uname) followersRef.current.add(uname);
        }
        // Chủ phòng (isHost) luôn được giữ trên đường đua và không bao giờ bị out AFK
        if (data.isHost) {
          hostUserIdsRef.current.add(uid);
          if (uname) hostUserIdsRef.current.add(uname);
          handleChat({
            userId: uid,
            username: uname,
            nickname: nick || 'Chủ phòng',
            avatar: String(data.avatar || ''),
            comment: 'join',
            isFollower: true,
            platform: data.platform === 'facebook' ? 'facebook' : 'tiktok',
          });
        } else {
          const activeRacer = racersRef.current.get(uid);
          if (activeRacer) {
            // Tay đua vẫn đang xem live -> làm mới thời gian hoạt động
            activeRacer.lastInteractAt = performance.now();
          } else {
            addSpectator(uid, nick, String(data.avatar || ''));
            const nowMs = Date.now();
            const wasDeparted =
              departedRacersRef.current.has(uid) || departedRacersRef.current.has(uname);

            if (wasDeparted) {
              // Người chơi từng bị out vì rời live nay quay lại -> MC chào và nhắc vào lại đường đua!
              departedRacersRef.current.delete(uid);
              departedRacersRef.current.delete(uname);
              pushFeed(
                `👋 Chào mừng ${nick} quay lại phiên live! Nhắn 1 tin bất kỳ để chạy tiếp nhé!`,
                'join',
              );
              if (nowMs - lastReturnVoiceAtRef.current > 6000) {
                lastReturnVoiceAtRef.current = nowMs;
                speakCommentator(
                  `Chào mừng bạn ${nick} đã quay trở lại phiên live! Hãy nhắn một tin bất kỳ để nhân vật vào lại đường đua chạy tiếp nhé!`,
                );
              }
            } else {
              // Khán giả mới vào phòng -> MC chào và hướng dẫn cách vào game (có chống spam)
              const lastGreet = greetedViewersRef.current.get(uid) || 0;
              if (nowMs - lastGreet > 180_000 && nowMs - lastWelcomeVoiceAtRef.current > 12_000) {
                greetedViewersRef.current.set(uid, nowMs);
                lastWelcomeVoiceAtRef.current = nowMs;
                if (greetedViewersRef.current.size > 300) {
                  const firstKey = greetedViewersRef.current.keys().next().value;
                  if (firstKey) greetedViewersRef.current.delete(firstKey);
                }
                speakCommentator(
                  `Xin chào bạn ${nick} mới vào phòng live! Chỉ cần bấm Follow kênh, hoặc đã Follow rồi thì nhắn một tin bất kỳ là nhân vật sẽ vào đường đua ngay nhé!`,
                );
              }
            }
          }
        }
      } else if (type === 'like') {
        handleLike({
          userId: String(data.userId || data.username || data.nickname || 'viewer'),
          username: String(data.username || data.userId || 'viewer'),
          nickname: String(data.nickname || data.username || 'Tay đua'),
          avatar: String(data.avatar || ''),
          likeCount: Number(data.likeCount || 1),
          platform: data.platform === 'facebook' ? 'facebook' : 'tiktok',
        });
      } else if (type === 'gift') {
        handleGift({
          userId: String(data.userId || data.username || data.nickname || 'viewer'),
          username: String(data.username || data.userId || 'viewer'),
          nickname: String(data.nickname || data.username || 'Tay đua'),
          avatar: String(data.avatar || ''),
          giftName: String(data.giftName || 'Quà tặng'),
          coins: Number(data.coins ?? data.totalCoins ?? data.diamondCount ?? 1),
          platform: data.platform === 'facebook' ? 'facebook' : 'tiktok',
        });
      }
    };

    // 1) Kênh SSE (/api/tiktok/events) — hoạt động 100% qua Nginx Proxy Manager / Cloudflare như npc-action-live
    const connectSse = () => {
      if (!alive) return;
      try {
        sse = new EventSource('/api/tiktok/events');
        const eventTypes = [
          'status',
          'users',
          'raceSync',
          'stageHealth',
          'ttsTestResult',
          'control',
          'chat',
          'member',
          'follow',
          'share',
          'like',
          'gift',
        ];
        for (const t of eventTypes) {
          sse.addEventListener(t, (ev) => {
            try {
              const parsed = JSON.parse((ev as MessageEvent).data);
              dispatchIncoming(t, parsed);
            } catch { }
          });
        }
        sse.onerror = () => {
          sse?.close();
          if (!alive) return;
          sseReconnectTimer = window.setTimeout(connectSse, 3000);
        };
      } catch { }
    };

    // 2) Kênh WebSocket (/ws) song song
    const connectWs = () => {
      if (!alive) return;
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${window.location.host}/ws`);
        wsRef.current = ws;
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg?.type && msg?.data !== undefined) {
              dispatchIncoming(msg.type, msg.data);
            }
          } catch { }
        };
        ws.onclose = () => {
          if (!alive) return;
          wsReconnectTimer = window.setTimeout(connectWs, 3000);
        };
      } catch { }
    };

    connectSse();
    connectWs();
    return () => {
      alive = false;
      clearTimeout(wsReconnectTimer);
      clearTimeout(sseReconnectTimer);
      sse?.close();
      ws?.close();
    };
  }, [
    applySavedUsersList,
    enterPodiumPhase,
    handleChat,
    handleFollow,
    handleGift,
    handleLike,
    requestMap,
    setAutoBots,
    setRaceDuration,
    setTotalLaps,
    startNewLobby,
    startRacingPhase,
  ]);

  // ---------- Vòng lặp vật lý 60 FPS ----------
  const hudSyncAccumRef = useRef<number>(0);

  const stepPhysics = useCallback(
    (dt: number) => {
      const clampedDt = Math.min(dt, 0.05);
      const now = performance.now();
      const map = racersRef.current;
      const totalRaceDist = RACE_CONSTANTS.LAP_LENGTH * totalLapsRef.current;

      timerRef.current = Math.max(0, timerRef.current - clampedDt);

      if (phaseRef.current === 'lobby') {
        const ceilSec = Math.ceil(timerRef.current);
        if (ceilSec <= 3 && ceilSec >= 1 && lastBeepSecRef.current !== ceilSec) {
          lastBeepSecRef.current = ceilSec;
          playCountdownBeep(false);
        }
        if (timerRef.current <= 0) {
          startRacingPhase();
        }
      } else if (phaseRef.current === 'racing') {
        if (timerRef.current <= 0) {
          enterPodiumPhase();
        }
      } else if (phaseRef.current === 'countdown') {
        const ceilSec = Math.ceil(timerRef.current);
        if (ceilSec <= 5 && ceilSec >= 1 && lastBeepSecRef.current !== ceilSec) {
          lastBeepSecRef.current = ceilSec;
          playCountdownBeep(false);
        }
        if (timerRef.current <= 0) {
          enterPodiumPhase();
        }
      } else if (phaseRef.current === 'podium') {
        if (timerRef.current <= 0) {
          startNewLobby(true);
        }
      }

      const isMoving = phaseRef.current === 'racing' || phaseRef.current === 'countdown';
      const halfW = RACE_CONSTANTS.TRACK_WIDTH / 2 - 2.2;
      let firstFinisherTriggered = false;

      map.forEach((r) => {
        if (r.boost !== 'none' && now >= r.boostUntil) {
          r.boost = 'none';
          r.boostLabel = '';
        }

        // Tính toán tất định (Deterministic) cho Bot Sprint & Lạng lách để Màn Hình Xem Trước (/) và Màn Hình Live (/?view=stage) khớp nhau 100%!
        const zSector = Math.floor(Math.max(0, r.z) / 28);
        const detHash = hashCode(`${matchNoRef.current}_${r.id}_${zSector}`);

        if (r.isBot && isMoving && r.boost === 'none' && detHash % 23 === 0) {
          r.boost = 'sprint';
          r.boostUntil = now + 1500;
          r.boostLabel = '⚡';
        }

        if (isMoving) {
          if (r.finishedAt !== null) {
            r.speed = Math.max(0, r.speed - 22 * clampedDt);
            r.z += r.speed * clampedDt;
          } else {
            const mult = BOOST_MULTIPLIER[r.boost];
            const targetSpeed = r.baseSpeed * (1 + r.petSpeedBonus) * mult;
            r.speed += (targetSpeed - r.speed) * Math.min(1, clampedDt * 8);
            r.z += r.speed * clampedDt;
            r.lap = Math.min(
              totalLapsRef.current,
              Math.floor(Math.max(0, r.z) / RACE_CONSTANTS.LAP_LENGTH) + 1,
            );

            // Lạng lách mượt mà tất định theo cung đường
            const desiredLane = (((detHash >> 4) % 100) / 100) * (halfW * 2) - halfW;
            r.targetX = Math.max(-halfW, Math.min(halfW, desiredLane));
            r.x += (r.targetX - r.x) * Math.min(1, clampedDt * 1.8);

            // Hoàn thành đủ số vòng (quay lại đúng điểm xuất phát/về đích!)
            if (r.z >= totalRaceDist) {
              r.z = totalRaceDist;
              r.lap = totalLapsRef.current;
              r.finishedAt = now;
              if (phaseRef.current === 'racing') {
                firstFinisherTriggered = true;
              }
            }
          }
        } else {
          r.speed = 0;
        }
      });

      if (firstFinisherTriggered && phaseRef.current === 'racing') {
        phaseRef.current = 'countdown';
        timerRef.current = RACE_CONSTANTS.FINISH_COUNTDOWN_SECONDS;
        lastBeepSecRef.current = -1;
        setPhase('countdown');
        setTimerSec(RACE_CONSTANTS.FINISH_COUNTDOWN_SECONDS);
        playFinishFanfareSfx();
        playCrowdCheerSfx();
        cameraDirectorRef.current.pushEvent({
          type: 'FINISH_EVENT',
          label: '🏁 VỀ ĐÍCH',
          durationSec: RACE_CONSTANTS.FINISH_COUNTDOWN_SECONDS,
        });
        pushFeed('🏁 ĐÃ CÓ TAY ĐUA CÁN ĐÍCH! Đếm ngược 5 giây cuối tranh Top 3!', 'dragon');
        speakCommentator(
          'Đã có người đầu tiên chạm vạch đích rồi! Chỉ còn đúng 5 giây nước rút cuối cùng để phân định Top 3!',
          true,
        );
      }

      const list = Array.from(map.values());
      list.sort((a, b) => {
        if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
        if (a.finishedAt !== null) return -1;
        if (b.finishedAt !== null) return 1;
        return b.z - a.z;
      });
      for (let i = 0; i < list.length; i++) {
        list[i].rank = i + 1;
      }

      // Bình luận khuấy động phòng chờ Lobby ở mốc 7 giây trước khi xuất phát
      if (phaseRef.current === 'lobby' && !lobbyHypeDoneRef.current && timerRef.current <= 7.5 && timerRef.current > 3.5) {
        lobbyHypeDoneRef.current = true;
        const countNow = list.length;
        const hypeLobby =
          countNow > 0
            ? `Chỉ còn 7 giây nữa là xuất phát! Đã có ${countNow} tay đua sẵn sàng, cả nhà mau bình luận thêm để nhảy vào vạch xuất phát nào!`
            : `Sắp xuất phát rồi cả nhà ơi! Gõ phím bình luận bất kỳ hoặc thả tim để nhân vật của bạn vào đường đua ngay!`;
        pushFeed(`🎙️ ${hypeLobby}`, 'system');
        speakCommentator(hypeLobby);
      }

      // Phát hiện sự kiện Vượt Lên Dẫn Đầu (OVERTAKE_EVENT) + Bình luận trực tiếp liên tục mỗi 8.2 giây
      if (phaseRef.current === 'racing') {
        raceElapsedRef.current += clampedDt;
        liveCommentAccumRef.current += clampedDt;
        const currTop1 = list[0];
        const currTop2 = list[1];
        const currTop3 = list[2];

        if (currTop1) {
          if (
            raceElapsedRef.current > 4.5 &&
            lastTop1IdRef.current &&
            lastTop1IdRef.current !== currTop1.id
          ) {
            const prevLeader = map.get(lastTop1IdRef.current);
            playCrowdCheerSfx();
            cameraDirectorRef.current.pushEvent({
              type: 'PLAYER_OVERTAKE',
              userId: currTop1.id,
              rivalUserId: prevLeader?.id,
              nickname: currTop1.nickname,
              label: `⚡ VƯỢT QUA ${prevLeader?.nickname || 'TOP 1'}!`,
              durationSec: 2.5,
            });
            const overtakeLines = [
              `Cú lật kèo nghẹt thở! ${currTop1.nickname} vừa lách qua khúc cua tuyệt đẹp, cướp ngôi Số 1 từ tay ${prevLeader?.nickname || 'đối thủ'}!`,
              `Đổi ngôi dẫn đầu rồi cả nhà ơi! ${currTop1.nickname} đang phóng tia sét vươn lên thống trị Top 1!`,
              `Pha vượt mặt quá đẳng cấp! ${currTop1.nickname} đã chính thức chiếm lĩnh vị trí dẫn đầu đoàn đua!`,
            ];
            const line = overtakeLines[commentIdxRef.current++ % overtakeLines.length];
            pushFeed(`🔥 ${currTop1.nickname} bứt phá chiếm ngôi TOP 1!`, 'sprint');
            speakCommentator(line, true);
            liveCommentAccumRef.current = 0; // Reset nhịp bình luận định kỳ sau pha vượt Top 1
          }
          lastTop1IdRef.current = currTop1.id;
        }

        // Bình luận viên tường thuật diễn biến trực tiếp mỗi 8.2 giây suốt chặng đua
        if (liveCommentAccumRef.current >= 8.2 && currTop1) {
          liveCommentAccumRef.current = 0;
          const gap12 = currTop2 ? Math.max(1, Math.round(currTop1.z - currTop2.z)) : 0;
          const pct = Math.min(99, Math.max(1, Math.round((currTop1.z / totalRaceDist) * 100)));
          const boostingRacer = list.find((r) => r.boost !== 'none' && !r.isBot) || list.find((r) => r.boost !== 'none');
          const mode = commentIdxRef.current++ % 5;
          let playByPlay = '';

          if (boostingRacer && mode === 0) {
            playByPlay = `Nhìn kìa! ${boostingRacer.nickname} đang bật tăng tốc phóng tia sét cực cháy ở vị trí hạng ${boostingRacer.rank}!`;
          } else if (currTop2 && gap12 <= 10 && (mode === 1 || mode === 2)) {
            playByPlay = `Kịch tính nghẹt thở! ${currTop1.nickname} và ${currTop2.nickname} đang kè sát nhau chỉ cách đúng ${gap12} mét! Ai thả tim nhanh hơn sẽ bứt lên dẫn đầu!`;
          } else if (currTop2 && currTop3 && mode === 2) {
            playByPlay = `Cuộc đua Tam Hùng siêu gay cấn! Dẫn đầu là ${currTop1.nickname}, bám sát phía sau là ${currTop2.nickname} và ${currTop3.nickname} ở vòng ${currTop1.lap}!`;
          } else if (currTop2 && gap12 > 10 && mode === 3) {
            playByPlay = `${currTop1.nickname} đang giữ vững ngôi đầu với ${pct} phần trăm chặng đường, bỏ xa ${currTop2.nickname} ${gap12} mét! Có đại gia nào tung Tên Lửa hay Rồng Thần để lật kèo không đây?!`;
          } else {
            playByPlay = `Đoàn đua ${list.length} tay đua đang ôm cua tốc độ cao ở vòng ${currTop1.lap} trên ${totalLapsRef.current}! Cả nhà chạm thả tim liên tục và bình luận để kích hoạt tia sét The Flash nhé!`;
          }

          pushFeed(`🎙️ BLV: ${playByPlay}`, 'system');
          speakCommentator(playByPlay, false);
        }
      }

      // Thông báo Vòng Cuối khi Top 1 bước vào vòng cuối cùng
      if (
        phaseRef.current === 'racing' &&
        totalLapsRef.current > 1 &&
        !announcedFinalLapRef.current &&
        list[0] &&
        list[0].lap === totalLapsRef.current
      ) {
        announcedFinalLapRef.current = true;
        pushFeed(`🔥 VÒNG CUỐI (${totalLapsRef.current}/${totalLapsRef.current})! Bứt tốc về đích ngay!`, 'rocket');
        speakCommentator('Vòng đua cuối cùng rồi! Ai sẽ bứt tốc vượt cua để cán đích đầu tiên đây!');
      }

      // Đồng bộ trạng thái cuộc đua từ Bảng Điều Khiển (/) sang Màn Hình Live (/?view=stage) mỗi 0.4s
      if (!IS_STAGE) {
        syncAccumRef.current += clampedDt;
        if (syncAccumRef.current >= 0.4) {
          syncAccumRef.current = 0;
          pushRaceSync(false);
        }
      }

      // Đồng bộ React HUD 6 lần/giây
      hudSyncAccumRef.current += clampedDt;
      if (hudSyncAccumRef.current >= 0.16) {
        hudSyncAccumRef.current = 0;
        setTimerSec(Math.ceil(timerRef.current));
        setRacerCount(list.length);
        setTop5(list.slice(0, 30).map((r) => ({ ...r })));
        setLeaderLap(list[0]?.lap || 1);
        setLeaderProgress(
          list[0] ? Math.min(100, Math.round((Math.max(0, list[0].z) / totalRaceDist) * 100)) : 0,
        );
        const dirtyCam = cameraDirectorRef.current.consumeHudStateIfDirty();
        if (dirtyCam) setCameraHud(dirtyCam);
        const camNow = cameraDirectorRef.current.getHudState();
        const activeSpotId = camNow.spotlightUserId;
        const focusObj =
          (camNow.focusedUserId ? racersRef.current.get(camNow.focusedUserId) : undefined) ||
          list[0];
        if (focusObj) {
          const leaderZ = list[0]?.z ?? focusObj.z;
          const distGap = Math.max(0, leaderZ - focusObj.z);
          const gapSec =
            focusObj.rank === 1 ? 0 : Math.round((distGap / Math.max(12, focusObj.speed || 20)) * 10) / 10;
          setFocusedRacer({ ...focusObj, gapSec });
        } else {
          setFocusedRacer(null);
        }
        // Hiển thị vị trí toàn bộ người chơi (tối đa 40 chấm) trên Mini Race Map
        const dots: MinimapDot[] = list.slice(0, 40).map((r) => {
          const s = sampleCircuit(Math.max(0, r.z), r.x);
          const m = worldToMinimap(s.x, s.z);
          return {
            id: r.id,
            x: m.x,
            y: m.y,
            rank: r.rank,
            isTop1: r.rank === 1,
            isSpotlight: activeSpotId === r.id,
            color: '#' + r.shirtColor.toString(16).padStart(6, '0'),
          };
        });
        setMinimapDots(dots);
      }
    },
    [enterPodiumPhase, pushFeed, startNewLobby, startRacingPhase],
  );

  // ---------- Các nút điều khiển Streamer (TikTok LIVE & Facebook Live giống npc-action-live) ----------
  const connectTikTok = useCallback(async (username: string) => {
    try {
      const res = await fetch('/api/tiktok/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : { success: false, error: 'Không có phản hồi' };
      if (parsed?.data) setLiveStatus(parsed.data);
      return parsed;
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  }, []);

  const disconnectTikTok = useCallback(async () => {
    try {
      const res = await fetch('/api/tiktok/disconnect', { method: 'POST' });
      const j = await res.json();
      if (j?.data) setLiveStatus(j.data);
    } catch { }
  }, []);

  const connectFacebook = useCallback(
    async (opts: { videoId: string; accessToken?: string; mode: 'bridge' | 'graph' }) => {
      try {
        const res = await fetch('/api/facebook/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts),
        });
        const text = await res.text();
        const parsed = text ? JSON.parse(text) : { success: false, error: 'Không có phản hồi' };
        if (parsed?.data) setLiveStatus(parsed.data);
        return parsed;
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    },
    [],
  );

  const disconnectFacebook = useCallback(async () => {
    try {
      const res = await fetch('/api/facebook/disconnect', { method: 'POST' });
      const j = await res.json();
      if (j?.data) setLiveStatus(j.data);
    } catch { }
  }, []);

  const ingestFbEvent = useCallback(
    async (payload: {
      nickname?: string;
      username?: string;
      comment?: string;
      avatar?: string;
      stars?: number;
      comments?: Array<{
        nickname?: string;
        username?: string;
        comment?: string;
        avatar?: string;
        stars?: number;
      }>;
    }) => {
      try {
        const res = await fetch('/api/facebook/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) return;
      } catch { }
    },
    [],
  );

  // Lắng nghe postMessage từ cửa sổ Cầu nối Facebook Live (window.opener.postMessage)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (d && typeof d === 'object' && d.type === 'FB_LIVE_INGEST' && d.payload) {
        void ingestFbEvent(d.payload);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [ingestFbEvent]);

  const pickRandomOrNewUser = useCallback((preferExisting: boolean) => {
    const existing = Array.from(racersRef.current.values()).filter((r) => !r.isBot);
    if (preferExisting && existing.length > 0) {
      const picked = existing[Math.floor(Math.random() * existing.length)];
      return {
        userId: picked.id,
        username: picked.username,
        nickname: picked.nickname,
        avatar: picked.avatar,
      };
    }
    const idx = mockSeqRef.current++;
    const name = `${MOCK_NAMES[idx % MOCK_NAMES.length]} ${idx}`;
    return {
      userId: `mock_${idx}`,
      username: `mock_user_${idx}`,
      nickname: name,
      avatar: '',
    };
  }, []);

  const postControl = useCallback((action: string, value?: unknown) => {
    void fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, value }),
    }).catch(() => { });
  }, []);

  const postTestEmit = useCallback(
    (type: 'chat' | 'like' | 'gift', data: Record<string, unknown>) => {
      void fetch('/api/test/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data }),
      }).catch(() => { });
    },
    [],
  );

  const triggerMock = useCallback(
    (
      action:
        | 'chat_new'
        | 'chat_10'
        | 'like'
        | 'gift_small'
        | 'gift_medium'
        | 'gift_superman'
        | 'gift_vip'
        | 'fb_chat'
        | 'fb_stars',
    ) => {
      if (action === 'chat_new') {
        const u = pickRandomOrNewUser(false);
        postTestEmit('chat', { ...u, comment: 'join', isFollower: true, platform: 'tiktok' });
      } else if (action === 'chat_10') {
        for (let i = 0; i < 10; i++) {
          const u = pickRandomOrNewUser(false);
          postTestEmit('chat', { ...u, comment: 'join', isFollower: true, platform: 'tiktok' });
        }
      } else if (action === 'like') {
        const u = pickRandomOrNewUser(true);
        postTestEmit('like', { ...u, likeCount: 3, platform: 'tiktok' });
      } else if (action === 'gift_small') {
        const u = pickRandomOrNewUser(true);
        postTestEmit('gift', { ...u, giftName: 'Hoa Hồng', coins: 5, platform: 'tiktok' });
      } else if (action === 'gift_medium') {
        const u = pickRandomOrNewUser(true);
        postTestEmit('gift', { ...u, giftName: 'Pháo Giấy', coins: 30, platform: 'tiktok' });
      } else if (action === 'gift_superman') {
        const u = pickRandomOrNewUser(true);
        postTestEmit('gift', { ...u, giftName: 'Năng Lượng Siêu Nhân', coins: 60, platform: 'tiktok' });
      } else if (action === 'gift_vip') {
        const u = pickRandomOrNewUser(true);
        postTestEmit('gift', { ...u, giftName: 'Rồng Thần VIP', coins: 200, platform: 'tiktok' });
      } else if (action === 'fb_chat') {
        const u = pickRandomOrNewUser(false);
        postTestEmit('chat', {
          ...u,
          userId: `fb_${u.userId}`,
          username: `fb_${u.username}`,
          comment: 'join',
          isFollower: true,
          platform: 'facebook',
        });
      } else if (action === 'fb_stars') {
        const u = pickRandomOrNewUser(true);
        postTestEmit('gift', {
          ...u,
          giftName: '⭐ Sao Facebook',
          coins: 100,
          platform: 'facebook',
        });
      }
    },
    [pickRandomOrNewUser, postTestEmit],
  );

  const skipPhase = useCallback(() => {
    postControl('skipPhase');
  }, [postControl]);

  const resetMatch = useCallback(() => {
    postControl('resetMatch');
  }, [postControl]);

  const changeTotalLaps = useCallback(
    (laps: number) => {
      setTotalLaps(laps);
      postControl('setLaps', laps);
    },
    [postControl, setTotalLaps],
  );

  const changeAutoBots = useCallback(
    (v: boolean) => {
      setAutoBots(v);
      postControl('setAutoBots', v);
    },
    [postControl, setAutoBots],
  );

  const changeDroneCam = useCallback(
    (v: boolean) => {
      droneCamOnRef.current = v;
      setDroneCamOnState(v);
      postControl('setDroneCam', v);
    },
    [postControl],
  );

  const changeDroneRect = useCallback(
    (rect: DroneRect) => {
      droneRectRef.current = rect;
      setDroneRectState(rect);
      try {
        localStorage.setItem('droneRect', JSON.stringify(rect));
      } catch {}
      postControl('setDroneRect', rect);
    },
    [postControl],
  );

  const changeGraphicsQuality = useCallback(
    (q: GraphicsQuality) => {
      graphicsQualityRef.current = q;
      setGraphicsQualityState(q);
      try {
        localStorage.setItem('graphicsQuality', q);
      } catch {}
      postControl('setGraphicsQuality', q);
      pushRaceSync(true);
    },
    [postControl, pushRaceSync],
  );

  const changeCameraMode = useCallback(
    (mode: CameraModeOverride) => {
      cameraModeRef.current = mode;
      setCameraModeState(mode);
      cameraDirectorRef.current.setModeOverride(mode);
      setCameraHud(cameraDirectorRef.current.getHudState());
      postControl('setCameraMode', mode);
      pushRaceSync(true);
    },
    [postControl, pushRaceSync],
  );

  const toggleAiCameraMode = useCallback(
    (key: keyof AiDirectorModes) => {
      const cur = aiCameraModesRef.current;
      const next: AiDirectorModes = { ...cur, [key]: !cur[key] };
      // Luôn giữ ít nhất 1 chế độ camera tham gia Đạo diễn AI
      if (!next.chase && !next.front && !next.side && !next.overview) return;
      aiCameraModesRef.current = next;
      setAiCameraModesState(next);
      cameraDirectorRef.current.setAiModes(next);
      setCameraHud(cameraDirectorRef.current.getHudState());
      try {
        localStorage.setItem('aiCameraModes', JSON.stringify(next));
      } catch {}
      postControl('setAiCameraModes', next);
      pushRaceSync(true);
    },
    [postControl, pushRaceSync],
  );

  const changeMap = useCallback(
    (id: string) => {
      requestMap(id);
      postControl('setMap', id);
    },
    [postControl, requestMap],
  );

  const changeRaceDuration = useCallback(
    (sec: number) => {
      setRaceDuration(sec);
      postControl('setDuration', sec);
    },
    [postControl, setRaceDuration],
  );

  const syncStageAudio = useCallback(
    (opts: { bgm?: boolean; sfx?: boolean; tts?: boolean }) => {
      postControl('setAudio', opts);
    },
    [postControl],
  );

  const speakCustom = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      postControl('speak', clean);
    },
    [postControl],
  );

  // ---------- Tự động mở khóa Audio Master Bus khi chạy ở chế độ Browser Source (OBS / TikTok LIVE Studio CEF) ----------
  useEffect(() => {
    if (!IS_BROWSER_SOURCE) return;
    let cancelled = false;
    void liveRuntime.startLiveMode({ keepScreenAwake: false }).then(() => {
      if (cancelled) return;
      if (liveRuntime.getAudioState() === 'running') {
        setLiveModeStarted(true);
        startRaceBgm();
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- StageHealthMonitor 2 kênh: BroadcastChannel (cùng trình duyệt) + Server WS/SSE (xuyên trình duyệt cho Browser Source) ----------
  useEffect(() => {
    const ch = openHealthChannel();
    healthChannelRef.current = ch;

    if (IS_STAGE) {
      const sendHeartbeat = () => {
        const fpsNow = stageFpsRef.current;
        if (fpsNow < 15) {
          lowFpsStreakRef.current += 1;
        } else {
          lowFpsStreakRef.current = 0;
        }
        const snap: StageHealthSnapshot = {
          outputMode: STAGE_OUTPUT_MODE,
          transport: 'broadcast',
          fps: fpsNow,
          lowFpsStreakSec: lowFpsStreakRef.current,
          visibilityState: document.visibilityState,
          audioState: liveRuntime.getAudioState(),
          audioLevel: liveRuntime.getAudioLevel(),
          wakeLockStatus: liveRuntime.getWakeLockStatus(),
          webcamState: webcamStatusRef.current,
          liveStarted: liveRuntime.isLiveStarted(),
          ttsQueueLen: getTtsQueueLength(),
          timestamp: Date.now(),
        };
        setStageHealth(snap);
        if (ch) {
          const msg: StageHealthMessage = { type: 'heartbeat', data: snap };
          try {
            ch.postMessage(msg);
          } catch {}
        }
        // Đẩy đồng thời lên Server để Dashboard trên Chrome giám sát được cả Stage chạy trong Browser Source CEF
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          try {
            wsRef.current.send(JSON.stringify({ type: 'stageHealth', data: snap }));
          } catch {}
        } else {
          fetch('/api/stage/health', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snap),
          }).catch(() => {});
        }
      };

      const onMsg = (ev: MessageEvent<StageHealthMessage>) => {
        if (ev.data?.type === 'requestTtsTest' && !ttsTestRunningRef.current) {
          ttsTestRunningRef.current = true;
          const testing: TtsTestResult = { status: 'testing' };
          try {
            ch?.postMessage({ type: 'ttsTestResult', data: testing });
          } catch {}
          void runTtsSelfTest()
            .then((res) => {
              const finalRes: TtsTestResult = {
                status: res.ok ? 'ok' : 'error',
                latencyMs: res.latencyMs,
                error: res.error,
                testedAt: Date.now(),
              };
              try {
                ch?.postMessage({ type: 'ttsTestResult', data: finalRes });
              } catch {}
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                try {
                  wsRef.current.send(JSON.stringify({ type: 'ttsTestResult', data: finalRes }));
                } catch {}
              }
            })
            .finally(() => {
              ttsTestRunningRef.current = false;
            });
        }
      };

      ch?.addEventListener('message', onMsg);
      const onVis = () => sendHeartbeat();
      document.addEventListener('visibilitychange', onVis);
      sendHeartbeat();
      const timer = window.setInterval(sendHeartbeat, 1000);
      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVis);
        ch?.removeEventListener('message', onMsg);
        ch?.close();
      };
    } else {
      // Dashboard (/) nhận nhịp tim sức khỏe thực tế từ Stage qua cả BroadcastChannel lẫn Server WS/SSE
      const onMsg = (ev: MessageEvent<StageHealthMessage>) => {
        if (ev.data?.type === 'heartbeat' && ev.data.data) {
          lastStageBeatAtRef.current = Date.now();
          setStageHealth(ev.data.data);
          setStageOnline(true);
        } else if (ev.data?.type === 'ttsTestResult' && ev.data.data) {
          setTtsTestResult(ev.data.data);
        }
      };
      ch?.addEventListener('message', onMsg);
      const watchdog = window.setInterval(() => {
        if (lastStageBeatAtRef.current > 0 && Date.now() - lastStageBeatAtRef.current > 3600) {
          setStageOnline(false);
        }
      }, 1000);
      return () => {
        clearInterval(watchdog);
        ch?.removeEventListener('message', onMsg);
        ch?.close();
      };
    }
  }, []);

  const reportStageFps = useCallback((fpsVal: number) => {
    stageFpsRef.current = fpsVal;
  }, []);

  const changeBroadcastMode = useCallback((mode: BroadcastOutputModeId) => {
    setBroadcastModeState(mode);
    try {
      localStorage.setItem('broadcastOutputMode', mode);
    } catch {}
  }, []);

  const startStageLiveMode = useCallback(async () => {
    await liveRuntime.startLiveMode({ keepScreenAwake: !IS_BROWSER_SOURCE });
    setLiveModeStarted(true);
    if (IS_STAGE) {
      startRaceBgm();
    }
  }, []);

  const changeWebcamEnabled = useCallback(
    (enabled: boolean) => {
      webcamEnabledRef.current = enabled;
      setWebcamEnabledState(enabled);
      if (!enabled) {
        webcamStatusRef.current = 'off';
        setWebcamStatusState('off');
      }
      postControl('setWebcamEnabled', enabled);
      pushRaceSync(true);
    },
    [postControl, pushRaceSync],
  );

  const changeWebcamRect = useCallback(
    (rect: WebcamRect) => {
      webcamRectRef.current = rect;
      setWebcamRectState(rect);
      try {
        localStorage.setItem('webcamRect', JSON.stringify(rect));
      } catch {}
      postControl('setWebcamRect', rect);
    },
    [postControl],
  );

  // ---------- Tự động cho nhân vật rời cuộc đua khi người chơi rời live / không tương tác quá ngưỡng AFK ----------
  useEffect(() => {
    const timer = window.setInterval(() => {
      const limitSec = afkTimeoutSecRef.current;
      if (limitSec <= 0) return;
      const limitMs = limitSec * 1000;
      const nowPerf = performance.now();
      const map = racersRef.current;
      let removedAny = false;

      for (const [id, r] of map.entries()) {
        if (r.isBot) continue;
        if (hostUserIdsRef.current.has(id) || hostUserIdsRef.current.has(r.username)) continue;
        if (nowPerf - r.lastInteractAt >= limitMs) {
          map.delete(id);
          departedRacersRef.current.set(id, { nickname: r.nickname, departedAt: Date.now() });
          if (r.username) {
            departedRacersRef.current.set(r.username, { nickname: r.nickname, departedAt: Date.now() });
          }
          if (departedRacersRef.current.size > 400) {
            const oldest = departedRacersRef.current.keys().next().value;
            if (oldest) departedRacersRef.current.delete(oldest);
          }
          const mins = Math.max(1, Math.round(limitSec / 60));
          pushFeed(`👋 ${r.nickname} tạm rời đường đua (không tương tác ${mins} phút)`, 'system');
          removedAny = true;
        }
      }

      if (removedAny) {
        fillBotsIfNeeded();
        pushRaceSync(true);
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [fillBotsIfNeeded, pushFeed, pushRaceSync]);

  const changeFooterBanner = useCallback(
    (next: FooterBannerConfig) => {
      footerBannerRef.current = next;
      setFooterBannerState(next);
      try {
        localStorage.setItem('footerBanner', JSON.stringify(next));
      } catch {}
      postControl('setFooterBanner', next);
      pushRaceSync(true);
    },
    [postControl, pushRaceSync],
  );

  const changeAfkTimeoutSec = useCallback(
    (sec: number) => {
      const clean = Math.max(0, Math.min(3600, Math.round(sec)));
      afkTimeoutSecRef.current = clean;
      setAfkTimeoutSecState(clean);
      try {
        localStorage.setItem('afkTimeoutSec', String(clean));
      } catch {}
      postControl('setAfkTimeout', clean);
      pushRaceSync(true);
    },
    [postControl, pushRaceSync],
  );

  const handleWebcamStatusChange = useCallback((st: WebcamStatus) => {
    webcamStatusRef.current = st;
    setWebcamStatusState(st);
  }, []);

  const triggerTtsTest = useCallback(async () => {
    setTtsTestResult({ status: 'testing' });
    if (IS_STAGE) {
      const res = await runTtsSelfTest();
      setTtsTestResult({
        status: res.ok ? 'ok' : 'error',
        latencyMs: res.latencyMs,
        error: res.error,
        testedAt: Date.now(),
      });
      return;
    }
    if (stageOnline) {
      // Gửi qua server (/api/control) để hoạt động cả khi Stage chạy trong Browser Source CEF lẫn tab Chrome
      postControl('requestTtsTest', Date.now());
    } else {
      // Nếu chưa mở Stage -> kiểm tra trực tiếp endpoint /api/tts trên Dashboard để xác nhận backend TTS sống
      const res = await runTtsSelfTest();
      setTtsTestResult({
        status: res.ok ? 'ok' : 'error',
        latencyMs: res.latencyMs,
        error: res.error,
        testedAt: Date.now(),
      });
    }
  }, [postControl, stageOnline]);

  return {
    racersRef,
    spectatorsRef,
    phaseRef,
    timerRef,
    cameraDirectorRef,
    cameraHud,
    phase,
    timerSec,
    matchNo,
    totalLaps,
    setTotalLaps: changeTotalLaps,
    raceDuration,
    setRaceDuration: changeRaceDuration,
    leaderLap,
    racerCount,
    top5,
    podiumTop3,
    minimapDots,
    leaderProgress,
    vipBanner,
    feed,
    commentatorText,
    isMcSpeaking,
    focusedRacer,
    speakCustom,
    liveStatus,
    savedUsers,
    autoBots,
    setAutoBots: changeAutoBots,
    droneCamOn,
    setDroneCamOn: changeDroneCam,
    droneRect,
    setDroneRect: changeDroneRect,
    graphicsQuality,
    setGraphicsQuality: changeGraphicsQuality,
    cameraMode,
    setCameraMode: changeCameraMode,
    aiCameraModes,
    toggleAiCameraMode,
    webcamEnabled,
    setWebcamEnabled: changeWebcamEnabled,
    webcamRect,
    setWebcamRect: changeWebcamRect,
    webcamStatus,
    setWebcamStatus: handleWebcamStatusChange,
    liveModeStarted,
    startStageLiveMode,
    stageHealth,
    stageOnline,
    ttsTestResult,
    triggerTtsTest,
    broadcastMode,
    setBroadcastMode: changeBroadcastMode,
    footerBanner,
    setFooterBanner: changeFooterBanner,
    afkTimeoutSec,
    setAfkTimeoutSec: changeAfkTimeoutSec,
    reportStageFps,
    stepPhysics,
    connectTikTok,
    disconnectTikTok,
    connectFacebook,
    disconnectFacebook,
    ingestFbEvent,
    triggerMock,
    skipPhase,
    resetMatch,
    syncStageAudio,
    mapId,
    changeMap,
    pendingMapRef,
  };
}
