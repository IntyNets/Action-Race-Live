import { MatchPhase, RACE_CONSTANTS, RacerState } from '../raceTypes';
import { sampleCircuit } from '../trackCurve';

// ============================================================================
// 4. CAMERA STATE MACHINE (9 Trạng Thái chuẩn Roblox Style Racing – TikTok LIVE)
// IDLE -> COUNTDOWN -> RACE_START -> CHASE -> FRONT_TRACKING -> SIDE_TRACKING -> OVERVIEW -> FINISH -> RESULT
// ============================================================================
export type CameraStateName =
  | 'IDLE'
  | 'COUNTDOWN'
  | 'RACE_START'
  | 'CHASE'
  | 'FRONT_TRACKING'
  | 'SIDE_TRACKING'
  | 'OVERVIEW'
  | 'FINISH'
  | 'RESULT';

// Chế độ Camera Đạo Diễn: Tự động (Auto) hoặc Chủ phòng chọn cố định 1 trong 4 Mode A/B/C/D
export type CameraModeOverride = 'auto' | 'chase' | 'front' | 'side' | 'overview';

// ============================================================================
// 7. CAMERA PHẢN ỨNG THEO SỰ KIỆN GAME (Event Priority + Transition Lock)
// ============================================================================
export type CameraEventType =
  | 'PLAYER_FINISH'
  | 'FINISH_EVENT'
  | 'MAJOR_GIFT_BOOST'
  | 'NORMAL_GIFT_BOOST'
  | 'PLAYER_GIFT'
  | 'PLAYER_OVERTAKE'
  | 'OVERTAKE_EVENT'
  | 'PLAYER_JOIN'
  | 'PLAYER_BOOST'
  | 'RACE_START'
  | 'RACE_END'
  | 'NORMAL_RACE_TRACKING';

export const CAMERA_EVENT_PRIORITY: Record<CameraEventType, number> = {
  PLAYER_FINISH: 100,
  FINISH_EVENT: 100,
  RACE_END: 95,
  MAJOR_GIFT_BOOST: 85,
  PLAYER_GIFT: 70,
  NORMAL_GIFT_BOOST: 65,
  PLAYER_OVERTAKE: 50,
  OVERTAKE_EVENT: 50,
  PLAYER_JOIN: 38,
  PLAYER_BOOST: 25,
  RACE_START: 20,
  NORMAL_RACE_TRACKING: 10,
};

export interface CameraEvent {
  type: CameraEventType;
  userId?: string;
  rivalUserId?: string;
  nickname?: string;
  label?: string;
  durationSec: number;
  createdAt: number;
  coalescedCount: number;
}

export interface CameraPose {
  posX: number;
  posY: number;
  posZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  fov: number;
  transitionSpeed: number;
}

export interface TrackOrbitalTarget {
  dist: number;
  lat: number;
  speed: number;
  /** Góc xoay quanh nhân vật: 0 = MODE A (CHASE phía sau), ±PI/2 = MODE C (SIDE ngang), PI = MODE B (FRONT chính diện) */
  orbitAngle: number;
  /** Khoảng cách từ camera tới nhân vật (6–8m chuẩn Roblox) */
  radius: number;
  /** Độ cao camera so với mặt đường (3–4m chuẩn Roblox) */
  height: number;
  /** Độ lệch ngang bổ sung theo khúc cua */
  curveBiasLat: number;
  /** Khoảng nhìn đón trước dọc theo vector hướng chạy */
  lookAhead: number;
  /** Độ cao điểm nhìn (Follow Target nằm giữa ngực & đầu: 1.85m–2.25m, không bám vào chân) */
  lookY: number;
  /** FOV phản ứng theo tốc độ: Normal ~70°, Boost 80–85°, Super Boost 88–90° */
  fov: number;
  panSpeed: number;
  shakeAmp: number;
}

export interface CameraHudState {
  state: CameraStateName;
  modeOverride: CameraModeOverride;
  badgeText: string;
  spotlightUserId: string | null;
  spotlightNickname: string;
  spotlightLabel: string;
  queueLength: number;
}

// ============================================================================
// 1. CameraEventQueue — Priority Queue + Coalescing + Transition Lock Cooldown
// ============================================================================
export class CameraEventQueue {
  private queue: CameraEvent[] = [];
  private lastSwitchAt = 0;
  private readonly minCooldownMs = 1100;
  private readonly maxQueueSize = 8;

  public push(evt: Omit<CameraEvent, 'createdAt' | 'coalescedCount'>) {
    const now = performance.now();

    if (evt.userId) {
      const existing = this.queue.find(
        (q) => q.userId === evt.userId && q.type === evt.type,
      );
      if (existing) {
        existing.coalescedCount += 1;
        existing.durationSec = Math.min(5.0, existing.durationSec + 0.75);
        if (evt.label) existing.label = evt.label;
        return;
      }
      const weaker = this.queue.find(
        (q) =>
          q.userId === evt.userId &&
          CAMERA_EVENT_PRIORITY[q.type] < CAMERA_EVENT_PRIORITY[evt.type],
      );
      if (weaker) {
        weaker.type = evt.type;
        weaker.durationSec = evt.durationSec;
        weaker.label = evt.label;
        weaker.coalescedCount += 1;
        this.sort();
        return;
      }
    }

    if (evt.type === 'FINISH_EVENT' || evt.type === 'PLAYER_FINISH') {
      this.queue = this.queue.filter(
        (q) => q.type === 'FINISH_EVENT' || q.type === 'PLAYER_FINISH',
      );
    }

    this.queue.push({
      ...evt,
      createdAt: now,
      coalescedCount: 1,
    });
    this.sort();

    if (this.queue.length > this.maxQueueSize) {
      this.queue.length = this.maxQueueSize;
    }
  }

  public peek(): CameraEvent | null {
    this.pruneExpired();
    return this.queue[0] || null;
  }

  public popIfReady(currentPriority: number, forcePreempt = false): CameraEvent | null {
    this.pruneExpired();
    const top = this.queue[0];
    if (!top) return null;

    const now = performance.now();
    const topPriority = CAMERA_EVENT_PRIORITY[top.type];

    if (!forcePreempt) {
      if (topPriority <= currentPriority) return null;
      if (
        now - this.lastSwitchAt < this.minCooldownMs &&
        top.type !== 'FINISH_EVENT' &&
        top.type !== 'PLAYER_FINISH'
      ) {
        return null;
      }
    }

    this.lastSwitchAt = now;
    return this.queue.shift() || null;
  }

  public clear() {
    this.queue = [];
  }

  public get length() {
    return this.queue.length;
  }

  private sort() {
    this.queue.sort((a, b) => {
      const diff = CAMERA_EVENT_PRIORITY[b.type] - CAMERA_EVENT_PRIORITY[a.type];
      return diff !== 0 ? diff : a.createdAt - b.createdAt;
    });
  }

  private pruneExpired() {
    const now = performance.now();
    this.queue = this.queue.filter(
      (q) =>
        q.type === 'FINISH_EVENT' ||
        q.type === 'PLAYER_FINISH' ||
        now - q.createdAt < 8500,
    );
  }
}

// ============================================================================
// 2. CameraBoundsController — Chuẩn hóa khoảng cách, độ cao & FOV theo tốc độ
// ============================================================================
export class CameraBoundsController {
  public clampDistance(dist: number): number {
    return Math.max(5.5, Math.min(34.0, dist));
  }

  public clampHeight(height: number): number {
    return Math.max(2.6, Math.min(26.0, height));
  }

  public clampFov(fov: number): number {
    return Math.max(54, Math.min(90, fov));
  }

  /**
   * 6. CAMERA PHẢN ỨNG THEO TỐC ĐỘ:
   * - NORMAL SPEED: FOV ~70°, khoảng cách mặc định (6.8m), không rung.
   * - BOOST (chat/join/sprint/jetpack): Camera lùi nhẹ (+1.0m), FOV 80–84°, rung rất nhẹ.
   * - SUPER BOOST (rocket/dragon): Camera lùi thêm (+2.1m), FOV đạt 88–90°, vệt sáng kéo dài.
   * - SLOW: Camera tiến gần nhẹ (-0.5m), FOV giảm về 66°.
   */
  public computeSpeedResponse(racer: RacerState | undefined): {
    fov: number;
    distOffset: number;
    heightOffset: number;
    shakeAmp: number;
  } {
    if (!racer) {
      return { fov: 66, distOffset: 0, heightOffset: 0, shakeAmp: 0 };
    }
    const boost = racer.boost;
    if (boost === 'dragon') {
      // Rồng Thần phóng to 1.85x & sải cánh rộng: lùi camera xa + nâng cao để thấy trọn rồng, nhân vật và đường đua
      return { fov: 83, distOffset: 9.6, heightOffset: 4.5, shakeAmp: 0.02 };
    }
    if (boost === 'rocket') {
      // Tên lửa dài & phun lửa lớn: lùi camera thoáng hơn để không bị sát mặt
      return { fov: 80, distOffset: 5.8, heightOffset: 2.6, shakeAmp: 0.016 };
    }
    if (boost === 'jetpack') {
      return { fov: 77, distOffset: 3.8, heightOffset: 1.7, shakeAmp: 0.01 };
    }
    if (boost === 'sprint' || boost === 'join' || boost === 'chat') {
      return { fov: 74, distOffset: 2.4, heightOffset: 0.9, shakeAmp: 0.006 };
    }
    if (racer.speed < 14 && racer.speed > 0.5) {
      // SLOW
      return { fov: 64, distOffset: -0.4, heightOffset: -0.1, shakeAmp: 0 };
    }
    // NORMAL SPEED
    return { fov: 66, distOffset: 0, heightOffset: 0, shakeAmp: 0 };
  }
}

// ============================================================================
// 3. CameraCollisionController — Không để camera xuyên địa hình, cổng hoặc vật thể
// ============================================================================
export class CameraCollisionController {
  public resolve(pose: CameraPose): CameraPose {
    // 1. Không bao giờ xuyên xuống dưới mặt đường (min Y = 2.4m)
    let y = Math.max(2.4, pose.posY);

    // 2. Tránh thanh ngang Cổng Xuất Phát / Về Đích (nằm ở y ~8.8m..10.5m tại dist = 0)
    const a = sampleCircuit(0, 0);
    const dGate = Math.hypot(pose.posX - a.x, pose.posZ - a.z);
    if (dGate < 14 && y > 6.6 && y < 13.0) {
      // Nếu camera ở tầm thấp (< 6.6m như Chase/Front/Side 3.5m) thì chui gọn dưới cổng;
      // nếu ở tầm cao (Overview) thì nâng hẳn lên trên cổng (> 13.0m)
      y = y < 9.5 ? 6.4 : 13.2;
    }

    return { ...pose, posY: y };
  }
}

// ============================================================================
// 8. CAMERA FOLLOW TARGET HELPER — Ngực & Đầu nhân vật (không bám vào chân)
// ============================================================================
function getCharacterFollowLookY(racer: RacerState | undefined): number {
  if (!racer) return 2.05;
  if (racer.boost === 'dragon') return 3.45;
  if (racer.boost === 'rocket') return 2.95;
  if (racer.boost === 'jetpack') return 2.65;
  // Nhân vật cao 2.3m - 2.55m -> điểm giữa ngực và đầu nằm ở ~1.95m - 2.1m,
  // đặt lookY = 2.15m giúp nhân vật nằm hơi dưới tâm màn hình và chiếm 35–45% chiều cao gameplay.
  return 2.15;
}

// ============================================================================
// MODE A: CHASE CAMERA – CAMERA PHÍA SAU (Mặc định & Quan trọng nhất)
// - Nằm phía sau nhân vật, cao 3.4–3.9 đơn vị, cách nhân vật 6.6–7.8 đơn vị.
// - Hướng nhìn về phần đầu và thân trên nhân vật, góc nhìn xuống nhẹ.
// - Nhân vật chiếm ~35–45% chiều cao gameplay, hơi dưới tâm màn hình.
// ============================================================================
export class ChaseCameraMode {
  public computeTarget(
    sortedRacers: RacerState[],
    focusRacer: RacerState | undefined,
    bounds: CameraBoundsController,
  ): TrackOrbitalTarget {
    const primary = focusRacer || sortedRacers[0];
    if (!primary) {
      return {
        dist: 0,
        lat: 0,
        speed: 0,
        orbitAngle: 0,
        radius: 7.2,
        height: 3.6,
        curveBiasLat: 0,
        lookAhead: 3.2,
        lookY: 2.15,
        fov: 70,
        panSpeed: 6.5,
        shakeAmp: 0,
      };
    }

    const primaryDist = Math.max(0, primary.z);
    // Kết hợp nhẹ vị trí của 2 tay đua bám sát nhất (trong phạm vi 7m) để thấy cả đối thủ cạnh tranh nhưng chủ thể chính vẫn là primary (trọng số 82%)
    let latBlend = primary.x;
    if (!focusRacer && sortedRacers.length > 1) {
      const r2 = sortedRacers[1];
      const gap = primaryDist - Math.max(0, r2.z);
      if (gap >= 0 && gap < 7.0) {
        latBlend = primary.x * 0.82 + r2.x * 0.18;
      }
    }

    const speedResp = bounds.computeSpeedResponse(primary);
    const sample = sampleCircuit(primaryDist, 0);
    // Khi nhân vật vào cua, camera mở nhẹ góc ra phía ngoài khúc cua với độ trễ tự nhiên
    const curveBias = Math.max(-2.2, Math.min(2.2, -sample.curvature * 1.45));

    return {
      dist: primaryDist,
      lat: latBlend,
      speed: primary.speed,
      orbitAngle: 0, // 0 rad = Phía sau nhân vật
      radius: bounds.clampDistance(10.8 + speedResp.distOffset),
      height: bounds.clampHeight(5.4 + speedResp.heightOffset),
      curveBiasLat: curveBias,
      lookAhead: 3.6,
      lookY: getCharacterFollowLookY(primary),
      fov: bounds.clampFov(speedResp.fov),
      panSpeed: 7.2,
      shakeAmp: speedResp.shakeAmp,
    };
  }
}

// ============================================================================
// MODE B: FRONT TRACKING – CAMERA CHÍNH DIỆN
// - Camera nằm phía trước nhân vật theo vector hướng chạy (+tx, +tz).
// - Nhìn ngược về phần thân trên/mặt nhân vật, lùi cùng tốc độ với nhân vật.
// - Khi nhân vật tăng tốc, camera tăng khoảng cách để giữ toàn thân (35–45%) trong khung hình.
// ============================================================================
export class FrontTrackingCameraMode {
  public computeTarget(
    racer: RacerState | undefined,
    bounds: CameraBoundsController,
    tSec: number,
  ): TrackOrbitalTarget {
    if (!racer) {
      return {
        dist: 0,
        lat: 0,
        speed: 0,
        orbitAngle: Math.PI,
        radius: 6.8,
        height: 3.2,
        curveBiasLat: 0,
        lookAhead: -0.6,
        lookY: 2.0,
        fov: 72,
        panSpeed: 7.5,
        shakeAmp: 0,
      };
    }

    const speedResp = bounds.computeSpeedResponse(racer);
    const isBigVehicle = racer.boost === 'dragon' || racer.boost === 'rocket';
    // Khi cưỡi Rồng Thần / Tên Lửa: mở góc chính diện xéo 3/4 (~140°) + lùi xa để thấy trọn toàn thân rồng/tên lửa, nhân vật & đường đua thoáng đãng
    const subtleAngle = isBigVehicle
      ? Math.PI * 0.78 + Math.sin(tSec * 0.7) * 0.1
      : Math.PI - Math.sin(tSec * 0.9) * 0.14;

    return {
      dist: Math.max(0, racer.z),
      lat: racer.x,
      speed: racer.speed,
      orbitAngle: subtleAngle,
      radius: bounds.clampDistance(10.8 + speedResp.distOffset * 1.05),
      height: bounds.clampHeight(5.0 + speedResp.heightOffset * 0.92),
      curveBiasLat: 0,
      lookAhead: -0.4,
      lookY: getCharacterFollowLookY(racer) - 0.1,
      fov: bounds.clampFov(Math.min(83, speedResp.fov)),
      panSpeed: 8.0,
      shakeAmp: speedResp.shakeAmp * 0.45,
    };
  }
}

// ============================================================================
// MODE C: SIDE TRACKING – CAMERA NGANG
// - Camera đặt bên trái hoặc bên phải hướng chạy, di chuyển song song với nhân vật.
// - Nhìn thấy toàn bộ nhân vật từ bên cạnh, thấy rõ animation sải chân chạy, mặt đường và 2 nhân vật cạnh tranh cùng lúc.
// ============================================================================
export class SideTrackingCameraMode {
  public computeTarget(
    primary: RacerState | undefined,
    rival: RacerState | undefined,
    bounds: CameraBoundsController,
  ): TrackOrbitalTarget {
    if (!primary) {
      return {
        dist: 0,
        lat: 0,
        speed: 0,
        orbitAngle: Math.PI * 0.5,
        radius: 7.4,
        height: 3.2,
        curveBiasLat: 0,
        lookAhead: 0.8,
        lookY: 1.95,
        fov: 70,
        panSpeed: 7.5,
        shakeAmp: 0,
      };
    }

    const primaryDist = Math.max(0, primary.z);
    let focusDist = primaryDist;
    let focusLat = primary.x;
    let extraRadius = 0;

    // Nếu có đối thủ đang kè sát cạnh tranh (trong phạm vi 6.5m), căn khung hình ôm trọn cả 2 tay đua song song
    if (rival && rival.id !== primary.id) {
      const rivalDist = Math.max(0, rival.z);
      const gapZ = Math.abs(primaryDist - rivalDist);
      if (gapZ < 6.5) {
        focusDist = primaryDist * 0.65 + rivalDist * 0.35;
        focusLat = primary.x * 0.65 + rival.x * 0.35;
        extraRadius = Math.min(2.2, gapZ * 0.35);
      }
    }

    // Chọn phía bên trong mặt đường (nếu nhân vật ở làn phải > 0 thì đặt camera bên trái -PI/2 để luôn ở trong lòng đường đua, không vướng cây/khán đài ngoài lề)
    const sideSign = focusLat > 0.5 ? -1 : 1;
    // Góc ngang 78 độ (hơi hướng nhẹ về phía trước 12 độ để thấy cả mặt bên và hướng lao tới)
    const sideOrbitAngle = sideSign * (Math.PI * 0.44);
    const speedResp = bounds.computeSpeedResponse(primary);

    return {
      dist: focusDist,
      lat: focusLat,
      speed: primary.speed,
      orbitAngle: sideOrbitAngle,
      radius: bounds.clampDistance(11.2 + extraRadius + speedResp.distOffset * 0.95),
      height: bounds.clampHeight(5.0 + speedResp.heightOffset * 0.88),
      curveBiasLat: 0,
      lookAhead: 0.9,
      lookY: getCharacterFollowLookY(primary) - 0.1,
      fov: bounds.clampFov(Math.min(81, speedResp.fov)),
      panSpeed: 7.8,
      shakeAmp: speedResp.shakeAmp * 0.35,
    };
  }
}

// ============================================================================
// MODE D: OVERVIEW – CAMERA TOÀN CẢNH
// - Camera đặt cao phía trên đường đua và nhìn chéo xuống.
// - Quan sát nhiều người chơi, hiển thị đường đua, khúc cua và khoảng cách giữa các tay đua.
// - Không zoom quá xa làm mất khả năng nhận diện người chơi.
// ============================================================================
export class OverviewCameraMode {
  public computeTarget(
    sortedRacers: RacerState[],
    bounds: CameraBoundsController,
  ): TrackOrbitalTarget {
    const leader = sortedRacers[0];
    if (!leader) {
      return {
        dist: 0,
        lat: 0,
        speed: 0,
        orbitAngle: 0,
        radius: 18.5,
        height: 14.5,
        curveBiasLat: 0,
        lookAhead: 4.5,
        lookY: 1.8,
        fov: 68,
        panSpeed: 5.2,
        shakeAmp: 0,
      };
    }

    const leaderDist = Math.max(0, leader.z);
    let dSum = 0;
    let lSum = 0;
    let vSum = 0;
    let wSum = 0;
    let minD = leaderDist;
    let maxD = leaderDist;
    const limit = Math.min(8, sortedRacers.length);

    for (let i = 0; i < limit; i++) {
      const r = sortedRacers[i];
      const d = Math.max(0, r.z);
      if (leaderDist - d > 32) continue;
      const w = i === 0 ? 2.2 : i === 1 ? 1.5 : 1.0;
      dSum += d * w;
      lSum += r.x * w;
      vSum += r.speed * w;
      wSum += w;
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
    }

    const targetDist = wSum > 0 ? dSum / wSum : leaderDist;
    const targetLat = wSum > 0 ? lSum / wSum : leader.x;
    const targetSpeed = wSum > 0 ? vSum / wSum : leader.speed;
    const spread = Math.max(2, maxD - minD);
    const curveAtTarget = sampleCircuit(targetDist, 0).curvature;

    return {
      dist: targetDist,
      lat: targetLat * 0.5,
      speed: targetSpeed,
      orbitAngle: 0,
      radius: bounds.clampDistance(16.5 + Math.min(9.0, spread * 0.28)),
      height: bounds.clampHeight(13.5 + Math.min(6.5, spread * 0.2)),
      curveBiasLat: Math.max(-4.0, Math.min(4.0, -curveAtTarget * 2.5)),
      lookAhead: 4.2,
      lookY: 1.9,
      fov: bounds.clampFov(68 + Math.min(6, spread * 0.12)),
      panSpeed: 5.5,
      shakeAmp: 0,
    };
  }
}

// ============================================================================
// 6. FinishCamera — Góc quay Vượt Vạch Đích (FINISH) & Bục Vinh Danh (RESULT)
// ============================================================================
export class FinishCamera {
  public computeFinishTarget(
    leader: RacerState | undefined,
    bounds: CameraBoundsController,
  ): TrackOrbitalTarget {
    return {
      dist: leader ? Math.max(0, leader.z) : 0,
      lat: leader ? leader.x : 0,
      speed: leader ? leader.speed : 0,
      orbitAngle: 0.42, // Góc chéo 24 độ thấy rõ nhân vật băng qua vạch kẻ caro về đích
      radius: bounds.clampDistance(10.5),
      height: bounds.clampHeight(5.0),
      curveBiasLat: 1.5,
      lookAhead: 1.2,
      lookY: getCharacterFollowLookY(leader),
      fov: bounds.clampFov(68),
      panSpeed: 6.5,
      shakeAmp: 0,
    };
  }

  public computeResultShowcase(
    podiumCenter: { x: number; y: number; z: number },
    podiumFrontDir: { x: number; z: number },
    podiumRightDir: { x: number; z: number },
    tSec: number,
  ): CameraPose {
    const sway = Math.sin(tSec * 0.52) * 4.2;
    return {
      posX: podiumCenter.x + podiumFrontDir.x * 14.5 + podiumRightDir.x * sway,
      posY: 5.8,
      posZ: podiumCenter.z + podiumFrontDir.z * 14.5 + podiumRightDir.z * sway,
      lookX: podiumCenter.x,
      lookY: 3.7,
      lookZ: podiumCenter.z,
      fov: 52,
      transitionSpeed: 3.8,
    };
  }
}

// ============================================================================
// 5. CameraTransition — Nội suy mượt vị trí (SmoothDamp/Exponential), Hướng nhìn & FOV
// Blend duration ~0.6–1.2 giây, không bao giờ teleport hoặc giật khung hình
// ============================================================================
export class CameraTransition {
  public posX: number;
  public posY: number;
  public posZ: number;
  public lookX: number;
  public lookY: number;
  public lookZ: number;
  public fov: number;
  private rate = 5.5;

  constructor(initial: CameraPose) {
    this.posX = initial.posX;
    this.posY = initial.posY;
    this.posZ = initial.posZ;
    this.lookX = initial.lookX;
    this.lookY = initial.lookY;
    this.lookZ = initial.lookZ;
    this.fov = initial.fov;
  }

  public snap(pose: CameraPose) {
    this.posX = pose.posX;
    this.posY = pose.posY;
    this.posZ = pose.posZ;
    this.lookX = pose.lookX;
    this.lookY = pose.lookY;
    this.lookZ = pose.lookZ;
    this.fov = pose.fov;
    this.rate = pose.transitionSpeed;
  }

  public step(target: CameraPose, dt: number) {
    this.rate += (target.transitionSpeed - this.rate) * (1 - Math.exp(-3.6 * dt));
    const posAlpha = 1 - Math.exp(-this.rate * dt);
    const lookAlpha = 1 - Math.exp(-(this.rate + 2.2) * dt);
    const fovAlpha = 1 - Math.exp(-4.2 * dt);

    this.posX += (target.posX - this.posX) * posAlpha;
    this.posY += (target.posY - this.posY) * posAlpha;
    this.posZ += (target.posZ - this.posZ) * posAlpha;

    this.lookX += (target.lookX - this.lookX) * lookAlpha;
    this.lookY += (target.lookY - this.lookY) * lookAlpha;
    this.lookZ += (target.lookZ - this.lookZ) * lookAlpha;

    this.fov += (target.fov - this.fov) * fovAlpha;
  }
}

/** Nội suy góc ngắn nhất trên đường tròn (-PI..PI) để xoay cung tròn mềm khi chuyển Chase <-> Side <-> Front */
function shortestAngleDelta(from: number, to: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

// ============================================================================
// 8. CameraDirector — Bộ điều phối trung tâm chuẩn CAMERA SYSTEM SPECIFICATION
// ============================================================================
export class CameraDirector {
  public readonly queue = new CameraEventQueue();
  public readonly chaseMode = new ChaseCameraMode();
  public readonly frontMode = new FrontTrackingCameraMode();
  public readonly sideMode = new SideTrackingCameraMode();
  public readonly overviewMode = new OverviewCameraMode();
  public readonly finishCamera = new FinishCamera();
  public readonly bounds = new CameraBoundsController();
  public readonly collision = new CameraCollisionController();
  public readonly transition: CameraTransition;

  private state: CameraStateName = 'IDLE';
  private modeOverride: CameraModeOverride = 'auto';
  private activeEvent: CameraEvent | null = null;
  private stateRemainingSec = 0;
  private raceStartElapsedSec = 0;
  private hudDirty = true;
  private breatherSec = 0;
  private forceSnap = false;

  // Hệ tọa độ cong + quỹ đạo cung tròn quanh nhân vật (Orbital Track-Space Camera)
  private trackInitialized = false;
  private curDist = 0;
  private curLat = 0;
  private curSpeed = 0;
  private curOrbitAngle = 0;
  private curRadius = 7.2;
  private curHeight = 3.6;
  private curCurveBias = 0;
  private curLookAhead = 3.2;
  private curLookY = 2.15;
  private curFov = 70;
  private curYawTx = 0;
  private curYawTz = 1;

  constructor() {
    const s0 = sampleCircuit(0, 0);
    this.curYawTx = s0.tx;
    this.curYawTz = s0.tz;
    this.transition = new CameraTransition({
      posX: s0.x - s0.tx * 7.8,
      posY: 3.8,
      posZ: s0.z - s0.tz * 7.8,
      lookX: s0.x + s0.tx * 3.0,
      lookY: 2.15,
      lookZ: s0.z + s0.tz * 3.0,
      fov: 70,
      transitionSpeed: 5.5,
    });
  }

  public setModeOverride(mode: CameraModeOverride) {
    if (this.modeOverride !== mode) {
      this.modeOverride = mode;
      this.hudDirty = true;
    }
  }

  public getModeOverride(): CameraModeOverride {
    return this.modeOverride;
  }

  /** Đặt camera ngay lập tức vào vị trí đích (dùng khi đổi map, tránh lướt xa) */
  public snapCamera() {
    this.forceSnap = true;
    this.trackInitialized = false;
  }

  public pushEvent(evt: Omit<CameraEvent, 'createdAt' | 'coalescedCount'>) {
    if (
      this.activeEvent &&
      evt.userId &&
      this.activeEvent.userId === evt.userId &&
      (this.state === 'FRONT_TRACKING' || this.state === 'SIDE_TRACKING' || this.state === 'CHASE')
    ) {
      if (evt.type === 'MAJOR_GIFT_BOOST' || evt.type === 'PLAYER_GIFT') {
        this.state = 'FRONT_TRACKING';
        this.activeEvent.type = evt.type;
      }
      if (evt.label) this.activeEvent.label = evt.label;
      this.stateRemainingSec = Math.min(5.0, Math.max(this.stateRemainingSec, evt.durationSec));
      this.hudDirty = true;
      return;
    }

    this.queue.push(evt);
    this.hudDirty = true;
  }

  public resetForNewMatch() {
    this.queue.clear();
    this.activeEvent = null;
    this.stateRemainingSec = 0;
    this.raceStartElapsedSec = 0;
    this.breatherSec = 0;
    this.trackInitialized = false;
    this.curDist = 0;
    this.curLat = 0;
    this.curSpeed = 0;
    this.curOrbitAngle = 0;
    this.state = 'IDLE';
    this.hudDirty = true;
  }

  public update(params: {
    dt: number;
    tSec: number;
    matchPhase: MatchPhase;
    timerSec: number;
    sortedRacers: RacerState[];
    racersMap: Map<string, RacerState>;
    podiumCenter: { x: number; y: number; z: number };
    podiumFrontDir: { x: number; z: number };
    podiumRightDir: { x: number; z: number };
  }): CameraPose {
    const {
      dt,
      tSec,
      matchPhase,
      timerSec,
      sortedRacers,
      racersMap,
      podiumCenter,
      podiumFrontDir,
      podiumRightDir,
    } = params;

    // ==========================================================================
    // 1. CAMERA STATE MACHINE (9 Trạng Thái: IDLE -> COUNTDOWN -> RACE_START -> CHASE / FRONT_TRACKING / SIDE_TRACKING / OVERVIEW -> FINISH -> RESULT)
    // ==========================================================================
    if (matchPhase === 'lobby') {
      this.raceStartElapsedSec = 0;
      const nextState: CameraStateName = timerSec <= 3 ? 'COUNTDOWN' : 'IDLE';
      if (this.state !== nextState) {
        this.state = nextState;
        this.activeEvent = null;
        this.queue.clear();
        this.hudDirty = true;
      }
    } else if (matchPhase === 'podium') {
      if (this.state !== 'RESULT') {
        this.state = 'RESULT';
        this.activeEvent = null;
        this.queue.clear();
        this.hudDirty = true;
      }
    } else if (matchPhase === 'countdown') {
      if (this.state !== 'FINISH') {
        this.state = 'FINISH';
        this.activeEvent = null;
        this.queue.clear();
        this.hudDirty = true;
      }
    } else {
      // matchPhase === 'racing'
      this.raceStartElapsedSec += dt;

      // Nếu chủ phòng khóa cứng 1 trong 4 Mode (Chase / Front / Side / Overview) trên Dashboard:
      if (this.modeOverride !== 'auto') {
        const forcedState: CameraStateName =
          this.modeOverride === 'front'
            ? 'FRONT_TRACKING'
            : this.modeOverride === 'side'
              ? 'SIDE_TRACKING'
              : this.modeOverride === 'overview'
                ? 'OVERVIEW'
                : 'CHASE';
        if (this.state !== forcedState) {
          this.state = forcedState;
          this.hudDirty = true;
        }
      } else {
        // Chế độ Tự Động Đạo Diễn (Auto Director):
        if (
          this.state === 'IDLE' ||
          this.state === 'COUNTDOWN' ||
          this.state === 'RESULT' ||
          this.state === 'FINISH'
        ) {
          this.state = this.raceStartElapsedSec < 1.8 ? 'RACE_START' : 'CHASE';
          this.activeEvent = null;
          this.hudDirty = true;
        } else if (this.state === 'RACE_START' && this.raceStartElapsedSec >= 1.8) {
          this.state = 'CHASE';
          this.hudDirty = true;
        }

        // Hết thời lượng sự kiện cinematic (Front Tracking / Side Tracking / Spotlight) -> blend mượt về CHASE
        if (
          this.activeEvent &&
          (this.state === 'FRONT_TRACKING' ||
            this.state === 'SIDE_TRACKING' ||
            this.state === 'CHASE' ||
            this.state === 'OVERVIEW')
        ) {
          this.stateRemainingSec -= dt;
          const targetAlive =
            !this.activeEvent.userId || racersMap.has(this.activeEvent.userId);
          if (this.stateRemainingSec <= 0 || !targetAlive) {
            this.state = 'CHASE';
            this.activeEvent = null;
            this.breatherSec = 1.1; // Transition lock ngăn sự kiện liên tục gây giật camera
            this.hudDirty = true;
          }
        }

        if (this.breatherSec > 0) this.breatherSec -= dt;

        const currentPriority = this.activeEvent
          ? CAMERA_EVENT_PRIORITY[this.activeEvent.type]
          : CAMERA_EVENT_PRIORITY.NORMAL_RACE_TRACKING;
        const inBreather = !this.activeEvent && this.breatherSec > 0;
        const headType = this.queue.peek()?.type;
        const breatherBlocks =
          inBreather &&
          headType !== 'MAJOR_GIFT_BOOST' &&
          headType !== 'FINISH_EVENT' &&
          headType !== 'PLAYER_FINISH';
        const nextEvt = breatherBlocks
          ? null
          : this.queue.popIfReady(currentPriority, !this.activeEvent);

        if (nextEvt) {
          this.activeEvent = nextEvt;
          this.stateRemainingSec = Math.min(4.8, nextEvt.durationSec);
          if (nextEvt.type === 'FINISH_EVENT' || nextEvt.type === 'PLAYER_FINISH') {
            this.state = 'FINISH';
          } else if (
            nextEvt.type === 'MAJOR_GIFT_BOOST' ||
            nextEvt.type === 'PLAYER_GIFT' ||
            nextEvt.type === 'NORMAL_GIFT_BOOST' ||
            nextEvt.type === 'PLAYER_JOIN'
          ) {
            // Quà tặng / Người chơi mới join -> chuyển sang góc Chính Diện (FRONT_TRACKING) khoe toàn thân nhân vật, mặt, thú cưng & hiệu ứng!
            this.state = 'FRONT_TRACKING';
          } else if (
            nextEvt.type === 'OVERTAKE_EVENT' ||
            nextEvt.type === 'PLAYER_OVERTAKE'
          ) {
            // Cuộc cạnh tranh vượt mặt -> chuyển sang góc Ngang (SIDE_TRACKING) quan sát 2 nhân vật đua song song!
            this.state = 'SIDE_TRACKING';
          } else if (nextEvt.type === 'RACE_END') {
            this.state = 'OVERVIEW';
          } else {
            this.state = 'CHASE';
          }
          this.hudDirty = true;
        }
      }
    }

    // ==========================================================================
    // 2. TÍNH TOÁN VỊ TRÍ & GÓC NHÌN CAMERA THEO TỪNG STATE / MODE
    // ==========================================================================
    let rawPose: CameraPose;
    const leader = sortedRacers[0];

    if (this.state === 'IDLE') {
      // IDLE: Camera đặt phía sau nhân vật tại vạch xuất phát, giữ khung hình ổn định
      this.trackInitialized = false;
      const focus =
        (this.activeEvent?.userId ? racersMap.get(this.activeEvent.userId) : undefined) ||
        leader;
      const focusLat = focus ? focus.x * 0.65 : 0;
      const s0 = sampleCircuit(0, focusLat);
      const gentleSway = Math.sin(tSec * 0.45) * 1.4;
      rawPose = {
        posX: s0.x - s0.tx * 10.4 + s0.rx * gentleSway,
        posY: 5.0,
        posZ: s0.z - s0.tz * 10.4 + s0.rz * gentleSway,
        lookX: s0.x + s0.tx * 2.8,
        lookY: 2.1,
        lookZ: s0.z + s0.tz * 2.8,
        fov: 66,
        transitionSpeed: 4.5,
      };
    } else if (this.state === 'COUNTDOWN') {
      // COUNTDOWN: Camera tiến nhẹ gần nhân vật (8.8m, cao 4.4m), tạo cảm giác chuẩn bị bứt tốc xuất phát
      this.trackInitialized = false;
      const focusLat = leader ? leader.x * 0.6 : 0;
      const s0 = sampleCircuit(0, focusLat);
      rawPose = {
        posX: s0.x - s0.tx * 8.8,
        posY: 4.4,
        posZ: s0.z - s0.tz * 8.8,
        lookX: s0.x + s0.tx * 3.6,
        lookY: 2.1,
        lookZ: s0.z + s0.tz * 3.6,
        fov: 64,
        transitionSpeed: 5.2,
      };
    } else if (this.state === 'RESULT') {
      // RESULT: Camera chuyển sang góc đẹp trước Bục Vinh Danh hiển thị Top 3 nhân vật & kết quả
      this.trackInitialized = false;
      rawPose = this.finishCamera.computeResultShowcase(
        podiumCenter,
        podiumFrontDir,
        podiumRightDir,
        tSec,
      );
    } else {
      // Các trạng thái đua trên đường chạy: RACE_START, CHASE, FRONT_TRACKING, SIDE_TRACKING, OVERVIEW, FINISH
      const spotRacer =
        this.activeEvent?.userId && racersMap.has(this.activeEvent.userId)
          ? racersMap.get(this.activeEvent.userId)
          : undefined;
      const rivalRacer =
        this.activeEvent?.rivalUserId && racersMap.has(this.activeEvent.rivalUserId)
          ? racersMap.get(this.activeEvent.rivalUserId)
          : sortedRacers[1];
      const primaryRacer = spotRacer || leader;

      let target: TrackOrbitalTarget;
      if (this.state === 'FINISH') {
        target = this.finishCamera.computeFinishTarget(primaryRacer, this.bounds);
      } else if (this.state === 'FRONT_TRACKING') {
        target = this.frontMode.computeTarget(primaryRacer, this.bounds, tSec);
      } else if (this.state === 'SIDE_TRACKING') {
        target = this.sideMode.computeTarget(primaryRacer, rivalRacer, this.bounds);
      } else if (this.state === 'OVERVIEW') {
        target = this.overviewMode.computeTarget(sortedRacers, this.bounds);
      } else if (this.state === 'RACE_START') {
        // RACE_START: Camera bắt đầu ở góc Chase hơi cao (4.4m, cách 8.2m) rồi thu mượt về Chase chuẩn (3.6m, cách 7.0m)
        const baseChase = this.chaseMode.computeTarget(sortedRacers, primaryRacer, this.bounds);
        target = {
          ...baseChase,
          radius: baseChase.radius + 1.1,
          height: baseChase.height + 0.7,
          fov: 74,
        };
      } else {
        // MODE A: CHASE CAMERA (Mặc định)
        target = this.chaseMode.computeTarget(sortedRacers, spotRacer, this.bounds);
      }

      if (!this.trackInitialized) {
        this.trackInitialized = true;
        this.curDist = target.dist;
        this.curLat = target.lat;
        this.curSpeed = target.speed;
        this.curOrbitAngle = target.orbitAngle;
        this.curRadius = target.radius;
        this.curHeight = target.height;
        this.curCurveBias = target.curveBiasLat;
        this.curLookAhead = target.lookAhead;
        this.curLookY = target.lookY;
        this.curFov = target.fov;
        const initSample = sampleCircuit(this.curDist, 0);
        this.curYawTx = initSample.tx;
        this.curYawTz = initSample.tz;
      }

      // 1) Feed-forward vận tốc để nhân vật không bao giờ bị trượt hoặc tụt khỏi tâm khung hình (Section 3 & 5)
      this.curSpeed += (target.speed - this.curSpeed) * (1 - Math.exp(-8.0 * dt));
      this.curDist += this.curSpeed * dt;
      const distAlpha = 1 - Math.exp(-target.panSpeed * dt);
      this.curDist += (target.dist - this.curDist) * distAlpha;

      // 2) Nội suy mượt tọa độ ngang, khoảng cách, độ cao, FOV và góc quỹ đạo (Orbit Angle)
      // Blend duration 0.6–1.2 giây (rate ~3.4 -> ~85% trong 0.6s, 98% trong 1.1s)
      const orbitAlpha = 1 - Math.exp(-3.6 * dt);
      const paramAlpha = 1 - Math.exp(-4.5 * dt);
      const latAlpha = 1 - Math.exp(-5.2 * dt);

      this.curLat += (target.lat - this.curLat) * latAlpha;
      this.curOrbitAngle += shortestAngleDelta(this.curOrbitAngle, target.orbitAngle) * orbitAlpha;
      this.curRadius += (target.radius - this.curRadius) * paramAlpha;
      this.curHeight += (target.height - this.curHeight) * paramAlpha;
      this.curCurveBias += (target.curveBiasLat - this.curCurveBias) * (1 - Math.exp(-3.2 * dt));
      this.curLookAhead += (target.lookAhead - this.curLookAhead) * paramAlpha;
      this.curLookY += (target.lookY - this.curLookY) * paramAlpha;
      this.curFov += (target.fov - this.curFov) * (1 - Math.exp(-4.2 * dt));

      // 3) Độ trễ xoay hướng tự nhiên khi nhân vật rẽ qua khúc cua (Natural Turn Lag - Section 2 & 3)
      const centerSample = sampleCircuit(this.curDist, 0);
      const turnLagAlpha = 1 - Math.exp(-5.0 * dt);
      this.curYawTx += (centerSample.tx - this.curYawTx) * turnLagAlpha;
      this.curYawTz += (centerSample.tz - this.curYawTz) * turnLagAlpha;
      const yawLen = Math.hypot(this.curYawTx, this.curYawTz) || 1;
      const smoothTx = this.curYawTx / yawLen;
      const smoothTz = this.curYawTz / yawLen;
      const smoothRx = -smoothTz;
      const smoothRz = smoothTx;

      // 4) Tính vị trí nhân vật (Follow Target) & vị trí Camera trên quỹ đạo cung tròn quanh nhân vật:
      // - Khi orbitAngle = 0 (CHASE): cos(0) = 1 -> camera đặt phía sau nhân vật (-smoothTx * radius).
      // - Khi orbitAngle = ±PI/2 (SIDE): sin(±PI/2) = ±1 -> camera đặt song song bên cạnh nhân vật (±smoothRx * radius).
      // - Khi orbitAngle = PI (FRONT): cos(PI) = -1 -> camera đặt phía trước nhân vật (+smoothTx * radius) và lùi theo nhân vật!
      // Nhờ quỹ đạo lượng giác (cos/sin), khi chuyển từ CHASE -> FRONT_TRACKING, camera lướt theo cung tròn mềm qua bên hông nhân vật, KHÔNG BAO GIỜ xuyên qua đầu nhân vật hay xoay 180° đột ngột!
      const charSample = sampleCircuit(this.curDist, this.curLat * 0.88);
      const backOffset = Math.cos(this.curOrbitAngle) * this.curRadius;
      const sideOffset = Math.sin(this.curOrbitAngle) * this.curRadius + this.curCurveBias;

      // Kết hợp vector hướng chạy có độ trễ tự nhiên (72%) + mẫu đường cong thực tế (28%)
      const orbitalPosX =
        charSample.x - smoothTx * backOffset + smoothRx * sideOffset;
      const orbitalPosZ =
        charSample.z - smoothTz * backOffset + smoothRz * sideOffset;

      const curveSample = sampleCircuit(
        this.curDist - backOffset,
        this.curLat * 0.55 + sideOffset * 0.75,
      );

      // Hiệu ứng rung cực nhẹ (micro-shake) chỉ khi nhận Super Boost (Rocket/Dragon)
      const shakeX =
        target.shakeAmp > 0 ? Math.sin(tSec * 47.0) * target.shakeAmp : 0;
      const shakeY =
        target.shakeAmp > 0 ? Math.cos(tSec * 53.0) * target.shakeAmp * 0.7 : 0;

      // Điểm nhìn (Follow Target): đặt tại phần ngực & đầu nhân vật, kết hợp nhìn đón nhẹ theo hướng chạy khi ở chế độ Chase/Overview
      const lookForwardFactor = Math.max(0, Math.cos(this.curOrbitAngle));
      const effectiveLookAhead = this.curLookAhead * lookForwardFactor;
      const lookSample = sampleCircuit(
        this.curDist + effectiveLookAhead,
        this.curLat * 0.88,
      );

      rawPose = {
        posX: orbitalPosX * 0.72 + curveSample.x * 0.28 + shakeX,
        posY: this.curHeight + shakeY,
        posZ: orbitalPosZ * 0.72 + curveSample.z * 0.28,
        lookX: charSample.x * 0.65 + lookSample.x * 0.35,
        lookY: this.curLookY,
        lookZ: charSample.z * 0.65 + lookSample.z * 0.35,
        fov: this.curFov,
        transitionSpeed: 14.5,
      };
    }

    // 3. Kiểm tra va chạm địa hình/cổng + nội suy mượt cuối
    const safePose = this.collision.resolve(rawPose);
    if (this.forceSnap) {
      this.transition.snap(safePose);
      this.forceSnap = false;
    }
    this.transition.step(safePose, dt);

    return {
      posX: this.transition.posX,
      posY: this.transition.posY,
      posZ: this.transition.posZ,
      lookX: this.transition.lookX,
      lookY: this.transition.lookY,
      lookZ: this.transition.lookZ,
      fov: this.transition.fov,
      transitionSpeed: safePose.transitionSpeed,
    };
  }

  public consumeHudStateIfDirty(): CameraHudState | null {
    if (!this.hudDirty) return null;
    this.hudDirty = false;
    return this.getHudState();
  }

  public getHudState(): CameraHudState {
    const labels: Record<CameraStateName, string> = {
      IDLE: '🎥 IDLE · CHỜ ĐUA',
      COUNTDOWN: '🎥 COUNTDOWN',
      RACE_START: '🎥 XUẤT PHÁT',
      CHASE: '🎥 CHASE CAM (SAU)',
      FRONT_TRACKING: '🎥 FRONT CAM (TRƯỚC)',
      SIDE_TRACKING: '🎥 SIDE CAM (NGANG)',
      OVERVIEW: '🎥 OVERVIEW (TOÀN CẢNH)',
      FINISH: '🎥 FINISH CAM',
      RESULT: '🎥 VINH DANH TOP 3',
    };
    return {
      state: this.state,
      modeOverride: this.modeOverride,
      badgeText: labels[this.state],
      spotlightUserId: this.activeEvent?.userId || null,
      spotlightNickname: this.activeEvent?.nickname || '',
      spotlightLabel: this.activeEvent?.label || '',
      queueLength: this.queue.length,
    };
  }
}

export const _UNUSED_RACE_CONST_REF = RACE_CONSTANTS.DEFAULT_LAPS;
