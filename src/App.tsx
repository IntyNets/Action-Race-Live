import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  MapPin,
  RotateCcw,
  SkipForward,
  Trophy,
  Tv,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Race3DCanvas } from './game/Race3DCanvas';
import { IS_BROWSER_SOURCE, IS_STAGE, useRaceEngine } from './game/useRaceEngine';
import { setAudioSettings } from './audio/raceAudio';
import { CIRCUIT_TRACK, MAPS, getMapLapKm } from './game/trackCurve';
import { DEFAULT_FOOTER_BANNER } from './game/raceTypes';
import { HostWebcamPip } from './live/HostWebcamPip';
import { hostAuthorization, RaceHostPanel } from './live/RaceHostPanel';
import {
  BROADCAST_OUTPUT_MODES,
  buildStageUrl,
  getBroadcastModeMeta,
} from './live/broadcastModes';

export default function App() {
  const engine = useRaceEngine();
  const {
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
    setTotalLaps,
    raceDuration,
    setRaceDuration,
    leaderLap,
    racerCount,
    top5,
    podiumTop3,
    minimapDots,
    vipBanner,
    feed,
    isMcSpeaking,
    focusedRacer,
    speakCustom,
    liveStatus,
    savedUsers,
    aiReplies,
    autoBots,
    setAutoBots,
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
    droneCamOn,
    setDroneCamOn,
    droneRect,
    setDroneRect,
    graphicsQuality,
    setGraphicsQuality,
    timeOfDayMode,
    setTimeOfDayMode,
    cameraMode,
    setCameraMode,
    aiCameraModes,
    toggleAiCameraMode,
    webcamEnabled,
    setWebcamEnabled,
    webcamRect,
    setWebcamRect,
    setWebcamStatus,
    liveModeStarted,
    startStageLiveMode,
    stageHealth,
    stageOnline,
    ttsTestResult,
    triggerTtsTest,
    broadcastMode,
    setBroadcastMode,
    footerBanner,
    setFooterBanner,
    afkTimeoutSec,
    setAfkTimeoutSec,
    reportStageFps,
  } = engine;

  const [platformTab, setPlatformTab] = useState<'tiktok' | 'facebook'>(() => {
    try {
      return localStorage.getItem('livePlatformTab') === 'facebook' ? 'facebook' : 'tiktok';
    } catch {
      return 'tiktok';
    }
  });
  const [tiktokIdInput, setTiktokIdInput] = useState(() => {
    try {
      return localStorage.getItem('tiktokUser') || '';
    } catch {
      return '';
    }
  });
  const [fbVideoId, setFbVideoId] = useState(() => {
    try {
      return localStorage.getItem('fbVideoId') || '';
    } catch {
      return '';
    }
  });
  const [fbToken, setFbToken] = useState(() => {
    try {
      return localStorage.getItem('fbAccessToken') || '';
    } catch {
      return '';
    }
  });
  const [fbMode, setFbMode] = useState<'bridge' | 'graph'>(() => {
    try {
      return localStorage.getItem('fbMode') === 'graph' ? 'graph' : 'bridge';
    } catch {
      return 'bridge';
    }
  });
  const [busy, setBusy] = useState(false);
  const [fbBusy, setFbBusy] = useState(false);
  const [copiedBridge, setCopiedBridge] = useState(false);
  const [connMsg, setConnMsg] = useState('');
  const [quickJoinName, setQuickJoinName] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');
  const [resettingPlayer, setResettingPlayer] = useState('');
  const [playerMessage, setPlayerMessage] = useState('');
  const [customSpeakInput, setCustomSpeakInput] = useState('');
  const [bgmOn, setBgmOn] = useState(true);
  const [sfxOn, setSfxOn] = useState(true);
  const [ttsOn, setTtsOn] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);

  const fb = liveStatus.fb;
  const playerQuery = playerSearch.trim().toLowerCase();
  const visibleProfiles = useMemo(() => savedUsers.filter((player) =>
    !playerQuery || `${player.nickname} ${player.username} ${player.userId}`.toLowerCase().includes(playerQuery),
  ).slice(0, 30), [savedUsers, playerQuery]);

  const resetPlayerLevel = async (player: { userId: string; nickname: string }) => {
    if (!window.confirm(`Đặt ${player.nickname} về cấp 1 và 0 XP?`)) return;
    setResettingPlayer(player.userId);
    setPlayerMessage('');
    try {
      const response = await fetch('/api/users/reset-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...hostAuthorization() },
        body: JSON.stringify({ userId: player.userId }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Không đặt lại được cấp độ.');
      setPlayerMessage(`${player.nickname} đã về cấp 1 và 0 XP.`);
    } catch (error) {
      setPlayerMessage(error instanceof Error ? error.message : 'Không đặt lại được cấp độ.');
    } finally {
      setResettingPlayer('');
    }
  };

  const switchPlatform = (p: 'tiktok' | 'facebook') => {
    setPlatformTab(p);
    try {
      localStorage.setItem('livePlatformTab', p);
    } catch { }
    setConnMsg('');
  };

  const handleConnectTikTok = async () => {
    if (!tiktokIdInput.trim()) return;
    setBusy(true);
    setConnMsg('');
    try {
      localStorage.setItem('tiktokUser', tiktokIdInput.trim());
    } catch { }
    const r = await connectTikTok(tiktokIdInput.trim());
    setConnMsg(r?.success ? '✅ Đã kết nối TikTok LIVE' : r?.error || 'Không kết nối được TikTok');
    setBusy(false);
  };

  const handleConnectFacebook = async (overrideMode?: 'bridge' | 'graph') => {
    const useMode = overrideMode || fbMode;
    setFbBusy(true);
    setConnMsg('');
    try {
      localStorage.setItem('fbVideoId', fbVideoId);
      localStorage.setItem('fbAccessToken', fbToken);
      localStorage.setItem('fbMode', useMode);
    } catch { }
    const r = await connectFacebook({
      videoId: fbVideoId,
      accessToken: useMode === 'graph' ? fbToken : '',
      mode: useMode,
    });
    if (r?.success) {
      setConnMsg(
        useMode === 'bridge'
          ? '✅ Đã bật Cầu nối Facebook Live! Mở tab Facebook Live hoặc bật التiện ích chạy ngầm.'
          : `✅ Đã kết nối Facebook Graph API (${r.pageName || r.videoId})`,
      );
    } else {
      setConnMsg(r?.error || 'Không kết nối được Facebook Live');
    }
    setFbBusy(false);
  };

  const openFbLiveWindow = () => {
    const targetUrl = fbVideoId.trim().startsWith('http')
      ? fbVideoId.trim()
      : fbVideoId.trim()
        ? `https://www.facebook.com/watch/live/?v=${encodeURIComponent(fbVideoId.trim())}`
        : 'https://www.facebook.com/watch/live/';
    window.open(targetUrl, 'fb_live_bridge_win');
    if (!fb?.isConnected) {
      void handleConnectFacebook('bridge');
    }
  };

  const copyFbBridgeScript = async () => {
    const serverOrigin = window.location.origin;
    const script = buildFbBrowserBridgeScript(serverOrigin);
    try {
      await navigator.clipboard.writeText(script);
      setCopiedBridge(true);
      setTimeout(() => setCopiedBridge(false), 4000);
      if (!fb?.isConnected) {
        void handleConnectFacebook('bridge');
      }
    } catch {
      setConnMsg('Không tự copy được, vui lòng thử lại.');
    }
  };

  const activeOutputMeta = useMemo(() => getBroadcastModeMeta(broadcastMode), [broadcastMode]);
  const effectiveOutputMode =
    stageOnline && stageHealth?.outputMode ? stageHealth.outputMode : broadcastMode;
  const checklistProfile = useMemo(
    () => getBroadcastModeMeta(effectiveOutputMode).checklistProfile,
    [effectiveOutputMode],
  );
  const stageUrl = useMemo(
    () =>
      buildStageUrl(
        typeof window !== 'undefined' ? window.location.origin : '',
        broadcastMode === 'rtmp_stream' ? 'window_capture' : broadcastMode,
      ),
    [broadcastMode],
  );

  const minimapPath = useMemo(() => {
    const pts = CIRCUIT_TRACK.minimapPoints;
    if (!pts.length) return '';
    return (
      pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
      ' Z'
    );
  }, [mapId]);
  const startDot = useMemo(() => CIRCUIT_TRACK.minimapPoints[0] || { x: 20, y: 50 }, [mapId]);
  const activeMap = useMemo(() => MAPS.find((m) => m.id === mapId) || MAPS[0], [mapId]);
  const activeLapKm = getMapLapKm(mapId);

  const handleAudioToggle = (kind: 'bgm' | 'sfx' | 'tts') => {
    if (kind === 'bgm') {
      const next = !bgmOn;
      setBgmOn(next);
      if (IS_STAGE) setAudioSettings({ bgm: next });
      else syncStageAudio({ bgm: next });
    } else if (kind === 'sfx') {
      const next = !sfxOn;
      setSfxOn(next);
      if (IS_STAGE) setAudioSettings({ sfx: next });
      else syncStageAudio({ sfx: next });
    } else {
      const next = !ttsOn;
      setTtsOn(next);
      if (IS_STAGE) setAudioSettings({ tts: next });
      else syncStageAudio({ tts: next });
    }
  };

  const copyStageUrl = async () => {
    try {
      await navigator.clipboard.writeText(stageUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch { }
  };

  const footerBannerElRef = useRef<HTMLDivElement | null>(null);
  const startFooterBannerDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: 'move' | 'resize',
  ) => {
    if (IS_STAGE) return;
    e.preventDefault();
    e.stopPropagation();
    const el = footerBannerElRef.current;
    const parent = (el?.offsetParent as HTMLElement | null) || el?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const init = { ...footerBanner };

    const onMove = (ev: PointerEvent) => {
      const dxPct = ((ev.clientX - startX) / rect.width) * 100;
      const dyPct = ((ev.clientY - startY) / rect.height) * 100;
      if (mode === 'move') {
        const nextX = Math.max(0, Math.min(100 - init.w, Math.round((init.x + dxPct) * 10) / 10));
        const nextY = Math.max(0, Math.min(96, Math.round((init.y + dyPct) * 10) / 10));
        setFooterBanner({ ...init, x: nextX, y: nextY });
      } else {
        const nextW = Math.max(
          25,
          Math.min(100 - init.x, Math.round((init.w + dxPct) * 10) / 10),
        );
        setFooterBanner({ ...init, w: nextW });
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const phaseMeta = {
    lobby: {
      label: '🚦 CHỜ VÀO ĐUA',
      badge: 'bg-sky-500/90 text-white',
      sub: 'Follow để vào đua. Đã Follow thì gửi một bình luận bất kỳ.',
    },
    racing: {
      label: `🔥 VÒNG ${leaderLap}/${totalLaps}`,
      badge: 'bg-emerald-500/90 text-slate-950',
      sub: 'Thả tim & tặng quà để bứt tốc ôm cua! Người mới vào được tăng tốc nhập cuộc!',
    },
    countdown: {
      label: '🏁 VỀ ĐÍCH',
      badge: 'bg-rose-500/95 text-white animate-pulse',
      sub: 'Đã có người hoàn thành đủ vòng! Tranh Top 3 ngay!',
    },
    podium: {
      label: '🏆 VINH DANH',
      badge: 'bg-amber-400 text-slate-950',
      sub: 'Chúc mừng Top 3! Chuẩn bị ván mới...',
    },
  }[phase];

  // Khung Sân Khấu 9:16 sạch sẽ dùng chung cho Chế Độ Live (/?view=stage) và Preview trong Dashboard
  const stageView = (
    <div className="relative h-full aspect-[9/16] max-w-full bg-slate-900 overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.85)] border-x border-white/10">
      {/* Cảnh 3D Three.js Đường Đua Uốn Lượn & Smart Race Camera Director */}
      <Race3DCanvas
        racersRef={racersRef}
        spectatorsRef={spectatorsRef}
        phaseRef={phaseRef}
        timerRef={timerRef}
        cameraDirectorRef={cameraDirectorRef}
        stepPhysics={stepPhysics}
        droneCamOn={droneCamOn}
        droneRect={droneRect}
        onDroneRectChange={setDroneRect}
        canEditDrone={!IS_STAGE}
        graphicsQuality={graphicsQuality}
        timeOfDayMode={timeOfDayMode}
        onFpsSample={reportStageFps}
      />

      {/* Khung Webcam Chủ Phòng PiP (Mặc định Tắt — Chỉ xin quyền camera audio:false khi bật chủ động) */}
      <HostWebcamPip
        enabled={webcamEnabled}
        rect={webcamRect}
        onRectChange={setWebcamRect}
        canEdit={!IS_STAGE}
        captureRealVideo={IS_STAGE}
        onStatusChange={setWebcamStatus}
      />

      {/* Nút Kích Hoạt Chế Độ Live trên Stage (mở khóa AudioContext + Screen Wake Lock bằng thao tác click thật) */}
      {IS_STAGE && !liveModeStarted && (
        <div className="absolute inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="max-w-[320px] w-full rounded-2xl bg-slate-900/95 border-2 border-rose-500/80 p-5 text-center shadow-[0_0_50px_rgba(244,63,94,0.45)] flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-rose-600/20 border border-rose-400/60 flex items-center justify-center text-2xl">
              {IS_BROWSER_SOURCE ? '🌐' : '🔴'}
            </div>
            <div className="text-sm font-black text-white">
              {IS_BROWSER_SOURCE
                ? 'Browser Source — Mở Khóa Âm Thanh'
                : 'Sẵn Sàng Phát Sóng Trực Tiếp (9:16)'}
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              {IS_BROWSER_SOURCE ? (
                <>
                  Trình duyệt nhúng đang tạm khóa tự động phát tiếng. Bấm <b>Interact (Tương tác)</b>{' '}
                  trong OBS / TikTok LIVE Studio rồi nhấn nút bên dưới 1 lần để mở{' '}
                  <b>Audio Master Bus</b>.
                </>
              ) : (
                <>
                  Nhấn nút bên dưới để mở khóa <b>Audio Master Bus</b> (BGM + SFX + MC TTS), kích
                  hoạt <b>Screen Wake Lock</b> và bắt đầu gửi nhịp tim sức khỏe về Bảng Điều Khiển.
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => void startStageLiveMode()}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 hover:brightness-110 text-slate-950 text-xs font-black tracking-wide shadow-lg transition cursor-pointer"
            >
              {IS_BROWSER_SOURCE ? '🔊 MỞ KHÓA ÂM THANH & VÀO LIVE' : '🔴 BẮT ĐẦU CHẾ ĐỘ LIVE'}
            </button>
          </div>
        </div>
      )}

      {/* ==================== TOP HUD (Bố cục chuẩn ảnh tham chiếu: Mini Map + Danh sách bên trái, LAP giữa, MC & Trạng thái bên phải) ==================== */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 z-20 pt-2.5 px-2.5 pb-2 flex flex-col gap-1.5">
        {/* Hàng trên cùng: Ván / LAP ở giữa + MC đang bình luận & Số người chơi bên phải */}
        <div className="flex items-start justify-between gap-2">
          {/* Góc Trái Trên: Mini Map trong suốt không khung nặng + Danh sách tay đua siêu gọn ngay bên dưới */}
          {phase !== 'podium' ? (
            <div className="flex flex-col items-start gap-1">
              {/* Mini Map trong suốt (giống ảnh tham chiếu) */}
              <div className="w-[96px] h-[70px] relative drop-shadow-[0_2px_6px_rgba(0,0,0,0.85)]">
                <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
                  <path
                    d={minimapPath}
                    fill="none"
                    stroke="rgba(15,23,42,0.75)"
                    strokeWidth="9"
                    strokeLinejoin="round"
                  />
                  <path
                    d={minimapPath}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="4.2"
                    strokeLinejoin="round"
                  />
                  <circle
                    cx={startDot.x}
                    cy={startDot.y}
                    r="4.6"
                    fill="#f8fafc"
                    stroke="#0f172a"
                    strokeWidth="1.6"
                  />
                  {minimapDots.map((d) => (
                    <g key={d.id}>
                      {d.isSpotlight && (
                        <circle
                          cx={d.x}
                          cy={d.y}
                          r="7.4"
                          fill="none"
                          stroke="#facc15"
                          strokeWidth="2.2"
                        />
                      )}
                      <circle
                        cx={d.x}
                        cy={d.y}
                        r={d.isTop1 || d.isSpotlight ? 4.6 : 2.8}
                        fill={d.isTop1 ? '#facc15' : d.color}
                        stroke={d.isTop1 ? '#0f172a' : '#ffffff'}
                        strokeWidth={d.isTop1 ? 1.5 : 0.8}
                      />
                    </g>
                  ))}
                </svg>
              </div>

              {/* Danh sách tay đua siêu gọn xếp dọc ngay dưới Mini Map (phong cách ảnh tham chiếu) */}
              {top5.length > 0 && (
                <div className="pointer-events-auto w-[124px] flex flex-col gap-[2px] overflow-y-auto pr-0.5">
                  {top5.map((r) => (
                    <div
                      key={r.id}
                      className={`flex items-center gap-1 px-1.5 py-[1.5px] rounded-md backdrop-blur-sm text-[8.5px] leading-tight shadow ${r.rank === 1
                          ? 'bg-amber-500/80 text-slate-950 font-black border border-yellow-200/70'
                          : focusedRacer?.id === r.id
                            ? 'bg-sky-500/75 text-white font-bold border border-sky-200/70'
                            : 'bg-slate-950/60 text-white/95 border border-white/10'
                        }`}
                    >
                      <span className="w-3 text-center font-black shrink-0">{r.rank}</span>
                      <img
                        src={r.avatar}
                        alt={r.nickname}
                        className="w-3 h-3 rounded-full object-cover bg-slate-800 shrink-0 border border-white/50"
                      />
                      <span className="flex-1 truncate font-semibold">
                        {r.boost === 'dragon'
                          ? '🐉'
                          : r.boost === 'superman'
                            ? '🦸'
                            : r.boost === 'rocket'
                              ? '🚀'
                              : r.boost === 'jetpack'
                                ? '🎒'
                                : ''}
                        {r.nickname}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div />
          )}

          {/* Giữa Trên: LAP X/Y nổi bật sạch sẽ (giống ảnh tham chiếu) */}
          <div className="flex flex-col items-center gap-0.5 pt-0.5">
            <div className="text-base font-black tracking-wider text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
              {phase === 'lobby'
                ? `CHỜ ĐUA · ${timerSec}s`
                : phase === 'podium'
                  ? `🏆 VÁN #${matchNo}`
                  : `LAP ${leaderLap}/${totalLaps}`}
            </div>
            <div className="flex items-center gap-1">
              <span className="px-1.5 py-[1px] rounded bg-slate-950/70 border border-white/15 text-[8.5px] font-bold text-amber-300">
                {activeMap.emoji} {activeLapKm.toFixed(2)}km · {timerSec}s
              </span>
            </div>
          </div>

          {/* Góc Phải Trên: Biểu tượng MC đang bình luận (không hiện chữ gây rối) + Camera + Số người */}
          <div className="pointer-events-auto flex flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              {/* Chỉ báo MC đang bình luận bằng sóng âm (không hiện text dài) */}
              <div
                title={isMcSpeaking ? 'MC đang bình luận trực tiếp' : 'MC đang sẵn sàng'}
                className={`flex items-center gap-1 px-2 py-1 rounded-full border backdrop-blur-md transition-all ${isMcSpeaking
                    ? 'bg-amber-400/90 border-yellow-100 text-slate-950 shadow-[0_0_12px_rgba(251,191,36,0.8)]'
                    : 'bg-slate-950/65 border-white/15 text-slate-300'
                  }`}
              >
                <span className="text-[10px]">🎙️</span>
                <span className="text-[9px] font-black tracking-wide">MC</span>
                <span className="flex items-end gap-[1.5px] h-2.5">
                  <span
                    className={`w-[2px] rounded-full ${isMcSpeaking ? 'h-2.5 bg-slate-950 animate-pulse' : 'h-1 bg-slate-500'
                      }`}
                  />
                  <span
                    className={`w-[2px] rounded-full ${isMcSpeaking ? 'h-1.5 bg-slate-950 animate-bounce' : 'h-1.5 bg-slate-500'
                      }`}
                  />
                  <span
                    className={`w-[2px] rounded-full ${isMcSpeaking ? 'h-2.5 bg-slate-950 animate-pulse' : 'h-1 bg-slate-500'
                      }`}
                  />
                </span>
              </div>

              <div className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-slate-950/70 border border-white/15 text-[10px] font-bold">
                <Users className="w-3 h-3 text-sky-400" />
                <span>{racerCount}</span>
              </div>
              {IS_STAGE && !IS_BROWSER_SOURCE && (
                <>
                  <button
                    onClick={() => setWebcamEnabled(!webcamEnabled)}
                    title={webcamEnabled ? 'Tắt Webcam Chủ Phòng' : 'Bật Webcam Chủ Phòng (chỉ hình, không mic)'}
                    className={`p-1 rounded-lg border transition text-[11px] leading-none ${webcamEnabled
                        ? 'bg-rose-600/90 border-rose-300 text-white'
                        : 'bg-slate-950/70 border-white/15 text-slate-300 hover:bg-slate-800'
                      }`}
                  >
                    📷
                  </button>
                  <button
                    onClick={() => handleAudioToggle('bgm')}
                    title="Bật/Tắt nhạc nền"
                    className="p-1 rounded-lg bg-slate-950/70 border border-white/15 hover:bg-slate-800 transition"
                  >
                    {bgmOn ? (
                      <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                </>
              )}
            </div>
            <span
              className={`px-1.5 py-0.5 rounded-md text-[8.5px] font-black border shadow ${cameraHud.state === 'FRONT_TRACKING'
                  ? 'bg-amber-400/90 text-slate-950 border-yellow-100'
                  : cameraHud.state === 'SIDE_TRACKING'
                    ? 'bg-cyan-400/90 text-slate-950 border-cyan-100'
                    : cameraHud.state === 'OVERVIEW'
                      ? 'bg-indigo-500/90 text-white border-indigo-200'
                      : 'bg-slate-950/65 text-sky-300 border-sky-400/30'
                }`}
            >
              {cameraHud.badgeText}
            </span>
          </div>
        </div>
      </div>

      {/* ==================== THÔNG BÁO QUÀ TẶNG VIP (GỌN KIỂU BROADCAST) ==================== */}
      {vipBanner && (
        <div className="pointer-events-none absolute top-28 left-3 right-3 z-30 flex justify-center">
          <div
            className={`animate-vip-pop w-full rounded-2xl px-3 py-2 border-2 shadow-2xl backdrop-blur-md flex items-center gap-2.5 ${vipBanner.tier === 'dragon'
              ? 'bg-gradient-to-r from-amber-500/95 via-orange-600/95 to-rose-600/95 border-yellow-200 shadow-[0_0_40px_rgba(251,191,36,0.9)]'
              : vipBanner.tier === 'superman'
                ? 'bg-gradient-to-r from-cyan-500/95 via-sky-600/95 to-indigo-600/95 border-cyan-100 shadow-[0_0_36px_rgba(56,189,248,0.9)]'
                : vipBanner.tier === 'rocket'
                  ? 'bg-gradient-to-r from-rose-600/95 to-fuchsia-600/95 border-pink-200 shadow-[0_0_28px_rgba(244,63,94,0.8)]'
                  : 'bg-gradient-to-r from-sky-600/95 to-indigo-600/95 border-sky-200'
              }`}
          >
            <img
              src={vipBanner.avatar}
              alt={vipBanner.nickname}
              className="w-10 h-10 rounded-full border-2 border-white object-cover shrink-0 shadow"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-wider text-yellow-100">
                {vipBanner.tier === 'dragon'
                  ? '🐉 SIÊU QUÀ VIP · CƯỠI RỒNG THẦN (10s)'
                  : vipBanner.tier === 'superman'
                    ? '🦸 HÓA SIÊU NHÂN BAY & HẠ CÁNH CỰC NGẦU (7s)'
                    : vipBanner.tier === 'rocket'
                      ? '🚀 CƯỠI TÊN LỬA SIÊU TỐC (6s)'
                      : '🎒 KÍCH HOẠT JETPACK BAY LƯỚT (4s)'}
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-black text-white truncate">{vipBanner.nickname}</span>
                <span className="text-[11px] font-bold text-white/90 shrink-0">
                  · {vipBanner.giftName} ({vipBanner.coins} xu)
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== BẢNG THÀNH TÍCH TOP 3 NHỎ GỌN (Đặt cao sát mép trên để KHÔNG che bối cảnh & 3 nhân vật trên bục!) ==================== */}
      {phase === 'podium' && podiumTop3.length > 0 && (
        <div className="pointer-events-none absolute top-14 left-2.5 right-2.5 z-30 flex justify-center">
          <div className="w-full max-w-[300px] rounded-xl bg-slate-950/70 border border-amber-300/60 backdrop-blur-md px-2 py-1.5 shadow-xl">
            <div className="flex items-center justify-between text-[9px] font-black tracking-wide mb-1">
              <span className="text-amber-300">🏆 BẢNG THÀNH TÍCH VÁN #{matchNo}</span>
              <span className="text-sky-300">Ván mới: {timerSec}s</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {[podiumTop3[1], podiumTop3[0], podiumTop3[2]].map((w, colIdx) => {
                if (!w) return <div key={colIdx} />;
                const isFirst = w.rank === 1;
                const isSecond = w.rank === 2;
                return (
                  <div
                    key={w.id}
                    className={`flex items-center gap-1 px-1.5 py-1 rounded-lg border ${isFirst
                        ? 'bg-amber-400/25 border-amber-300/70'
                        : isSecond
                          ? 'bg-slate-200/15 border-slate-300/40'
                          : 'bg-orange-500/15 border-orange-400/40'
                      }`}
                  >
                    <img
                      src={w.avatar}
                      alt={w.nickname}
                      className={`w-5 h-5 rounded-full object-cover border shrink-0 ${isFirst
                          ? 'border-amber-300'
                          : isSecond
                            ? 'border-slate-200'
                            : 'border-orange-300'
                        }`}
                    />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div
                        className={`text-[8px] font-black ${isFirst
                            ? 'text-amber-300'
                            : isSecond
                              ? 'text-slate-200'
                              : 'text-orange-300'
                          }`}
                      >
                        {isFirst ? '👑 #1' : isSecond ? '🥈 #2' : '🥉 #3'}
                      </div>
                      <div className="text-[8.5px] font-bold text-white truncate">
                        {w.nickname}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== BOTTOM HUD (Thẻ nhân vật đang quay giống ảnh tham chiếu) ==================== */}
      <div
        className={`pointer-events-none absolute bottom-0 left-0 right-0 z-20 px-3 pt-2 flex flex-col gap-1.5 bg-gradient-to-t from-slate-950/90 via-slate-950/35 to-transparent ${IS_STAGE ? 'pb-14' : 'pb-12'
          }`}
      >
        {/* Các thẻ sự kiện tương tác gọn gàng (tối đa 1 dòng nổi bật nhất) */}
        {feed.length > 0 && (
          <div className="flex flex-col gap-1 items-start max-w-[60%]">
            {feed.slice(0, 1).map((item) => (
              <div
                key={item.id}
                className={`px-2 py-0.5 rounded-full text-[9.5px] font-bold backdrop-blur-md border shadow max-w-full truncate ${item.tone === 'dragon'
                    ? 'bg-amber-500/90 border-yellow-200 text-slate-950'
                    : item.tone === 'rocket'
                      ? 'bg-rose-600/90 border-pink-300 text-white'
                      : item.tone === 'jetpack'
                        ? 'bg-sky-600/90 border-sky-200 text-white'
                        : item.tone === 'sprint'
                          ? 'bg-cyan-500/85 border-cyan-200 text-slate-950'
                          : 'bg-slate-950/75 border-white/20 text-slate-100'
                  }`}
              >
                {item.text}
              </div>
            ))}
          </div>
        )}

        {/* Thẻ Thông Tin Nhân Vật Đang Được Camera Quay Tới (Phong cách Broadcast giống ảnh tham chiếu) */}
        {phase !== 'podium' && focusedRacer && (
          <div className="self-center w-full max-w-[300px] rounded-xl bg-slate-950/75 border border-white/20 backdrop-blur-md px-2.5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.65)] flex items-center gap-2.5">
            <img
              src={focusedRacer.avatar}
              alt={focusedRacer.nickname}
              className="w-10 h-10 rounded-full object-cover border-2 border-white/75 bg-slate-800 shrink-0 shadow"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[11px] font-black text-white truncate">
                <span className="truncate">{focusedRacer.nickname}</span>
                {focusedRacer.petName && (
                  <span className="text-[9px] text-amber-300 shrink-0">{focusedRacer.petName}</span>
                )}
              </div>
              <div className="text-[9px] text-slate-300/90 truncate">
                @{focusedRacer.username || focusedRacer.id} · Lv.{focusedRacer.level || 1}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] font-bold text-slate-200 flex-wrap">
                <span className="font-mono text-white">
                  {Math.round(focusedRacer.speed * 3.6)} KM/H
                </span>
                <span className="text-slate-500">|</span>
                <span>
                  LAP {focusedRacer.lap}/{totalLaps}
                </span>
                <span className="text-slate-500">|</span>
                <span className={focusedRacer.rank === 1 ? 'text-amber-300' : 'text-slate-300'}>
                  {focusedRacer.rank === 1 ? 'Dẫn đầu' : `-${focusedRacer.gapSec.toFixed(1)}s`}
                </span>
                {focusedRacer.boost !== 'none' && (
                  <span className="px-1.5 py-[1px] rounded bg-rose-600 text-white text-[8.5px] font-black uppercase tracking-wider shadow">
                    {focusedRacer.boost === 'dragon'
                      ? 'RỒNG VIP'
                      : focusedRacer.boost === 'superman'
                        ? 'SIÊU NHÂN'
                        : focusedRacer.boost === 'rocket'
                          ? 'ROCKET'
                          : focusedRacer.boost === 'jetpack'
                            ? 'JETPACK'
                            : 'NITRO'}
                  </span>
                )}
              </div>
            </div>
            <div
              className={`shrink-0 text-right font-black leading-none italic drop-shadow ${focusedRacer.rank === 1
                  ? 'text-2xl text-amber-300'
                  : focusedRacer.rank === 2
                    ? 'text-2xl text-slate-200'
                    : focusedRacer.rank === 3
                      ? 'text-2xl text-sky-300'
                      : 'text-xl text-cyan-300'
                }`}
            >
              {focusedRacer.rank}
              <span className="text-[11px] not-italic ml-0.5">
                {focusedRacer.rank === 1
                  ? 'st'
                  : focusedRacer.rank === 2
                    ? 'nd'
                    : focusedRacer.rank === 3
                      ? 'rd'
                      : 'th'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ==================== THANH THÔNG BÁO / HƯỚNG DẪN (Kéo di chuyển & sửa chữ, cỡ chữ trên Dashboard) ==================== */}
      {footerBanner.visible && (
        <div
          ref={footerBannerElRef}
          onPointerDown={!IS_STAGE ? (e) => startFooterBannerDrag(e, 'move') : undefined}
          style={{
            left: `${footerBanner.x}%`,
            top: `${footerBanner.y}%`,
            width: `${footerBanner.w}%`,
            fontSize: `${footerBanner.fontSize}px`,
            lineHeight: 1.35,
          }}
          title={!IS_STAGE ? 'Kéo để di chuyển vị trí thanh hướng dẫn' : undefined}
          className={`absolute z-30 rounded-lg bg-slate-950/75 backdrop-blur-sm px-2.5 py-1 text-center font-bold text-slate-100 whitespace-pre-line break-words select-none shadow-lg ${
            !IS_STAGE
              ? 'pointer-events-auto cursor-grab active:cursor-grabbing border border-dashed border-amber-400/75 hover:border-amber-300'
              : 'pointer-events-none border border-white/15'
          }`}
        >
          {footerBanner.text}
          {!IS_STAGE && (
            <div
              onPointerDown={(e) => startFooterBannerDrag(e, 'resize')}
              title="Kéo để thay đổi độ rộng"
              className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center text-[9px] text-amber-300/90 hover:bg-amber-400/20 rounded-r-lg"
            >
              ⋮
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ==================== 1. CHẾ ĐỘ LIVE (/?view=stage) — CHỈ DÀNH CHO OBS / PRISM / LIVE STUDIO ====================
  if (IS_STAGE) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center overflow-hidden">
        {stageView}
      </div>
    );
  }

  // ==================== 2. BẢNG ĐIỀU KHIỂN STREAMER (/) — TÁCH RIÊNG GIỐNG NPC-ACTION-LIVE ====================
  return (
    <div className="w-screen h-screen bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
      {/* Thanh tiêu đề Dashboard */}
      <header className="shrink-0 h-14 px-4 border-b border-white/10 bg-slate-900/90 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">🏁</span>
          <div>
            <h1 className="text-sm font-black text-white leading-tight">
              Đấu Trường Đua Tốc Độ 3D — Action Race Live (Bảng Điều Khiển)
            </h1>
            <p className="text-[11px] text-slate-400">
              Live Đa Nền Tảng (TikTok & Facebook) · Chỉ trang Chế Độ Live (<code>/?view=stage</code>) phát tiếng
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void copyStageUrl()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/15 text-xs font-bold transition"
          >
            {copiedLink ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" /> Đã copy Link {activeOutputMeta.shortLabel}
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-sky-400" /> Copy Link {activeOutputMeta.shortLabel}
              </>
            )}
          </button>
          <a
            href={stageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 hover:brightness-110 text-slate-950 text-xs font-black shadow transition"
          >
            <Tv className="w-4 h-4" /> Mở Chế Độ Live (9:16)
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* Thân Dashboard 2 cột: Trái = Preview 9:16 | Phải = Toàn bộ điều khiển */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Cột Trái: Màn hình Xem Trước 9:16 */}
        <div className="lg:w-[440px] xl:w-[480px] shrink-0 p-4 flex flex-col items-center justify-center bg-slate-950 border-b lg:border-b-0 lg:border-r border-white/10">
          <div className="h-[480px] lg:h-[calc(100vh-120px)] max-h-[760px] flex items-center justify-center">
            {stageView}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 text-center">
            Xem trước trực tiếp (tự đồng bộ với trang <code className="text-sky-300">/?view=stage</code>)
          </div>
        </div>

        {/* Cột Phải: Các thẻ điều khiển tách biệt */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6">
          <div className="max-w-2xl mx-auto flex flex-col gap-4">
            {/* 0A. Chọn Chế Độ Nguồn Phát (Output Mode — Mở rộng linh hoạt cho Window Capture, Browser Source, URL Stream/RTMP...) */}
            <section className="rounded-2xl bg-slate-900/90 border border-sky-500/35 p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-black text-sky-300 flex items-center gap-2">
                  📡 Chế Độ Nguồn Phát (Output Mode)
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-200 border border-sky-400/35">
                  {activeOutputMeta.icon} {activeOutputMeta.shortLabel}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {BROADCAST_OUTPUT_MODES.map((m) => {
                  const selected = broadcastMode === m.id;
                  const comingSoon = m.status === 'coming_soon';
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setBroadcastMode(m.id)}
                      className={`text-left rounded-xl p-2.5 border transition flex flex-col gap-1 ${
                        selected
                          ? comingSoon
                            ? 'bg-amber-950/45 border-amber-400/70 shadow-[0_0_16px_rgba(251,191,36,0.2)]'
                            : 'bg-sky-950/60 border-sky-400 shadow-[0_0_16px_rgba(56,189,248,0.25)]'
                          : 'bg-slate-950/70 border-white/10 hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-black text-white">
                          {m.icon} {m.shortLabel}
                        </span>
                        {m.badge && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-black shrink-0 ${
                              comingSoon
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                            }`}
                          >
                            {m.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 leading-snug line-clamp-2">
                        {m.description}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Chi tiết cấu hình & URL tương ứng với chế độ nguồn phát đang chọn */}
              <div className="rounded-xl bg-slate-950/80 border border-white/10 p-3 flex flex-col gap-2 text-[11px]">
                <div className="text-slate-200 leading-relaxed">{activeOutputMeta.description}</div>

                {activeOutputMeta.status === 'available' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="flex-1 min-w-0 truncate rounded-lg bg-slate-900 border border-sky-400/30 px-2.5 py-1.5 text-[11px] font-mono text-sky-300">
                      {stageUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyStageUrl()}
                      className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-black transition shrink-0"
                    >
                      {copiedLink ? '✅ Đã copy' : '📋 Copy Link'}
                    </button>
                    {broadcastMode === 'window_capture' && (
                      <a
                        href={stageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-amber-400 hover:brightness-110 text-slate-950 text-[11px] font-black transition shrink-0"
                      >
                        ↗ Mở Stage
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg bg-amber-950/40 border border-amber-400/40 px-3 py-2 text-amber-200">
                    🛠️ <b>Đang chuẩn bị cho Giai đoạn 3 (RTMP / URL Stream):</b> Nhánh{' '}
                    <code>MediaStreamAudioDestinationNode</code> đã được đấu nối sẵn trong{' '}
                    <code>LiveRuntime</code>. Khi kích hoạt Giai đoạn 3, bạn chỉ cần nhập{' '}
                    <b>Server URL</b> + <b>Stream Key</b> ngay tại đây để đẩy luồng trực tiếp.
                  </div>
                )}

                {activeOutputMeta.recommendedSize && (
                  <div className="text-[10.5px] text-slate-400">
                    📐 Khuyến nghị: <b className="text-slate-200">{activeOutputMeta.recommendedSize}</b>
                  </div>
                )}

                <ul className="list-disc pl-4 space-y-0.5 text-[10.5px] text-slate-300">
                  {activeOutputMeta.setupSteps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ul>
              </div>
            </section>

            {/* 0B. Giám Sát Sức Khỏe Phiên Live & Pre-Live Checklist (Dữ Liệu Thực Tế 100%) */}
            <section className="rounded-2xl bg-slate-900/90 border border-emerald-500/35 p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-black text-emerald-300 flex items-center gap-2">
                  🛡️ Giám Sát Sức Khỏe Live & Pre-Live Checklist
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10.5px] font-black border ${!stageOnline
                      ? 'bg-slate-800 text-slate-400 border-white/15'
                      : (checklistProfile.needsVisibleTabCheck &&
                          stageHealth?.visibilityState === 'hidden') ||
                        (stageHealth?.lowFpsStreakSec ?? 0) >= 4
                        ? 'bg-rose-600/90 text-white border-rose-200 animate-pulse'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                    }`}
                >
                  {!stageOnline
                    ? '⚪ Chưa mở trang Stage (/?view=stage)'
                    : checklistProfile.needsVisibleTabCheck &&
                        stageHealth?.visibilityState === 'hidden'
                      ? '🚨 STAGE ĐANG BỊ ẨN / MINIMIZE'
                      : (stageHealth?.lowFpsStreakSec ?? 0) >= 4
                        ? `🚨 TỤT FPS LIÊN TỤC (${stageHealth?.fps} FPS)`
                        : `🟢 ${getBroadcastModeMeta(effectiveOutputMode).shortLabel} · ${stageHealth?.fps ?? 0} FPS`}
                </span>
              </div>

              {/* Cảnh báo đỏ nếu Stage bị ẩn (Window Capture) hoặc tụt FPS kéo dài */}
              {stageOnline &&
                checklistProfile.needsVisibleTabCheck &&
                stageHealth?.visibilityState === 'hidden' && (
                  <div className="rounded-xl bg-rose-950/70 border border-rose-400/70 px-3 py-2 text-xs font-bold text-rose-200">
                    ⚠️ Cửa sổ <code>/?view=stage</code> đang bị ẩn hoặc thu nhỏ (<code>hidden</code>). Trình duyệt sẽ bóp FPS và TikTok LIVE Studio có thể bị đứng hình — hãy giữ cửa sổ Stage luôn hiển thị!
                  </div>
                )}
              {stageOnline && (stageHealth?.lowFpsStreakSec ?? 0) >= 4 && (
                <div className="rounded-xl bg-amber-950/70 border border-amber-400/70 px-3 py-2 text-xs font-bold text-amber-200">
                  ⚠️ FPS dưới 15 liên tục {stageHealth?.lowFpsStreakSec} giây ({stageHealth?.fps} FPS). Hãy hạ Chất Lượng Đồ Họa xuống mức <b>Thấp</b> hoặc <b>Trung Bình</b>!
                </div>
              )}

              {/* Thanh đo sóng âm thực tế từ AnalyserNode trên Stage */}
              <div className="rounded-xl bg-slate-950/75 border border-white/10 px-3 py-2 flex items-center gap-3">
                <span className="text-[11px] font-bold text-slate-300 shrink-0">
                  📊 Sóng âm Master Bus:
                </span>
                <div className="flex-1 h-2.5 rounded-full bg-slate-800 overflow-hidden border border-white/10">
                  <div
                    style={{
                      width: `${stageOnline ? Math.min(100, Math.round((stageHealth?.audioLevel ?? 0) * 100)) : 0}%`,
                      transition: 'width 150ms ease-out',
                    }}
                    className="h-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-500"
                  />
                </div>
                <span className="text-[10.5px] font-mono text-sky-300 w-16 text-right shrink-0">
                  {stageOnline ? `${Math.round((stageHealth?.audioLevel ?? 0) * 100)}%` : 'N/A'}
                </span>
              </div>

              {/* Bảng Pre-Live Checklist đo từ dữ liệu thực tế */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                <div className="flex items-center justify-between rounded-lg bg-slate-950/70 border border-white/10 px-2.5 py-1.5">
                  <span className="text-slate-300">1. Stage hoạt động</span>
                  <span className={stageOnline ? 'text-emerald-400 font-bold' : 'text-amber-300 font-bold'}>
                    {stageOnline
                      ? stageHealth?.outputMode === 'browser_source'
                        ? '✅ OK (Browser Source)'
                        : '✅ Heartbeat OK'
                      : '⚠️ Chưa mở'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-950/70 border border-white/10 px-2.5 py-1.5">
                  <span className="text-slate-300">2. Stage hiển thị</span>
                  <span
                    className={
                      !stageOnline
                        ? 'text-slate-400'
                        : !checklistProfile.needsVisibleTabCheck
                          ? 'text-emerald-400 font-bold'
                          : stageHealth?.visibilityState === 'visible'
                            ? 'text-emerald-400 font-bold'
                            : 'text-rose-400 font-bold'
                    }
                  >
                    {!stageOnline
                      ? '❔ Chưa xác định'
                      : !checklistProfile.needsVisibleTabCheck
                        ? '✅ CEF Render'
                        : stageHealth?.visibilityState === 'visible'
                          ? '✅ Visible'
                          : '🚨 Hidden'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-950/70 border border-white/10 px-2.5 py-1.5">
                  <span className="text-slate-300">3. Audio Master Bus</span>
                  <span
                    className={
                      !stageOnline
                        ? 'text-slate-400'
                        : stageHealth?.audioState === 'running'
                          ? 'text-emerald-400 font-bold'
                          : 'text-amber-300 font-bold'
                    }
                  >
                    {!stageOnline
                      ? '❔ Chưa xác định'
                      : stageHealth?.audioState === 'running'
                        ? '✅ Running'
                        : `⚠️ ${stageHealth?.audioState || 'chưa mở'}`}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-950/70 border border-white/10 px-2.5 py-1.5">
                  <span className="text-slate-300">4. Screen Wake Lock</span>
                  <span
                    className={
                      !stageOnline
                        ? 'text-slate-400'
                        : !checklistProfile.needsWakeLock
                          ? 'text-sky-300 font-bold'
                          : stageHealth?.wakeLockStatus === 'active'
                            ? 'text-emerald-400 font-bold'
                            : 'text-slate-300'
                    }
                  >
                    {!stageOnline
                      ? '❔ Chưa xác định'
                      : !checklistProfile.needsWakeLock
                        ? 'ℹ️ Live Studio / OBS giữ'
                        : stageHealth?.wakeLockStatus === 'active'
                          ? '✅ Đang giữ sáng'
                          : stageHealth?.wakeLockStatus === 'unsupported'
                            ? 'ℹ️ Không hỗ trợ'
                            : '⚠️ Chưa bật'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-950/70 border border-white/10 px-2.5 py-1.5">
                  <span className="text-slate-300">5. FPS thực tế</span>
                  <span
                    className={
                      !stageOnline
                        ? 'text-slate-400'
                        : (stageHealth?.lowFpsStreakSec ?? 0) >= 4
                          ? 'text-rose-400 font-bold'
                          : 'text-emerald-400 font-bold'
                    }
                  >
                    {!stageOnline ? '❔ Chưa xác định' : `✅ ${stageHealth?.fps ?? 0} FPS`}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-950/70 border border-white/10 px-2.5 py-1.5">
                  <span className="text-slate-300">6. TikTok / FB Live</span>
                  <span
                    className={
                      liveStatus.connected || fb?.isConnected
                        ? 'text-emerald-400 font-bold'
                        : 'text-amber-300 font-bold'
                    }
                  >
                    {liveStatus.connected || fb?.isConnected ? '✅ Đã kết nối' : '⚠️ Chưa kết nối'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-950/70 border border-white/10 px-2.5 py-1.5">
                  <span className="text-slate-300">7. Webcam Chủ Phòng</span>
                  <span
                    className={
                      stageHealth?.webcamState === 'active'
                        ? 'text-emerald-400 font-bold'
                        : stageHealth?.webcamState === 'lost' || stageHealth?.webcamState === 'denied'
                          ? 'text-rose-400 font-bold'
                          : 'text-slate-400'
                    }
                  >
                    {!checklistProfile.webcamInWebRecommended && !webcamEnabled
                      ? 'ℹ️ Add Camera trong OBS/LS'
                      : !stageOnline
                        ? webcamEnabled
                          ? '⏳ Đang chờ Stage'
                          : '⏸️ Tắt (Mặc định)'
                        : stageHealth?.webcamState === 'active'
                          ? '✅ Track đang chạy'
                          : stageHealth?.webcamState === 'lost'
                            ? '🚨 Mất tín hiệu'
                            : stageHealth?.webcamState === 'denied'
                              ? '🚨 Chưa cấp quyền'
                              : '⏸️ Tắt (Mặc định)'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-950/70 border border-white/10 px-2.5 py-1.5">
                  <span className="text-slate-300">8. Kiểm tra TTS thật</span>
                  <button
                    type="button"
                    onClick={() => void triggerTtsTest()}
                    disabled={ttsTestResult.status === 'testing'}
                    className={`px-2 py-0.5 rounded font-black text-[10px] transition ${ttsTestResult.status === 'ok'
                        ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/50'
                        : ttsTestResult.status === 'error'
                          ? 'bg-rose-500/25 text-rose-300 border border-rose-400/50'
                          : 'bg-sky-600 hover:bg-sky-500 text-white'
                      }`}
                  >
                    {ttsTestResult.status === 'testing'
                      ? '⏳ Đang test...'
                      : ttsTestResult.status === 'ok'
                        ? `✅ OK (${ttsTestResult.latencyMs}ms)`
                        : ttsTestResult.status === 'error'
                          ? '❌ Lỗi · Thử lại'
                          : '🔊 Test TTS Ngay'}
                  </button>
                </div>
              </div>

              {/* Điều khiển Webcam Chủ Phòng PiP (Mặc định TẮT, chỉ xin quyền camera audio: false khi bật) */}
              <div className="rounded-xl bg-slate-950/75 border border-rose-400/30 p-3 flex flex-col gap-2 text-xs">
                <label className="flex items-center justify-between font-bold cursor-pointer">
                  <span>📷 Bật Webcam Chủ Phòng PiP (chỉ hình, không mic · Kéo thả trên Preview)</span>
                  <input
                    type="checkbox"
                    checked={webcamEnabled}
                    onChange={(e) => setWebcamEnabled(e.target.checked)}
                  />
                </label>
                {webcamEnabled && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10 text-[10.5px]">
                    <span className="text-rose-200">
                      💡 Kéo khung <b>HOST</b> bên trái để di chuyển · Kéo góc <b>⤡</b> để thu phóng
                    </span>
                    <div className="flex gap-1 font-black">
                      <button
                        type="button"
                        onClick={() =>
                          setWebcamRect({
                            ...webcamRect,
                            shape: 'circle',
                            h: Math.round(webcamRect.w * (9 / 16) * 10) / 10,
                          })
                        }
                        className={`px-2 py-1 rounded ${webcamRect.shape === 'circle'
                            ? 'bg-rose-500 text-white'
                            : 'bg-slate-800 text-slate-300'
                          }`}
                      >
                        Tròn
                      </button>
                      <button
                        type="button"
                        onClick={() => setWebcamRect({ ...webcamRect, shape: 'rounded', h: 20 })}
                        className={`px-2 py-1 rounded ${webcamRect.shape === 'rounded'
                            ? 'bg-rose-500 text-white'
                            : 'bg-slate-800 text-slate-300'
                          }`}
                      >
                        Bo góc
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setWebcamRect({ x: 4, y: 63, w: 28, h: 16, shape: 'circle' })
                        }
                        className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {/* Tùy chỉnh Thanh Thông Báo / Hướng Dẫn (Kéo di chuyển trên Preview, sửa chữ & cỡ chữ) */}
              <div className="rounded-xl bg-slate-950/75 border border-amber-400/35 p-3 flex flex-col gap-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 font-bold cursor-pointer text-amber-200">
                    <input
                      type="checkbox"
                      checked={footerBanner.visible}
                      onChange={(e) =>
                        setFooterBanner({ ...footerBanner, visible: e.target.checked })
                      }
                    />
                    <span>📝 Thanh Thông Báo / Hướng Dẫn (Kéo thả vị trí trên Preview)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setFooterBanner({ ...DEFAULT_FOOTER_BANNER })}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-white/15 text-[10.5px] font-bold text-slate-200"
                  >
                    ↺ Mặc định
                  </button>
                </div>

                {footerBanner.visible && (
                  <>
                    <textarea
                      rows={2}
                      value={footerBanner.text}
                      onChange={(e) =>
                        setFooterBanner({ ...footerBanner, text: e.target.value })
                      }
                      placeholder="Nhập nội dung thông báo / hướng dẫn hiển thị trên màn hình Live..."
                      className="w-full rounded-lg bg-slate-900 border border-white/15 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400 resize-y"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                      <label className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-slate-300">
                          <span>🔤 Cỡ chữ</span>
                          <span className="font-mono font-bold text-amber-300">
                            {footerBanner.fontSize}px
                          </span>
                        </div>
                        <input
                          type="range"
                          min={8}
                          max={22}
                          step={0.5}
                          value={footerBanner.fontSize}
                          onChange={(e) =>
                            setFooterBanner({
                              ...footerBanner,
                              fontSize: Number(e.target.value),
                            })
                          }
                          className="accent-amber-400 cursor-pointer"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-slate-300">
                          <span>↔️ Độ rộng khung</span>
                          <span className="font-mono font-bold text-sky-300">
                            {Math.round(footerBanner.w)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={25}
                          max={98}
                          step={1}
                          value={footerBanner.w}
                          onChange={(e) => {
                            const nextW = Number(e.target.value);
                            const clampedX = Math.min(footerBanner.x, 100 - nextW);
                            setFooterBanner({
                              ...footerBanner,
                              w: nextW,
                              x: Math.max(0, Math.round(clampedX * 10) / 10),
                            });
                          }}
                          className="accent-sky-400 cursor-pointer"
                        />
                      </label>
                    </div>
                    <div className="text-[10.5px] text-amber-200/85">
                      💡 Kéo trực tiếp thanh khung viền nét đứt màu vàng bên khung Preview trái để đổi vị trí ({footerBanner.x}%, {footerBanner.y}%) · Kéo mép phải <b>⋮</b> để chỉnh độ rộng.
                    </div>
                  </>
                )}
              </div>
            </section>
            <section className="rounded-2xl bg-slate-900/90 border border-white/10 p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-black flex items-center gap-2">
                  {liveStatus.connected || fb?.isConnected ? (
                    <Wifi className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-slate-400" />
                  )}
                  Kết nối Livestream (TikTok LIVE & Facebook Live)
                </h2>
                <span className="text-[11px] text-slate-400">
                  💡 Có thể kết nối <b>cả TikTok + Facebook cùng lúc</b>
                </span>
              </div>

              {/* Thanh chọn nền tảng */}
              <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
                <button
                  type="button"
                  onClick={() => switchPlatform('tiktok')}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-black transition ${platformTab === 'tiktok'
                      ? 'bg-gradient-to-r from-pink-600 to-rose-500 text-white shadow-lg shadow-rose-950/50'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                >
                  <span>🎵 TikTok LIVE</span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${liveStatus.connected ? 'bg-emerald-400 ring-2 ring-emerald-200' : 'bg-slate-500'
                      }`}
                  />
                </button>

                <button
                  type="button"
                  onClick={() => switchPlatform('facebook')}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-black transition ${platformTab === 'facebook'
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-950/50'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                >
                  <span>🔵 Facebook Live</span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${fb?.isConnected ? 'bg-emerald-400 ring-2 ring-emerald-200' : 'bg-slate-500'
                      }`}
                  />
                </button>
              </div>

              {platformTab === 'tiktok' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tiktokIdInput}
                      onChange={(e) => setTiktokIdInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void handleConnectTikTok()}
                      placeholder="username TikTok (không cần @)"
                      className="flex-1 rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-400"
                    />
                    <button
                      onClick={() => void handleConnectTikTok()}
                      disabled={busy || !tiktokIdInput.trim()}
                      className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 text-xs font-black transition"
                    >
                      {busy ? 'Đang nối...' : 'Kết nối TikTok'}
                    </button>
                    <button
                      onClick={() => void disconnectTikTok()}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold transition"
                    >
                      Ngắt
                    </button>
                  </div>
                  <div className="text-xs">
                    Trạng thái TikTok:{' '}
                    {liveStatus.connected ? (
                      <span className="text-emerald-400 font-bold">
                        Đang live @{liveStatus.username} · {liveStatus.viewerCount} người xem ·{' '}
                        {liveStatus.totalLikes || 0} tim
                      </span>
                    ) : liveStatus.connecting ? (
                      <span className="text-amber-400 font-bold">Đang kết nối...</span>
                    ) : (
                      <span className="text-slate-400">Chưa kết nối</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-400">Chế độ kết nối FB:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setFbMode('bridge');
                        try {
                          localStorage.setItem('fbMode', 'bridge');
                        } catch { }
                      }}
                      className={`rounded-lg px-2.5 py-1.5 font-bold transition ${fbMode === 'bridge'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                    >
                      ⚡ Cầu nối Trình duyệt (Khuyên dùng - Không cần Token)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFbMode('graph');
                        try {
                          localStorage.setItem('fbMode', 'graph');
                        } catch { }
                      }}
                      className={`rounded-lg px-2.5 py-1.5 font-bold transition ${fbMode === 'graph'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                    >
                      🔑 Facebook Graph API (Dùng Access Token)
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={fbVideoId}
                      onChange={(e) => setFbVideoId(e.target.value)}
                      placeholder="Dán Link buổi Live Facebook hoặc Video ID (vd: https://www.facebook.com/watch/live/?v=...)"
                      className="min-w-0 flex-1 rounded-xl bg-slate-950 border border-white/15 px-3 py-2 text-xs text-white"
                    />
                    <button
                      onClick={() => void handleConnectFacebook()}
                      disabled={fbBusy || (fbMode === 'graph' && (!fbVideoId.trim() || !fbToken.trim()))}
                      className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 text-xs font-black transition"
                    >
                      {fbBusy
                        ? 'Đang nối...'
                        : fbMode === 'bridge'
                          ? '🔵 Bật Cầu Nối FB'
                          : '🔵 Kết nối Graph API'}
                    </button>
                    <button
                      onClick={() => void disconnectFacebook()}
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold transition"
                    >
                      Ngắt FB
                    </button>
                  </div>

                  {fbMode === 'graph' ? (
                    <div className="space-y-2 rounded-xl bg-slate-950/70 p-3 border border-white/10">
                      <input
                        type="password"
                        value={fbToken}
                        onChange={(e) => setFbToken(e.target.value)}
                        placeholder="Facebook Page / User Access Token (EAAB...)"
                        className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs text-white border border-white/10"
                      />
                      <p className="text-[11px] text-slate-400">
                        Tự động lấy bình luận trực tiếp (mỗi 2 giây), lượt người xem, cảm xúc (👍 ❤️ 😆) thành Sprint và tặng Sao thành quà tăng tốc!
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-xl bg-blue-950/35 p-3 border border-blue-800/50">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const targetUrl = fbVideoId.trim().startsWith('http')
                              ? fbVideoId.trim()
                              : fbVideoId.trim()
                                ? `https://www.facebook.com/watch/live/?v=${encodeURIComponent(fbVideoId.trim())}`
                                : 'https://www.facebook.com/watch/live/';
                            if (!fb?.isConnected) void handleConnectFacebook('bridge');
                            try {
                              const res = await fetch('/api/facebook/launch-auto-browser', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ url: targetUrl }),
                              });
                              const j = await res.json();
                              if (j?.success) {
                                setConnMsg('🚀 Đã mở trình duyệt tự động nạp sẵn Tiện ích chạy ngầm (Không cần bấm F12)!');
                                return;
                              }
                            } catch { }
                            openFbLiveWindow();
                            setConnMsg(
                              '💡 Để chạy ngầm 100% không cần bấm F12: hãy nhấp đúp file MO-FACEBOOK-TU-DONG.bat hoặc tải gói Extension (.zip) bên cạnh nạp vào chrome://extensions.',
                            );
                          }}
                          className="rounded-lg bg-gradient-to-r from-emerald-400 to-teal-500 px-3 py-1.5 text-xs font-black text-slate-950 shadow hover:brightness-110"
                        >
                          🚀 Mở Trình Duyệt Tự Động Chạy Ngầm (Không cần F12)
                        </button>
                        <a
                          href="/api/extension/download"
                          className="rounded-lg bg-amber-400/90 hover:bg-amber-300 px-2.5 py-1.5 text-xs font-black text-slate-950"
                        >
                          📦 Tải Extension (.zip)
                        </a>
                        <button
                          type="button"
                          onClick={openFbLiveWindow}
                          className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-blue-500"
                        >
                          🌐 Mở bài Facebook Live
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            window.open('https://www.facebook.com/live/producer', 'fb_live_bridge_win');
                            if (!fb?.isConnected) void handleConnectFacebook('bridge');
                          }}
                          className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-500"
                        >
                          🎥 Mở FB Live Producer
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void ingestFbEvent({
                              nickname: 'Hoàng Long FB',
                              comment: 'Cho mình vào đường đua với!',
                            })
                          }
                          className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                        >
                          💬 Thử 1 bình luận FB
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void ingestFbEvent({
                              nickname: 'Hoàng Long FB',
                              likes: 3,
                            })
                          }
                          className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-rose-300 hover:bg-slate-700"
                        >
                          ❤️ Thử Thả Tim / Like FB
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void ingestFbEvent({
                              nickname: 'Hoàng Long FB',
                              giftName: '🚀 Tên Lửa Facebook',
                              coins: 25,
                            })
                          }
                          className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-sky-300 hover:bg-slate-700"
                        >
                          🎁 Thử Quà FB (Rocket)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void ingestFbEvent({
                              nickname: 'Hoàng Long FB',
                              stars: 100,
                            })
                          }
                          className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-amber-300 hover:bg-slate-700"
                        >
                          ⭐ Thử tặng 100 Sao FB
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyFbBridgeScript()}
                          className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                        >
                          {copiedBridge ? '✅ Đã Copy mã dự phòng!' : '📋 Copy mã F12 (Dự phòng)'}
                        </button>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-300">
                        <b>⚡ Chạy ngầm tự động 100% — KHÔNG CẦN bấm F12:</b> Nhấp đúp{' '}
                        <code className="rounded bg-slate-900 px-1.5 py-0.5 text-emerald-300">
                          MO-FACEBOOK-TU-DONG.bat
                        </code>{' '}
                        hoặc cài{' '}
                        <code className="rounded bg-slate-900 px-1.5 py-0.5 text-amber-300">
                          tools/fb-live-extension
                        </code>{' '}
                        vào <code className="text-blue-300">chrome://extensions</code> để tự động bắt bình luận & Sao Facebook ngầm dưới nền!
                      </p>
                    </div>
                  )}

                  <div className="text-xs">
                    Trạng thái Facebook:{' '}
                    {fb?.isConnected ? (
                      <span className="text-emerald-400 font-bold">
                        Đang kết nối ({fb.mode === 'graph' ? 'Graph API' : 'Cầu nối Trình duyệt'}) ·{' '}
                        {fb.pageName} · <b>{fb.commentsReceived}</b> bình luận ·{' '}
                        <b>{fb.totalReactions}</b> cảm xúc
                      </span>
                    ) : fb?.isConnecting ? (
                      <span className="text-amber-400 font-bold">Đang kết nối Facebook Live...</span>
                    ) : (
                      <span className="text-slate-400">Chưa kết nối Facebook Live</span>
                    )}
                  </div>
                </div>
              )}

              {(liveStatus.connected || fb?.isConnected) && (
                <div className="flex flex-wrap gap-3 rounded-lg bg-emerald-950/40 px-3 py-1.5 text-xs text-emerald-300 border border-emerald-800/50">
                  <span>🟢 Nguồn đang hoạt động:</span>
                  {liveStatus.connected && <b>🎵 TikTok (@{liveStatus.username})</b>}
                  {fb?.isConnected && <b>🔵 Facebook ({fb.pageName || fb.videoId})</b>}
                </div>
              )}

              {(connMsg || liveStatus.error || fb?.error) && (
                <p className="text-xs font-semibold text-amber-300">
                  {connMsg || liveStatus.error || fb?.error}
                </p>
              )}

              {/* Hướng dẫn cách Join vào Game & Ô Thêm Nhanh Tay Đua */}
              <div className="rounded-xl bg-slate-950/80 border border-sky-400/30 p-3 flex flex-col gap-2 text-xs">
                <div className="font-black text-sky-300">
                  🏃 Cách Tham Gia Vào Đường Đua (Tự động 100% khi đang Live):
                </div>
                <ul className="text-[11px] text-slate-300 space-y-1 list-disc list-inside leading-relaxed">
                  <li>
                    <b>TikTok:</b> Bấm <b>Follow</b> để vào đua ngay. Nếu đã Follow, gửi một bình luận bất kỳ. <b>Facebook Live:</b> Gửi một bình luận để vào đua.
                  </li>
                  <li>
                    <b>Cách 2 (Chủ phòng / Thêm tay đua thủ công):</b> Khi bấm <b>Kết nối TikTok</b>, nhân vật của chủ kênh tự động vào sân. Hoặc gõ tên bất kỳ vào ô dưới đây để cho vào đua ngay:
                  </li>
                </ul>
                <div className="flex gap-2 pt-0.5">
                  <input
                    type="text"
                    value={quickJoinName}
                    onChange={(e) => setQuickJoinName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && quickJoinName.trim()) {
                        const name = quickJoinName.trim().replace(/^@+/, '');
                        const uid = name.normalize('NFKD').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || `user_${Date.now()}`;
                        void fetch('/api/test/emit', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            type: 'chat',
                            data: {
                              userId: uid,
                              username: uid,
                              nickname: name,
                              comment: 'Vào đua',
                              isFollower: true,
                              platform: platformTab,
                            },
                          }),
                        });
                        setQuickJoinName('');
                      }
                    }}
                    placeholder="Nhập Tên hoặc @username để cho vào đua ngay (vd: Phùng Quý)..."
                    className="flex-1 rounded-lg bg-slate-900 border border-white/15 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const raw = (quickJoinName.trim() || tiktokIdInput.trim() || 'Chủ Phòng Live').replace(/^@+/, '');
                      const uid = raw.normalize('NFKD').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || `user_${Date.now()}`;
                      void fetch('/api/test/emit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: 'chat',
                          data: {
                            userId: uid,
                            username: uid,
                            nickname: raw,
                            comment: 'Vào đua',
                            isFollower: true,
                            platform: platformTab,
                          },
                        }),
                      });
                      setQuickJoinName('');
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black transition whitespace-nowrap"
                  >
                    ➕ Vào Đua Ngay
                  </button>
                </div>
              </div>

              {/* Hộp Link Stage Đa Nền Tảng chống quét AI (chuẩn npc-action-live) */}
              <div className="space-y-1.5 rounded-xl bg-slate-950/75 p-2.5 text-[11px] text-slate-300 border border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-black text-emerald-300">
                    🛡️ Link Stage Đa Nền Tảng chống quét AI (1080 × 1920):
                  </span>
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/40">
                    Giao diện trung tính · Phát đồng thời TikTok & Facebook
                  </span>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-3">
                  <div className="rounded-lg bg-slate-900/90 p-2 border border-white/10">
                    <div className="font-bold text-amber-300">⭐ Đa nền tảng (Khuyên dùng)</div>
                    <code className="mt-0.5 block select-all truncate text-[10.5px] text-slate-200">
                      {stageUrl}
                    </code>
                  </div>
                  <div className="rounded-lg bg-slate-900/90 p-2 border border-white/10">
                    <div className="font-bold text-pink-300">🎵 Riêng TikTok</div>
                    <code className="mt-0.5 block select-all truncate text-[10.5px] text-slate-200">
                      {stageUrl}&platform=tiktok
                    </code>
                  </div>
                  <div className="rounded-lg bg-slate-900/90 p-2 border border-white/10">
                    <div className="font-bold text-blue-300">🔵 Riêng Facebook</div>
                    <code className="mt-0.5 block select-all truncate text-[10.5px] text-slate-200">
                      {stageUrl}&platform=facebook
                    </code>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. Thiết lập Đường Đua & Ván Đấu */}
            <section className="rounded-2xl bg-slate-900/90 border border-white/10 p-4 flex flex-col gap-3">
              <h2 className="text-sm font-black text-sky-300">🏁 Thiết Lập Đường Đua & Ván Đấu</h2>

              {/* Chọn Bản Đồ Đường Đua (4 Maps) */}
              <div className="flex flex-col gap-2 bg-slate-950/70 rounded-xl p-3 border border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-amber-400" />
                    Chọn Bản Đồ Đường Đua (4 Maps)
                  </span>
                  {phase !== 'lobby' && (
                    <span className="text-[10.5px] font-semibold text-amber-300">
                      Áp dụng từ ván kế tiếp
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {MAPS.map((m) => {
                    const selected = mapId === m.id;
                    const lapKm = getMapLapKm(m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => changeMap(m.id)}
                        className={`text-left rounded-xl p-2.5 border transition ${selected
                            ? 'bg-amber-400/20 border-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.2)]'
                            : 'bg-slate-900/80 border-white/10 hover:bg-slate-800'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-black text-white">
                            {m.emoji} {m.name}
                          </span>
                          {selected && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[9px] font-black">
                              ĐANG CHỌN
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[10.5px] font-bold text-sky-300">
                          <span>📏 {lapKm.toFixed(2)} km / vòng</span>
                          <span className="text-slate-500">·</span>
                          <span className="text-amber-300">
                            Tổng {(lapKm * totalLaps).toFixed(2)} km
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10.5px] text-slate-400 leading-snug">{m.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/70 rounded-xl p-3 border border-white/10">
                <span className="text-xs font-bold">Số vòng đua (mặc định 3 vòng):</span>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setTotalLaps(n)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition ${totalLaps === n
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                    >
                      {n} vòng
                    </button>
                  ))}
                </div>
              </div>

              {/* Chọn Thời Gian Đua Tối Đa */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/70 rounded-xl p-3 border border-white/10">
                <span className="text-xs font-bold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  Thời gian đua tối đa:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { sec: 90, label: '90s' },
                    { sec: 120, label: '2 phút' },
                    { sec: 180, label: '3 phút' },
                    { sec: 240, label: '4 phút' },
                    { sec: 300, label: '5 phút' },
                  ].map((opt) => (
                    <button
                      key={opt.sec}
                      onClick={() => setRaceDuration(opt.sec)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition ${raceDuration === opt.sec
                          ? 'bg-emerald-400 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tự động cho nhân vật rời đường đua khi người chơi rời phiên live (không tương tác quá ngưỡng AFK) */}
              <div className="flex flex-col gap-1.5 bg-slate-950/70 rounded-xl p-3 border border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-200">
                    👋 Tự động Out nhân vật khi rời Live (không tương tác):
                  </span>
                  <span className="text-[10.5px] font-bold text-amber-300">
                    {afkTimeoutSec === 0 ? 'Đang tắt' : `${Math.round(afkTimeoutSec / 60)} phút`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { sec: 180, label: '3 phút (Đông người)' },
                    { sec: 300, label: '5 phút ⭐ Khuyến nghị' },
                    { sec: 600, label: '10 phút (Thoải mái)' },
                    { sec: 0, label: 'Tắt' },
                  ].map((opt) => (
                    <button
                      key={opt.sec}
                      type="button"
                      onClick={() => setAfkTimeoutSec(opt.sec)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition ${
                        afkTimeoutSec === opt.sec
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10.5px] text-slate-400">
                  Khi người chơi bị Out quay lại phiên live, MC sẽ tự động chào và nhắc nhắn 1 tin bất kỳ để vào lại đường đua.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-xs font-bold">
                <button
                  onClick={skipPhase}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 transition"
                >
                  <SkipForward className="w-4 h-4" /> Chuyển pha ngay
                </button>
                <button
                  onClick={resetMatch}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 transition"
                >
                  <RotateCcw className="w-4 h-4" /> Reset ván mới
                </button>
              </div>

              {/* Bộ chọn 4 Chế Độ Camera Đạo Diễn chuẩn Roblox Style Racing */}
              <div className="flex flex-col gap-2 bg-slate-950/80 rounded-xl p-3 border border-amber-400/30">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-amber-300">
                    🎥 Chế Độ Camera 3D (Roblox Style Racing Spec):
                  </span>
                  <span className="text-[10.5px] font-bold text-sky-300">
                    Đang quay: {cameraHud.badgeText}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[11px] font-black">
                  {(
                    [
                      {
                        id: 'auto',
                        label: '🎬 Tự Động',
                        desc: 'Đạo diễn AI (Kết hợp các Mode đã chọn)',
                      },
                      {
                        id: 'chase',
                        label: '🏃 Mode A: Chase',
                        desc: 'Phía sau nhân vật (Mặc định)',
                      },
                      {
                        id: 'front',
                        label: '🤳 Mode B: Front',
                        desc: 'Chính diện lùi theo nhân vật',
                      },
                      {
                        id: 'side',
                        label: '🏎️ Mode C: Side',
                        desc: 'Song song ngang hông',
                      },
                      {
                        id: 'overview',
                        label: '🚁 Mode D: Overview',
                        desc: 'Toàn cảnh từ trên cao',
                      },
                    ] as const
                  ).map((m) => {
                    const active = cameraMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setCameraMode(m.id)}
                        className={`rounded-xl p-2 text-left border transition flex flex-col justify-between ${active
                            ? 'bg-amber-400 text-slate-950 border-yellow-100 shadow-[0_0_16px_rgba(251,191,36,0.45)]'
                            : 'bg-slate-900/90 text-slate-200 border-white/10 hover:bg-slate-800'
                          }`}
                      >
                        <div>{m.label}</div>
                        <div
                          className={`mt-0.5 text-[9.5px] font-semibold leading-tight ${active ? 'text-slate-900' : 'text-slate-400'
                            }`}
                        >
                          {m.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Cài đặt lựa chọn các Mode Camera được phép tham gia vào chế độ Đạo Diễn AI */}
                {cameraMode === 'auto' && (
                  <div className="mt-1 pt-2 border-t border-white/10 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[10.5px]">
                      <span className="font-bold text-amber-200">
                        🤖 Chọn các góc máy tham gia Đạo Diễn AI (tự luân phiên & theo sự kiện):
                      </span>
                      <span className="text-[10px] text-slate-400">Giữ ít nhất 1 góc</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10.5px] font-bold">
                      {(
                        [
                          { key: 'chase', label: '🏃 Chase (Phía sau)' },
                          { key: 'front', label: '🤳 Front (Chính diện)' },
                          { key: 'side', label: '🏎️ Side (Góc ngang)' },
                          { key: 'overview', label: '🚁 Overview (Toàn cảnh)' },
                        ] as const
                      ).map((opt) => {
                        const checked = aiCameraModes[opt.key];
                        return (
                          <label
                            key={opt.key}
                            className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer transition ${checked
                                ? 'bg-amber-400/20 border-amber-300/70 text-amber-100'
                                : 'bg-slate-900/70 border-white/10 text-slate-400 hover:bg-slate-800'
                              }`}
                          >
                            <span className="truncate">{opt.label}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAiCameraMode(opt.key)}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Nút điều chỉnh Chất Lượng Đồ Họa (Bóng thật, Cây cối, Cỏ lá) phù hợp cấu hình máy */}
              <div className="flex flex-col gap-2 bg-slate-950/80 rounded-xl p-3 border border-emerald-400/30">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-emerald-300">
                    🎨 Chất Lượng Đồ Họa (Bóng thật · Cây cối · Cỏ lá):
                  </span>
                  <span className="text-[10px] text-slate-400">Đồng bộ trực tiếp sang Live</span>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-[11px] font-black">
                  {(
                    [
                      {
                        id: 'low',
                        label: '⚡ Thấp (Nhẹ máy)',
                        desc: '30 fps · 28 tay đua hiển thị · Tắt bóng và drone',
                      },
                      {
                        id: 'medium',
                        label: '⚖️ Trung Bình',
                        desc: '44 tay đua hiển thị · Bóng 1024px',
                      },
                      {
                        id: 'high',
                        label: '✨ Cao',
                        desc: '60 tay đua hiển thị · Bóng 2048px',
                      },
                      {
                        id: '4k',
                        label: '4K UHD',
                        desc: 'Canvas đến 2160 × 3840 ở Stage dọc · Bóng 4096px',
                      },
                    ] as const
                  ).map((q) => {
                    const active = graphicsQuality === q.id;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setGraphicsQuality(q.id)}
                        className={`rounded-xl p-2 text-left border transition ${active
                            ? 'bg-emerald-400 text-slate-950 border-emerald-100 shadow-[0_0_14px_rgba(52,211,153,0.4)]'
                            : 'bg-slate-900/90 text-slate-200 border-white/10 hover:bg-slate-800'
                          }`}
                      >
                        <div>{q.label}</div>
                        <div
                          className={`mt-0.5 text-[9.5px] font-semibold leading-tight ${active ? 'text-slate-900' : 'text-slate-400'
                            }`}
                        >
                          {q.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Cảnh sắc & Nguồn sáng Vật lý (PBL) thay đổi theo Thời Gian Thực */}
              <div className="flex flex-col gap-2 bg-slate-950/80 rounded-xl p-3 border border-indigo-400/30">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-black text-indigo-300">
                    🌅 Cảnh Sắc & Ánh Sáng PBL Theo Thời Gian Thực:
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Nguồn sáng càng cao → Bóng đổ càng đậm & rõ nét
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px] font-black">
                  {(
                    [
                      { id: 'realtime', label: '🕒 Giờ Thực Tế (24h)', desc: 'Theo đúng đồng hồ ngoài đời' },
                      { id: 'cycle', label: '🔄 Chu Kỳ Nhanh (5p)', desc: 'Tự trôi Sáng → Trưa → Chiều → Đêm' },
                      { id: 'noon', label: '☀️ Giữa Trưa', desc: 'Nắng đỉnh đầu · Bóng siêu rõ' },
                      { id: 'dawn', label: '🌅 Bình Minh', desc: 'Nắng sớm vàng hồng · Bóng dài' },
                      { id: 'sunset', label: '🌇 Hoàng Hôn', desc: 'Chiều rực lửa · Phản xạ mặt đường' },
                      { id: 'night', label: '🌙 Đêm Đầy Sao', desc: 'Ánh trăng & Đèn đường tự bật' },
                    ] as const
                  ).map((m) => {
                    const active = timeOfDayMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setTimeOfDayMode(m.id)}
                        className={`rounded-xl p-2 text-left border transition ${
                          active
                            ? 'bg-indigo-400 text-slate-950 border-indigo-100 shadow-[0_0_14px_rgba(129,140,248,0.4)]'
                            : 'bg-slate-900/90 text-slate-200 border-white/10 hover:bg-slate-800'
                        }`}
                      >
                        <div>{m.label}</div>
                        <div
                          className={`mt-0.5 text-[9.5px] font-semibold leading-tight ${
                            active ? 'text-slate-900' : 'text-slate-400'
                          }`}
                        >
                          {m.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tùy chọn Camera Drone Toàn Cảnh (Kéo thả & Thu phóng trên Preview bên trái) */}
              <div className="flex flex-col gap-2 bg-slate-950/70 rounded-xl p-3 border border-sky-400/30 text-xs">
                <label className="flex items-center justify-between font-semibold cursor-pointer">
                  <span>🚁 Hiển thị Camera Drone toàn cảnh (Kéo thả & thu phóng trên màn Xem Trước)</span>
                  <input
                    type="checkbox"
                    checked={droneCamOn}
                    onChange={(e) => setDroneCamOn(e.target.checked)}
                  />
                </label>
                {droneCamOn && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10">
                    <span className="text-[10.5px] text-sky-300">
                      💡 Kéo khung Drone bên trái để di chuyển · Kéo góc <b>⤡</b> để thu phóng
                    </span>
                    <div className="flex gap-1 text-[10px] font-black">
                      <button
                        type="button"
                        onClick={() => setDroneRect({ x: droneRect.x, y: droneRect.y, w: 26, h: 17 })}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                      >
                        Nhỏ
                      </button>
                      <button
                        type="button"
                        onClick={() => setDroneRect({ x: Math.min(droneRect.x, 64), y: droneRect.y, w: 34, h: 22 })}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                      >
                        Vừa
                      </button>
                      <button
                        type="button"
                        onClick={() => setDroneRect({ x: Math.min(droneRect.x, 52), y: Math.min(droneRect.y, 64), w: 46, h: 29 })}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                      >
                        To
                      </button>
                      <button
                        type="button"
                        onClick={() => setDroneRect({ x: 63, y: 58, w: 34, h: 22 })}
                        className="px-2 py-1 rounded bg-sky-600/80 hover:bg-sky-500 text-white"
                      >
                        Reset vị trí
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <label className="flex items-center justify-between bg-slate-950/70 rounded-xl px-3 py-2.5 border border-white/10 text-xs font-semibold cursor-pointer">
                <span>🤖 Tự động thêm Bot khi ít hơn 10 tay đua</span>
                <input
                  type="checkbox"
                  checked={autoBots}
                  onChange={(e) => setAutoBots(e.target.checked)}
                />
              </label>
            </section>

            {/* 3. Khu Vực Kiểm Thử & Giả Lập (Mock Mode) */}
            <section className="rounded-2xl bg-slate-900/90 border border-white/10 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-amber-300">
                  🎮 Giả Lập Tương Tác (Đồng bộ sang trang Live)
                </h2>
                <span className="text-[11px] text-slate-400">Đang có {racerCount} tay đua</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-bold">
                <button
                  onClick={() => triggerMock('follow_new')}
                  className="py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 transition"
                >
                  🎵 +1 Follow TikTok
                </button>
                <button
                  onClick={() => triggerMock('fb_chat')}
                  className="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 transition"
                >
                  🔵 +1 Chat FB
                </button>
                <button
                  onClick={() => triggerMock('chat_10')}
                  className="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition"
                >
                  👥 +10 Tay Đua
                </button>
                <button
                  onClick={() => triggerMock('like')}
                  className="py-2.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 transition"
                >
                  ❤️ Tap Sprint (2s)
                </button>
                <button
                  onClick={() => triggerMock('gift_small')}
                  className="py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 transition"
                >
                  🎒 Quà 5 xu (+🐾 Pet)
                </button>
                <button
                  onClick={() => triggerMock('gift_medium')}
                  className="py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 transition"
                >
                  🚀 Quà 30 xu (Rocket)
                </button>
                <button
                  onClick={() => triggerMock('gift_superman')}
                  className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 text-slate-950 font-black transition"
                >
                  🦸 Quà 60 xu (Siêu Nhân)
                </button>
                <button
                  onClick={() => triggerMock('fb_stars')}
                  className="py-2.5 px-3 rounded-xl bg-blue-500 hover:bg-blue-400 text-white transition"
                >
                  ⭐ 100 Sao FB (VIP)
                </button>
                <button
                  onClick={() => triggerMock('gift_vip')}
                  className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black transition"
                >
                  🐉 Quà 200 xu (Rồng VIP)
                </button>
              </div>
            </section>

            {/* 4. Hồ Sơ & Cấp Độ Người Chơi Đã Lưu (Tự động khôi phục khi Join lại) */}
            <section className="rounded-2xl bg-slate-900/90 border border-white/10 p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-black text-amber-300 flex items-center gap-1.5">
                    <Trophy className="w-4 h-4 text-amber-400" />
                    Hồ Sơ Người Chơi Đã Lưu ({savedUsers.length} tay đua)
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Lưu bền vững Cấp độ, Điểm XP, Số trận thắng, Đặc điểm nhân vật NotBlox & Thú cưng VIP vào{' '}
                    <code className="text-sky-300">data/users.json</code>. Đặt lại cấp độ sẽ đưa XP về 0 và giữ thành tích, nhân vật, thú cưng.
                  </p>
                </div>
              </div>

              {savedUsers.length > 0 && <input type="search" aria-label="Tìm tay đua" value={playerSearch}
                onChange={(event) => setPlayerSearch(event.target.value)} placeholder="Tìm tay đua theo tên hoặc ID"
                className="rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white" />}
              {playerMessage && <p className="text-xs text-amber-200" role="status">{playerMessage}</p>}

              {savedUsers.length === 0 ? (
                <div className="rounded-xl bg-slate-950/60 border border-white/10 p-3 text-center text-xs text-slate-400">
                  Chưa có người chơi nào được lưu. Khi khán giả bình luận/tặng quà tham gia đua, hệ thống sẽ tự động lưu hồ sơ tại đây!
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/70 divide-y divide-white/10">
                  {visibleProfiles.length === 0 && <p className="p-3 text-xs text-slate-400">Không tìm thấy tay đua.</p>}
                  {visibleProfiles.map((u, idx) => {
                    const shirtHex = '#' + (u.shirtColor || 0x3b82f6).toString(16).padStart(6, '0');
                    return (
                      <div
                        key={u.userId}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-white/5 transition"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 text-center font-black text-slate-400">
                            #{idx + 1}
                          </span>
                          <img
                            src={u.avatar}
                            alt={u.nickname}
                            className="w-7 h-7 rounded-full object-cover border border-white/30 bg-slate-800 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-black text-white truncate max-w-[130px]">
                                {u.nickname}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-amber-400/20 border border-amber-300/40 text-[10px] font-black text-amber-300">
                                Lv.{u.level}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {u.platform === 'facebook' ? '🔵 FB' : '🎵 TT'}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-slate-400">
                              <span className="text-sky-300 font-bold">{u.points} XP</span>
                              <span>·</span>
                              <span className="text-emerald-300 font-semibold">
                                🏆 {u.wins} thắng / {u.matches} trận
                              </span>
                              <span>·</span>
                              <span className="flex items-center gap-1">
                                <span
                                  style={{ backgroundColor: shirtHex }}
                                  className="inline-block w-2.5 h-2.5 rounded-full border border-white/60"
                                />
                                {u.characterIdx === 1 ? 'MiniCharacter' : 'Character'}
                              </span>
                              {u.petName && (
                                <>
                                  <span>·</span>
                                  <span className="text-amber-300 font-bold">
                                    🐾 {u.petName} (+{Math.round((u.petSpeedBonus || 0.18) * 100)}%)
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                        <button
                          onClick={() => {
                            void fetch('/api/test/emit', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                type: 'chat',
                                data: {
                                  userId: u.userId,
                                  username: u.username,
                                  nickname: u.nickname,
                                  avatar: u.avatar,
                                  platform: u.platform,
                                  comment: 'Vào đua',
                                  isFollower: true,
                                },
                              }),
                            });
                          }}
                          className="shrink-0 px-2.5 py-1 rounded-lg bg-sky-600/90 hover:bg-sky-500 text-[11px] font-black text-white transition"
                          title="Đưa tay đua trở lại với hồ sơ đã lưu"
                        >
                          ⚡ Vào đua lại
                        </button>
                        <button type="button" disabled={Boolean(resettingPlayer) || u.points === 0}
                          onClick={() => void resetPlayerLevel(u)}
                          className="rounded-lg border border-rose-400/40 px-2.5 py-1 text-[11px] text-rose-200 hover:bg-rose-950 disabled:opacity-40">
                          {resettingPlayer === u.userId ? 'Đang đặt lại…' : 'Đặt lại cấp độ'}
                        </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <RaceHostPanel liveReplies={aiReplies} />

            {/* 5. Điều khiển Âm Thanh & Bình Luận Viên Thể Thao Trực Tiếp */}
            <section className="rounded-2xl bg-slate-900/90 border border-white/10 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-black text-emerald-300">
                  🔊 Âm Thanh & 🎙️ BLV Thể Thao Sôi Động (/?view=stage)
                </h2>
                <span className="text-[10.5px] text-amber-300 font-bold">
                  Song tấu 2 BLV Nam Minh & Hoài My
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs font-semibold">
                <label className="flex items-center justify-between bg-slate-950/70 rounded-xl px-3 py-2.5 border border-white/10 cursor-pointer">
                  <span>🎵 Nhạc nền</span>
                  <input
                    type="checkbox"
                    checked={bgmOn}
                    onChange={() => handleAudioToggle('bgm')}
                  />
                </label>
                <label className="flex items-center justify-between bg-slate-950/70 rounded-xl px-3 py-2.5 border border-white/10 cursor-pointer">
                  <span>💥 SFX & Khán đài</span>
                  <input
                    type="checkbox"
                    checked={sfxOn}
                    onChange={() => handleAudioToggle('sfx')}
                  />
                </label>
                <label className="flex items-center justify-between bg-slate-950/70 rounded-xl px-3 py-2.5 border border-white/10 cursor-pointer">
                  <span>🎙️ Giọng BLV</span>
                  <input
                    type="checkbox"
                    checked={ttsOn}
                    onChange={() => handleAudioToggle('tts')}
                  />
                </label>
              </div>

              {/* Ô nhập câu cho BLV đọc trực tiếp & các nút Hype khuấy động phòng Live */}
              <div className="rounded-xl bg-slate-950/75 border border-white/10 p-3 flex flex-col gap-2">
                <div className="text-xs font-bold text-amber-300">
                  🎙️ Cho BLV Hô Vang Trực Tiếp Trên Sóng Live:
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customSpeakInput}
                    onChange={(e) => setCustomSpeakInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customSpeakInput.trim()) {
                        speakCustom(customSpeakInput);
                        setCustomSpeakInput('');
                      }
                    }}
                    placeholder="Gõ câu bất kỳ để BLV hô vang trên trang Live..."
                    className="flex-1 rounded-lg bg-slate-900 border border-white/15 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!customSpeakInput.trim()) return;
                      speakCustom(customSpeakInput);
                      setCustomSpeakInput('');
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black transition"
                  >
                    🔊 Đọc Ngay
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() =>
                      speakCustom(
                        'Cả nhà ơi chạm tay thả tim cháy màn hình để kích hoạt tia sét The Flash bứt tốc vượt cua nào!',
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 transition"
                  >
                    ⚡ Kêu gọi Thả tim
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      speakCustom(
                        'Bấm Follow để vào đường đua cùng cả nhà. Nếu đã Follow, hãy gửi một bình luận bất kỳ nhé!',
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 transition"
                  >
                    👋 Kêu gọi Vào đua
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      speakCustom(
                        'Chỉ cần 1 bông hoa hồng là nhận ngay Thú Cưng VIP tăng 18 phần trăm tốc độ! Có đại gia nào tung Tên Lửa hay Rồng Thần lật kèo không đây?!',
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 transition"
                  >
                    🎁 Kêu gọi Tặng quà & Pet VIP
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      speakCustom(
                        'Khúc cua tử thần phía trước đang cực kỳ gay cấn! Ngôi vị quán quân vẫn chưa ngã ngũ đâu cả nhà ơi!',
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-rose-200 transition"
                  >
                    🔥 Khuấy động Đua Top
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tạo đoạn mã JavaScript chạy trực tiếp trên tab Facebook Live (giống npc-action-live).
 * Mở cửa sổ trung gian /api/facebook/bridge và truyền qua window.postMessage (miễn nhiễm 100% lỗi CSP).
 */
function buildFbBrowserBridgeScript(serverOrigin: string): string {
  return `(() => {
  const SERVER = ${JSON.stringify(serverOrigin)};
  const BRIDGE_URL = SERVER + '/api/facebook/bridge';
  if (window.__VN_FB_BRIDGE_STOP) window.__VN_FB_BRIDGE_STOP();

  const seen = new Set();
  const queue = [];
  let count = 0;
  let bridgeWin = null;

  let badge = document.getElementById('vn-fb-live-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'vn-fb-live-badge';
    badge.style.cssText = 'position:fixed;top:14px;right:14px;z-index:999999;color:#fff;padding:11px 16px;border-radius:12px;font:600 13px/1.45 system-ui,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,0.55);cursor:pointer;user-select:none;transition:all 0.2s;';
    document.body.appendChild(badge);
  }

  function isBridgeOpen() {
    try { return Boolean(bridgeWin && !bridgeWin.closed); } catch { return false; }
  }

  function updateBadge(lastText = '') {
    if (isBridgeOpen()) {
      badge.style.background = 'linear-gradient(135deg,#065f46,#0f172a)';
      badge.style.border = '1.5px solid #34d399';
      badge.innerHTML = '🟢 <b>Cầu nối 3D Race Live</b><br/><span style="font-size:11px;color:#a7f3d0">Đã bắt: <b>' + count + '</b> bình luận' + (lastText ? ' · ' + lastText.slice(0, 26) : '') + '</span>';
    } else {
      badge.style.background = 'linear-gradient(135deg,#d97706,#7c2d12)';
      badge.style.border = '2px solid #fde047';
      badge.innerHTML = '👆 <b>BẤM VÀO ĐÂY (1 CLICK) ĐỂ KẾT NỐI GAME</b><br/><span style="font-size:11px;color:#fef08a">Mở cổng truyền bình luận vượt tường lửa CSP Facebook (' + queue.length + ' đang chờ)</span>';
    }
  }

  function flushQueue() {
    if (!isBridgeOpen()) return;
    while (queue.length > 0) {
      const payload = queue.shift();
      try { bridgeWin.postMessage({ type: 'FB_LIVE_INGEST', payload }, '*'); } catch {}
    }
  }

  function openBridgePopup() {
    try {
      bridgeWin = window.open(BRIDGE_URL, 'vn_fb_bridge', 'width=440,height=230,left=30,top=30');
      if (isBridgeOpen()) {
        setTimeout(flushQueue, 500);
        setTimeout(flushQueue, 1200);
      }
    } catch {}
    updateBadge();
  }

  badge.onclick = () => {
    openBridgePopup();
    sendToGame({ id: 'ping_' + Date.now(), nickname: 'Hệ thống FB Live', comment: '' });
  };

  window.addEventListener('message', (e) => {
    if (e.data && (e.data.type === 'VN_FB_BRIDGE_READY' || e.data.type === 'VN_FB_BRIDGE_ACK')) {
      flushQueue();
      updateBadge();
    }
  });

  openBridgePopup();

  let lastDomReactions = -1;

  function detectStars(str) {
    if (!str) return 0;
    const m = str.match(/(?:đã gửi|vừa gửi|gửi tặng|đã tặng|tặng|ủng hộ|sent|gifted)\\s+(\\d[\\d.,]*)\\s*(?:sao|stars?|⭐)/i)
      || str.match(/⭐\\s*(\\d[\\d.,]*)\\s*(?:sao|stars?)?/i)
      || str.match(/\\b(\\d[\\d.,]*)\\s*(?:sao|stars?)\\b/i);
    if (!m || !m[1]) return 0;
    const v = parseInt(m[1].replace(/[.,]/g, ''), 10);
    return v > 0 && v <= 1000000 ? v : 0;
  }

  function detectGift(str) {
    if (!str) return { coins: 0, giftName: '' };
    if (/(?:đã gửi|vừa gửi|đã tặng|gửi tặng)\\s+(?:một\\s+)?(?:phần quà|món quà|quà tặng|quà\\b|vương miện|rồng|tên lửa|hoa hồng)/i.test(str)
      || /\\b(?:sent a gift|sent a virtual gift|gifted a)\\b/i.test(str)) {
      if (/rồng|dragon|vương miện|crown|vip/i.test(str)) return { coins: 120, giftName: '🐉 Quà VIP Facebook' };
      if (/siêu nhân|pháo hoa|kim cương/i.test(str)) return { coins: 60, giftName: '🦸 Siêu Quà Facebook' };
      return { coins: 25, giftName: '🎁 Quà Facebook Live' };
    }
    return { coins: 0, giftName: '' };
  }

  function sendToGame(item) {
    const hasItem = Boolean(item.comment || item.stars || item.coins || item.giftName || item.isLike);
    const payload = {
      videoId: location.href.slice(0, 120),
      pageName: document.title.replace(/\\(\\d+\\)\\s*/, '').slice(0, 45) || 'Facebook Live',
      comments: hasItem ? [item] : [],
      likes: item.likes || 0,
    };
    const previewTxt = item.coins || item.stars
      ? '⭐ ' + item.nickname + ' (' + (item.coins || item.stars) + ' Sao)'
      : item.likes
        ? '❤️ +' + item.likes + ' Tim/Like'
        : item.comment ? item.nickname + ': ' + item.comment : '';
    if (isBridgeOpen()) {
      try {
        bridgeWin.postMessage({ type: 'FB_LIVE_INGEST', payload }, '*');
        updateBadge(previewTxt);
        return;
      } catch {}
    }
    if (hasItem || item.likes) queue.push(payload);
    updateBadge();
  }

  function scanReactions(isInitial) {
    let best = -1;
    document.querySelectorAll('[aria-label*="cảm xúc"], [aria-label*="lượt thích"], [aria-label*="reaction"], [aria-label*="like"], span[role="toolbar"] ~ span').forEach((el) => {
      const src = (el.getAttribute('aria-label') || el.textContent || '').trim();
      const m = src.match(/(\\d+(?:[.,]\\d+)?)\\s*(?:lượt thích|cảm xúc|reactions?|likes?)/i);
      if (m && m[1]) {
        const v = parseInt(m[1].replace(/[.,]/g, ''), 10);
        if (v > best) best = v;
      } else if (/^\\d{1,7}$/.test(src)) {
        const v = parseInt(src, 10);
        if (v > best) best = v;
      }
    });
    if (best >= 0) {
      if (isInitial || lastDomReactions < 0) lastDomReactions = best;
      else if (best > lastDomReactions) {
        const delta = Math.min(50, best - lastDomReactions);
        lastDomReactions = best;
        count++;
        sendToGame({ likes: delta });
      }
    }
  }

  function parseArticle(el, isInitial) {
    const aria = el.getAttribute('aria-label') || '';
    let nickname = '';
    const linkSpans = el.querySelectorAll('a[role="link"] span[dir="auto"], a span[dir="auto"], span[dir="auto"] a');
    for (const s of linkSpans) {
      const t = (s.textContent || '').trim();
      if (t && t.length >= 2 && t.length <= 50 && !/^(Thích|Phản hồi|Chia sẻ|Like|Reply|Share|Theo dõi|Follow|\\d+\\s*(phút|giờ|giây|ngày|tuần|m|h|s|d|w))$/i.test(t)) {
        nickname = t;
        break;
      }
    }
    if (!nickname) return;
    const textBlocks = [];
    el.querySelectorAll('div[dir="auto"], span[dir="auto"]').forEach((d) => {
      if (d.querySelector('div[dir="auto"], span[dir="auto"]')) return;
      if (d.closest('a[role="link"]')) return;
      const t = (d.innerText || d.textContent || '').trim();
      if (t && t !== nickname && !/^(Thích|Phản hồi|Chia sẻ|Like|Reply|Share|Theo dõi|Follow|\\d+\\s*(phút|giờ|giây|ngày|tuần|m|h|s|d|w))$/i.test(t)) {
        textBlocks.push(t);
      }
    });
    let emojiAlt = '';
    let isStickerLike = false;
    el.querySelectorAll('img[alt], div[role="img"][aria-label]').forEach((imgNode) => {
      const alt = imgNode.getAttribute('alt') || imgNode.getAttribute('aria-label') || '';
      if (alt && alt.length <= 16) emojiAlt += alt;
      else if (/thích|like|trái tim|heart|love|yêu thích/i.test(alt)) isStickerLike = true;
    });
    const comment = (textBlocks.join(' ').trim() || emojiAlt).trim();
    const fullTxt = comment + ' ' + aria + ' ' + (el.innerText || '').replace(/\\s+/g, ' ');
    const stars = detectStars(fullTxt);
    const gift = detectGift(fullTxt);
    const coins = stars || gift.coins;
    if (!comment && !coins && !isStickerLike) return;
    let avatar = '';
    const svgImg = el.querySelector('svg image');
    if (svgImg) avatar = svgImg.getAttribute('xlink:href') || svgImg.getAttribute('href') || '';
    if (!avatar) {
      const img = el.querySelector('img');
      if (img && img.src && !img.src.includes('emoji')) avatar = img.src;
    }
    const key = nickname + '|' + comment + '|' + coins + '|' + (isStickerLike ? 'L' : '');
    if (seen.has(key)) return;
    seen.add(key);
    if (isInitial) return;
    count++;
    sendToGame({ id: key + '|' + Date.now(), nickname, comment: comment || (isStickerLike ? '❤️' : ''), avatar, stars, coins, giftName: gift.giftName, isLike: isStickerLike });
  }

  document.querySelectorAll('div[role="article"]').forEach((el) => parseArticle(el, true));
  scanReactions(true);
  const timer = setInterval(() => {
    document.querySelectorAll('div[role="article"]').forEach((el) => parseArticle(el, false));
    scanReactions(false);
  }, 850);
  window.__VN_FB_BRIDGE_STOP = () => clearInterval(timer);
})();`;
}
