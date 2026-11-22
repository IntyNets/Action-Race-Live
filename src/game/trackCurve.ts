/**
 * Hệ thống đường đua uốn lượn khép kín (Closed-Loop Winding Circuit) NHIỀU MAP:
 * - Mọi map đều bắt đầu & kết thúc tại CÙNG MỘT ĐIỂM (distance = 0, hướng +Z)
 * - Dùng bảng tra cứu arc-length để tính vị trí (x, z), hướng (yaw) và độ cong O(1) ở 60 FPS
 * - Đổi map bằng setActiveMap(id): CIRCUIT_TRACK được cập nhật tại chỗ + tăng trackVersion
 */

export interface TrackSample {
  x: number;
  z: number;
  /** Vector tiếp tuyến đơn vị (hướng chạy về phía trước) */
  tx: number;
  tz: number;
  /** Vector pháp tuyến bên phải (dùng tính làn ngang lateral offset) */
  rx: number;
  rz: number;
  /** Góc xoay Y (radians) để nhân vật hướng đúng dọc đường đua */
  yaw: number;
  /** Độ cong cục bộ (âm = cua trái, dương = cua phải) */
  curvature: number;
}

export interface MapTheme {
  sceneryType: 'park' | 'stadium' | 'mountain' | 'city';
  curbColorA: number;
  curbColorB: number;
  /** 5 màu gradient bầu trời từ đỉnh -> chân trời */
  sky: [string, string, string, string, string];
  fog: number;
  fogDensity: number;
  grassTint: number;
  leafA: number;
  leafB: number;
  hemiSky: number;
  hemiGround: number;
  sunColor: number;
  sunIntensity: number;
  exposure: number;
  cloudColor: number;
  treeCount: number;
  lake: boolean;
}

export interface MapDef {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  scale: number;
  points: Array<[number, number]>;
  theme: MapTheme;
}

const DAY_THEME: MapTheme = {
  sceneryType: 'park',
  curbColorA: 0xef4444,
  curbColorB: 0xf8fafc,
  sky: ['#0284c7', '#38bdf8', '#bae6fd', '#fef08a', '#fde68a'],
  fog: 0x93c5fd,
  fogDensity: 0.0032,
  grassTint: 0xffffff,
  leafA: 0x15803d,
  leafB: 0x22c55e,
  hemiSky: 0xe0f2fe,
  hemiGround: 0x166534,
  sunColor: 0xfff7ed,
  sunIntensity: 1.5,
  exposure: 1.1,
  cloudColor: 0xffffff,
  treeCount: 220,
  lake: true,
};

export const MAPS: MapDef[] = [
  {
    id: 'grand-prix',
    name: 'Grand Prix Công Viên',
    emoji: '🏞️',
    desc: 'Vòng đua cổ điển cua rộng + chữ S, nắng đẹp',
    scale: 1.7,
    points: [
      [0, -28],
      [0, 18],
      [8, 62],
      [44, 88],
      [86, 68],
      [72, 26],
      [108, -8],
      [102, -58],
      [54, -84],
      [14, -68],
    ],
    theme: DAY_THEME,
  },
  {
    id: 'stadium',
    name: 'Sân Vận Động Oval',
    emoji: '🏟️',
    desc: 'Đường oval tốc độ cao có một khúc chicane',
    scale: 0.95,
    points: [
      [0, -110],
      [0, -10],
      [0, 90],
      [15, 165],
      [65, 200],
      [115, 185],
      [135, 130],
      [120, 70],
      [150, 10],
      [135, -50],
      [125, -110],
      [95, -165],
      [45, -175],
      [10, -155],
    ],
    theme: {
      ...DAY_THEME,
      sceneryType: 'stadium',
      curbColorA: 0xfacc15,
      curbColorB: 0x2563eb,
      sky: ['#1d4ed8', '#3b82f6', '#93c5fd', '#fde68a', '#fed7aa'],
      fog: 0xbfdbfe,
      grassTint: 0xd9f99d,
      treeCount: 110,
      lake: false,
    },
  },
  {
    id: 'serpentine',
    name: 'Đèo Uốn Lượn',
    emoji: '⛰️',
    desc: 'Nhiều cua gắt zigzag, đoạn về thẳng bứt tốc',
    scale: 0.78,
    points: [
      [0, -60],
      [0, 40],
      [10, 110],
      [55, 150],
      [20, 200],
      [-30, 240],
      [10, 290],
      [70, 310],
      [130, 280],
      [100, 230],
      [150, 180],
      [110, 130],
      [150, 70],
      [140, 0],
      [150, -60],
      [110, -110],
      [50, -120],
      [10, -100],
    ],
    theme: {
      ...DAY_THEME,
      sceneryType: 'mountain',
      curbColorA: 0xf97316,
      curbColorB: 0xfef3c7,
      sky: ['#7c3aed', '#a78bfa', '#fbcfe8', '#fdba74', '#fde68a'],
      fog: 0xe9d5ff,
      grassTint: 0xbbf7d0,
      leafA: 0x14532d,
      leafB: 0x365314,
      hemiSky: 0xfae8ff,
      sunColor: 0xffedd5,
      treeCount: 260,
      lake: false,
    },
  },
  {
    id: 'neon-city',
    name: 'Thành Phố Neon Về Đêm',
    emoji: '🌃',
    desc: 'Đường phố đêm, rẽ góc vuông + vịnh cua kép',
    scale: 0.95,
    points: [
      [0, -90],
      [0, 30],
      [0, 130],
      [35, 175],
      [110, 175],
      [150, 135],
      [150, 70],
      [110, 40],
      [110, -20],
      [150, -60],
      [150, -130],
      [110, -170],
      [40, -170],
      [5, -135],
    ],
    theme: {
      sceneryType: 'city',
      curbColorA: 0xec4899,
      curbColorB: 0x22d3ee,
      sky: ['#020617', '#1e1b4b', '#4c1d95', '#be185d', '#fb7185'],
      fog: 0x1e1b4b,
      fogDensity: 0.0046,
      grassTint: 0x334155,
      leafA: 0x312e81,
      leafB: 0x7c3aed,
      hemiSky: 0x818cf8,
      hemiGround: 0x1e1b4b,
      sunColor: 0xc4b5fd,
      sunIntensity: 1.05,
      exposure: 1.0,
      cloudColor: 0x6d28d9,
      treeCount: 80,
      lake: false,
    },
  },
];

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

const SAMPLE_COUNT = 800;

interface BuiltTrack {
  samples: TrackSample[];
  totalLength: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minimapPoints: Array<{ x: number; y: number }>;
}

function buildClosedTrack(def: MapDef): BuiltTrack {
  const ctrl = def.points.map(([x, z]) => [x * def.scale, z * def.scale] as [number, number]);
  const n = ctrl.length;
  const rawCount = 2400;
  const rawPts: Array<{ x: number; z: number; s: number }> = [];
  let accum = 0;

  for (let i = 0; i < rawCount; i++) {
    const u = (i / rawCount) * n;
    const idx = Math.floor(u) % n;
    const t = u - Math.floor(u);
    const p0 = ctrl[(idx - 1 + n) % n];
    const p1 = ctrl[idx];
    const p2 = ctrl[(idx + 1) % n];
    const p3 = ctrl[(idx + 2) % n];

    const x = catmullRom(p0[0], p1[0], p2[0], p3[0], t);
    const z = catmullRom(p0[1], p1[1], p2[1], p3[1], t);
    if (i > 0) {
      accum += Math.hypot(x - rawPts[i - 1].x, z - rawPts[i - 1].z);
    }
    rawPts.push({ x, z, s: accum });
  }
  const closeDist = Math.hypot(
    rawPts[0].x - rawPts[rawCount - 1].x,
    rawPts[0].z - rawPts[rawCount - 1].z,
  );
  const totalLength = accum + closeDist;

  // Điểm gần (0, 0) nhất làm mốc distance = 0 (Vạch Xuất Phát & Về Đích)
  let startRawIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < rawCount; i++) {
    const d = Math.hypot(rawPts[i].x, rawPts[i].z);
    if (d < bestD) {
      bestD = d;
      startRawIdx = i;
    }
  }
  const startS = rawPts[startRawIdx].s;

  const pts: Array<{ x: number; z: number }> = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const targetS = ((i / SAMPLE_COUNT) * totalLength + startS) % totalLength;
    // Tìm đoạn chứa targetS bằng tìm kiếm nhị phân
    let lo = 0;
    let hi = rawCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rawPts[mid].s <= targetS) lo = mid;
      else hi = mid - 1;
    }
    const a = rawPts[lo];
    const b = rawPts[(lo + 1) % rawCount];
    const segLen = lo === rawCount - 1 ? closeDist : Math.max(1e-5, b.s - a.s);
    const alpha = Math.max(0, Math.min(1, (targetS - a.s) / segLen));
    const x = a.x + (b.x - a.x) * alpha;
    const z = a.z + (b.z - a.z) * alpha;
    pts.push({ x, z });
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const samples: TrackSample[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const prev = pts[(i - 2 + SAMPLE_COUNT) % SAMPLE_COUNT];
    const curr = pts[i];
    const next = pts[(i + 2) % SAMPLE_COUNT];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len;
    const tz = dz / len;
    const rx = -tz;
    const rz = tx;
    const yaw = Math.atan2(tx, tz);

    const prevPrev = pts[(i - 8 + SAMPLE_COUNT) % SAMPLE_COUNT];
    const nextNext = pts[(i + 8) % SAMPLE_COUNT];
    const ax = curr.x - prevPrev.x;
    const az = curr.z - prevPrev.z;
    const bx = nextNext.x - curr.x;
    const bz = nextNext.z - curr.z;
    const cross = ax * bz - az * bx;
    const denom = Math.hypot(ax, az) * Math.hypot(bx, bz) || 1;
    const curvature = Math.max(-1, Math.min(1, (cross / denom) * 3.2));

    samples.push({ x: curr.x, z: curr.z, tx, tz, rx, rz, yaw, curvature });
  }

  const pad = 12;
  const span = Math.max(maxX - minX, maxZ - minZ) || 1;
  const offX = (span - (maxX - minX)) * 0.5;
  const offZ = (span - (maxZ - minZ)) * 0.5;
  const minimapPoints: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < SAMPLE_COUNT; i += 8) {
    const p = samples[i];
    minimapPoints.push({
      x: pad + ((p.x - minX + offX) / span) * (100 - pad * 2),
      y: pad + ((maxZ - p.z + offZ) / span) * (100 - pad * 2),
    });
  }

  return { samples, totalLength, minX, maxX, minZ, maxZ, minimapPoints };
}

// Bộ nhớ đệm toàn bộ map đã dựng + độ dài km/vòng cho từng map
const BUILT_TRACK_CACHE = new Map<string, BuiltTrack>();
export const MAP_LAP_KM: Record<string, number> = {};
for (const m of MAPS) {
  const built = buildClosedTrack(m);
  BUILT_TRACK_CACHE.set(m.id, built);
  MAP_LAP_KM[m.id] = Math.round((built.totalLength / 1000) * 100) / 100;
}

// Đối tượng track dùng chung, được cập nhật tại chỗ khi đổi map
const initialBuilt = BUILT_TRACK_CACHE.get(MAPS[0].id)!;
export const CIRCUIT_TRACK: BuiltTrack = { ...initialBuilt };

let activeMapId = MAPS[0].id;
let trackVersion = 1;

export function getActiveMap(): MapDef {
  return MAPS.find((m) => m.id === activeMapId) || MAPS[0];
}

export function getActiveMapId(): string {
  return activeMapId;
}

export function getMapLapKm(id?: string): number {
  return MAP_LAP_KM[id || activeMapId] ?? 0.88;
}

/** Tăng mỗi khi đổi map -> để renderer biết cần dựng lại đường đua */
export function getTrackVersion(): number {
  return trackVersion;
}

export function setActiveMap(id: string): boolean {
  const def = MAPS.find((m) => m.id === id);
  if (!def || def.id === activeMapId) return false;
  const cached = BUILT_TRACK_CACHE.get(def.id) || buildClosedTrack(def);
  Object.assign(CIRCUIT_TRACK, cached);
  activeMapId = def.id;
  trackVersion++;
  return true;
}

export function getLapLength(): number {
  return CIRCUIT_TRACK.totalLength;
}

/**
 * Tra cứu tọa độ 3D, hướng chạy & độ cong theo quãng đường `distance` (mét) và lệch làn `lateral` (mét).
 */
export function sampleCircuit(distance: number, lateral = 0): TrackSample {
  const total = CIRCUIT_TRACK.totalLength;
  const wrapped = ((distance % total) + total) % total;
  const exact = (wrapped / total) * SAMPLE_COUNT;
  const i0 = Math.floor(exact) % SAMPLE_COUNT;
  const i1 = (i0 + 1) % SAMPLE_COUNT;
  const f = exact - Math.floor(exact);

  const a = CIRCUIT_TRACK.samples[i0];
  const b = CIRCUIT_TRACK.samples[i1];

  const cx = a.x + (b.x - a.x) * f;
  const cz = a.z + (b.z - a.z) * f;
  const tx = a.tx + (b.tx - a.tx) * f;
  const tz = a.tz + (b.tz - a.tz) * f;
  const tLen = Math.hypot(tx, tz) || 1;
  const ntx = tx / tLen;
  const ntz = tz / tLen;
  const rx = -ntz;
  const rz = ntx;

  return {
    x: cx + rx * lateral,
    z: cz + rz * lateral,
    tx: ntx,
    tz: ntz,
    rx,
    rz,
    yaw: Math.atan2(ntx, ntz),
    curvature: a.curvature + (b.curvature - a.curvature) * f,
  };
}

/**
 * Chuyển vị trí (x, z) thế giới sang tọa độ 0..100 trên Mini-Map 2D.
 */
export function worldToMinimap(x: number, z: number): { x: number; y: number } {
  const { minX, maxX, minZ, maxZ } = CIRCUIT_TRACK;
  const pad = 12;
  const span = Math.max(maxX - minX, maxZ - minZ) || 1;
  const offX = (span - (maxX - minX)) * 0.5;
  const offZ = (span - (maxZ - minZ)) * 0.5;
  return {
    x: pad + ((x - minX + offX) / span) * (100 - pad * 2),
    y: pad + ((maxZ - z + offZ) / span) * (100 - pad * 2),
  };
}
