import { MatchPhase, RACE_CONSTANTS, RacerState } from '../raceTypes';
import { sampleCircuit } from '../trackCurve';

// ============================================================================
// 8. CAMERA STATE MACHINE
// ============================================================================
export type CameraStateName =
  | 'LOBBY'
  | 'START_COUNTDOWN'
  | 'RACE_TRACKING'
  | 'BOOST_SPOTLIGHT'
  | 'MAJOR_GIFT_SPOTLIGHT'
  | 'OVERTAKE_SPOTLIGHT'
  | 'FINISH_TRACKING'
  | 'RESULT_SHOWCASE';

// ============================================================================
// 5. EVENT PRIORITY (Cao -> Thấp)
// ============================================================================
export type CameraEventType =
  | 'FINISH_EVENT'
  | 'MAJOR_GIFT_BOOST'
  | 'NORMAL_GIFT_BOOST'
  | 'OVERTAKE_EVENT'
  | 'NORMAL_RACE_TRACKING';

export const CAMERA_EVENT_PRIORITY: Record<CameraEventType, number> = {
  FINISH_EVENT: 100,
  MAJOR_GIFT_BOOST: 80,
  NORMAL_GIFT_BOOST: 60,
  OVERTAKE_EVENT: 40,
  NORMAL_RACE_TRACKING: 10,
};

export interface CameraEvent {
  type: CameraEventType;
  userId?: string;
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

export interface TrackCameraTarget {
  dist: number;
  lat: number;
  speed: number;
  back: number;
  side: number;
  height: number;
  lookAhead: number;
  lookY: number;
  fov: number;
  panSpeed: number;
}

export interface CameraHudState {
  state: CameraStateName;
  badgeText: string;
  spotlightUserId: string | null;
  spotlightNickname: string;
  spotlightLabel: string;
  queueLength: number;
}

// ============================================================================
// 1. CameraEventQueue — Priority Queue + Coalescing + Cooldown
// ============================================================================
export class CameraEventQueue {
  private queue: CameraEvent[] = [];
  private lastSwitchAt = 0;
  private readonly minCooldownMs = 1200;
  private readonly maxQueueSize = 8;

  public push(evt: Omit<CameraEvent, 'createdAt' | 'coalescedCount'>) {
    const now = performance.now();

    // Event Coalescing: gộp các quà tặng liên tục của cùng 1 userId thành 1 sự kiện
    if (evt.userId) {
      const existing = this.queue.find(
        (q) => q.userId === evt.userId && q.type === evt.type,
      );
      if (existing) {
        existing.coalescedCount += 1;
        existing.durationSec = Math.min(5.2, existing.durationSec + 0.8);
        if (evt.label) existing.label = evt.label;
        return;
      }
      // Nếu cùng user có quà lớn hơn -> nâng cấp sự kiện trong hàng đợi
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

    // FINISH_EVENT luôn xóa sạch các spotlight nhỏ hơn đang chờ
    if (evt.type === 'FINISH_EVENT') {
      this.queue = this.queue.filter((q) => q.type === 'FINISH_EVENT');
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
      if (now - this.lastSwitchAt < this.minCooldownMs && top.type !== 'FINISH_EVENT') {
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
      (q) => q.type === 'FINISH_EVENT' || now - q.createdAt < 9000,
    );
  }
}

// ============================================================================
// 2. CameraBoundsController — Kiểm soát vùng quan sát, chống zoom quá mức
// ============================================================================
export class CameraBoundsController {
  public clampDistance(dist: number): number {
    return Math.max(10.5, Math.min(24.0, dist));
  }

  public clampHeight(height: number): number {
    return Math.max(7.2, Math.min(20.0, height));
  }

  public clampFov(fov: number): number {
    return Math.max(46, Math.min(64, fov));
  }
}

// ============================================================================
// 3. CameraCollisionController — Ngăn camera xuyên mặt đất & cổng/khán đài
// ============================================================================
export class CameraCollisionController {
  public resolve(pose: CameraPose): CameraPose {
    // 1. Không bao giờ xuyên xuống dưới mặt đường (min Y = 3.6m)
    let y = Math.max(3.6, pose.posY);

    // 2. Cổng Xuất Phát/Về Đích (cao ~10.5m): nâng camera LIÊN TỤC khi tới gần cổng
    const a = sampleCircuit(0, 0);
    const d = Math.hypot(pose.posX - a.x, pose.posZ - a.z);
    if (d < 18 && y < 13.4) {
      const k = 1 - d / 18;
      const smooth = k * k * (3 - 2 * k);
      y = y + (13.4 - y) * smooth;
    }

    return { ...pose, posY: y };
  }
}

// ============================================================================
// 4. RaceCamera — Tính mục tiêu theo tọa độ đường đua cho CẢ ĐOÀN ĐUA
// ============================================================================
export class RaceCamera {
  public reset() {
    // State smoothing được quản lý đồng nhất trong hệ tọa độ đường cong của CameraDirector
  }

  public computeTarget(
    sortedRacers: RacerState[],
    bounds: CameraBoundsController,
  ): TrackCameraTarget {
    const leader = sortedRacers[0];
    if (!leader) {
      return {
        dist: 0,
        lat: 0,
        speed: 0,
        back: 14.5,
        side: 0,
        height: 11.8,
        lookAhead: 1.6,
        lookY: 2.0,
        fov: 56,
        panSpeed: 5.5,
      };
    }

    // Đoàn đua: tối đa 6 tay đua dẫn đầu trong phạm vi 25m sau Top 1
    const leaderDist = Math.max(0, leader.z);
    let dSum = 0;
    let lSum = 0;
    let vSum = 0;
    let wSum = 0;
    let minD = leaderDist;
    let maxD = leaderDist;
    const limit = Math.min(6, sortedRacers.length);

    for (let i = 0; i < limit; i++) {
      const r = sortedRacers[i];
      const d = Math.max(0, r.z);
      if (leaderDist - d > 25) continue;
      const w = i === 0 ? 2.5 : i === 1 ? 1.6 : 1.0;
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

    // Đẩy nhẹ camera ra phía ngoài khúc cua để nhìn rõ cả vòng cua phía trước
    const curveAtTarget = sampleCircuit(targetDist, 0).curvature;

    return {
      dist: targetDist,
      lat: targetLat,
      speed: targetSpeed,
      back: bounds.clampDistance(13.5 + Math.min(8, spread * 0.28)),
      side: Math.max(-4, Math.min(4, -curveAtTarget * 2.5)),
      height: bounds.clampHeight(11.5 + Math.min(5, spread * 0.18)),
      lookAhead: 1.6,
      lookY: 2.0,
      fov: bounds.clampFov(56 + Math.min(4, spread * 0.1)),
      panSpeed: 5.5,
    };
  }
}

// ============================================================================
// 5. SpotlightCamera — Khoảnh khắc nổi bật: tập trung vào người tặng quà / vượt Top 1
// ============================================================================
export class SpotlightCamera {
  public computeTarget(
    racer: RacerState,
    state: 'BOOST_SPOTLIGHT' | 'MAJOR_GIFT_SPOTLIGHT' | 'OVERTAKE_SPOTLIGHT',
    tSec: number,
    bounds: CameraBoundsController,
  ): TrackCameraTarget {
    const isMajor = state === 'MAJOR_GIFT_SPOTLIGHT';
    return {
      dist: Math.max(0, racer.z),
      lat: racer.x,
      speed: racer.speed,
      back: bounds.clampDistance(isMajor ? 12.0 : 11.0),
      side: isMajor ? Math.sin(tSec * 0.8) * 2.8 + 1.8 : 2.4,
      height: bounds.clampHeight(isMajor ? 8.2 : 7.8),
      lookAhead: 1.2,
      lookY: isMajor ? 2.8 : 2.1,
      fov: bounds.clampFov(isMajor ? 60 : 56),
      panSpeed: 4.2,
    };
  }
}

// ============================================================================
// 6. FinishCamera — Góc quay Về Đích (FINISH_TRACKING) & Bục Vinh Danh (RESULT_SHOWCASE)
// ============================================================================
export class FinishCamera {
  public computeFinishTarget(
    leader: RacerState | undefined,
    bounds: CameraBoundsController,
  ): TrackCameraTarget {
    return {
      dist: leader ? Math.max(0, leader.z) : 0,
      lat: leader ? leader.x : 0,
      speed: leader ? leader.speed : 0,
      back: bounds.clampDistance(11.5),
      side: 4.5,
      height: bounds.clampHeight(8.5),
      lookAhead: 0.5,
      lookY: 2.2,
      fov: bounds.clampFov(54),
      panSpeed: 4.5,
    };
  }

  public computeResultShowcase(
    podiumCenter: { x: number; y: number; z: number },
    podiumFrontDir: { x: number; z: number },
    podiumRightDir: { x: number; z: number },
    tSec: number,
  ): CameraPose {
    const sway = Math.sin(tSec * 0.52) * 4.8;
    return {
      posX: podiumCenter.x + podiumFrontDir.x * 16.0 + podiumRightDir.x * sway,
      posY: 6.4,
      posZ: podiumCenter.z + podiumFrontDir.z * 16.0 + podiumRightDir.z * sway,
      lookX: podiumCenter.x,
      lookY: 3.9,
      lookZ: podiumCenter.z,
      fov: 48,
      transitionSpeed: 3.4,
    };
  }
}

// ============================================================================
// 7. CameraTransition — Nội suy mượt mà vị trí, điểm nhìn & FOV
// ============================================================================
export class CameraTransition {
  public posX: number;
  public posY: number;
  public posZ: number;
  public lookX: number;
  public lookY: number;
  public lookZ: number;
  public fov: number;
  private rate = 4.0;

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
    this.rate += (target.transitionSpeed - this.rate) * (1 - Math.exp(-3.2 * dt));
    const posAlpha = 1 - Math.exp(-this.rate * dt);
    const lookAlpha = 1 - Math.exp(-(this.rate + 1.5) * dt);
    const fovAlpha = 1 - Math.exp(-4.5 * dt);

    this.posX += (target.posX - this.posX) * posAlpha;
    this.posY += (target.posY - this.posY) * posAlpha;
    this.posZ += (target.posZ - this.posZ) * posAlpha;

    this.lookX += (target.lookX - this.lookX) * lookAlpha;
    this.lookY += (target.lookY - this.lookY) * lookAlpha;
    this.lookZ += (target.lookZ - this.lookZ) * lookAlpha;

    this.fov += (target.fov - this.fov) * fovAlpha;
  }
}

// ============================================================================
// 8. CameraDirector — Bộ điều phối trung tâm (Curvilinear Track-Space Camera)
// ============================================================================
export class CameraDirector {
  public readonly queue = new CameraEventQueue();
  public readonly raceCamera = new RaceCamera();
  public readonly spotlightCamera = new SpotlightCamera();
  public readonly finishCamera = new FinishCamera();
  public readonly bounds = new CameraBoundsController();
  public readonly collision = new CameraCollisionController();
  public readonly transition: CameraTransition;

  private state: CameraStateName = 'LOBBY';
  private activeEvent: CameraEvent | null = null;
  private stateRemainingSec = 0;
  private hudDirty = true;
  private breatherSec = 0;
  private forceSnap = false;

  // Hệ tọa độ cong dọc đường đua giúp lia camera & ôm cua luôn giữ nhân vật trong khung hình 9:16
  private trackInitialized = false;
  private curDist = 0;
  private curLat = 0;
  private curSpeed = 0;
  private curBack = 14.5;
  private curSide = 0;
  private curHeight = 11.8;
  private curLookAhead = 1.6;
  private curLookY = 2.0;
  private curFov = 56;

  constructor() {
    const s0 = sampleCircuit(0, 0);
    this.transition = new CameraTransition({
      posX: s0.x - s0.tx * 16,
      posY: 11.4,
      posZ: s0.z - s0.tz * 16,
      lookX: s0.x + s0.tx * 3.5,
      lookY: 2.2,
      lookZ: s0.z + s0.tz * 3.5,
      fov: 54,
      transitionSpeed: 3.5,
    });
  }

  /** Đặt camera ngay lập tức vào vị trí đích (dùng khi đổi map, tránh lướt xa) */
  public snapCamera() {
    this.forceSnap = true;
    this.trackInitialized = false;
    this.raceCamera.reset();
  }

  public pushEvent(evt: Omit<CameraEvent, 'createdAt' | 'coalescedCount'>) {
    if (
      this.activeEvent &&
      evt.userId &&
      this.activeEvent.userId === evt.userId &&
      (this.state === 'BOOST_SPOTLIGHT' || this.state === 'MAJOR_GIFT_SPOTLIGHT')
    ) {
      if (evt.type === 'MAJOR_GIFT_BOOST') {
        this.state = 'MAJOR_GIFT_SPOTLIGHT';
        this.activeEvent.type = 'MAJOR_GIFT_BOOST';
      }
      if (evt.label) this.activeEvent.label = evt.label;
      this.stateRemainingSec = Math.min(5.2, Math.max(this.stateRemainingSec, evt.durationSec));
      this.hudDirty = true;
      return;
    }

    this.queue.push(evt);
    this.hudDirty = true;
  }

  public resetForNewMatch() {
    this.queue.clear();
    this.raceCamera.reset();
    this.activeEvent = null;
    this.stateRemainingSec = 0;
    this.breatherSec = 0;
    this.trackInitialized = false;
    this.curDist = 0;
    this.curLat = 0;
    this.curSpeed = 0;
    this.state = 'LOBBY';
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

    // 1. Đồng bộ trạng thái cấp cao từ MatchPhase
    if (matchPhase === 'lobby') {
      const nextState: CameraStateName = timerSec <= 3 ? 'START_COUNTDOWN' : 'LOBBY';
      if (this.state !== nextState) {
        this.state = nextState;
        this.activeEvent = null;
        this.queue.clear();
        this.hudDirty = true;
      }
    } else if (matchPhase === 'podium') {
      if (this.state !== 'RESULT_SHOWCASE') {
        this.state = 'RESULT_SHOWCASE';
        this.activeEvent = null;
        this.queue.clear();
        this.hudDirty = true;
      }
    } else if (matchPhase === 'countdown') {
      if (this.state !== 'FINISH_TRACKING') {
        this.state = 'FINISH_TRACKING';
        this.activeEvent = null;
        this.queue.clear();
        this.hudDirty = true;
      }
    } else {
      if (
        this.state === 'LOBBY' ||
        this.state === 'START_COUNTDOWN' ||
        this.state === 'RESULT_SHOWCASE' ||
        this.state === 'FINISH_TRACKING'
      ) {
        this.state = 'RACE_TRACKING';
        this.activeEvent = null;
        this.hudDirty = true;
      }

      if (
        this.state === 'BOOST_SPOTLIGHT' ||
        this.state === 'MAJOR_GIFT_SPOTLIGHT' ||
        this.state === 'OVERTAKE_SPOTLIGHT'
      ) {
        this.stateRemainingSec -= dt;
        const targetAlive =
          this.activeEvent?.userId && racersMap.has(this.activeEvent.userId);
        if (this.stateRemainingSec <= 0 || !targetAlive) {
          this.state = 'RACE_TRACKING';
          this.activeEvent = null;
          this.breatherSec = 1.3;
          this.hudDirty = true;
        }
      }

      if (this.breatherSec > 0) this.breatherSec -= dt;

      const currentPriority = this.activeEvent
        ? CAMERA_EVENT_PRIORITY[this.activeEvent.type]
        : CAMERA_EVENT_PRIORITY.NORMAL_RACE_TRACKING;
      const inBreather = this.state === 'RACE_TRACKING' && this.breatherSec > 0;
      const headType = this.queue.peek()?.type;
      const breatherBlocks =
        inBreather && headType !== 'MAJOR_GIFT_BOOST' && headType !== 'FINISH_EVENT';
      const nextEvt = breatherBlocks
        ? null
        : this.queue.popIfReady(currentPriority, this.state === 'RACE_TRACKING');
      if (nextEvt) {
        this.activeEvent = nextEvt;
        this.stateRemainingSec = Math.min(5.2, nextEvt.durationSec);
        if (nextEvt.type === 'FINISH_EVENT') {
          this.state = 'FINISH_TRACKING';
        } else if (nextEvt.type === 'MAJOR_GIFT_BOOST') {
          this.state = 'MAJOR_GIFT_SPOTLIGHT';
        } else if (nextEvt.type === 'NORMAL_GIFT_BOOST') {
          this.state = 'BOOST_SPOTLIGHT';
        } else if (nextEvt.type === 'OVERTAKE_EVENT') {
          this.state = 'OVERTAKE_SPOTLIGHT';
        } else {
          this.state = 'RACE_TRACKING';
        }
        this.hudDirty = true;
      }
    }

    // 2. Tính góc camera mục tiêu theo trạng thái
    let rawPose: CameraPose;
    if (this.state === 'LOBBY') {
      this.curDist = 0;
      this.curLat = 0;
      this.curSpeed = 0;
      this.trackInitialized = false;
      const s0 = sampleCircuit(0, 0);
      const orbitX = Math.sin(tSec * 0.42) * 10.5;
      rawPose = {
        posX: s0.x - s0.tx * 16.0 + s0.rx * orbitX,
        posY: 11.2,
        posZ: s0.z - s0.tz * 16.0 + s0.rz * orbitX,
        lookX: s0.x + s0.tx * 2.5,
        lookY: 2.1,
        lookZ: s0.z + s0.tz * 2.5,
        fov: 54,
        transitionSpeed: 3.6,
      };
    } else if (this.state === 'START_COUNTDOWN') {
      this.curDist = 0;
      this.curLat = 0;
      this.curSpeed = 0;
      this.trackInitialized = false;
      const s0 = sampleCircuit(0, 0);
      rawPose = {
        posX: s0.x - s0.tx * 14.0,
        posY: 9.8,
        posZ: s0.z - s0.tz * 14.0,
        lookX: s0.x + s0.tx * 4.0,
        lookY: 2.0,
        lookZ: s0.z + s0.tz * 4.0,
        fov: 54,
        transitionSpeed: 4.8,
      };
    } else if (this.state === 'RESULT_SHOWCASE') {
      this.trackInitialized = false;
      rawPose = this.finishCamera.computeResultShowcase(
        podiumCenter,
        podiumFrontDir,
        podiumRightDir,
        tSec,
      );
    } else {
      // Các pha chạy trên đường đua: dùng Hệ tọa độ cong dọc đường đua + Curve-Tangent Hybrid
      let target: TrackCameraTarget;
      if (this.state === 'FINISH_TRACKING') {
        target = this.finishCamera.computeFinishTarget(sortedRacers[0], this.bounds);
      } else if (
        (this.state === 'BOOST_SPOTLIGHT' ||
          this.state === 'MAJOR_GIFT_SPOTLIGHT' ||
          this.state === 'OVERTAKE_SPOTLIGHT') &&
        this.activeEvent?.userId &&
        racersMap.has(this.activeEvent.userId)
      ) {
        const spot = racersMap.get(this.activeEvent.userId)!;
        target = this.spotlightCamera.computeTarget(spot, this.state, tSec, this.bounds);
      } else {
        target = this.raceCamera.computeTarget(sortedRacers, this.bounds);
      }

      if (!this.trackInitialized) {
        this.trackInitialized = true;
        this.curDist = target.dist;
        this.curLat = target.lat;
        this.curSpeed = target.speed;
        this.curBack = target.back;
        this.curSide = target.side;
        this.curHeight = target.height;
        this.curLookAhead = target.lookAhead;
        this.curLookY = target.lookY;
        this.curFov = target.fov;
      }

      // Feed-forward theo vận tốc giúp triệt tiêu độ trễ khi bám đoàn đua,
      // đồng thời lia dọc theo đường cong khi đổi sang người tặng quà
      this.curSpeed += (target.speed - this.curSpeed) * (1 - Math.exp(-6.0 * dt));
      this.curDist += this.curSpeed * dt;
      const distAlpha = 1 - Math.exp(-target.panSpeed * dt);
      this.curDist += (target.dist - this.curDist) * distAlpha;

      const paramAlpha = 1 - Math.exp(-3.8 * dt);
      this.curLat += (target.lat - this.curLat) * (1 - Math.exp(-4.2 * dt));
      this.curBack += (target.back - this.curBack) * paramAlpha;
      this.curSide += (target.side - this.curSide) * (1 - Math.exp(-3.0 * dt));
      this.curHeight += (target.height - this.curHeight) * paramAlpha;
      this.curLookAhead += (target.lookAhead - this.curLookAhead) * paramAlpha;
      this.curLookY += (target.lookY - this.curLookY) * paramAlpha;
      this.curFov += (target.fov - this.curFov) * paramAlpha;

      // Chuyển sang tọa độ 3D bằng Curve-Tangent Hybrid (65% tiếp tuyến + 35% đường cong):
      // bảo đảm nhân vật không bao giờ lọt ra khỏi mép màn hình 9:16 ngay cả ở khúc cua gắt
      const focusS = sampleCircuit(this.curDist, this.curLat * 0.85);
      const lookS = sampleCircuit(this.curDist + this.curLookAhead, this.curLat * 0.85);
      const curveBackS = sampleCircuit(
        this.curDist - this.curBack,
        this.curLat * 0.4 + this.curSide,
      );
      const tangentBackX = focusS.x - focusS.tx * this.curBack + focusS.rx * this.curSide;
      const tangentBackZ = focusS.z - focusS.tz * this.curBack + focusS.rz * this.curSide;

      rawPose = {
        posX: tangentBackX * 0.65 + curveBackS.x * 0.35,
        posY: this.curHeight,
        posZ: tangentBackZ * 0.65 + curveBackS.z * 0.35,
        lookX: lookS.x,
        lookY: this.curLookY,
        lookZ: lookS.z,
        fov: this.curFov,
        transitionSpeed: 14.0,
      };
    }

    // 3. Kiểm tra va chạm địa hình/cổng + nội suy micro cuối
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
      LOBBY: '🎥 LOBBY CAM',
      START_COUNTDOWN: '🎥 XUẤT PHÁT',
      RACE_TRACKING: '🎥 ĐOÀN ĐUA',
      BOOST_SPOTLIGHT: '🎥 SPOTLIGHT QUÀ',
      MAJOR_GIFT_SPOTLIGHT: '🎥 VIP RỒNG THẦN',
      OVERTAKE_SPOTLIGHT: '🎥 VƯỢT TOP 1',
      FINISH_TRACKING: '🎥 CÁN ĐÍCH',
      RESULT_SHOWCASE: '🎥 VINH DANH TOP 3',
    };
    return {
      state: this.state,
      badgeText: labels[this.state],
      spotlightUserId: this.activeEvent?.userId || null,
      spotlightNickname: this.activeEvent?.nickname || '',
      spotlightLabel: this.activeEvent?.label || '',
      queueLength: this.queue.length,
    };
  }
}

export const _UNUSED_RACE_CONST_REF = RACE_CONSTANTS.DEFAULT_LAPS;
