import type { TimeOfDayMode } from './raceTypes';

/**
 * Bộ công cụ PBR / PBS / PBL, Texture 2K (2048x2048), Topology Triangle,
 * Tia Sét Phân Nhánh 3D, Tia Lửa Đạn Đạo Nảy Mặt Đường & Môi Trường Thời Gian Thực.
 */

// Băm số nguyên cực nhanh cho vòng lặp 4.19 triệu điểm ảnh 2K (0 cấp phát chuỗi, < 45ms)
function hash2D(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2D(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2D(x0, y0, seed);
  const b = hash2D(x1, y0, seed);
  const c = hash2D(x0, y1, seed);
  const d = hash2D(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export interface PBRTextureSet {
  map: any;
  normalMap: any;
  roughnessMap: any;
  dispose: () => void;
}

/**
 * Tạo bộ Texture PBR 2K (2048x2048) cho Mặt Đường Nhựa Đua Tốc Độ:
 * - Albedo 2K: Đá dăm bazan đa sắc, vệt lốp ma sát bóng nhẹ, vạch phân làn phản quang, dải quang học mép đường.
 * - NormalMap 2K: Pháp tuyến không gian tiếp tuyến tính từ trường độ cao vi mô (bắt sáng đèn & mặt trời cực nét).
 * - RoughnessMap 2K: Vùng nhựa nhám (0.78), vệt bánh xe (0.35), sơn phản quang (0.26).
 */
export function create2KAsphaltPBR(THREE: any, maxAnisotropy: number, texSize = 2048): PBRTextureSet {
  const N = texSize;
  const heightBuf = new Float32Array(N * N);

  const albCv = document.createElement('canvas');
  albCv.width = N;
  albCv.height = N;
  const albCtx = albCv.getContext('2d')!;
  const albImg = albCtx.createImageData(N, N);
  const albData = albImg.data;

  const rghCv = document.createElement('canvas');
  rghCv.width = N;
  rghCv.height = N;
  const rghCtx = rghCv.getContext('2d')!;
  const rghImg = rghCtx.createImageData(N, N);
  const rghData = rghImg.data;

  const laneSpacing = N / 6;
  const dashPeriod = N / 2;

  for (let y = 0; y < N; y++) {
    const vNorm = y / N;
    const inDash = (y % dashPeriod) > dashPeriod * 0.12 && (y % dashPeriod) < dashPeriod * 0.78;
    const rowOff = y * N;

    for (let x = 0; x < N; x++) {
      const idx = rowOff + x;
      const p4 = idx * 4;

      // Hạt đá dăm đa tầng + nhiễu nhựa đường liền mảnh (tileable)
      const fine = hash2D(x, y, 11);
      const med = valueNoise2D((x / N) * 256, (y / N) * 256, 256, 29);
      const macro = valueNoise2D((x / N) * 32, (y / N) * 32, 32, 71);

      // Vệt ma sát dọc giữa các làn chạy giúp độ nhám biến thiên chân thật
      const lanePhase = Math.abs(((x % laneSpacing) / laneSpacing) - 0.5) * 2;
      const tireWear = Math.max(0, 1 - lanePhase * 1.65) * 0.55;

      const pebble = fine > 0.86 ? (fine - 0.86) * 4.2 : 0;
      const hVal = med * 0.55 + fine * 0.3 + pebble * 0.65 - tireWear * 0.18;
      heightBuf[idx] = hVal;

      // Màu nền nhựa bazan tự nhiên
      let base = 28 + macro * 12 + med * 14 + pebble * 38 - tireWear * 5;
      let r = base;
      let g = base + 3;
      let b = base + 9;
      let rough = 202 - tireWear * 78 - pebble * 18; // ~0.79 nhám, vệt lốp ~0.48

      // Dải viền phản quang mép đường hai bên
      const edgeDist = Math.min(x, N - 1 - x);
      if (edgeDist >= Math.round(N * 0.012) && edgeDist <= Math.round(N * 0.028)) {
        r = 42;
        g = 198;
        b = 248;
        rough = 58;
        heightBuf[idx] += 0.35;
      }

      // 5 vạch kẻ phân làn sơn nhiệt dẻo trắng phản quang
      for (let l = 1; l <= 5; l++) {
        const lx = l * laneSpacing;
        if (inDash && Math.abs(x - lx) <= N * 0.0055) {
          const wear = 0.88 + med * 0.12;
          r = 242 * wear;
          g = 246 * wear;
          b = 250 * wear;
          rough = 72;
          heightBuf[idx] = 0.85 + fine * 0.08;
          break;
        }
      }

      // Vệt nứt vi mô rất mảnh tự nhiên dọc mặt nhựa
      if (Math.abs(macro - 0.5) < 0.004 && vNorm > 0.05) {
        r *= 0.68;
        g *= 0.68;
        b *= 0.7;
        rough = 235;
        heightBuf[idx] -= 0.45;
      }

      albData[p4] = r;
      albData[p4 + 1] = g;
      albData[p4 + 2] = b;
      albData[p4 + 3] = 255;

      const rg = Math.max(32, Math.min(248, rough));
      rghData[p4] = rg;
      rghData[p4 + 1] = rg;
      rghData[p4 + 2] = rg;
      rghData[p4 + 3] = 255;
    }
  }

  albCtx.putImageData(albImg, 0, 0);
  rghCtx.putImageData(rghImg, 0, 0);

  // Tính Normal Map 2K không gian tiếp tuyến từ đạo hàm bậc nhất trường độ cao
  const nrmCv = document.createElement('canvas');
  nrmCv.width = N;
  nrmCv.height = N;
  const nrmCtx = nrmCv.getContext('2d')!;
  const nrmImg = nrmCtx.createImageData(N, N);
  const nrmData = nrmImg.data;
  const strength = 2.65;

  for (let y = 0; y < N; y++) {
    const ym = ((y - 1 + N) % N) * N;
    const yp = ((y + 1) % N) * N;
    const y0 = y * N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N;
      const xp = (x + 1) % N;
      const dX = (heightBuf[y0 + xp] - heightBuf[y0 + xm]) * strength;
      const dY = (heightBuf[yp + x] - heightBuf[ym + x]) * strength;
      const invLen = 1 / Math.sqrt(dX * dX + dY * dY + 1);
      const p4 = (y0 + x) * 4;
      nrmData[p4] = (-dX * invLen * 0.5 + 0.5) * 255;
      nrmData[p4 + 1] = (-dY * invLen * 0.5 + 0.5) * 255;
      nrmData[p4 + 2] = (invLen * 0.5 + 0.5) * 255;
      nrmData[p4 + 3] = 255;
    }
  }
  nrmCtx.putImageData(nrmImg, 0, 0);

  const setupTex = (cv: HTMLCanvasElement, isSrgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAnisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  };

  const map = setupTex(albCv, true);
  const normalMap = setupTex(nrmCv, false);
  const roughnessMap = setupTex(rghCv, false);

  return {
    map,
    normalMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Tạo bộ Texture PBR 2K (2048x2048) cho Thảm Cỏ & Địa Hình Tự Nhiên:
 * - Albedo 2K: Thảm cỏ đa tầng kết hợp lớp đất mùn tự nhiên & ngọn cỏ non bắt nắng.
 * - NormalMap 2K: Độ nổi gân lá cỏ & sỏi tự nhiên.
 * - RoughnessMap 2K: Ngọn cỏ sương bóng nhẹ (0.46) trên nền đất mờ (0.92).
 */
export function create2KGrassPBR(THREE: any, maxAnisotropy: number, texSize = 2048): PBRTextureSet {
  const N = texSize;
  const heightBuf = new Float32Array(N * N);

  const albCv = document.createElement('canvas');
  albCv.width = N;
  albCv.height = N;
  const albCtx = albCv.getContext('2d')!;
  const albImg = albCtx.createImageData(N, N);
  const albData = albImg.data;

  const rghCv = document.createElement('canvas');
  rghCv.width = N;
  rghCv.height = N;
  const rghCtx = rghCv.getContext('2d')!;
  const rghImg = rghCtx.createImageData(N, N);
  const rghData = rghImg.data;

  for (let y = 0; y < N; y++) {
    const rowOff = y * N;
    for (let x = 0; x < N; x++) {
      const idx = rowOff + x;
      const p4 = idx * 4;

      const patch = valueNoise2D((x / N) * 16, (y / N) * 16, 16, 101);
      const clump = valueNoise2D((x / N) * 96, (y / N) * 96, 96, 211);
      // Tạo sợi cỏ mảnh hướng dọc nhẹ
      const blade = valueNoise2D((x / N) * 384, (y / N) * 128, 128, 307);
      const micro = hash2D(x, y, 409);

      const h = clump * 0.45 + blade * 0.45 + micro * 0.15;
      heightBuf[idx] = h;

      const lush = patch * 0.6 + clump * 0.4;
      const tip = Math.max(0, blade - 0.55) * 2.1;

      const r = 24 + lush * 26 + tip * 48 + (1 - clump) * 18;
      const g = 108 + lush * 68 + tip * 62;
      const b = 36 + lush * 24 + tip * 22;

      const rough = 228 - tip * 96 - lush * 22;

      albData[p4] = Math.min(255, r);
      albData[p4 + 1] = Math.min(255, g);
      albData[p4 + 2] = Math.min(255, b);
      albData[p4 + 3] = 255;

      const rg = Math.max(85, Math.min(246, rough));
      rghData[p4] = rg;
      rghData[p4 + 1] = rg;
      rghData[p4 + 2] = rg;
      rghData[p4 + 3] = 255;
    }
  }

  albCtx.putImageData(albImg, 0, 0);
  rghCtx.putImageData(rghImg, 0, 0);

  const nrmCv = document.createElement('canvas');
  nrmCv.width = N;
  nrmCv.height = N;
  const nrmCtx = nrmCv.getContext('2d')!;
  const nrmImg = nrmCtx.createImageData(N, N);
  const nrmData = nrmImg.data;
  const strength = 2.35;

  for (let y = 0; y < N; y++) {
    const ym = ((y - 1 + N) % N) * N;
    const yp = ((y + 1) % N) * N;
    const y0 = y * N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N;
      const xp = (x + 1) % N;
      const dX = (heightBuf[y0 + xp] - heightBuf[y0 + xm]) * strength;
      const dY = (heightBuf[yp + x] - heightBuf[ym + x]) * strength;
      const invLen = 1 / Math.sqrt(dX * dX + dY * dY + 1);
      const p4 = (y0 + x) * 4;
      nrmData[p4] = (-dX * invLen * 0.5 + 0.5) * 255;
      nrmData[p4 + 1] = (-dY * invLen * 0.5 + 0.5) * 255;
      nrmData[p4 + 2] = (invLen * 0.5 + 0.5) * 255;
      nrmData[p4 + 3] = 255;
    }
  }
  nrmCtx.putImageData(nrmImg, 0, 0);

  const setupTex = (cv: HTMLCanvasElement, isSrgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAnisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  };

  const map = setupTex(albCv, true);
  const normalMap = setupTex(nrmCv, false);
  const roughnessMap = setupTex(rghCv, false);

  return {
    map,
    normalMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Xây dựng dải đường đua / lề đường theo Topology Triangle dày mượt (nhiều dải tam giác ngang & dọc),
 * có độ vồng thoát nước nhẹ ở tim đường (crown camber) và pháp tuyến chuẩn để bắt sáng điểm & phản xạ PBR.
 */
export function buildTriangulatedRibbon(
  THREE: any,
  sampleCircuit: (dist: number, lateral: number) => { x: number; z: number; rx: number; rz: number },
  totalLen: number,
  innerOffset: number,
  outerOffset: number,
  yHeight: number,
  uvRepeatPerMeter: number,
  widthSegs = 8,
  crownHeight = 0.04,
) {
  const lenSegs = Math.max(260, Math.min(760, Math.ceil(totalLen / 2.5)));
  const cols = widthSegs + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= lenSegs; i++) {
    const dist = (i / lenSegs) * totalLen;
    const s = sampleCircuit(dist, 0);
    const v = dist * uvRepeatPerMeter;

    for (let j = 0; j <= widthSegs; j++) {
      const u = j / widthSegs;
      const lat = innerOffset + (outerOffset - innerOffset) * u;
      // Độ vồng parabol rất nhẹ ở giữa mặt đường giúp phản xạ ánh sáng PBS chân thật
      const camber = crownHeight * (1 - Math.pow(u * 2 - 1, 2));
      positions.push(s.x + s.rx * lat, yHeight + camber, s.z + s.rz * lat);
      uvs.push(u, v);
    }

    if (i < lenSegs) {
      const rowA = i * cols;
      const rowB = (i + 1) * cols;
      for (let j = 0; j < widthSegs; j++) {
        const a = rowA + j;
        const b = rowA + j + 1;
        const c = rowB + j;
        const d = rowB + j + 1;
        // Cắt chéo đối xứng theo tâm đường để lưới tam giác cân đối hoàn hảo
        if (j < widthSegs / 2) {
          indices.push(a, c, b, b, c, d);
        } else {
          indices.push(a, c, d, a, d, b);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Xây dựng địa hình lưới Tam Giác (Triangle Topology Terrain) có đồi thoai thoải tự nhiên ở vùng xa,
 * giữ phẳng tuyệt đối hành lang đường đua, hồ nước và bục trao giải.
 */
export function buildTriangulatedTerrain(
  THREE: any,
  grassSize: number,
  cx: number,
  cz: number,
  trackSamples: Array<{ x: number; z: number }>,
  halfW: number,
  lakeX: number,
  lakeZ: number,
  lakeR: number,
  podiumX: number,
  podiumZ: number,
  segs = 96,
) {
  const geo = new THREE.PlaneGeometry(grassSize, grassSize, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const flatCorridor = halfW + 14;
  const hillRamp = 38;

  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + cx;
    const wz = pos.getZ(i) + cz;

    let minDist = Infinity;
    for (let s = 0; s < trackSamples.length; s += 3) {
      const p = trackSamples[s];
      const d = Math.hypot(wx - p.x, wz - p.z);
      if (d < minDist) minDist = d;
    }
    if (lakeR > 0) {
      minDist = Math.min(minDist, Math.hypot(wx - lakeX, wz - lakeZ) - lakeR + 8);
    }
    minDist = Math.min(minDist, Math.hypot(wx - podiumX, wz - podiumZ) + 4);

    let y = -0.07;
    if (minDist > flatCorridor) {
      const t = Math.min(1, (minDist - flatCorridor) / hillRamp);
      const smooth = t * t * (3 - 2 * t);
      const undulation =
        Math.sin(wx * 0.028 + wz * 0.019) * 2.4 +
        Math.cos(wx * 0.052 - wz * 0.044) * 1.35 +
        Math.sin((wx + wz) * 0.014) * 3.1;
      y = -0.07 + Math.max(0, undulation + 2.1) * smooth;
    }
    pos.setY(i, y);
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * Hệ thống Tia Lửa Vật Lý Đạn Đạo 3D (Ballistic Triangle Sparks):
 * - Sử dụng 1 InstancedMesh duy nhất với hình học kim cương tam giác nhọn kéo dài theo vận tốc.
 * - Có trọng lực thật, nảy lách tách khi chạm mặt đường nhựa, và chuyển màu nhiệt độ vật đen (Trắng -> Vàng -> Cam -> Đỏ than).
 */
export interface SparkSpawnOpts {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life?: number;
  size?: number;
  tintHex?: number;
}

export function createBallisticSparkSystem(THREE: any, scene: any, maxSparks = 240) {
  // Hình khối tia lửa tam giác 8 mặt thuôn nhọn dọc trục +Z
  const geo = new THREE.OctahedronGeometry(0.065, 0);
  geo.scale(0.55, 0.55, 4.4);

  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.96,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const inst = new THREE.InstancedMesh(geo, mat, maxSparks);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.frustumCulled = false;
  scene.add(inst);

  interface SparkItem {
    active: boolean;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    maxLife: number;
    size: number;
    customTint: number; // -1 = dùng dải nhiệt độ vật đen tự nhiên
  }

  const items: SparkItem[] = [];
  const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
  const tmpColor = new THREE.Color();
  for (let i = 0; i < maxSparks; i++) {
    items.push({
      active: false,
      x: 0,
      y: -999,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 0.5,
      size: 1,
      customTint: -1,
    });
    inst.setMatrixAt(i, zeroMat);
    inst.setColorAt(i, tmpColor.setHex(0xffffff));
  }

  let cursor = 0;
  const dummy = new THREE.Object3D();
  const lookTarget = new THREE.Vector3();

  const spawn = (opts: SparkSpawnOpts) => {
    const it = items[cursor];
    cursor = (cursor + 1) % maxSparks;
    it.active = true;
    it.x = opts.x;
    it.y = opts.y;
    it.z = opts.z;
    it.vx = opts.vx;
    it.vy = opts.vy;
    it.vz = opts.vz;
    it.maxLife = opts.life ?? (0.32 + Math.random() * 0.34);
    it.life = it.maxLife;
    it.size = opts.size ?? 1.0;
    it.customTint = opts.tintHex !== undefined ? opts.tintHex : -1;
  };

  const update = (dt: number) => {
    let anyChanged = false;
    for (let i = 0; i < maxSparks; i++) {
      const it = items[i];
      if (!it.active) continue;
      anyChanged = true;
      it.life -= dt;
      if (it.life <= 0) {
        it.active = false;
        inst.setMatrixAt(i, zeroMat);
        continue;
      }

      // Lực cản không khí + trọng lực thật + nảy lách tách khi va xuống mặt đường nhựa!
      it.vy -= 15.5 * dt;
      it.vx *= 1 - 1.15 * dt;
      it.vz *= 1 - 1.15 * dt;

      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.z += it.vz * dt;

      if (it.y <= 0.06 && it.vy < 0) {
        it.y = 0.06;
        it.vy = -it.vy * (0.42 + (i % 5) * 0.05);
        it.vx *= 0.78;
        it.vz *= 0.78;
      }

      const spd = Math.hypot(it.vx, it.vy, it.vz);
      const t = it.life / it.maxLife; // 1.0 (mới bắn ra cực nóng) -> 0.0 (nguội tắt)

      dummy.position.set(it.x, it.y, it.z);
      lookTarget.set(it.x + it.vx, it.y + it.vy, it.z + it.vz);
      dummy.lookAt(lookTarget);
      const stretchZ = Math.max(0.6, Math.min(3.4, 0.55 + spd * 0.085)) * it.size;
      const thick = (0.45 + t * 0.65) * it.size;
      dummy.scale.set(thick, thick, stretchZ);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);

      // Dải bức xạ vật đen (Blackbody Thermal Cooling): Trắng xanh -> Vàng rực -> Cam lửa -> Đỏ than
      if (it.customTint >= 0) {
        if (t > 0.72) {
          tmpColor.setHex(0xffffff).lerp(new THREE.Color(it.customTint), (1 - t) * 2.8);
        } else {
          tmpColor.setHex(it.customTint).multiplyScalar(0.45 + t * 0.75);
        }
      } else if (t > 0.78) {
        tmpColor.setRGB(1.0, 0.99, 0.92);
      } else if (t > 0.48) {
        tmpColor.setRGB(1.0, 0.86, 0.28);
      } else if (t > 0.22) {
        tmpColor.setRGB(0.98, 0.44, 0.08);
      } else {
        tmpColor.setRGB(0.75 * (t / 0.22), 0.14 * (t / 0.22), 0.04);
      }
      inst.setColorAt(i, tmpColor);
    }

    if (anyChanged) {
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
  };

  return {
    spawn,
    update,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Tạo cụm Tia Sét Phân Nhánh 3D bằng Lưới Tam Giác Đôi (2-Layer Crossed Triangle Ribbon):
 * - Lõi trắng rực nhiệt độ cao (Incandescent Core) + Vỏ hồ quang plasma (Outer Sheath).
 * - Sinh đường gãy khúc tự nhiên (Midpoint Displacement) kèm nhánh phụ phóng xuống mặt đường.
 */
export function createJaggedLightningGroup(THREE: any) {
  const SEGS = 8; // thân chính 8 đoạn + 2 nhánh phụ x 3 đoạn = 14 đoạn x 2 mặt chữ thập = 56 tam giác!
  const TOTAL_SEGS = SEGS + 6;
  const VERTS = TOTAL_SEGS * 4 * 2; // 2 mặt phẳng vuông góc nhau cho mỗi đoạn -> nhìn góc nào cũng có khối 3D!
  const INDICES_COUNT = TOTAL_SEGS * 6 * 2;

  const makeRibbonGeo = () => {
    const pos = new Float32Array(VERTS * 3);
    const idx = new Uint16Array(INDICES_COUNT);
    let iPtr = 0;
    for (let s = 0; s < TOTAL_SEGS * 2; s++) {
      const v0 = s * 4;
      idx[iPtr++] = v0;
      idx[iPtr++] = v0 + 1;
      idx[iPtr++] = v0 + 2;
      idx[iPtr++] = v0 + 1;
      idx[iPtr++] = v0 + 3;
      idx[iPtr++] = v0 + 2;
    }
    const g = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(pos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', attr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.frustumCulled = false;
    return g;
  };

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.98,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const plasmaMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.58,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const grp = new THREE.Group();
  const BOLT_COUNT = 4;
  interface BoltMeshPair {
    coreGeo: any;
    plasmaGeo: any;
    nextSnapAt: number;
    anchor: [number, number, number];
    endTarget: [number, number, number];
  }
  const bolts: BoltMeshPair[] = [];
  const anchors: Array<{ a: [number, number, number]; b: [number, number, number] }> = [
    { a: [-0.55, 1.85, -0.15], b: [-1.05, 0.08, -3.45] }, // Vai trái phóng hồ quang chạm mặt đường
    { a: [0.55, 1.85, -0.15], b: [1.05, 0.08, -3.45] }, // Vai phải phóng hồ quang chạm mặt đường
    { a: [0.0, 2.35, -0.25], b: [0.0, 1.15, -3.95] }, // Đỉnh lưng kéo đuôi sét dài
    { a: [-0.35, 1.05, -0.2], b: [0.42, 0.12, -2.85] }, // Chân quấn chéo tia điện
  ];

  for (let b = 0; b < BOLT_COUNT; b++) {
    const coreGeo = makeRibbonGeo();
    const plasmaGeo = makeRibbonGeo();
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    const plasmaMesh = new THREE.Mesh(plasmaGeo, plasmaMat);
    grp.add(plasmaMesh, coreMesh);
    bolts.push({
      coreGeo,
      plasmaGeo,
      nextSnapAt: 0,
      anchor: anchors[b].a,
      endTarget: anchors[b].b,
    });
  }
  grp.visible = false;

  const writeSegQuad = (
    arr: Float32Array,
    segIdx: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    halfW: number,
  ) => {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.max(0.001, Math.hypot(dx, dy, dz));
    // 2 vector vuông góc với đoạn tia sét để tạo dải chữ thập 3D
    let p1x = -dz / len;
    let p1y = 0;
    let p1z = dx / len;
    const p1Len = Math.hypot(p1x, p1z);
    if (p1Len < 0.01) {
      p1x = 1;
      p1z = 0;
    } else {
      p1x /= p1Len;
      p1z /= p1Len;
    }
    // Mặt vuông góc thứ 2
    const p2x = (dy * p1z - dz * p1y) / len;
    const p2y = (dz * p1x - dx * p1z) / len;
    const p2z = (dx * p1y - dy * p1x) / len;

    const writePlane = (planeIdx: number, nx: number, ny: number, nz: number) => {
      const base = (segIdx * 2 + planeIdx) * 12;
      arr[base] = ax - nx * halfW;
      arr[base + 1] = ay - ny * halfW;
      arr[base + 2] = az - nz * halfW;

      arr[base + 3] = ax + nx * halfW;
      arr[base + 4] = ay + ny * halfW;
      arr[base + 5] = az + nz * halfW;

      arr[base + 6] = bx - nx * halfW;
      arr[base + 7] = by - ny * halfW;
      arr[base + 8] = bz - nz * halfW;

      arr[base + 9] = bx + nx * halfW;
      arr[base + 10] = by + ny * halfW;
      arr[base + 11] = bz + nz * halfW;
    };

    writePlane(0, p1x, p1y, p1z);
    writePlane(1, p2x, p2y, p2z);
  };

  const ptsX = new Float32Array(SEGS + 1);
  const ptsY = new Float32Array(SEGS + 1);
  const ptsZ = new Float32Array(SEGS + 1);

  const rebuildBolt = (bolt: BoltMeshPair, intensityScale: number) => {
    const [ax, ay, az] = bolt.anchor;
    const [bx, by, bz] = bolt.endTarget;
    ptsX[0] = ax;
    ptsY[0] = ay;
    ptsZ[0] = az;
    ptsX[SEGS] = bx + (Math.random() - 0.5) * 0.55;
    ptsY[SEGS] = Math.max(0.06, by + (Math.random() - 0.5) * 0.35);
    ptsZ[SEGS] = bz - Math.random() * 0.65;

    // Nội suy kèm nhiễu điện gãy khúc tự nhiên (Midpoint Jitter)
    for (let s = 1; s < SEGS; s++) {
      const t = s / SEGS;
      const env = Math.sin(t * Math.PI); // phình rộng ở giữa, hội tụ ở 2 đầu
      ptsX[s] = ptsX[0] + (ptsX[SEGS] - ptsX[0]) * t + (Math.random() - 0.5) * 0.72 * env;
      ptsY[s] = Math.max(
        0.06,
        ptsY[0] + (ptsY[SEGS] - ptsY[0]) * t + (Math.random() - 0.5) * 0.62 * env,
      );
      ptsZ[s] = ptsZ[0] + (ptsZ[SEGS] - ptsZ[0]) * t + (Math.random() - 0.5) * 0.25;
    }

    const coreArr = bolt.coreGeo.attributes.position.array as Float32Array;
    const plasmaArr = bolt.plasmaGeo.attributes.position.array as Float32Array;

    for (let s = 0; s < SEGS; s++) {
      const taper = (1 - (s / SEGS) * 0.55) * intensityScale;
      writeSegQuad(
        coreArr,
        s,
        ptsX[s],
        ptsY[s],
        ptsZ[s],
        ptsX[s + 1],
        ptsY[s + 1],
        ptsZ[s + 1],
        0.028 * taper,
      );
      writeSegQuad(
        plasmaArr,
        s,
        ptsX[s],
        ptsY[s],
        ptsZ[s],
        ptsX[s + 1],
        ptsY[s + 1],
        ptsZ[s + 1],
        0.095 * taper,
      );
    }

    // 2 nhánh tia sét phụ (Fork Branches) tách ra từ đốt thứ 2 và đốt thứ 5
    const forkRoots = [2, 5];
    let segCursor = SEGS;
    for (let f = 0; f < 2; f++) {
      const rIdx = forkRoots[f];
      let fx = ptsX[rIdx];
      let fy = ptsY[rIdx];
      let fz = ptsZ[rIdx];
      const dirSide = f === 0 ? -1 : 1;
      for (let fs = 0; fs < 3; fs++) {
        const nx = fx + dirSide * (0.18 + Math.random() * 0.28);
        const ny = Math.max(0.05, fy - (0.16 + Math.random() * 0.26));
        const nz = fz - (0.32 + Math.random() * 0.35);
        const fTaper = (1 - fs / 3) * 0.65 * intensityScale;
        writeSegQuad(coreArr, segCursor, fx, fy, fz, nx, ny, nz, 0.018 * fTaper);
        writeSegQuad(plasmaArr, segCursor, fx, fy, fz, nx, ny, nz, 0.062 * fTaper);
        fx = nx;
        fy = ny;
        fz = nz;
        segCursor++;
      }
    }

    bolt.coreGeo.attributes.position.needsUpdate = true;
    bolt.plasmaGeo.attributes.position.needsUpdate = true;
  };

  const update = (tSec: number, plasmaColorHex: number, coreTintHex = 0xffffff, intensityScale = 1.0) => {
    plasmaMat.color.setHex(plasmaColorHex);
    coreMat.color.setHex(coreTintHex);
    plasmaMat.opacity = 0.48 + Math.random() * 0.24;
    for (let b = 0; b < bolts.length; b++) {
      if (tSec >= bolts[b].nextSnapAt) {
        bolts[b].nextSnapAt = tSec + 0.032 + Math.random() * 0.028; // phóng hồ quang ~28Hz sống động
        rebuildBolt(bolts[b], intensityScale);
      }
    }
  };

  return { grp, update, coreMat, plasmaMat };
}

/**
 * Tính toán Bầu Trời Vật Lý (PBL Sky + Mặt Trời + Sao Đêm), Đổ Bóng Theo Độ Cao Nguồn Sáng,
 * và Biến Đổi Cảnh Sắc Theo Thời Gian Thực (Real-Time 24h hoặc Chu Kỳ).
 */
export interface RealTimeLightingState {
  hour24: number;
  sunElevationRad: number;
  sunAzimuthRad: number;
  /** 0 = đêm khuya, 1 = giữa trưa nắng cao */
  dayFactor: number;
  /** Độ cao nguồn sáng đổ bóng chính (sin(elev)): nguồn càng cao -> bóng càng ngắn, đậm và sắc nét! */
  shadowSourceHeightFactor: number;
  isNightLampsOn: boolean;
}

export function resolveHour24(mode: TimeOfDayMode, tSec: number): number {
  if (mode === 'dawn') return 6.25;
  if (mode === 'noon') return 12.15;
  if (mode === 'sunset') return 17.75;
  if (mode === 'night') return 21.5;
  if (mode === 'cycle') {
    // Chu kỳ 24 giờ mượt mà trong 5 phút (300 giây) để trình diễn trên Livestream
    return ((tSec / 300) * 24 + 8.5) % 24;
  }
  // Mặc định 'realtime': lấy chính xác giờ thực tế trên máy tính / múi giờ hiện tại từng giây!
  const d = new Date();
  return (
    d.getHours() +
    d.getMinutes() / 60 +
    d.getSeconds() / 3600 +
    d.getMilliseconds() / 3_600_000
  );
}

export function createPhysicalSkyAndRealTimeSystem(
  THREE: any,
  SkyClass: any,
  renderer: any,
  scene: any,
  pmrem: any,
) {
  // 1) Bầu trời tán xạ khí quyển vật lý Preetham (Physical Sky Shader)
  const sky = new SkyClass();
  sky.scale.setScalar(900);
  scene.add(sky);

  // Scene phụ siêu nhẹ chỉ chứa Sky để tái tạo bản đồ phản xạ môi trường IBL (PMREM) không tốn FPS
  const iblSkyScene = new THREE.Scene();
  const iblSky = new SkyClass();
  iblSky.scale.setScalar(100);
  iblSkyScene.add(iblSky);

  // 2) Đĩa Mặt Trời / Mặt Trăng phát sáng vật lý trên vòm trời
  const sunDiscMat = new THREE.MeshBasicMaterial({
    color: 0xfffbeb,
    fog: false,
  });
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(11.5, 24, 20), sunDiscMat);
  scene.add(sunDisc);

  // 3) Vòm Sao Đêm 3D tự động hiện lên mượt mà khi hoàng hôn buông xuống
  const starCount = 650;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = hash2D(i, 1, 77) * Math.PI * 2;
    const phi = Math.acos(0.08 + hash2D(i, 2, 91) * 0.92); // nửa vòm trời trên
    const r = 410;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xe2e8f0,
    size: 1.85,
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  const sunDir = new THREE.Vector3();
  const shadowLightDir = new THREE.Vector3();
  const cSunNoon = new THREE.Color(0xfffaf0);
  const cSunGolden = new THREE.Color(0xff8c42);
  const cMoonNight = new THREE.Color(0x93c5fd);
  const cHemiDaySky = new THREE.Color(0xbae6fd);
  const cHemiDuskSky = new THREE.Color(0xfb7185);
  const cHemiNightSky = new THREE.Color(0x1e293b);
  const cHemiDayGround = new THREE.Color(0x166534);
  const cHemiNightGround = new THREE.Color(0x090d16);
  const cFogDay = new THREE.Color(0xcbd5e1);
  const cFogGolden = new THREE.Color(0xfdba74);
  const cFogNight = new THREE.Color(0x0b1324);
  const tmpColor = new THREE.Color();
  const tmpColor2 = new THREE.Color();

  let lastIblElev = -999;
  let lastIblAt = -999;
  let currentEnvRT: any = null;

  const update = (opts: {
    mode: TimeOfDayMode;
    tSec: number;
    focusX: number;
    focusZ: number;
    cameraPos: any;
    sunLight: any;
    hemiLight: any;
    rimLight: any;
    fog: any;
    cloudMat: any;
    grassMat: any;
    leafMats: any[];
    lakeMat: any;
    streetLampMat?: any;
    isForcedNightCity?: boolean;
  }): RealTimeLightingState => {
    const hour24 = opts.isForcedNightCity ? 21.2 : resolveHour24(opts.mode, opts.tSec);

    // Góc giờ mặt trời: 06:00 mọc (elev = 0), 12:00 đỉnh trưa (elev ~ 78 độ = 1.36 rad), 18:00 lặn (elev = 0)
    const dayAngle = ((hour24 - 6) / 24) * Math.PI * 2;
    const rawSinElev = Math.sin(dayAngle); // -1 (nửa đêm) .. +1 (giữa trưa)
    const sunElevationRad = Math.asin(Math.max(-0.95, Math.min(0.98, rawSinElev * 0.975)));
    // Mặt trời di chuyển Đông -> Nam -> Tây chân thực
    const sunAzimuthRad = ((hour24 - 6) / 12) * Math.PI;

    const cosE = Math.cos(sunElevationRad);
    sunDir.set(
      cosE * Math.cos(sunAzimuthRad),
      Math.sin(sunElevationRad),
      cosE * Math.sin(sunAzimuthRad),
    ).normalize();

    // Hệ số ban ngày mượt (0 = đêm, 1 = trưa nắng cao)
    const dayFactor = Math.max(0, Math.min(1, (rawSinElev + 0.14) / 1.14));
    const twilightFactor = Math.max(0, 1 - Math.abs(rawSinElev) * 3.2); // cao nhất lúc bình minh & hoàng hôn

    // Cập nhật thông số khí quyển Preetham trên cả Sky chính & IBL Sky
    const turbidity = 2.2 + twilightFactor * 7.5 + (1 - dayFactor) * 1.2;
    const rayleigh = dayFactor > 0.08 ? 1.35 + twilightFactor * 2.4 : 0.18;
    const mieCoeff = 0.0035 + twilightFactor * 0.014;
    const mieG = 0.82 + twilightFactor * 0.12;

    for (const sObj of [sky, iblSky]) {
      const u = sObj.material.uniforms;
      u.turbidity.value = turbidity;
      u.rayleigh.value = rayleigh;
      u.mieCoefficient.value = mieCoeff;
      u.mieDirectionalG.value = mieG;
      u.sunPosition.value.copy(sunDir);
    }

    sky.position.copy(opts.cameraPos);
    stars.position.copy(opts.cameraPos);
    stars.rotation.y = opts.tSec * 0.004;
    starMat.opacity = Math.max(0, Math.min(0.92, (0.25 - rawSinElev) * 2.4));

    // Đặt đĩa Mặt Trời (ban ngày) hoặc Mặt Trăng bạc (ban đêm)
    const celestialDir = rawSinElev >= -0.06 ? sunDir : shadowLightDir;
    if (rawSinElev < -0.06) {
      // Ban đêm: Nguồn sáng Mặt Trăng / Đèn cao áp chiếu từ độ cao ~46 độ để vẫn có bóng đổ rõ tự nhiên
      const moonElev = 0.78; // ~45 độ
      const moonAzim = sunAzimuthRad + Math.PI;
      shadowLightDir.set(
        Math.cos(moonElev) * Math.cos(moonAzim),
        Math.sin(moonElev),
        Math.cos(moonElev) * Math.sin(moonAzim),
      ).normalize();
      sunDiscMat.color.setHex(0xe2e8f0);
    } else {
      // Ban ngày: Nguồn sáng đổ bóng đi ĐÚNG theo hướng Mặt Trời (giữ góc tối thiểu 13 độ lúc sát chân trời để bóng dài đẹp không vỡ)
      const clampedElev = Math.max(0.23, sunElevationRad);
      shadowLightDir.set(
        Math.cos(clampedElev) * Math.cos(sunAzimuthRad),
        Math.sin(clampedElev),
        Math.cos(clampedElev) * Math.sin(sunAzimuthRad),
      ).normalize();
      sunDiscMat.color.copy(cSunGolden).lerp(cSunNoon, Math.min(1, Math.max(0, rawSinElev * 1.4)));
    }
    sunDisc.position.copy(opts.cameraPos).addScaledVector(celestialDir, 395);

    // ĐỘ CAO NGUỒN SÁNG -> ĐỘ RÕ & ĐỘ ĐẬM CỦA BÓNG ĐỔ ("nguồn sáng càng cao thì bóng càng rõ")
    const heightFactor = Math.max(0.22, shadowLightDir.y); // 0.22 (sát chân trời) -> 0.98 (đỉnh đầu lúc 12h trưa)

    if (rawSinElev >= -0.06) {
      // Ban ngày: mặt trời càng lên cao -> cường độ chiếu thẳng càng mạnh, ánh sáng tán xạ nền vừa phải -> tương phản bóng đổ CỰC RÕ!
      const sunWarmth = Math.min(1, Math.max(0, (rawSinElev - 0.05) / 0.55));
      opts.sunLight.color.copy(cSunGolden).lerp(cSunNoon, sunWarmth);
      opts.sunLight.intensity = 1.25 + Math.pow(heightFactor, 1.25) * 2.15; // Trưa nắng cao đạt ~3.35!
      opts.hemiLight.color.copy(cHemiDuskSky).lerp(cHemiDaySky, sunWarmth);
      opts.hemiLight.groundColor.copy(cHemiNightGround).lerp(cHemiDayGround, dayFactor);
      // Khi nắng đứng bóng (heightFactor cao), giảm bớt ambient tràn để phần bóng râm dưới chân nhân vật & cây cối đậm nét rõ ràng!
      opts.hemiLight.intensity = 0.72 - heightFactor * 0.22;
      opts.fog.color.copy(cFogGolden).lerp(cFogDay, sunWarmth);
      opts.fog.density = 0.0022 + (1 - heightFactor) * 0.0018;
      renderer.toneMappingExposure = 0.96 + heightFactor * 0.16;
    } else {
      // Ban đêm: ánh trăng xanh dịu + đèn đường ấm áp
      opts.sunLight.color.copy(cMoonNight);
      opts.sunLight.intensity = 1.15;
      opts.hemiLight.color.copy(cHemiNightSky);
      opts.hemiLight.groundColor.copy(cHemiNightGround);
      opts.hemiLight.intensity = 0.58;
      opts.fog.color.copy(cFogNight);
      opts.fog.density = 0.0032;
      renderer.toneMappingExposure = 1.08;
    }

    opts.rimLight.intensity = 0.35 + (1 - dayFactor) * 0.45;

    // Đổ bóng chuẩn theo vector nguồn sáng + Khóa lưới Texel (Texel Snapping) để cạnh bóng sắc lẹm, không rung khi camera bay!
    if (opts.sunLight.castShadow) {
      const frustumHalf = 38; // Khung shadow ôm sát khu vực camera nhìn -> mật độ điểm ảnh bóng cực cao!
      if (opts.sunLight.shadow.camera.right !== frustumHalf) {
        opts.sunLight.shadow.camera.left = -frustumHalf;
        opts.sunLight.shadow.camera.right = frustumHalf;
        opts.sunLight.shadow.camera.top = frustumHalf;
        opts.sunLight.shadow.camera.bottom = -frustumHalf;
        opts.sunLight.shadow.camera.near = 4;
        opts.sunLight.shadow.camera.far = 195;
        opts.sunLight.shadow.camera.updateProjectionMatrix();
      }
      const mapW = opts.sunLight.shadow.mapSize.width || 2048;
      const texelSize = (frustumHalf * 2) / mapW;
      const snapX = Math.round(opts.focusX / texelSize) * texelSize;
      const snapZ = Math.round(opts.focusZ / texelSize) * texelSize;

      const lightDist = 92;
      opts.sunLight.position.set(
        snapX + shadowLightDir.x * lightDist,
        shadowLightDir.y * lightDist,
        snapZ + shadowLightDir.z * lightDist,
      );
      opts.sunLight.target.position.set(snapX, 0, snapZ);
      opts.sunLight.target.updateMatrixWorld();

      // Nguồn sáng càng cao -> normalBias nhỏ hơn để bóng bám sát chân nhân vật, càng rõ nét!
      opts.sunLight.shadow.bias = -0.00025;
      opts.sunLight.shadow.normalBias = 0.018 + (1 - heightFactor) * 0.025;
    }

    // Cảnh sắc tự nhiên (mây, cỏ, tán cây, mặt hồ, đèn đường) biến đổi mượt theo thời gian thực
    tmpColor.setHex(0xffffff).lerp(tmpColor2.setHex(0xfdba74), twilightFactor * 0.65);
    if (rawSinElev < -0.05) {
      tmpColor.setHex(0x334155);
    }
    opts.cloudMat.color.copy(tmpColor);

    // Nhuộm nhẹ ánh hoàng hôn / đêm cho mặt cỏ & hồ nước tự nhiên
    const grassBrightness = 0.45 + dayFactor * 0.58;
    opts.grassMat.color.setRGB(
      grassBrightness * (1 + twilightFactor * 0.18),
      grassBrightness,
      grassBrightness * (1 - twilightFactor * 0.12),
    );
    if (opts.lakeMat) {
      opts.lakeMat.emissiveIntensity = 0.08 + (1 - dayFactor) * 0.22;
    }

    const isNightLampsOn = dayFactor < 0.36 || Boolean(opts.isForcedNightCity);
    if (opts.streetLampMat) {
      if (opts.streetLampMat.emissive) {
        opts.streetLampMat.emissiveIntensity = isNightLampsOn ? 2.4 : 0.12;
      }
    }

    // Tái tạo bản đồ bức xạ môi trường IBL (PMREM PBL) định kỳ khi góc mặt trời thay đổi đáng kể
    if (
      Math.abs(sunElevationRad - lastIblElev) > 0.045 &&
      opts.tSec - lastIblAt > 2.5
    ) {
      lastIblElev = sunElevationRad;
      lastIblAt = opts.tSec;
      const nextRT = pmrem.fromScene(iblSkyScene, 0.035);
      scene.environment = nextRT.texture;
      scene.environmentIntensity = 0.55 + dayFactor * 0.45;
      if (currentEnvRT) currentEnvRT.dispose();
      currentEnvRT = nextRT;
    }

    return {
      hour24,
      sunElevationRad,
      sunAzimuthRad,
      dayFactor,
      shadowSourceHeightFactor: heightFactor,
      isNightLampsOn,
    };
  };

  const dispose = () => {
    if (currentEnvRT) currentEnvRT.dispose();
    starGeo.dispose();
    starMat.dispose();
    sunDisc.geometry.dispose();
    sunDiscMat.dispose();
  };

  return { sky, sunDisc, stars, update, dispose };
}
