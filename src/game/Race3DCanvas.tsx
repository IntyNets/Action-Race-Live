import React, { useEffect, useRef, useState } from 'react';
import {
  DroneRect,
  GraphicsQuality,
  MatchPhase,
  RACE_CONSTANTS,
  RacerState,
  SpectatorInfo,
  TimeOfDayMode,
} from './raceTypes';
import {
  CIRCUIT_TRACK,
  MapTheme,
  getActiveMap,
  getTrackVersion,
  sampleCircuit,
} from './trackCurve';
import { CameraDirector } from './camera/CameraDirector';
import {
  buildTriangulatedRibbon,
  buildTriangulatedTerrain,
  create2KAsphaltPBR,
  create2KCityTarAsphaltPBR,
  create2KGrassPBR,
  createBallisticSparkSystem,
  createCityBuildingFacadeTextures,
  createCityUrbanPavementTextures,
  createHeroPlasmaPointLightRig,
  createHologramDragonMaterial,
  createJaggedLightningGroup,
  createPhysicalSkyAndRealTimeSystem,
  createSoftRadialGlowTexture,
} from './pbrEnvironmentAndVfx';

interface Race3DCanvasProps {
  racersRef: React.MutableRefObject<Map<string, RacerState>>;
  spectatorsRef?: React.MutableRefObject<Map<string, SpectatorInfo>>;
  phaseRef: React.MutableRefObject<MatchPhase>;
  timerRef: React.MutableRefObject<number>;
  cameraDirectorRef: React.MutableRefObject<CameraDirector>;
  stepPhysics: (dt: number) => void;
  droneCamOn?: boolean;
  droneRect?: DroneRect;
  onDroneRectChange?: (rect: DroneRect) => void;
  canEditDrone?: boolean;
  graphicsQuality?: GraphicsQuality;
  timeOfDayMode?: TimeOfDayMode;
  onFpsSample?: (fps: number) => void;
}

interface DroneTagInfo {
  id: string;
  nickname: string;
  rank: number;
  color: string;
  boost: RacerState['boost'];
}

const MAX_DRONE_TAGS = 24;

interface LabelBadgeInfo {
  id: string;
  nickname: string;
  avatar: string;
  rank: number;
  lap: number;
  level: number;
  boost: RacerState['boost'];
  boostLabel: string;
  petName: string;
  isPodium?: boolean;
}

const MAX_BADGES = 30;
const MAX_PARTICLES = 260;

// Tách riêng Nhân vật người chơi & Thú cưng VIP từ nguồn iErcann/NotBlox (Notblox-Assets)
const NOTBLOX_CDN = 'https://cdn.jsdelivr.net/gh/iErcann/Notblox-Assets@main';

// 1) Nhân vật người chơi (chỉ dùng người NotBlox)
const NOTBLOX_CHARACTER_MODELS: Array<{ url: string; targetHeight: number }> = [
  { url: `${NOTBLOX_CDN}/character/Character.glb`, targetHeight: 2.55 },
  { url: `${NOTBLOX_CDN}/character/MiniCharacter.glb`, targetHeight: 2.3 },
];

// 2) Thú cưng VIP đồng hành (kích thước nhỏ gọn ~0.82m - 1.18m cân đối khi đi cạnh người 2.55m)
const NOTBLOX_PET_MODELS: Array<{ url: string; targetHeight: number }> = [
  { url: `${NOTBLOX_CDN}/animal/Cat.glb`, targetHeight: 0.9 },
  { url: `${NOTBLOX_CDN}/animal/Dog.glb`, targetHeight: 0.96 },
  { url: `${NOTBLOX_CDN}/animal/Wolf.glb`, targetHeight: 1.08 },
  { url: `${NOTBLOX_CDN}/animal/Horse.glb`, targetHeight: 1.18 },
  { url: `${NOTBLOX_CDN}/animal/Raccoon.glb`, targetHeight: 0.9 },
  { url: `${NOTBLOX_CDN}/animal/Pig.glb`, targetHeight: 0.9 },
  { url: `${NOTBLOX_CDN}/animal/Sheep.glb`, targetHeight: 0.96 },
  { url: `${NOTBLOX_CDN}/animal/Chick.glb`, targetHeight: 0.82 },
];

const NOTBLOX_PROP_MODELS = {
  car: `${NOTBLOX_CDN}/vehicle/Car.glb`,
  ezCar: `${NOTBLOX_CDN}/vehicle/EzCar.glb`,
  crate: `${NOTBLOX_CDN}/base/Crate.glb`,
  egg: `${NOTBLOX_CDN}/base/Egg.glb`,
  ball: `${NOTBLOX_CDN}/base/Ball.glb`,
};

const BOOST_BADGE_STYLE: Record<RacerState['boost'], string> = {
  none: '',
  chat: 'bg-sky-500/95 text-white',
  join: 'bg-emerald-400 text-slate-950 shadow-[0_0_10px_rgba(52,211,153,0.9)]',
  sprint: 'bg-cyan-400 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.85)]',
  jetpack: 'bg-amber-400 text-slate-950 shadow-[0_0_10px_rgba(251,191,36,0.85)]',
  rocket: 'bg-rose-500 text-white shadow-[0_0_14px_rgba(244,63,94,0.9)]',
  superman:
    'bg-gradient-to-r from-cyan-400 via-sky-400 to-amber-300 text-slate-950 shadow-[0_0_16px_rgba(56,189,248,0.95)]',
  dragon:
    'bg-gradient-to-r from-yellow-300 via-amber-400 to-orange-500 text-slate-950 shadow-[0_0_16px_rgba(251,191,36,0.95)]',
};

// Đồng bộ tên gọi 6 trạng thái hoạt ảnh chuẩn cho cả Character.glb và MiniCharacter.glb
type NotBloxAnimState = 'idle' | 'run' | 'sprint' | 'jump' | 'dance' | 'fall';

export const Race3DCanvas: React.FC<Race3DCanvasProps> = ({
  racersRef,
  spectatorsRef,
  phaseRef,
  timerRef,
  cameraDirectorRef,
  stepPhysics,
  droneCamOn = true,
  droneRect = { x: 63, y: 63, w: 34, h: 22 },
  onDroneRectChange,
  canEditDrone = false,
  graphicsQuality = 'medium',
  timeOfDayMode = 'realtime',
  onFpsSample,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const badgeElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const speedElsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const dronePipRef = useRef<HTMLDivElement | null>(null);
  const droneTagElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const speedLinesRef = useRef<HTMLDivElement | null>(null);
  const [badges, setBadges] = useState<LabelBadgeInfo[]>([]);
  const [droneTags, setDroneTags] = useState<DroneTagInfo[]>([]);
  const [fps, setFps] = useState<number>(0);
  const [loadedModelsCount, setLoadedModelsCount] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const stepPhysicsRef = useRef(stepPhysics);
  stepPhysicsRef.current = stepPhysics;
  const droneCamOnRef = useRef(droneCamOn);
  droneCamOnRef.current = droneCamOn;
  const graphicsQualityRef = useRef<GraphicsQuality>(graphicsQuality);
  graphicsQualityRef.current = graphicsQuality;
  const timeOfDayModeRef = useRef<TimeOfDayMode>(timeOfDayMode);
  timeOfDayModeRef.current = timeOfDayMode;
  const droneRectRef = useRef<DroneRect>(droneRect);
  droneRectRef.current = droneRect;
  const onFpsSampleRef = useRef(onFpsSample);
  onFpsSampleRef.current = onFpsSample;

  // Xử lý kéo thả & thu phóng khung Camera Drone trực tiếp trên Bảng Điều Khiển
  const startDroneInteract = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (!canEditDrone || !onDroneRectChange || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const cRect = containerRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const init = { ...droneRectRef.current };

    const onMove = (ev: PointerEvent) => {
      const dxPct = ((ev.clientX - startX) / Math.max(1, cRect.width)) * 100;
      const dyPct = ((ev.clientY - startY) / Math.max(1, cRect.height)) * 100;
      if (mode === 'move') {
        const nx = Math.max(1, Math.min(99 - init.w, init.x + dxPct));
        const ny = Math.max(8, Math.min(95 - init.h, init.y + dyPct));
        onDroneRectChange({
          x: Math.round(nx * 10) / 10,
          y: Math.round(ny * 10) / 10,
          w: init.w,
          h: init.h,
        });
      } else {
        const nw = Math.max(18, Math.min(72, Math.min(99 - init.x, init.w + dxPct)));
        const nh = Math.max(14, Math.min(50, Math.min(95 - init.y, init.h + dyPct)));
        onDroneRectChange({
          x: init.x,
          y: init.y,
          w: Math.round(nw * 10) / 10,
          h: Math.round(nh * 10) / 10,
        });
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let rafId = 0;
    let cleanupFn: (() => void) | null = null;

    const init = async () => {
      try {
        const dynamicImport = new Function('specifier', 'return import(specifier)') as (
          s: string,
        ) => Promise<any>;
        const [THREE, gltfMod, dracoMod, skelMod, skyMod] = await Promise.all([
          dynamicImport('three'),
          dynamicImport('three/addons/loaders/GLTFLoader.js'),
          dynamicImport('three/addons/loaders/DRACOLoader.js'),
          dynamicImport('three/addons/utils/SkeletonUtils.js'),
          dynamicImport('three/addons/objects/Sky.js'),
        ]);
        if (cancelled) return;

        const { GLTFLoader } = gltfMod;
        const { DRACOLoader } = dracoMod;
        const SkeletonUtils = skelMod;
        const { Sky } = skyMod;

        // ---------- Renderer + PBR/PBS/PBL + Đổ Bóng Độ Phân Giải Cao (PCFSoftShadowMap) ----------
        const renderer = new THREE.WebGLRenderer({
          antialias: false,
          powerPreference: 'high-performance',
        });
        const gl = renderer.getContext();
        const maxBufferSide = Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
        const resizeDrawingBuffer = () => {
          const width = container.clientWidth || 540;
          const height = container.clientHeight || 960;
          const longSide = Math.max(width, height);
          const shortSide = Math.min(width, height);
          const quality = graphicsQualityRef.current;
          const dpr = window.devicePixelRatio || 1;
          const scale = quality === '4k' ? Math.min(3840 / longSide, 2160 / shortSide) :
            quality === 'high' ? Math.min(dpr, 1.6, 2560 / longSide) :
            quality === 'medium' ? Math.min(dpr, 1.15, 1440 / longSide) : Math.min(dpr, 0.85, 854 / longSide);
          renderer.setDrawingBufferSize(width, height, Math.min(scale, maxBufferSide / longSide));
          renderer.domElement.style.width = '100%';
          renderer.domElement.style.height = '100%';
        };
        resizeDrawingBuffer();
        renderer.shadowMap.enabled = graphicsQualityRef.current !== 'low';
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy?.() || 8);

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0xcbd5e1, 0.0028);

        const pmrem = new THREE.PMREMGenerator(renderer);

        const camera = new THREE.PerspectiveCamera(
          52,
          (container.clientWidth || 540) / (container.clientHeight || 960),
          0.5,
          560,
        );
        const droneCamera = new THREE.PerspectiveCamera(46, 1, 1, 950);
        let droneCx = (CIRCUIT_TRACK.minX + CIRCUIT_TRACK.maxX) * 0.5;
        let droneCz = (CIRCUIT_TRACK.minZ + CIRCUIT_TRACK.maxZ) * 0.5;
        let droneSpan = Math.max(
          110,
          CIRCUIT_TRACK.maxX - CIRCUIT_TRACK.minX,
          CIRCUIT_TRACK.maxZ - CIRCUIT_TRACK.minZ,
        );
        let lastDroneSig = '';

        // Hệ thống Bầu Trời Vật Lý (PBL Preetham Sky + Đĩa Mặt Trời/Trăng + Vòm Sao Đêm) theo thời gian thực
        const realTimeSky = createPhysicalSkyAndRealTimeSystem(
          THREE,
          Sky,
          renderer,
          scene,
          pmrem,
        );

        // Ánh sáng PBL + Nguồn sáng Mặt Trời đổ bóng theo đúng góc & độ cao thực tế (nguồn càng cao bóng càng sắc nét!)
        const hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x166534, 0.62);
        scene.add(hemiLight);
        const sunLight = new THREE.DirectionalLight(0xfffaf0, 2.85);
        sunLight.position.set(28, 76, -22);
        sunLight.castShadow = graphicsQualityRef.current !== 'low';
        sunLight.shadow.mapSize.set(
          1024,
          1024,
        );
        sunLight.shadow.camera.near = 4;
        sunLight.shadow.camera.far = 195;
        sunLight.shadow.camera.left = -38;
        sunLight.shadow.camera.right = 38;
        sunLight.shadow.camera.top = 38;
        sunLight.shadow.camera.bottom = -38;
        sunLight.shadow.bias = -0.00025;
        sunLight.shadow.normalBias = 0.022;
        scene.add(sunLight);
        scene.add(sunLight.target);
        const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
        rimLight.position.set(-50, 34, 80);
        scene.add(rimLight);
        // Đèn điểm chiếu sáng mặt đường nhựa 2K PBR (phản xạ hạt đá dăm & vệt lốp chân thật)
        const flashRoadLight = new THREE.PointLight(0xfacc15, 0, 34, 1.45);
        flashRoadLight.position.set(0, 1.85, 0);
        scene.add(flashRoadLight);

        // Hệ thống Ánh Sáng Điểm Động làm nổi bật khối 3D nhân vật khi tăng tốc (KHÔNG có quả cầu hiển thị, giữ nguyên màu gốc)
        const heroLightRig = createHeroPlasmaPointLightRig(THREE, scene);
        const softLampGlowTex = createSoftRadialGlowTexture(THREE);

        // Đèn tỏa sáng rực rỡ từ luồng lửa đuôi Tên Lửa Rocket chiếu sáng mặt đường & xung quanh
        const rocketExhaustLight = new THREE.PointLight(0xff7a18, 0, 30, 1.25);
        scene.add(rocketExhaustLight);

        // Đèn hào quang Hologram huyền ảo tỏa sáng từ Rồng Thần xuống mặt đất
        const dragonHoloLight = new THREE.PointLight(0x22d3ee, 0, 28, 1.3);
        scene.add(dragonHoloLight);

        // ---------- Procedural Textures ----------
        const makeAsphaltTexture = () => {
          const cv = document.createElement('canvas');
          cv.width = 512;
          cv.height = 512;
          const ctx = cv.getContext('2d')!;
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 0, 512, 512);
          for (let i = 0; i < 6000; i++) {
            const v = 26 + Math.floor(Math.random() * 26);
            ctx.fillStyle = `rgb(${v},${v + 6},${v + 16})`;
            ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
          }
          // Viền neon cyan hai bên mép đường
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(6, 0, 10, 512);
          ctx.fillRect(496, 0, 10, 512);
          // 5 vạch kẻ làn đường đứt khúc
          ctx.fillStyle = 'rgba(248,250,252,0.85)';
          for (let l = 1; l <= 5; l++) {
            const lx = Math.round((512 / 6) * l) - 3;
            ctx.fillRect(lx, 30, 6, 175);
            ctx.fillRect(lx, 288, 6, 175);
          }
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          return tex;
        };

        const makeCurbTexture = (colorA = 0xef4444, colorB = 0xf8fafc) => {
          const cv = document.createElement('canvas');
          cv.width = 64;
          cv.height = 256;
          const ctx = cv.getContext('2d')!;
          ctx.fillStyle = '#' + colorA.toString(16).padStart(6, '0');
          ctx.fillRect(0, 0, 64, 128);
          ctx.fillStyle = '#' + colorB.toString(16).padStart(6, '0');
          ctx.fillRect(0, 128, 64, 128);
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          return tex;
        };

        const makeGrassTexture = () => {
          const cv = document.createElement('canvas');
          cv.width = 256;
          cv.height = 256;
          const ctx = cv.getContext('2d')!;
          ctx.fillStyle = '#22c55e';
          ctx.fillRect(0, 0, 256, 256);
          ctx.fillStyle = '#16a34a';
          ctx.fillRect(0, 0, 256, 128);
          for (let i = 0; i < 1000; i++) {
            ctx.fillStyle = i % 2 === 0 ? 'rgba(134,239,172,0.32)' : 'rgba(21,128,61,0.32)';
            ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 6);
          }
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(28, 28);
          return tex;
        };

        const makeShadowTexture = () => {
          const cv = document.createElement('canvas');
          cv.width = 64;
          cv.height = 64;
          const ctx = cv.getContext('2d')!;
          const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
          g.addColorStop(0, 'rgba(2,6,23,0.62)');
          g.addColorStop(0.6, 'rgba(2,6,23,0.28)');
          g.addColorStop(1, 'rgba(2,6,23,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 64, 64);
          return new THREE.CanvasTexture(cv);
        };

        const makeGlowParticleTexture = () => {
          const cv = document.createElement('canvas');
          cv.width = 64;
          cv.height = 64;
          const ctx = cv.getContext('2d')!;
          // Hào quang đốm sáng mềm (Soft Bokeh)
          const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
          g.addColorStop(0, 'rgba(255,255,255,1)');
          g.addColorStop(0.25, 'rgba(255,255,255,0.92)');
          g.addColorStop(0.55, 'rgba(255,255,255,0.32)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 64, 64);
          // Tia sao 4 cánh mảnh tự nhiên (Starburst Sparkle)
          ctx.save();
          ctx.translate(32, 32);
          const drawSpike = (ang: number, len: number, w: number) => {
            ctx.save();
            ctx.rotate(ang);
            const sg = ctx.createLinearGradient(0, -len, 0, len);
            sg.addColorStop(0, 'rgba(255,255,255,0)');
            sg.addColorStop(0.5, 'rgba(255,255,255,0.95)');
            sg.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = sg;
            ctx.fillRect(-w / 2, -len, w, len * 2);
            ctx.restore();
          };
          drawSpike(0, 29, 2.6);
          drawSpike(Math.PI / 2, 29, 2.6);
          drawSpike(Math.PI / 4, 16, 1.5);
          drawSpike(-Math.PI / 4, 16, 1.5);
          ctx.restore();
          return new THREE.CanvasTexture(cv);
        };

        const makeCheckeredTexture = (cols = 14, rows = 2) => {
          const cv = document.createElement('canvas');
          cv.width = cols * 32;
          cv.height = rows * 32;
          const ctx = cv.getContext('2d')!;
          for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
              ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#0f172a';
              ctx.fillRect(x * 32, y * 32, 32, 32);
            }
          }
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          return tex;
        };

        const makeSignTexture = (text: string, bg: string, fg = '#ffffff', accent = '#facc15') => {
          const cv = document.createElement('canvas');
          cv.width = 512;
          cv.height = 128;
          const ctx = cv.getContext('2d')!;
          const grad = ctx.createLinearGradient(0, 0, 512, 128);
          grad.addColorStop(0, bg);
          grad.addColorStop(1, '#0f172a');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, 512, 128);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 10;
          ctx.strokeRect(5, 5, 502, 118);
          ctx.fillStyle = fg;
          ctx.font = '900 46px "Be Vietnam Pro", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, 256, 66);
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          return tex;
        };

        const makeRobloxFaceTexture = () => {
          const cv = document.createElement('canvas');
          cv.width = 128;
          cv.height = 128;
          const ctx = cv.getContext('2d')!;
          ctx.fillStyle = '#fde68a';
          ctx.fillRect(0, 0, 128, 128);
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(44, 56, 9, 0, Math.PI * 2);
          ctx.arc(84, 56, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(47, 52, 3, 0, Math.PI * 2);
          ctx.arc(87, 52, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(64, 72, 20, 0.14 * Math.PI, 0.86 * Math.PI);
          ctx.stroke();
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          return tex;
        };

        // ---------- 1. Xây dựng Map Đường Đua (dựng lại được khi đổi map) ----------
        const trackW = RACE_CONSTANTS.TRACK_WIDTH;
        const halfW = trackW / 2;
        const dummy = new THREE.Object3D();

        // Vật liệu PBR / PBS 2K (2048x2048 Albedo + NormalMap + RoughnessMap) & Hình khối Topology Triangle
        const grassPBR = create2KGrassPBR(THREE, maxAniso, 2048);
        const asphaltPBR = create2KAsphaltPBR(THREE, maxAniso, 2048);
        const cityTarAsphaltPBR = create2KCityTarAsphaltPBR(THREE, maxAniso, 2048);
        const buildingFacadeTex = createCityBuildingFacadeTextures(THREE, maxAniso);
        const cityPavementTex = createCityUrbanPavementTextures(THREE, maxAniso);

        const cityPlazaGroundMat = new THREE.MeshPhysicalMaterial({
          map: cityPavementTex.plazaMap,
          normalMap: cityTarAsphaltPBR.normalMap,
          normalScale: new THREE.Vector2(0.55, 0.55),
          roughness: 0.72,
          metalness: 0.15,
          clearcoat: 0.35,
          clearcoatRoughness: 0.28,
          envMapIntensity: 1.15,
        });
        const citySidewalkMat = new THREE.MeshPhysicalMaterial({
          map: cityPavementTex.sidewalkMap,
          normalMap: asphaltPBR.normalMap,
          normalScale: new THREE.Vector2(0.45, 0.45),
          roughness: 0.48,
          metalness: 0.12,
          clearcoat: 0.52,
          clearcoatRoughness: 0.22,
          envMapIntensity: 1.35,
        });

        const grassMat = new THREE.MeshPhysicalMaterial({
          map: grassPBR.map,
          normalMap: grassPBR.normalMap,
          normalScale: new THREE.Vector2(0.95, 0.95),
          roughnessMap: grassPBR.roughnessMap,
          roughness: 1.0,
          metalness: 0.0,
          sheen: 0.52,
          sheenRoughness: 0.68,
          sheenColor: new THREE.Color(0x86efac),
          envMapIntensity: 0.85,
        });
        const roadMat = new THREE.MeshPhysicalMaterial({
          map: asphaltPBR.map,
          normalMap: asphaltPBR.normalMap,
          normalScale: new THREE.Vector2(1.18, 1.18),
          roughnessMap: asphaltPBR.roughnessMap,
          roughness: 1.0,
          metalness: 0.06,
          clearcoat: 0.22,
          clearcoatRoughness: 0.38,
          ior: 1.48,
          envMapIntensity: 1.18,
        });
        const curbMat = new THREE.MeshPhysicalMaterial({
          map: makeCurbTexture(),
          roughness: 0.38,
          clearcoat: 0.35,
          clearcoatRoughness: 0.3,
        });
        const barrierGeo = new THREE.BoxGeometry(0.7, 1.05, 3.6);
        const barrierRed = new THREE.MeshPhysicalMaterial({
          color: 0xef4444,
          roughness: 0.32,
          clearcoat: 0.45,
          clearcoatRoughness: 0.25,
        });
        const barrierWhite = new THREE.MeshPhysicalMaterial({
          color: 0xf8fafc,
          roughness: 0.32,
          clearcoat: 0.45,
          clearcoatRoughness: 0.25,
        });
        // Cây xanh, bụi cỏ & hoa sử dụng lưới Triangle mịn hơn (bỏ mảng phẳng thô) + tán lá PBS
        const trunkGeo = new THREE.CylinderGeometry(0.28, 0.56, 4.1, 12);
        const leafBotGeo = new THREE.IcosahedronGeometry(2.05, 2);
        const leafTopGeo = new THREE.IcosahedronGeometry(1.48, 2);
        const bushGeo = new THREE.IcosahedronGeometry(1.05, 2);
        const grassBladeGeo = new THREE.ConeGeometry(0.22, 0.95, 6);
        const flowerGeo = new THREE.OctahedronGeometry(0.28, 1);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b3a19, roughness: 0.9 });
        const leafMatA = new THREE.MeshPhysicalMaterial({
          color: 0x15803d,
          roughness: 0.72,
          sheen: 0.45,
          sheenColor: new THREE.Color(0x4ade80),
        });
        const leafMatB = new THREE.MeshPhysicalMaterial({
          color: 0x22c55e,
          roughness: 0.68,
          sheen: 0.48,
          sheenColor: new THREE.Color(0x86efac),
        });
        const leafMatC = new THREE.MeshPhysicalMaterial({
          color: 0x4ade80,
          roughness: 0.65,
          sheen: 0.5,
          sheenColor: new THREE.Color(0xbbf7d0),
        });
        const grassBladeMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.8 });
        const flowerMatPink = new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.48 });
        const flowerMatGold = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.44 });
        const standGeo = new THREE.BoxGeometry(6.5, 4.4, 18);
        const standRoofGeo = new THREE.BoxGeometry(7.6, 0.6, 18.6);
        const standMat = new THREE.MeshStandardMaterial({ color: 0x4f46e5, roughness: 0.5 });
        const roofMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.32 });
        const lakeMat = new THREE.MeshPhysicalMaterial({
          color: 0x0284c7,
          emissive: 0x0369a1,
          emissiveIntensity: 0.14,
          roughness: 0.06,
          metalness: 0.12,
          clearcoat: 1.0,
          clearcoatRoughness: 0.04,
          ior: 1.333,
          reflectivity: 0.95,
          normalMap: grassPBR.normalMap,
          normalScale: new THREE.Vector2(0.18, 0.18),
        });
        const gatePillarGeo = new THREE.BoxGeometry(1.3, 10.2, 1.3);
        const gatePillarMat = new THREE.MeshPhysicalMaterial({
          color: 0xfacc15,
          metalness: 0.65,
          roughness: 0.22,
          clearcoat: 0.6,
        });
        const gateBannerMat = new THREE.MeshBasicMaterial({ map: makeCheckeredTexture(22, 3) });
        const finishLineMat = new THREE.MeshStandardMaterial({
          map: makeCheckeredTexture(14, 2),
          roughness: 0.42,
        });

        // Hình khối Triangle mịn cho 4 bản đồ (Park / Stadium / Mountain / Neon City)
        const pineConeBotGeo = new THREE.ConeGeometry(2.3, 3.6, 12);
        const pineConeTopGeo = new THREE.ConeGeometry(1.6, 2.8, 12);
        const mountainPeakGeo = new THREE.ConeGeometry(1.0, 1.0, 9);
        const mountainSnowGeo = new THREE.ConeGeometry(0.42, 0.42, 9);
        const boulderGeo = new THREE.DodecahedronGeometry(1.6, 1);
        const rockMat = new THREE.MeshStandardMaterial({
          color: 0x64748b,
          roughness: 0.88,
          normalMap: asphaltPBR.normalMap,
          normalScale: new THREE.Vector2(0.65, 0.65),
        });
        const snowMat = new THREE.MeshPhysicalMaterial({
          color: 0xf8fafc,
          roughness: 0.48,
          sheen: 0.4,
          sheenColor: new THREE.Color(0xe0f2fe),
        });

        const fountainBaseGeo = new THREE.CylinderGeometry(4.5, 5.2, 0.9, 24);
        const fountainJetGeo = new THREE.CylinderGeometry(0.7, 1.15, 7.5, 18);
        const fountainRingGeo = new THREE.TorusGeometry(2.6, 0.28, 12, 28);
        const fountainStoneMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.45 });
        const fountainWaterMat = new THREE.MeshPhysicalMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.84,
          roughness: 0.08,
          ior: 1.333,
        });
        const balloonEnvelopeGeo = new THREE.SphereGeometry(3.2, 20, 16);
        const balloonBasketGeo = new THREE.BoxGeometry(1.5, 1.2, 1.5);
        const balloonPalette = [0xef4444, 0xfacc15, 0x38bdf8, 0xec4899, 0x22c55e, 0xa855f7];
        const balloonMats = balloonPalette.map(
          (col) => new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.36, clearcoat: 0.35 }),
        );

        const towerPoleGeo = new THREE.BoxGeometry(0.85, 18.0, 0.85);
        const towerHeadGeo = new THREE.BoxGeometry(4.6, 1.8, 0.9);
        const towerGlowMat = new THREE.MeshStandardMaterial({
          color: 0xfef9c3,
          emissive: 0xfef08a,
          emissiveIntensity: 0.5,
          roughness: 0.2,
        });
        const trophyBaseGeo = new THREE.CylinderGeometry(4.0, 4.8, 2.2, 20);
        const trophyStemGeo = new THREE.CylinderGeometry(1.0, 1.6, 4.0, 20);
        const trophyCupGeo = new THREE.CylinderGeometry(4.2, 1.8, 4.8, 20);
        const trophyGoldMat = new THREE.MeshPhysicalMaterial({
          color: 0xfacc15,
          emissive: 0xd97706,
          emissiveIntensity: 0.25,
          metalness: 0.92,
          roughness: 0.14,
          clearcoat: 0.9,
          clearcoatRoughness: 0.1,
        });

        const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
        const buildingFacadeMats = buildingFacadeTex.variants.map(
          (v) =>
            new THREE.MeshPhysicalMaterial({
              color: 0xffffff,
              map: v.map,
              emissive: 0xffffff,
              emissiveMap: v.emissiveMap,
              emissiveIntensity: 1.85,
              roughness: 0.22,
              metalness: 0.48,
              clearcoat: 0.75,
              envMapIntensity: 1.3,
            }),
        );
        const buildingBodyMat = buildingFacadeMats[0];
        const buildingRoofMat = new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          roughness: 0.85,
          metalness: 0.25,
        });
        const buildingPenthouseMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          roughness: 0.68,
          metalness: 0.42,
        });
        const matDarkMetal = new THREE.MeshPhysicalMaterial({
          color: 0x334155,
          metalness: 0.86,
          roughness: 0.26,
          clearcoat: 0.4,
        });
        const neonCyanMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
        const neonPinkMat = new THREE.MeshBasicMaterial({ color: 0xec4899 });
        const neonAmberMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
        const streetPostGeo = new THREE.BoxGeometry(0.42, 7.2, 0.42);
        const streetArmGeo = new THREE.BoxGeometry(2.4, 0.32, 0.42);
        const streetLampGeo = new THREE.BoxGeometry(1.1, 0.35, 0.65);

        const floatingLandmarks: Array<{ mesh: any; baseY: number; phase: number }> = [];

        // Mây tích (Cumulus) lưới Tam Giác tròn mịn tự nhiên thay thế hoàn toàn khối hộp vuông
        const cloudAnchor = new THREE.Group();
        const cloudGroup = new THREE.Group();
        const cloudMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.92,
        });
        const cloudPuffGeoA = new THREE.IcosahedronGeometry(4.6, 2);
        cloudPuffGeoA.scale(1.35, 0.62, 0.95);
        const cloudPuffGeoB = new THREE.IcosahedronGeometry(3.4, 2);
        cloudPuffGeoB.scale(1.15, 0.68, 0.9);
        for (let i = 0; i < 22; i++) {
          const cg = new THREE.Group();
          cg.add(new THREE.Mesh(cloudPuffGeoA, cloudMat));
          const m2 = new THREE.Mesh(cloudPuffGeoB, cloudMat);
          m2.position.set(3.4, 1.1, 0.4);
          const m3 = new THREE.Mesh(cloudPuffGeoB, cloudMat);
          m3.position.set(-3.1, 0.7, -0.3);
          m3.scale.setScalar(0.85);
          cg.add(m2, m3);
          cg.position.set(-140 + (i % 6) * 56, 36 + (i % 4) * 6, -170 + Math.floor(i / 6) * 110);
          cloudGroup.add(cg);
        }
        cloudAnchor.add(cloudGroup);
        scene.add(cloudAnchor);

        // Bục Vinh Danh 3D PBS (phủ Clearcoat sang trọng, nhận & đổ bóng thật)
        const podiumGroup = new THREE.Group();
        const makePodiumBlock = (x: number, h: number, color: number) => {
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(4.4, h, 4.4),
            new THREE.MeshPhysicalMaterial({
              color,
              metalness: 0.62,
              roughness: 0.2,
              clearcoat: 0.85,
              clearcoatRoughness: 0.12,
            }),
          );
          box.position.set(x, h / 2, 0);
          box.castShadow = true;
          box.receiveShadow = true;
          return box;
        };
        podiumGroup.add(makePodiumBlock(0, 3.4, 0xfacc15));
        podiumGroup.add(makePodiumBlock(-5.0, 2.3, 0xe2e8f0));
        podiumGroup.add(makePodiumBlock(5.0, 1.6, 0xd97706));
        scene.add(podiumGroup);

        const podiumCenterVec = new THREE.Vector3(0, 0, 0);
        const podiumFrontPt = new THREE.Vector3(0, 0, 1);
        const podiumRightPt = new THREE.Vector3(1, 0, 0);
        const positionPodium = () => {
          const anchor = sampleCircuit(18, -(halfW + 14));
          podiumGroup.position.set(anchor.x, 0, anchor.z);
          podiumGroup.rotation.y = anchor.yaw + Math.PI / 2;
          podiumGroup.updateMatrixWorld(true);
          podiumCenterVec.set(0, 0, 0);
          podiumGroup.localToWorld(podiumCenterVec);
          podiumFrontPt.set(0, 0, 1);
          podiumGroup.localToWorld(podiumFrontPt);
          podiumFrontPt.sub(podiumCenterVec).normalize();
          podiumRightPt.set(1, 0, 0);
          podiumGroup.localToWorld(podiumRightPt);
          podiumRightPt.sub(podiumCenterVec).normalize();
        };

        const spotlightBeam = new THREE.Mesh(
          new THREE.ConeGeometry(3.4, 14, 18, 1, true),
          new THREE.MeshBasicMaterial({
            color: 0xfacc15,
            transparent: true,
            opacity: 0.22,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        spotlightBeam.visible = false;
        scene.add(spotlightBeam);

        const getPodiumSlotWorld = (rank: number) => {
          const lx = rank === 1 ? 0 : rank === 2 ? -5.0 : 5.0;
          const ly = rank === 1 ? 3.4 : rank === 2 ? 2.3 : 1.6;
          const v = new THREE.Vector3(lx, ly, 0);
          podiumGroup.localToWorld(v);
          return { x: v.x, y: v.y, z: v.z, yaw: podiumGroup.rotation.y };
        };

        // Áp dụng màu đặc trưng của lề đường và mặt đường nhựa dầu đô thị (khi vào map Thành Phố Về Đêm)
        const applyMapTheme = (th: MapTheme) => {
          const isCity = th.sceneryType === 'city';
          const cA = isCity ? 0x334155 : th.curbColorA;
          const cB = isCity ? 0xcbd5e1 : th.curbColorB;
          if (curbMat.map) curbMat.map.dispose();
          curbMat.map = makeCurbTexture(cA, cB);
          curbMat.needsUpdate = true;
          barrierRed.color.setHex(isCity ? 0x1e293b : th.curbColorA);
          barrierWhite.color.setHex(isCity ? 0x94a3b8 : th.curbColorB);
          leafMatA.color.setHex(th.leafA);
          leafMatB.color.setHex(th.leafB);

          const roadSet = isCity ? cityTarAsphaltPBR : asphaltPBR;
          roadMat.map = roadSet.map;
          roadMat.normalMap = roadSet.normalMap;
          roadMat.normalScale.set(isCity ? 1.75 : 1.18, isCity ? 1.75 : 1.18);
          roadMat.roughnessMap = roadSet.roughnessMap;
          roadMat.roughness = isCity ? 0.68 : 1.0;
          roadMat.metalness = isCity ? 0.26 : 0.06;
          roadMat.clearcoat = isCity ? 0.96 : 0.22;
          roadMat.clearcoatRoughness = isCity ? 0.075 : 0.38;
          roadMat.reflectivity = isCity ? 1.0 : 0.5;
          roadMat.envMapIntensity = isCity ? 2.45 : 1.18;
          roadMat.needsUpdate = true;
        };

        const sharedTrackGeos = new Set<any>([
          barrierGeo,
          trunkGeo,
          leafBotGeo,
          leafTopGeo,
          bushGeo,
          grassBladeGeo,
          flowerGeo,
          standGeo,
          standRoofGeo,
          gatePillarGeo,
          pineConeBotGeo,
          pineConeTopGeo,
          mountainPeakGeo,
          mountainSnowGeo,
          boulderGeo,
          fountainBaseGeo,
          fountainJetGeo,
          fountainRingGeo,
          balloonEnvelopeGeo,
          balloonBasketGeo,
          towerPoleGeo,
          towerHeadGeo,
          trophyBaseGeo,
          trophyStemGeo,
          trophyCupGeo,
          buildingGeo,
          streetPostGeo,
          streetArmGeo,
          streetLampGeo,
        ]);
        let trackRoot: any = null;
        let builtTrackVersion = -1;
        let builtQuality: GraphicsQuality | '' = '';
        let relayoutProps: (() => void) | null = null;

        const applyGraphicsQualitySettings = (q: GraphicsQuality) => {
          const isLow = q === 'low';
          resizeDrawingBuffer();
          renderer.shadowMap.enabled = !isLow;
          sunLight.castShadow = !isLow;
          const targetMapSize = q === '4k' ? 4096 : q === 'high' ? 2048 : 1024;
          if (sunLight.shadow.mapSize.width !== targetMapSize) {
            sunLight.shadow.mapSize.set(targetMapSize, targetMapSize);
            if (sunLight.shadow.map) {
              sunLight.shadow.map.dispose();
              sunLight.shadow.map = null;
            }
          }
          renderer.shadowMap.needsUpdate = true;
        };

        const buildTrackWorld = () => {
          if (trackRoot) {
            scene.remove(trackRoot);
            trackRoot.traverse((o: any) => {
              if (o.isInstancedMesh && typeof o.dispose === 'function') o.dispose();
              if (o.geometry && !sharedTrackGeos.has(o.geometry)) o.geometry.dispose();
            });
          }
          floatingLandmarks.length = 0;
          trackRoot = new THREE.Group();
          scene.add(trackRoot);

          const map = getActiveMap();
          const scenery = map.theme.sceneryType;
          applyMapTheme(map.theme);
          positionPodium();

          const total = CIRCUIT_TRACK.totalLength;
          const cx = (CIRCUIT_TRACK.minX + CIRCUIT_TRACK.maxX) / 2;
          const cz = (CIRCUIT_TRACK.minZ + CIRCUIT_TRACK.maxZ) / 2;
          const ext = Math.max(
            CIRCUIT_TRACK.maxX - CIRCUIT_TRACK.minX,
            CIRCUIT_TRACK.maxZ - CIRCUIT_TRACK.minZ,
          );
          cloudAnchor.position.set(cx, 0, cz);

          const selectedQuality = graphicsQualityRef.current;
          const quality = selectedQuality === '4k' ? 'high' : selectedQuality;
          applyGraphicsQualitySettings(selectedQuality);
          const enableWorldShadows = quality !== 'low';

          // Tính bán kính hồ nước trước để giữ lòng hồ & hành lang đường đua phẳng tuyệt đối trên lưới địa hình Triangle
          let lakeX = cx;
          let lakeZ = cz;
          let lakeR = 0;
          if (map.theme.lake) {
            let minDist = Infinity;
            for (let i = 0; i < CIRCUIT_TRACK.samples.length; i += 4) {
              const p = CIRCUIT_TRACK.samples[i];
              minDist = Math.min(minDist, Math.hypot(cx - p.x, cz - p.z));
            }
            const r = Math.min(26, minDist - halfW - 8);
            if (r >= 9) lakeR = r;
          }

          // Nền địa hình: Ở Map Thành Phố dùng nền Nhựa/Bê Tông Đô Thị phẳng + Vỉa Hè Đá Granite (TUYỆT ĐỐI KHÔNG dùng thảm cỏ xanh đồi núi!)
          const grassSize = ext + 520;
          if (scenery === 'city') {
            const plazaRep = grassSize / 24;
            cityPavementTex.plazaMap.repeat.set(plazaRep, plazaRep);
            const cityGroundGeo = new THREE.PlaneGeometry(grassSize, grassSize, 2, 2);
            cityGroundGeo.rotateX(-Math.PI / 2);
            const cityGround = new THREE.Mesh(cityGroundGeo, cityPlazaGroundMat);
            cityGround.position.set(cx, -0.04, cz);
            cityGround.receiveShadow = enableWorldShadows;
            trackRoot.add(cityGround);

            // Vỉa hè lát đá Granite rộng 6.8m chạy dọc hai bên đại lộ đô thị
            cityPavementTex.sidewalkMap.repeat.set(1.6, Math.max(24, Math.round(total / 8.5)));
            const sidewalkL = new THREE.Mesh(
              buildTriangulatedRibbon(THREE, sampleCircuit, total, -halfW - 8.2, -halfW - 1.4, 0.14, 0.0, 2, 1.0),
              citySidewalkMat,
            );
            const sidewalkR = new THREE.Mesh(
              buildTriangulatedRibbon(THREE, sampleCircuit, total, halfW + 1.4, halfW + 8.2, 0.14, 0.0, 2, 1.0),
              citySidewalkMat,
            );
            sidewalkL.receiveShadow = enableWorldShadows;
            sidewalkR.receiveShadow = enableWorldShadows;
            trackRoot.add(sidewalkL, sidewalkR);
          } else {
            const repeatCnt = grassSize / 16;
            grassPBR.map.repeat.set(repeatCnt, repeatCnt);
            grassPBR.normalMap.repeat.set(repeatCnt, repeatCnt);
            grassPBR.roughnessMap.repeat.set(repeatCnt, repeatCnt);
            const terrainGeo = buildTriangulatedTerrain(
              THREE,
              grassSize,
              cx,
              cz,
              CIRCUIT_TRACK.samples,
              halfW,
              lakeX,
              lakeZ,
              lakeR,
              podiumCenterVec.x,
              podiumCenterVec.z,
              quality === 'low' ? 48 : 96,
            );
            const grass = new THREE.Mesh(terrainGeo, grassMat);
            grass.position.set(cx, 0, cz);
            grass.receiveShadow = enableWorldShadows;
            trackRoot.add(grass);
          }

          // Mặt đường nhựa 2K PBR & lề đường theo lưới Tam Giác mịn (widthSegs = 8, có độ vồng mặt đường tự nhiên)
          const roadMesh = new THREE.Mesh(
            buildTriangulatedRibbon(THREE, sampleCircuit, total, -halfW, halfW, 0.012, 0.055, 8, 0.042),
            roadMat,
          );
          roadMesh.receiveShadow = enableWorldShadows;
          const curbL = new THREE.Mesh(
            buildTriangulatedRibbon(THREE, sampleCircuit, total, -halfW - 1.5, -halfW, 0.06, 0.14, 3, 0.015),
            curbMat,
          );
          const curbR = new THREE.Mesh(
            buildTriangulatedRibbon(THREE, sampleCircuit, total, halfW, halfW + 1.5, 0.06, 0.14, 3, 0.015),
            curbMat,
          );
          curbL.receiveShadow = enableWorldShadows;
          curbR.receiveShadow = enableWorldShadows;
          trackRoot.add(roadMesh, curbL, curbR);

          // Rào chắn 2 bên đường (InstancedMesh)
          const barrierSegs = Math.ceil(total / 4.2);
          const redBarrierInst = new THREE.InstancedMesh(barrierGeo, barrierRed, barrierSegs * 2 + 4);
          const whiteBarrierInst = new THREE.InstancedMesh(barrierGeo, barrierWhite, barrierSegs * 2 + 4);
          let rb = 0;
          let wb = 0;
          for (let i = 0; i < barrierSegs; i++) {
            const dist = (i / barrierSegs) * total;
            const isRed = i % 2 === 0;
            for (const side of [-1, 1]) {
              const s = sampleCircuit(dist, side * (halfW + 1.9));
              dummy.position.set(s.x, 0.55, s.z);
              dummy.rotation.set(0, s.yaw, 0);
              dummy.scale.set(1, 1, 1);
              dummy.updateMatrix();
              if (isRed) redBarrierInst.setMatrixAt(rb++, dummy.matrix);
              else whiteBarrierInst.setMatrixAt(wb++, dummy.matrix);
            }
          }
          redBarrierInst.count = rb;
          whiteBarrierInst.count = wb;
          if (enableWorldShadows) {
            redBarrierInst.castShadow = true;
            redBarrierInst.receiveShadow = true;
            whiteBarrierInst.castShadow = true;
            whiteBarrierInst.receiveShadow = true;
          }
          trackRoot.add(redBarrierInst, whiteBarrierInst);

          // Duy nhất 1 cổng XUẤT PHÁT / VỀ ĐÍCH (distance = 0, đổ bóng thật xuống đường)
          {
            const s = sampleCircuit(0, 0);
            const grp = new THREE.Group();
            const leftP = new THREE.Mesh(gatePillarGeo, gatePillarMat);
            leftP.position.set(-halfW - 1.1, 5.1, 0);
            const rightP = new THREE.Mesh(gatePillarGeo, gatePillarMat);
            rightP.position.set(halfW + 1.1, 5.1, 0);
            const banner = new THREE.Mesh(
              new THREE.BoxGeometry(trackW + 3.4, 1.6, 1.0),
              gateBannerMat,
            );
            banner.position.set(0, 9.6, 0);
            const line = new THREE.Mesh(new THREE.PlaneGeometry(trackW, 3.8), finishLineMat);
            line.rotation.x = -Math.PI / 2;
            line.position.set(0, 0.068, 0);
            line.receiveShadow = enableWorldShadows;
            if (enableWorldShadows) {
              leftP.castShadow = true;
              rightP.castShadow = true;
              banner.castShadow = true;
            }
            grp.add(leftP, rightP, banner, line);
            grp.position.set(s.x, 0, s.z);
            grp.rotation.y = s.yaw;
            trackRoot.add(grp);
          }

          // Hồ nước PBR phản chiếu bầu trời thật + Đài phun nước 3D ở map Công Viên
          if (lakeR >= 9) {
            const lake = new THREE.Mesh(new THREE.CircleGeometry(lakeR, 48), lakeMat);
            lake.rotation.x = -Math.PI / 2;
            lake.position.set(lakeX, -0.02, lakeZ);
            lake.receiveShadow = enableWorldShadows;
            trackRoot.add(lake);

            const fGrp = new THREE.Group();
            const fBase = new THREE.Mesh(fountainBaseGeo, fountainStoneMat);
            fBase.position.y = 0.45;
            const fJet = new THREE.Mesh(fountainJetGeo, fountainWaterMat);
            fJet.position.y = 4.2;
            const fRing = new THREE.Mesh(fountainRingGeo, fountainWaterMat);
            fRing.rotation.x = Math.PI / 2;
            fRing.position.y = 7.4;
            if (enableWorldShadows) fBase.castShadow = true;
            fGrp.add(fBase, fJet, fRing);
            fGrp.position.set(lakeX, 0, lakeZ);
            trackRoot.add(fGrp);
          }

          const isSafeScenerySpot = (x: number, z: number, minClearance: number) => {
            for (let i = 0; i < CIRCUIT_TRACK.samples.length; i += 4) {
              const p = CIRCUIT_TRACK.samples[i];
              if (Math.hypot(x - p.x, z - p.z) < minClearance) return false;
            }
            if (lakeR > 0 && Math.hypot(x - lakeX, z - lakeZ) < lakeR + 4) return false;
            if (Math.hypot(x - podiumCenterVec.x, z - podiumCenterVec.z) < 14) return false;
            return true;
          };

          // 1) Cây xanh tự nhiên chi tiết (chỉ dựng cho Công Viên / Sân Vận Động / Đèo Núi — KHÔNG trồng rừng hỗn độn trong Thành Phố)
          if (scenery !== 'city') {
            const treeScaleFactor = quality === 'high' ? 1.25 : quality === 'low' ? 0.65 : 1.0;
            const treeMax = Math.max(24, Math.round(map.theme.treeCount * treeScaleFactor));
            const treePositions: Array<{ x: number; z: number; s: number; rot: number }> = [];
            const attempts = treeMax * 4;
            const spreadR = ext * 0.72 + 70;
            for (let i = 0; i < attempts && treePositions.length < treeMax; i++) {
              const angle = i * 2.39996;
              const radius = Math.sqrt((i + 0.5) / attempts) * spreadR;
              const tx = cx + Math.cos(angle) * radius;
              const tz = cz + Math.sin(angle) * radius;
              if (isSafeScenerySpot(tx, tz, halfW + 7.2)) {
                treePositions.push({ x: tx, z: tz, s: 0.85 + (i % 6) * 0.16, rot: (i % 7) * 0.55 });
              }
            }
            const tCount = Math.max(1, treePositions.length);
            const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, tCount);
            const leafBotInst = new THREE.InstancedMesh(
              scenery === 'mountain' ? pineConeBotGeo : leafBotGeo,
              leafMatA,
              tCount,
            );
            const leafTopInst = new THREE.InstancedMesh(
              scenery === 'mountain' ? pineConeTopGeo : leafTopGeo,
              leafMatB,
              tCount,
            );
            const leafSideInst =
              quality !== 'low'
                ? new THREE.InstancedMesh(
                  scenery === 'mountain' ? pineConeTopGeo : leafTopGeo,
                  leafMatC,
                  tCount * 2,
                )
                : null;

            if (enableWorldShadows) {
              trunkInst.castShadow = true;
              trunkInst.receiveShadow = true;
              leafBotInst.castShadow = true;
              leafBotInst.receiveShadow = true;
              leafTopInst.castShadow = true;
              leafTopInst.receiveShadow = true;
              if (leafSideInst) {
                leafSideInst.castShadow = true;
                leafSideInst.receiveShadow = true;
              }
            }

            treePositions.forEach((tp, idx) => {
              dummy.rotation.set(0, tp.rot, 0);
              dummy.scale.setScalar(tp.s);
              dummy.position.set(tp.x, 1.95 * tp.s, tp.z);
              dummy.updateMatrix();
              trunkInst.setMatrixAt(idx, dummy.matrix);

              dummy.position.set(tp.x, (scenery === 'mountain' ? 4.4 : 4.55) * tp.s, tp.z);
              dummy.scale.set(tp.s * 1.12, tp.s * 0.96, tp.s * 1.12);
              dummy.updateMatrix();
              leafBotInst.setMatrixAt(idx, dummy.matrix);

              dummy.position.set(
                tp.x + Math.cos(tp.rot) * 0.45 * tp.s,
                (scenery === 'mountain' ? 6.6 : 6.1) * tp.s,
                tp.z + Math.sin(tp.rot) * 0.45 * tp.s,
              );
              dummy.scale.setScalar(tp.s * 0.95);
              dummy.updateMatrix();
              leafTopInst.setMatrixAt(idx, dummy.matrix);

              if (leafSideInst) {
                const a1 = tp.rot + 1.1;
                const a2 = tp.rot + 3.8;
                dummy.position.set(
                  tp.x + Math.cos(a1) * 1.35 * tp.s,
                  (scenery === 'mountain' ? 3.2 : 4.15) * tp.s,
                  tp.z + Math.sin(a1) * 1.35 * tp.s,
                );
                dummy.scale.setScalar(tp.s * 0.78);
                dummy.updateMatrix();
                leafSideInst.setMatrixAt(idx * 2, dummy.matrix);

                dummy.position.set(
                  tp.x + Math.cos(a2) * 1.25 * tp.s,
                  (scenery === 'mountain' ? 5.2 : 4.85) * tp.s,
                  tp.z + Math.sin(a2) * 1.25 * tp.s,
                );
                dummy.scale.setScalar(tp.s * 0.72);
                dummy.updateMatrix();
                leafSideInst.setMatrixAt(idx * 2 + 1, dummy.matrix);
              }
            });
            trackRoot.add(trunkInst, leafBotInst, leafTopInst);
            if (leafSideInst) trackRoot.add(leafSideInst);
          }

          // 1B) Bụi cây & Cụm cỏ 3D chi tiết ven 2 bên lề đường (chỉ dựng ở mức Trung bình & Cao để tối ưu FPS)
          if (quality !== 'low' && scenery !== 'city') {
            const bushCount = quality === 'high' ? 240 : 110;
            const grassCount = quality === 'high' ? 840 : 340;
            const bushInst = new THREE.InstancedMesh(bushGeo, leafMatB, bushCount);
            const grassInst = new THREE.InstancedMesh(grassBladeGeo, grassBladeMat, grassCount);
            let bi = 0;
            for (let b = 0; b < bushCount; b++) {
              const dist = ((b + 0.3) / bushCount) * total;
              const side = b % 2 === 0 ? -1 : 1;
              const lat = side * (halfW + 3.4 + (b % 5) * 1.6);
              const s = sampleCircuit(dist, lat);
              const sc = 0.65 + (b % 4) * 0.25;
              dummy.position.set(s.x, 0.52 * sc, s.z);
              dummy.rotation.set(0, b * 1.3, 0);
              dummy.scale.set(sc * 1.25, sc * 0.78, sc * 1.1);
              dummy.updateMatrix();
              bushInst.setMatrixAt(bi++, dummy.matrix);
            }
            bushInst.count = bi;

            let gi = 0;
            for (let g = 0; g < grassCount; g++) {
              const dist = ((g * 0.6180339) % 1) * total;
              const side = g % 2 === 0 ? -1 : 1;
              const lat = side * (halfW + 2.2 + ((g * 7) % 18) * 0.95);
              const s = sampleCircuit(dist, lat);
              const gs = 0.65 + (g % 5) * 0.18;
              dummy.position.set(s.x, 0.4 * gs, s.z);
              dummy.rotation.set(((g % 3) - 1) * 0.18, g * 0.9, (((g + 1) % 3) - 1) * 0.18);
              dummy.scale.set(gs, gs * (0.9 + (g % 3) * 0.22), gs);
              dummy.updateMatrix();
              grassInst.setMatrixAt(gi++, dummy.matrix);
            }
            grassInst.count = gi;
            // Thêm hoa cỏ 3D nhiều màu sắc (hồng / vàng) ven 2 bên đường đua có đổ bóng rõ nét
            const flowerCount = quality === 'high' ? 240 : 120;
            const flowerInstPink = new THREE.InstancedMesh(flowerGeo, flowerMatPink, flowerCount);
            const flowerInstGold = new THREE.InstancedMesh(flowerGeo, flowerMatGold, flowerCount);
            let fp = 0;
            let fg = 0;
            for (let fl = 0; fl < flowerCount * 2; fl++) {
              const dist = ((fl * 0.381966) % 1) * total;
              const side = fl % 2 === 0 ? -1 : 1;
              const lat = side * (halfW + 2.4 + ((fl * 5) % 12) * 0.85);
              const s = sampleCircuit(dist, lat);
              const sc = 0.75 + (fl % 4) * 0.2;
              dummy.position.set(s.x, 0.34 * sc, s.z);
              dummy.rotation.set(0.2, fl * 0.8, 0.15);
              dummy.scale.setScalar(sc);
              dummy.updateMatrix();
              if (fl % 2 === 0 && fp < flowerCount) flowerInstPink.setMatrixAt(fp++, dummy.matrix);
              else if (fg < flowerCount) flowerInstGold.setMatrixAt(fg++, dummy.matrix);
            }
            flowerInstPink.count = fp;
            flowerInstGold.count = fg;

            if (enableWorldShadows) {
              bushInst.castShadow = true;
              bushInst.receiveShadow = true;
              grassInst.castShadow = true;
              grassInst.receiveShadow = true;
              flowerInstPink.castShadow = true;
              flowerInstPink.receiveShadow = true;
              flowerInstGold.castShadow = true;
              flowerInstGold.receiveShadow = true;
            }
            trackRoot.add(bushInst, grassInst, flowerInstPink, flowerInstGold);
          }

          // 2) Công trình & Cảnh vật ĐẶC TRƯNG cho từng bản đồ
          if (scenery === 'park') {
            // 8 Khinh Khí Cầu nhiều màu bay bồng bềnh quanh Công Viên
            for (let b = 0; b < 8; b++) {
              const ang = (b / 8) * Math.PI * 2;
              const bx = cx + Math.cos(ang) * (ext * 0.42);
              const bz = cz + Math.sin(ang) * (ext * 0.42);
              const by = 22 + (b % 3) * 4.5;
              const bg = new THREE.Group();
              const env = new THREE.Mesh(balloonEnvelopeGeo, balloonMats[b % balloonMats.length]);
              env.position.y = 3.2;
              const basket = new THREE.Mesh(balloonBasketGeo, trunkMat);
              basket.position.y = -1.2;
              bg.add(env, basket);
              bg.position.set(bx, by, bz);
              trackRoot.add(bg);
              floatingLandmarks.push({ mesh: bg, baseY: by, phase: b * 0.9 });
            }
          } else if (scenery === 'stadium') {
            // 12 Khán đài lớn bao quanh Sân Vận Động + 10 Tháp Đèn Pha + Cúp Vàng khổng lồ ở tâm sân
            for (let k = 0; k < 12; k++) {
              const frac = k / 12;
              const side = k % 2 === 0 ? -1 : 1;
              const s = sampleCircuit(total * frac, side * (halfW + 10.5));
              if (!isSafeScenerySpot(s.x, s.z, halfW + 5.5)) continue;
              const sg = new THREE.Group();
              const base = new THREE.Mesh(standGeo, standMat);
              base.position.y = 2.2;
              const roof = new THREE.Mesh(standRoofGeo, roofMat);
              roof.position.y = 6.2;
              sg.add(base, roof);
              sg.position.set(s.x, 0, s.z);
              sg.rotation.y = s.yaw;
              trackRoot.add(sg);
            }
            for (let lt = 0; lt < 10; lt++) {
              const frac = (lt + 0.5) / 10;
              const side = lt % 2 === 0 ? 1 : -1;
              const s = sampleCircuit(total * frac, side * (halfW + 8.5));
              if (!isSafeScenerySpot(s.x, s.z, halfW + 5)) continue;
              const tg = new THREE.Group();
              const pole = new THREE.Mesh(towerPoleGeo, matDarkMetal);
              pole.position.y = 9.0;
              const head = new THREE.Mesh(towerHeadGeo, towerGlowMat);
              head.position.set(-side * 0.8, 17.8, 0);
              tg.add(pole, head);
              tg.position.set(s.x, 0, s.z);
              tg.rotation.y = s.yaw;
              trackRoot.add(tg);
            }
            if (isSafeScenerySpot(cx, cz, halfW + 8)) {
              const tr = new THREE.Group();
              const tb = new THREE.Mesh(trophyBaseGeo, standMat);
              tb.position.y = 1.1;
              const ts = new THREE.Mesh(trophyStemGeo, trophyGoldMat);
              ts.position.y = 4.2;
              const tc = new THREE.Mesh(trophyCupGeo, trophyGoldMat);
              tc.position.y = 8.4;
              tr.add(tb, ts, tc);
              tr.position.set(cx, 0, cz);
              trackRoot.add(tr);
            }
          } else if (scenery === 'mountain') {
            // 40 Đỉnh Núi Đá Chóp Tuyết Trắng + Đá Tảng dọc đèo
            let placed = 0;
            for (let m = 0; m < 120 && placed < 40; m++) {
              const ang = m * 2.39996 + 0.5;
              const rad = ext * 0.25 + (m % 7) * 26;
              const mx = cx + Math.cos(ang) * rad;
              const mz = cz + Math.sin(ang) * rad;
              if (!isSafeScenerySpot(mx, mz, halfW + 17)) continue;
              placed++;
              const h = 15 + (m % 5) * 5.2;
              const r = 9 + (m % 4) * 2.8;
              const mg = new THREE.Group();
              const peak = new THREE.Mesh(mountainPeakGeo, rockMat);
              peak.scale.set(r, h, r);
              peak.position.y = h / 2;
              mg.add(peak);
              if (h >= 21) {
                const snow = new THREE.Mesh(mountainSnowGeo, snowMat);
                snow.scale.set(r, h, r);
                snow.position.y = h * 0.79;
                mg.add(snow);
              }
              mg.position.set(mx, 0, mz);
              mg.rotation.y = (m % 6) * 0.55;
              trackRoot.add(mg);
            }
            // Đá tảng sát mép đường đèo
            const rockPos: Array<{ x: number; z: number; s: number; r: number }> = [];
            for (let rk = 0; rk < 24; rk++) {
              const side = rk % 2 === 0 ? -1 : 1;
              const s = sampleCircuit((rk / 24) * total, side * (halfW + 6.0));
              if (isSafeScenerySpot(s.x, s.z, halfW + 4.5)) {
                rockPos.push({ x: s.x, z: s.z, s: 0.9 + (rk % 3) * 0.4, r: rk * 0.7 });
              }
            }
            if (rockPos.length > 0) {
              const boulderInst = new THREE.InstancedMesh(boulderGeo, rockMat, rockPos.length);
              rockPos.forEach((rp, idx) => {
                dummy.position.set(rp.x, 0.9 * rp.s, rp.z);
                dummy.rotation.set(rp.r, rp.r * 0.6, 0);
                dummy.scale.set(rp.s * 1.2, rp.s * 0.85, rp.s);
                dummy.updateMatrix();
                boulderInst.setMatrixAt(idx, dummy.matrix);
              });
              trackRoot.add(boulderInst);
            }
          } else if (scenery === 'city') {
            // QUY HOẠCH ĐẠI LỘ & LÔ PHỐ Ô BÀN CỜ CHUẨN ĐÔ THỊ (tham khảo threejs.org/examples/webgpu_lights_clustered_city.html):
            // 1) Dãy nhà mặt tiền phố (Street-Wall Frontage) xếp thẳng hàng dọc 2 bên vỉa hè, chừa ngã tư đường ngang đều đặn.
            // 2) Các lô phố ô bàn cờ (Orthogonal City Blocks) phía sau và ở lõi trung tâm, tuyệt đối không xoay nghiêng lộn xộn hay chồng chéo!
            // 3) Biển hiệu hộp đèn dọc + Mái hiên cửa hiệu tầng trệt đa sắc chiếu phản quang lên mặt đường nhựa dầu bóng ướt.
            interface CityBuildingItem {
              x: number;
              z: number;
              w: number;
              d: number;
              h: number;
              yaw: number;
              variant: number;
              neonIdx: number;
              streetFront?: {
                inwardX: number;
                inwardZ: number;
                tangentYaw: number;
              };
            }

            const cityBuildings: CityBuildingItem[] = [];
            const canPlaceCityBuilding = (
              bx: number,
              bz: number,
              bw: number,
              bd: number,
              minAlleyGap: number,
            ) => {
              const rad = 0.5 * Math.hypot(bw, bd);
              const reqTrackDist = halfW + 8.3 + rad * 0.92;
              for (let sIdx = 0; sIdx < CIRCUIT_TRACK.samples.length; sIdx += 2) {
                const p = CIRCUIT_TRACK.samples[sIdx];
                if (Math.hypot(bx - p.x, bz - p.z) < reqTrackDist) return false;
              }
              if (Math.hypot(bx - podiumCenterVec.x, bz - podiumCenterVec.z) < 16.5 + rad) {
                return false;
              }
              for (let k = 0; k < cityBuildings.length; k++) {
                const ob = cityBuildings[k];
                const dx = Math.abs(bx - ob.x);
                const dz = Math.abs(bz - ob.z);
                // Kiểm tra hộp bao vuông góc (AABB) kèm khoảng hở ngõ phố gọn gàng
                const halfSumX = (bw + ob.w) * 0.5 + minAlleyGap;
                const halfSumZ = (bd + ob.d) * 0.5 + minAlleyGap;
                if (dx < halfSumX && dz < halfSumZ) return false;
              }
              return true;
            };

            // Lớp 1: Dãy nhà mặt tiền đại lộ (Streetfront Avenue Row) thẳng tắp hai bên vỉa hè
            const frontageStep = 18.2;
            const frontageSlots = Math.floor(total / frontageStep);
            for (let slot = 0; slot < frontageSlots; slot++) {
              // Cứ mỗi 5 lô chừa 1 ngã tư đường nhánh vuông góc thoáng đẹp
              if (slot % 5 === 0) continue;
              const isCornerLandmark = slot % 5 === 1 || slot % 5 === 4;
              const dist = (slot + 0.5) * frontageStep;

              for (const side of [-1, 1] as const) {
                const s = sampleCircuit(dist, side * (halfW + 16.4));
                // Khóa góc xoay về lưới trục đô thị vuông góc (0, 90, 180, 270 độ) để các tòa nhà luôn song song & vuông vức!
                const snappedQuarter = Math.round(s.yaw / (Math.PI / 2));
                const gridYaw = snappedQuarter * (Math.PI / 2);
                const isEastWest = Math.abs(snappedQuarter) % 2 === 1;

                const widthAlongStreet = 14.2 + ((slot + (side > 0 ? 1 : 0)) % 3) * 1.1;
                const depthFromStreet = 13.0 + (slot % 2) * 1.4;
                const worldW = isEastWest ? depthFromStreet : widthAlongStreet;
                const worldD = isEastWest ? widthAlongStreet : depthFromStreet;

                const hBase = isCornerLandmark
                  ? 34 + ((slot * 5 + (side > 0 ? 3 : 0)) % 4) * 5.5
                  : 19 + ((slot * 3 + (side > 0 ? 2 : 0)) % 5) * 4.2;

                if (!canPlaceCityBuilding(s.x, s.z, worldW, worldD, 1.8)) continue;

                // Hướng mặt tiền quay thẳng từ tòa nhà vào lòng đường đua
                const roadCenter = sampleCircuit(dist, 0);
                const toRoadX = roadCenter.x - s.x;
                const toRoadZ = roadCenter.z - s.z;
                const toRoadLen = Math.hypot(toRoadX, toRoadZ) || 1;

                cityBuildings.push({
                  x: s.x,
                  z: s.z,
                  w: worldW,
                  d: worldD,
                  h: hBase,
                  yaw: gridYaw,
                  variant: (slot + (side > 0 ? 1 : 2)) % 3,
                  neonIdx: (slot * 2 + (side > 0 ? 1 : 0)) % 5,
                  streetFront: {
                    inwardX: toRoadX / toRoadLen,
                    inwardZ: toRoadZ / toRoadLen,
                    tangentYaw: s.yaw,
                  },
                });
              }
            }

            // Lớp 2: Quy hoạch Lô Phố Ô Bàn Cờ (Orthogonal City Blocks) ở lõi trung tâm & hậu cảnh đại lộ
            const gridStep = 25.0;
            const gxStart = Math.floor((CIRCUIT_TRACK.minX - 105) / gridStep);
            const gxEnd = Math.ceil((CIRCUIT_TRACK.maxX + 105) / gridStep);
            const gzStart = Math.floor((CIRCUIT_TRACK.minZ - 105) / gridStep);
            const gzEnd = Math.ceil((CIRCUIT_TRACK.maxZ + 105) / gridStep);
            const maxBuildings = quality === 'low' ? 95 : quality === 'high' ? 175 : 140;

            for (let gi = gxStart; gi <= gxEnd && cityBuildings.length < maxBuildings; gi++) {
              // Cứ mỗi 4 ô chừa 1 tuyến phố ngang rộng rãi
              if (((gi % 4) + 4) % 4 === 0) continue;
              for (let gj = gzStart; gj <= gzEnd && cityBuildings.length < maxBuildings; gj++) {
                if (((gj % 4) + 4) % 4 === 0) continue;
                const bx = gi * gridStep;
                const bz = gj * gridStep;
                const distFromDowntown = Math.hypot(bx - cx, bz - cz);
                if (distFromDowntown > ext * 0.78 + 95) continue;

                const hashIdx = Math.abs(gi * 31 + gj * 17);
                const bw = 15.5 + (hashIdx % 3) * 1.8;
                const bd = 15.5 + ((hashIdx >> 2) % 3) * 1.8;
                // Cao ốc trung tâm vươn cao uy nghi, giảm dần tự nhiên ra vùng ven
                const downtownFactor = Math.max(0, 1 - distFromDowntown / (ext * 0.7 + 90));
                const bh = 22 + (hashIdx % 6) * 5.8 + downtownFactor * 18;

                if (!canPlaceCityBuilding(bx, bz, bw, bd, 3.2)) continue;
                cityBuildings.push({
                  x: bx,
                  z: bz,
                  w: bw,
                  d: bd,
                  h: bh,
                  yaw: 0,
                  variant: hashIdx % 3,
                  neonIdx: hashIdx % 5,
                });
              }
            }

            if (cityBuildings.length > 0) {
              // Tách theo 3 phong cách kiến trúc mặt tiền + Nóc bê tông tối (không bị dính cửa sổ lên sân thượng!) + Tầng thượng giật cấp
              const byVariant: CityBuildingItem[][] = [[], [], []];
              cityBuildings.forEach((b) => byVariant[b.variant % 3].push(b));

              byVariant.forEach((group, vIdx) => {
                if (group.length === 0) return;
                const bodyInst = new THREE.InstancedMesh(
                  buildingGeo,
                  buildingFacadeMats[vIdx],
                  group.length,
                );
                group.forEach((bp, i) => {
                  dummy.rotation.set(0, 0, 0);
                  dummy.position.set(bp.x, bp.h / 2, bp.z);
                  dummy.scale.set(bp.w, bp.h, bp.d);
                  dummy.updateMatrix();
                  bodyInst.setMatrixAt(i, dummy.matrix);
                });
                if (enableWorldShadows) {
                  bodyInst.castShadow = true;
                  bodyInst.receiveShadow = true;
                }
                trackRoot.add(bodyInst);
              });

              // Nóc gờ bê tông tối (che kín đỉnh khối nhà) + Khối kỹ thuật Penthouse sân thượng
              const roofCapInst = new THREE.InstancedMesh(
                buildingGeo,
                buildingRoofMat,
                cityBuildings.length,
              );
              const penthouseInst = new THREE.InstancedMesh(
                buildingGeo,
                buildingPenthouseMat,
                cityBuildings.length,
              );
              const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
              const tallTowers = cityBuildings.filter((b) => b.h >= 36);
              const spireInst =
                tallTowers.length > 0
                  ? new THREE.InstancedMesh(streetPostGeo, matDarkMetal, tallTowers.length)
                  : null;
              const beaconInst =
                tallTowers.length > 0
                  ? new THREE.InstancedMesh(
                      new THREE.SphereGeometry(0.32, 8, 8),
                      beaconMat,
                      tallTowers.length,
                    )
                  : null;

              cityBuildings.forEach((bp, idx) => {
                dummy.rotation.set(0, 0, 0);
                dummy.position.set(bp.x, bp.h + 0.36, bp.z);
                dummy.scale.set(bp.w + 0.32, 0.72, bp.d + 0.32);
                dummy.updateMatrix();
                roofCapInst.setMatrixAt(idx, dummy.matrix);

                const phH = 2.4 + (idx % 3) * 0.9;
                dummy.position.set(bp.x, bp.h + 0.72 + phH / 2, bp.z);
                dummy.scale.set(bp.w * 0.52, phH, bp.d * 0.52);
                dummy.updateMatrix();
                penthouseInst.setMatrixAt(idx, dummy.matrix);
              });

              if (spireInst && beaconInst) {
                tallTowers.forEach((bp, idx) => {
                  const topY = bp.h + 3.2;
                  dummy.rotation.set(0, 0, 0);
                  dummy.position.set(bp.x, topY + 2.8, bp.z);
                  dummy.scale.set(0.38, 0.85, 0.38);
                  dummy.updateMatrix();
                  spireInst.setMatrixAt(idx, dummy.matrix);

                  dummy.position.set(bp.x, topY + 6.0, bp.z);
                  dummy.scale.setScalar(1);
                  dummy.updateMatrix();
                  beaconInst.setMatrixAt(idx, dummy.matrix);
                });
                trackRoot.add(spireInst, beaconInst);
              }
              trackRoot.add(roofCapInst, penthouseInst);

              // Hệ thống Biển Hiệu Cửa Hàng Dọc + Mái Hiên Sáng & Quầng Sáng Đa Sắc Tràn Ra Đường Nhựa Dầu (chuẩn webgpu_lights_clustered_city)
              const streetFronts = cityBuildings.filter((b) => Boolean(b.streetFront));
              const clusteredPalette = [0xffb74d, 0x22d3ee, 0xfb7185, 0xa855f7, 0x34d399];
              const signMats = clusteredPalette.map(
                (hex) => new THREE.MeshBasicMaterial({ color: hex }),
              );
              const spillGeo = new THREE.PlaneGeometry(15.5, 13.5);
              spillGeo.rotateX(-Math.PI / 2);
              const spillMats = clusteredPalette.map(
                (hex) =>
                  new THREE.MeshBasicMaterial({
                    map: softLampGlowTex,
                    color: hex,
                    transparent: true,
                    opacity: 0.22,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                  }),
              );

              clusteredPalette.forEach((_, cIdx) => {
                const subset = streetFronts.filter((b) => b.neonIdx === cIdx);
                if (subset.length === 0) return;

                // 1) Biển hiệu hộp đèn dọc (Vertical Blade Sign) gắn mặt tiền nhô ra vỉa hè
                const bladeInst = new THREE.InstancedMesh(
                  buildingGeo,
                  signMats[cIdx],
                  subset.length,
                );
                // 2) Dải hộp đèn mái hiên cửa hàng tầng 1 (Storefront Canopy Fascia)
                const canopyInst = new THREE.InstancedMesh(
                  buildingGeo,
                  signMats[cIdx],
                  subset.length,
                );
                // 3) Thảm ánh sáng màu lan tỏa từ cửa tiệm ra vỉa hè & mép đường nhựa dầu
                const spillInst = new THREE.InstancedMesh(
                  spillGeo,
                  spillMats[cIdx],
                  subset.length,
                );

                subset.forEach((bp, i) => {
                  const sf = bp.streetFront!;
                  const faceDist =
                    Math.abs(sf.inwardX) > Math.abs(sf.inwardZ) ? bp.w * 0.5 : bp.d * 0.5;
                  const fx = bp.x + sf.inwardX * (faceDist + 0.55);
                  const fz = bp.z + sf.inwardZ * (faceDist + 0.55);

                  dummy.rotation.set(0, sf.tangentYaw, 0);
                  dummy.position.set(fx, 8.2 + (i % 3) * 1.4, fz);
                  dummy.scale.set(0.95, 5.2, 0.32);
                  dummy.updateMatrix();
                  bladeInst.setMatrixAt(i, dummy.matrix);

                  const cxPos = bp.x + sf.inwardX * (faceDist + 0.22);
                  const czPos = bp.z + sf.inwardZ * (faceDist + 0.22);
                  dummy.position.set(cxPos, 3.65, czPos);
                  dummy.scale.set(0.45, 0.55, 9.8);
                  dummy.updateMatrix();
                  canopyInst.setMatrixAt(i, dummy.matrix);

                  const sxPos = bp.x + sf.inwardX * (faceDist + 5.8);
                  const szPos = bp.z + sf.inwardZ * (faceDist + 5.8);
                  dummy.position.set(sxPos, 0.16, szPos);
                  dummy.scale.set(1, 1, 1);
                  dummy.updateMatrix();
                  spillInst.setMatrixAt(i, dummy.matrix);
                });

                trackRoot.add(bladeInst, canopyInst, spillInst);
              });
            }

            // Cột đèn đường Đô Thị quay VÀO TRONG mặt đường + 14 PointLight PBR rải đều giúp mặt đường nhựa dầu bóng loáng toàn tuyến!
            const lampWashGeo = new THREE.PlaneGeometry(22, 28);
            lampWashGeo.rotateX(-Math.PI / 2);
            const lampHaloWarmMat = new THREE.SpriteMaterial({
              map: softLampGlowTex,
              color: 0xfef3c7,
              transparent: true,
              opacity: 0.54,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const lampHaloCyanMat = new THREE.SpriteMaterial({
              map: softLampGlowTex,
              color: 0x7dd3fc,
              transparent: true,
              opacity: 0.46,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const lampWashWarmMat = new THREE.MeshBasicMaterial({
              map: softLampGlowTex,
              color: 0xfde68a,
              transparent: true,
              opacity: 0.24,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const lampWashCyanMat = new THREE.MeshBasicMaterial({
              map: softLampGlowTex,
              color: 0x38bdf8,
              transparent: true,
              opacity: 0.19,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const lampBulbWarmMat = new THREE.MeshBasicMaterial({ color: 0xfffbeb });
            const streetLightColors = [0xffdca8, 0x38bdf8, 0xffdca8, 0xfb7185, 0xffdca8, 0xa855f7];

            const cityLampCount = 28;
            for (let sl = 0; sl < cityLampCount; sl++) {
              const side = sl % 2 === 0 ? -1 : 1;
              const s = sampleCircuit((sl / cityLampCount) * total, side * (halfW + 2.8));
              const lg = new THREE.Group();
              const post = new THREE.Mesh(streetPostGeo, matDarkMetal);
              post.position.set(0, 3.6, 0);
              if (enableWorldShadows) post.castShadow = true;
              // Hướng +side * X vươn thẳng VÀO TÂM ĐƯỜNG ĐUA
              const arm = new THREE.Mesh(streetArmGeo, matDarkMetal);
              arm.position.set(side * 1.12, 7.1, 0);
              const isWarm = sl % 4 !== 1;
              const lamp = new THREE.Mesh(
                streetLampGeo,
                isWarm ? lampBulbWarmMat : neonCyanMat,
              );
              lamp.position.set(side * 2.15, 6.94, 0);

              const halo = new THREE.Sprite(isWarm ? lampHaloWarmMat : lampHaloCyanMat);
              halo.position.set(side * 2.15, 6.82, 0);
              halo.scale.set(9.2, 9.2, 1);

              const washMesh = new THREE.Mesh(
                lampWashGeo,
                isWarm ? lampWashWarmMat : lampWashCyanMat,
              );
              washMesh.position.set(side * 5.2, 0.052, 0);

              lg.add(post, arm, lamp, halo, washMesh);
              // Bật 14 nguồn PointLight thực dọc khắp vòng đua để hạt đá dăm & vệt dầu trên mặt nhựa phản quang sống động!
              if (sl % 2 === 0 && quality !== 'low') {
                const ptCol = streetLightColors[(sl >> 1) % streetLightColors.length];
                const pt = new THREE.PointLight(ptCol, 4.2, 54, 0.85);
                pt.position.set(side * 3.8, 6.6, 0);
                lg.add(pt);
              } else if (sl % 4 === 0 && quality === 'low') {
                const pt = new THREE.PointLight(0xffdca8, 3.8, 52, 0.85);
                pt.position.set(side * 3.8, 6.6, 0);
                lg.add(pt);
              }
              lg.position.set(s.x, 0, s.z);
              lg.rotation.y = s.yaw;
              trackRoot.add(lg);
            }
          }

          // Khán đài cơ bản + Hệ thống Đèn Đường Cao Áp quay VÀO TRONG đường đua trên Park & Mountain
          if (scenery === 'park' || scenery === 'mountain') {
            const standFracs = [0.06, 0.38, 0.72];
            standFracs.forEach((frac, idx) => {
              const side = idx % 2 === 0 ? -1 : 1;
              const s = sampleCircuit(total * frac, side * (halfW + 10));
              if (!isSafeScenerySpot(s.x, s.z, halfW + 5)) return;
              const sg = new THREE.Group();
              const base = new THREE.Mesh(standGeo, standMat);
              base.position.y = 2.2;
              const roof = new THREE.Mesh(standRoofGeo, roofMat);
              roof.position.y = 6.2;
              if (enableWorldShadows) {
                base.castShadow = true;
                base.receiveShadow = true;
                roof.castShadow = true;
              }
              sg.add(base, roof);
              sg.position.set(s.x, 0, s.z);
              sg.rotation.y = s.yaw;
              trackRoot.add(sg);
            });

            for (let sl = 0; sl < 18; sl++) {
              const side = sl % 2 === 0 ? -1 : 1;
              const s = sampleCircuit((sl / 18) * total, side * (halfW + 3.4));
              const lg = new THREE.Group();
              const post = new THREE.Mesh(streetPostGeo, matDarkMetal);
              post.position.y = 3.6;
              const arm = new THREE.Mesh(streetArmGeo, matDarkMetal);
              arm.position.set(side * 1.12, 7.1, 0);
              const lamp = new THREE.Mesh(streetLampGeo, towerGlowMat);
              lamp.position.set(side * 2.15, 6.95, 0);
              if (enableWorldShadows) post.castShadow = true;
              lg.add(post, arm, lamp);
              lg.position.set(s.x, 0, s.z);
              lg.rotation.y = s.yaw;
              trackRoot.add(lg);
            }
          }

          if (relayoutProps) relayoutProps();
        };

        const rebuildTrackIfNeeded = () => {
          const v = getTrackVersion();
          const q = graphicsQualityRef.current;
          if (v === builtTrackVersion && q === builtQuality) return;
          const mapChanged = v !== builtTrackVersion;
          builtTrackVersion = v;
          builtQuality = q;
          buildTrackWorld();
          if (mapChanged) {
            cameraDirectorRef.current.snapCamera();
          }
        };
        rebuildTrackIfNeeded();

        // ---------- 2B. Hiệu ứng Vệt Gió Siêu Tốc 3D Xung Quanh Khung Cảnh (giống ảnh tham chiếu) ----------
        scene.add(camera);
        const windStreaksGroup = new THREE.Group();
        const windStreakGeo = new THREE.CylinderGeometry(0.025, 0.025, 5.2, 4);
        windStreakGeo.rotateX(Math.PI / 2);
        const windStreakMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const windStreaks: Array<{ mesh: any; x: number; y: number; z: number; spd: number }> = [];
        for (let ws = 0; ws < 30; ws++) {
          const ang = (ws / 30) * Math.PI * 2 + (ws % 3) * 0.21;
          const rad = 5.2 + (ws % 5) * 1.45;
          const wx = Math.cos(ang) * rad * 0.85;
          const wy = Math.sin(ang) * rad * 1.1 + 1.2;
          const wz = -6 - (ws % 10) * 3.8;
          const mesh = new THREE.Mesh(windStreakGeo, windStreakMat);
          mesh.position.set(wx, wy, wz);
          windStreaksGroup.add(mesh);
          windStreaks.push({ mesh, x: wx, y: wy, z: wz, spd: 34 + (ws % 6) * 8 });
        }
        windStreaksGroup.visible = false;
        camera.add(windStreaksGroup);


        // ---------- 3. Hệ thống Tia Lửa Đạn Đạo 3D Vật Lý (Nảy mặt đường nhựa & Bức xạ vật đen) ----------
        const glowTex = makeGlowParticleTexture();
        const sparkSystem = createBallisticSparkSystem(THREE, scene, 260);

        const spawnParticle = (opts: {
          x: number;
          y: number;
          z: number;
          vx: number;
          vy: number;
          vz: number;
          life: number;
          size: number;
          grow?: number;
          gravity?: number;
          color: number;
          smoke?: boolean;
        }) => {
          // Bỏ qua khói mờ mịn, chỉ phóng tia lửa 3D tam giác sắc lẹm có trọng lực & nảy trên đường đua!
          if (opts.smoke) return;
          const useCustomHue =
            opts.color === 0x38bdf8 ||
            opts.color === 0x22d3ee ||
            opts.color === 0x34d399 ||
            opts.color === 0x4ade80 ||
            opts.color === 0xc084fc ||
            opts.color === 0xe879f9;
          sparkSystem.spawn({
            x: opts.x,
            y: opts.y,
            z: opts.z,
            vx: opts.vx,
            vy: opts.vy,
            vz: opts.vz,
            life: opts.life,
            size: Math.max(0.65, Math.min(1.55, opts.size)),
            tintHex: useCustomHue ? opts.color : undefined,
          });
        };

        // ---------- 3B. Vệt Đèn Đường Phát Sáng The Flash ("chạy tới đâu đường sáng tới đó") ----------
        const FLASH_TRAIL_MAX = 110;
        const geoRoadGlow = new THREE.PlaneGeometry(2.1, 3.6);
        geoRoadGlow.rotateX(-Math.PI / 2);
        interface RoadGlowStamp {
          active: boolean;
          life: number;
          maxLife: number;
          mesh: any;
          mat: any;
        }
        const roadGlows: RoadGlowStamp[] = [];
        for (let rg = 0; rg < FLASH_TRAIL_MAX; rg++) {
          const mat = new THREE.MeshBasicMaterial({
            map: glowTex,
            color: 0xfacc15,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const mesh = new THREE.Mesh(geoRoadGlow, mat);
          mesh.visible = false;
          scene.add(mesh);
          roadGlows.push({ active: false, life: 0, maxLife: 1.0, mesh, mat });
        }
        let roadGlowCursor = 0;
        const spawnRoadGlow = (x: number, z: number, yaw: number, color: number, scaleW = 1.0) => {
          // 3B) Vệt đèn đường phát sáng The Flash hòa quyện tự nhiên vào mặt nhựa ("chạy tới đâu đường sáng tới đó")
          const st = roadGlows[roadGlowCursor];
          roadGlowCursor = (roadGlowCursor + 1) % FLASH_TRAIL_MAX;
          st.active = true;
          st.life = 0.9;
          st.maxLife = 0.9;
          st.mat.color.setHex(color);
          st.mat.opacity = 0.48;
          st.mesh.position.set(x, 0.085, z);
          st.mesh.rotation.set(0, yaw, 0);
          st.mesh.scale.set(scaleW, 1, 1.15);
          st.mesh.visible = true;
        };

        // ---------- 4. Nạp bất đồng bộ Nhân Vật, Thú Cưng & Đối Tượng 3D từ iErcann/NotBlox ----------
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
        const gltfLoader = new GLTFLoader();
        gltfLoader.setDRACOLoader(dracoLoader);

        interface NotBloxTemplate {
          scene: any;
          animations: any[];
        }
        const glbTemplates: Array<NotBloxTemplate | null> = NOTBLOX_CHARACTER_MODELS.map(() => null);
        const petTemplates: Array<any | null> = NOTBLOX_PET_MODELS.map(() => null);

        // Chuẩn hóa chất liệu giống NotBlox MeshSystem.ts (metalness = 0 để màu sắc tươi sáng)
        const normalizeNotBloxMesh = (root: any, targetH: number) => {
          root.traverse((child: any) => {
            if (child.isMesh && child.material) {
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              mats.forEach((m: any) => {
                if (typeof m.metalness === 'number') m.metalness = 0;
              });
            }
          });
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const scale = size.y > 0.05 ? targetH / size.y : 1.0;
          root.scale.setScalar(scale);
          box.setFromObject(root);
          root.position.y = -box.min.y;
        };

        // Tải model GLB có cache tránh trùng URL
        const urlPromiseCache = new Map<string, Promise<any | null>>();
        const loadGlbOnce = (url: string) => {
          if (!urlPromiseCache.has(url)) {
            urlPromiseCache.set(
              url,
              new Promise((resolve) => {
                gltfLoader.load(
                  url,
                  (gltf: any) => resolve(gltf),
                  undefined,
                  () => resolve(null),
                );
              }),
            );
          }
          return urlPromiseCache.get(url)!;
        };

        // Chuẩn hóa dấu Quaternion (dot(q_i, q_{i+1}) < 0 -> đảo dấu) trên mọi QuaternionKeyframeTrack
        // để khắc phục triệt để lỗi chân trái của Character.glb bị triệt tiêu góc xoay (trông như đang đi bộ)
        const sanitizeAnimationClips = (clips: any[]) => {
          for (const clip of clips) {
            if (!clip || !Array.isArray(clip.tracks)) continue;
            for (const track of clip.tracks) {
              const vals = track?.values;
              if (!vals || vals.length < 8) continue;
              const isQuat =
                track.ValueTypeName === 'quaternion' ||
                (typeof track.name === 'string' && track.name.endsWith('.quaternion'));
              if (!isQuat) continue;
              for (let k = 4; k < vals.length; k += 4) {
                const dot =
                  vals[k - 4] * vals[k] +
                  vals[k - 3] * vals[k + 1] +
                  vals[k - 2] * vals[k + 2] +
                  vals[k - 1] * vals[k + 3];
                if (dot < 0) {
                  vals[k] = -vals[k];
                  vals[k + 1] = -vals[k + 1];
                  vals[k + 2] = -vals[k + 2];
                  vals[k + 3] = -vals[k + 3];
                }
              }
            }
          }
        };

        // 4A) Tải Nhân vật người chơi NotBlox
        NOTBLOX_CHARACTER_MODELS.forEach((spec, idx) => {
          void loadGlbOnce(spec.url).then((gltf) => {
            if (cancelled || !gltf) return;
            const clonedRoot = SkeletonUtils.clone(gltf.scene);
            normalizeNotBloxMesh(clonedRoot, spec.targetHeight);
            const animations = gltf.animations || [];
            sanitizeAnimationClips(animations);
            glbTemplates[idx] = {
              scene: clonedRoot,
              animations,
            };
            setLoadedModelsCount((c) => c + 1);
          });
        });

        // 4B) Tải Thú cưng VIP NotBlox (kích thước nhỏ gọn đi kèm người chơi)
        NOTBLOX_PET_MODELS.forEach((spec, idx) => {
          void loadGlbOnce(spec.url).then((gltf) => {
            if (cancelled || !gltf) return;
            const clonedRoot = SkeletonUtils.clone(gltf.scene);
            normalizeNotBloxMesh(clonedRoot, spec.targetHeight);
            petTemplates[idx] = clonedRoot;
            setLoadedModelsCount((c) => c + 1);
          });
        });

        // Xe đua NotBlox đậu gọn bên lề gần vạch xuất phát (giảm vật thể gây rối mắt, đặt lại theo từng map)
        const propsRoot = new THREE.Group();
        scene.add(propsRoot);
        let propsToken = 0;
        const propPlacements = [
          { url: NOTBLOX_PROP_MODELS.car, h: 2.3, dist: 6, lat: halfW + 6.5, yaw: 0 },
          { url: NOTBLOX_PROP_MODELS.ezCar, h: 2.1, dist: 22, lat: halfW + 6.5, yaw: 0.1 },
        ];
        relayoutProps = () => {
          const myToken = ++propsToken;
          propsRoot.clear();
          propPlacements.forEach((pl) => {
            void loadGlbOnce(pl.url).then((gltf) => {
              if (cancelled || !gltf || myToken !== propsToken) return;
              const obj = gltf.scene.clone(true);
              normalizeNotBloxMesh(obj, pl.h);
              const s = sampleCircuit(pl.dist, pl.lat);
              obj.position.set(s.x, obj.position.y, s.z);
              obj.rotation.y = s.yaw + pl.yaw;
              propsRoot.add(obj);
            });
          });
        };
        relayoutProps();

        // ---------- 5. Shared Geometries & Pool 60 Nhân Vật + Đạo Cụ 3D ----------
        const sharedFaceTex = makeRobloxFaceTexture();
        const sharedShadowTex = makeShadowTexture();

        const geoHead = new THREE.BoxGeometry(0.84, 0.84, 0.84);
        const geoHatTop = new THREE.BoxGeometry(0.92, 0.22, 0.92);
        const geoTorso = new THREE.BoxGeometry(1.02, 1.08, 0.54);
        const geoLimb = new THREE.BoxGeometry(0.35, 0.94, 0.35);
        const geoShadow = new THREE.PlaneGeometry(2.2, 2.2);

        const geoJetPackBase = new THREE.BoxGeometry(0.76, 0.85, 0.24);
        const geoJetTank = new THREE.CylinderGeometry(0.18, 0.2, 0.95, 10);
        const geoJetNozzle = new THREE.CylinderGeometry(0.12, 0.19, 0.24, 10);
        const geoFlameOuter = new THREE.ConeGeometry(0.24, 1.15, 8);
        const geoFlameInner = new THREE.ConeGeometry(0.13, 0.72, 8);

        const geoRocketBody = new THREE.CylinderGeometry(0.56, 0.62, 3.4, 14);
        const geoRocketStripe = new THREE.CylinderGeometry(0.58, 0.59, 0.45, 14);
        const geoRocketNose = new THREE.ConeGeometry(0.56, 1.35, 14);
        const geoRocketWindow = new THREE.SphereGeometry(0.24, 10, 10);
        const geoRocketFin = new THREE.BoxGeometry(0.1, 0.72, 0.95);
        const geoRocketNozzle = new THREE.CylinderGeometry(0.42, 0.56, 0.48, 12);
        const geoShockRing = new THREE.TorusGeometry(0.95, 0.08, 8, 22);

        // Hình khối Rồng Chân Thật Điêu Khắc Chi Tiết (Đầu sừng kép, hàm răng nanh, bờm cổ, 22 đốt sống, 4 chân móng vuốt, cánh xương 3 ngón)
        const geoDragonHead = new THREE.SphereGeometry(0.74, 18, 14);
        const geoDragonSnout = new THREE.CapsuleGeometry(0.3, 0.64, 8, 12);
        geoDragonSnout.rotateX(Math.PI / 2);
        const geoDragonBrow = new THREE.CapsuleGeometry(0.1, 0.42, 5, 8);
        geoDragonBrow.rotateX(Math.PI / 2);
        const geoDragonFang = new THREE.ConeGeometry(0.048, 0.22, 6);
        const geoDragonHorn = new THREE.ConeGeometry(0.13, 1.05, 8);
        const geoDragonHornTip = new THREE.ConeGeometry(0.085, 0.86, 8);
        const geoDragonMane = new THREE.ConeGeometry(0.095, 0.68, 6);
        const geoDragonWhisker = new THREE.CylinderGeometry(0.032, 0.012, 1.85, 6);
        const geoDragonEye = new THREE.SphereGeometry(0.13, 10, 10);
        const geoDragonSeg = new THREE.SphereGeometry(0.68, 16, 12);
        const geoDragonSpike = new THREE.ConeGeometry(0.12, 0.58, 6);
        const geoDragonTailFan = new THREE.ConeGeometry(0.44, 1.35, 5);
        geoDragonTailFan.rotateX(-Math.PI / 2);
        const geoDragonThigh = new THREE.CapsuleGeometry(0.21, 0.54, 6, 8);
        const geoDragonShin = new THREE.CapsuleGeometry(0.14, 0.48, 6, 8);
        const geoDragonClaw = new THREE.ConeGeometry(0.052, 0.26, 6);
        const geoDragonWingArm = new THREE.CylinderGeometry(0.1, 0.15, 3.25, 8);
        geoDragonWingArm.rotateZ(Math.PI / 2);
        const geoDragonWingFinger = new THREE.CylinderGeometry(0.032, 0.068, 2.95, 6);
        const geoDragonWingMain = new THREE.BoxGeometry(2.95, 0.05, 1.65);
        const geoDragonWingTip = new THREE.ConeGeometry(1.02, 2.35, 4);
        geoDragonWingTip.rotateZ(-Math.PI / 2);
        const geoDragonOrb = new THREE.SphereGeometry(0.24, 12, 10);
        const geoBoltMain = new THREE.BoxGeometry(0.08, 0.08, 1.35);
        const geoBoltDiag = new THREE.BoxGeometry(0.07, 0.07, 0.95);

        const matShadow = new THREE.MeshBasicMaterial({
          map: sharedShadowTex,
          transparent: true,
          depthWrite: false,
        });
        const matChrome = new THREE.MeshPhysicalMaterial({
          color: 0xf1f5f9,
          metalness: 0.92,
          roughness: 0.14,
          clearcoat: 0.9,
          clearcoatRoughness: 0.08,
        });
        const matRocketRed = new THREE.MeshPhysicalMaterial({
          color: 0xef4444,
          metalness: 0.45,
          roughness: 0.18,
          clearcoat: 1.0,
          clearcoatRoughness: 0.08,
        });
        const matGlass = new THREE.MeshPhysicalMaterial({
          color: 0x38bdf8,
          emissive: 0x0284c7,
          emissiveIntensity: 0.55,
          metalness: 0.2,
          roughness: 0.05,
          clearcoat: 1.0,
          ior: 1.52,
        });
        const matFlameOuter = new THREE.MeshBasicMaterial({
          color: 0xff6b1a,
          transparent: true,
          opacity: 0.86,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const matFlameInner = new THREE.MeshBasicMaterial({
          color: 0xfef08a,
          transparent: true,
          opacity: 0.94,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const matRocketCore = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.98,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const matFlameCyan = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const matRocketShock = new THREE.MeshBasicMaterial({
          color: 0xfdba74,
          transparent: true,
          opacity: 0.82,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const matDragonGold = new THREE.MeshPhysicalMaterial({
          color: 0xfacc15,
          emissive: 0xd97706,
          emissiveIntensity: 0.35,
          metalness: 0.88,
          roughness: 0.16,
          clearcoat: 0.95,
          clearcoatRoughness: 0.1,
          iridescence: 0.38,
          iridescenceIOR: 1.4,
        });
        // Vật liệu Rồng Hologram Ảo Diệu (GLSL Fresnel + Scanline + Sóng Năng Lượng Xuyên Thấu)
        const matDragonHoloEast = createHologramDragonMaterial(THREE, 'eastern');
        const matDragonHoloWest = createHologramDragonMaterial(THREE, 'western');
        const matDragonFang = new THREE.MeshBasicMaterial({
          color: 0xe0f2fe,
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const matDragonEye = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const matSprintRing = new THREE.MeshBasicMaterial({
          color: 0x22d3ee,
          transparent: true,
          opacity: 0.85,
        });

        interface RacerSlot {
          root: any;
          bodyPivot: any;
          fallbackGrp: any;
          glbHolder: any;
          glbCharIdx: number;
          glbMixer: any | null;
          glbActions: Map<string, any>;
          glbAnimState: NotBloxAnimState | '';
          glbHasClips: boolean;
          glbTintMats: any[];
          glbAllMats: any[];
          glbLastColor: number;
          glbOutlineMat: any;
          glbHaloMat: any;
          supermanAuraGrp: any;
          supermanRings: any[];
          landingShockRing: any;
          landingShockMat: any;
          wasSuperman: boolean;
          supermanLandTimer: number;
          landingBurstDone: boolean;
          dragonWhiskersGrp: any;
          dragonStyle: 'eastern' | 'western';
          petHolder: any;
          petModelWrap: any;
          petLoadedIdx: number;
          shadowMesh: any;
          leftArm: any;
          rightArm: any;
          leftLeg: any;
          rightLeg: any;
          torsoMat: any;
          pantsMat: any;
          skinMat: any;
          hatMat: any;
          sprintRing: any;
          jetpackGrp: any;
          jetFlames: any[];
          rocketGrp: any;
          rocketFlameCore: any;
          rocketFlameOuter: any;
          rocketFlameInner: any;
          rocketRing: any;
          rocketShockRings: any[];
          dragonGrp: any;
          dragonHeadGrp: any;
          dragonJawGrp: any;
          dragonSegs: any[];
          dragonLegs: any[];
          dragonLeftWing: any;
          dragonRightWing: any;
          dragonOrbsGrp: any;
          dragonHoloMeshes: any[];
          sonicSpeedGrp: any;
          sonicSpeedRings: any[];
          bodyPlasmaGrp: any;
          flashLightningGrp: any;
          jaggedLightning: ReturnType<typeof createJaggedLightningGroup>;
        }

        const createRacerSlot = (): RacerSlot => {
          const root = new THREE.Group();

          const shadowMesh = new THREE.Mesh(geoShadow, matShadow);
          shadowMesh.rotation.x = -Math.PI / 2;
          shadowMesh.position.y = 0.06;
          root.add(shadowMesh);

          const bodyPivot = new THREE.Group();
          root.add(bodyPivot);

          // Nhóm chứa mô hình nhân vật / thú cưng 3D GLB từ iErcann/NotBlox
          const glbHolder = new THREE.Group();
          bodyPivot.add(glbHolder);

          // Nhóm Thú Cưng VIP đi theo bên cạnh & hơi lùi sau người chơi
          const petHolder = new THREE.Group();
          petHolder.position.set(1.45, 0, -1.05);
          const petShadow = new THREE.Mesh(geoShadow, matShadow);
          petShadow.rotation.x = -Math.PI / 2;
          petShadow.scale.setScalar(0.5);
          petShadow.position.y = 0.05;
          const petAura = new THREE.Mesh(geoShockRing, matDragonGold);
          petAura.rotation.x = Math.PI / 2;
          petAura.scale.setScalar(0.58);
          petAura.position.y = 0.09;
          const petModelWrap = new THREE.Group();
          petHolder.add(petShadow, petAura, petModelWrap);
          petHolder.visible = false;
          root.add(petHolder);

          // Nhóm dự phòng (hiển thị ngay lập tức trong khi GLB đang tải hoặc cho tay đua hạng #17..#60)
          const fallbackGrp = new THREE.Group();
          bodyPivot.add(fallbackGrp);

          const torsoMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.45 });
          const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55 });
          const skinMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.5 });
          const hatMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35 });

          const faceMat = new THREE.MeshStandardMaterial({ map: sharedFaceTex, roughness: 0.45 });
          const head = new THREE.Mesh(geoHead, [
            skinMat,
            skinMat,
            skinMat,
            skinMat,
            faceMat,
            skinMat,
          ]);
          head.position.set(0, 2.48, 0);
          fallbackGrp.add(head);

          const hat = new THREE.Mesh(geoHatTop, hatMat);
          hat.position.set(0, 2.98, 0);
          fallbackGrp.add(hat);

          const torso = new THREE.Mesh(geoTorso, torsoMat);
          torso.position.set(0, 1.5, 0);
          fallbackGrp.add(torso);

          const makeLimb = (x: number, y: number, mat: any) => {
            const p = new THREE.Group();
            p.position.set(x, y, 0);
            const m = new THREE.Mesh(geoLimb, mat);
            m.position.y = -0.45;
            p.add(m);
            fallbackGrp.add(p);
            return p;
          };
          const leftArm = makeLimb(-0.7, 1.95, skinMat);
          const rightArm = makeLimb(0.7, 1.95, skinMat);
          const leftLeg = makeLimb(-0.27, 0.94, pantsMat);
          const rightLeg = makeLimb(0.27, 0.94, pantsMat);

          // 1) Sprint Aura Ring + Sóng Xung Kích Tốc Độ (Sonic Slipstream Rings)
          const sprintRing = new THREE.Mesh(geoShockRing, matSprintRing);
          sprintRing.rotation.x = Math.PI / 2;
          sprintRing.position.y = 0.22;
          sprintRing.visible = false;
          root.add(sprintRing);

          const sonicSpeedGrp = new THREE.Group();
          const sonicSpeedRings: any[] = [];
          for (let sr = 0; sr < 2; sr++) {
            const sMat = new THREE.MeshBasicMaterial({
              color: sr === 0 ? 0x00b4ff : 0x67e8f9,
              transparent: true,
              opacity: 0.45,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const sMesh = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.032, 8, 28), sMat);
            sMesh.position.set(0, 1.35, -0.4 - sr * 1.1);
            sonicSpeedGrp.add(sMesh);
            sonicSpeedRings.push(sMesh);
          }
          sonicSpeedGrp.visible = false;
          root.add(sonicSpeedGrp);

          // 2) Jetpack 3D
          const jetpackGrp = new THREE.Group();
          jetpackGrp.position.set(0, 1.62, -0.36);
          jetpackGrp.add(new THREE.Mesh(geoJetPackBase, matDarkMetal));
          const jetFlames: any[] = [];
          for (const sx of [-0.26, 0.26]) {
            const tank = new THREE.Mesh(geoJetTank, matChrome);
            tank.position.set(sx, 0.05, -0.1);
            const nozzle = new THREE.Mesh(geoJetNozzle, matDarkMetal);
            nozzle.position.set(sx, -0.48, -0.1);
            const fOuter = new THREE.Mesh(geoFlameOuter, matFlameOuter);
            fOuter.rotation.x = Math.PI;
            fOuter.position.set(sx, -1.08, -0.1);
            const fInner = new THREE.Mesh(geoFlameInner, matFlameCyan);
            fInner.rotation.x = Math.PI;
            fInner.position.set(sx, -0.86, -0.1);
            jetpackGrp.add(tank, nozzle, fOuter, fInner);
            jetFlames.push(fOuter, fInner);
          }
          jetpackGrp.visible = false;
          bodyPivot.add(jetpackGrp);

          // 3) Tên Lửa Siêu Thanh 3D + Luồng Lửa Afterburner 3 Lớp & Vòng Sóng Xung Kích Kim Cương (Shock Diamonds)
          const rocketGrp = new THREE.Group();
          rocketGrp.position.set(0, 0.45, 0.25);
          const rBody = new THREE.Mesh(geoRocketBody, matChrome);
          rBody.rotation.x = Math.PI / 2;
          const rStripe = new THREE.Mesh(geoRocketStripe, matRocketRed);
          rStripe.rotation.x = Math.PI / 2;
          rStripe.position.z = 0.55;
          const rNose = new THREE.Mesh(geoRocketNose, matRocketRed);
          rNose.rotation.x = Math.PI / 2;
          rNose.position.z = 2.35;
          const rWin = new THREE.Mesh(geoRocketWindow, matGlass);
          rWin.position.set(0, 0.48, 1.05);
          const rNozzle = new THREE.Mesh(geoRocketNozzle, matDarkMetal);
          rNozzle.rotation.x = Math.PI / 2;
          rNozzle.position.z = -1.85;
          for (let f = 0; f < 4; f++) {
            const finWrap = new THREE.Group();
            finWrap.rotation.z = (f * Math.PI) / 2 + Math.PI / 4;
            const fin = new THREE.Mesh(geoRocketFin, matRocketRed);
            fin.position.set(0, 0.72, -1.25);
            finWrap.add(fin);
            rocketGrp.add(finWrap);
          }
          const rocketFlameCore = new THREE.Mesh(geoFlameInner, matRocketCore);
          rocketFlameCore.rotation.x = -Math.PI / 2;
          rocketFlameCore.scale.set(1.55, 2.25, 1.55);
          rocketFlameCore.position.z = -2.45;

          const rocketFlameInner = new THREE.Mesh(geoFlameInner, matFlameInner);
          rocketFlameInner.rotation.x = -Math.PI / 2;
          rocketFlameInner.scale.set(2.35, 3.35, 2.35);
          rocketFlameInner.position.z = -3.05;

          const rocketFlameOuter = new THREE.Mesh(geoFlameOuter, matFlameOuter);
          rocketFlameOuter.rotation.x = -Math.PI / 2;
          rocketFlameOuter.scale.set(2.75, 4.15, 2.75);
          rocketFlameOuter.position.z = -3.85;

          const rocketRing = new THREE.Mesh(geoShockRing, matFlameCyan);
          rocketRing.position.z = -2.08;

          const rocketShockRings: any[] = [];
          for (let sr = 0; sr < 3; sr++) {
            const sRing = new THREE.Mesh(geoShockRing, matRocketShock);
            sRing.position.z = -2.4 - sr * 0.95;
            sRing.scale.setScalar(0.68 - sr * 0.14);
            rocketGrp.add(sRing);
            rocketShockRings.push(sRing);
          }

          rocketGrp.add(
            rBody,
            rStripe,
            rNose,
            rWin,
            rNozzle,
            rocketFlameCore,
            rocketFlameInner,
            rocketFlameOuter,
            rocketRing,
          );
          rocketGrp.visible = false;
          root.add(rocketGrp);

          // 4) Rồng Thần Hologram Ảo Diệu & Giải Phẫu Điêu Khắc Chân Thật (Đầu Sừng Kép + Hàm Nanh + Bờm + 22 Đốt Thân + 4 Chân Móng Vuốt + Cánh 3 Ngón)
          const dragonHoloMeshes: any[] = [];
          const addHoloMesh = (geo: any, parent: any) => {
            const m = new THREE.Mesh(geo, matDragonHoloEast);
            parent.add(m);
            dragonHoloMeshes.push(m);
            return m;
          };

          const dragonGrp = new THREE.Group();
          dragonGrp.position.set(0, 0.4, 0);
          const dragonHeadGrp = new THREE.Group();
          dragonHeadGrp.position.set(0, 1.02, 3.05);

          // Hộp sọ & mõm trên góc cạnh uy nghiêm
          const dHead = addHoloMesh(geoDragonHead, dragonHeadGrp);
          dHead.scale.set(0.92, 0.84, 1.32);
          const dSnout = addHoloMesh(geoDragonSnout, dragonHeadGrp);
          dSnout.position.set(0, -0.04, 0.92);
          dSnout.scale.set(0.96, 0.82, 1.12);

          // Cặp gờ chân mày dữ dội che trên hốc mắt rồng
          for (const sx of [-1, 1]) {
            const brow = addHoloMesh(geoDragonBrow, dragonHeadGrp);
            brow.position.set(sx * 0.36, 0.28, 0.56);
            brow.rotation.set(0.18, sx * 0.28, sx * -0.35);
          }

          // Hàm dưới cử động há gầm + 4 răng nanh sắc nhọn phát sáng
          const dragonJawGrp = new THREE.Group();
          dragonJawGrp.position.set(0, -0.24, 0.24);
          const dJaw = addHoloMesh(geoDragonSnout, dragonJawGrp);
          dJaw.position.set(0, -0.08, 0.56);
          dJaw.scale.set(0.8, 0.58, 0.94);
          for (const fx of [-0.22, 0.22]) {
            const fangFront = new THREE.Mesh(geoDragonFang, matDragonFang);
            fangFront.position.set(fx, 0.14, 0.92);
            const fangMid = new THREE.Mesh(geoDragonFang, matDragonFang);
            fangMid.position.set(fx * 1.12, 0.12, 0.58);
            fangMid.scale.setScalar(0.82);
            dragonJawGrp.add(fangFront, fangMid);
          }
          dragonHeadGrp.add(dragonJawGrp);

          // Đôi mắt rồng phát tia sáng trắng ngọc
          const dEyeL = new THREE.Mesh(geoDragonEye, matDragonEye);
          dEyeL.position.set(-0.41, 0.16, 0.56);
          dEyeL.scale.set(0.85, 0.65, 1.25);
          const dEyeR = new THREE.Mesh(geoDragonEye, matDragonEye);
          dEyeR.position.set(0.41, 0.16, 0.56);
          dEyeR.scale.set(0.85, 0.65, 1.25);
          dragonHeadGrp.add(dEyeL, dEyeR);

          // Cặp sừng rồng 2 đốt uốn cong vút ra sau cực kỳ chân thật + sừng phụ bên má
          for (const sx of [-1, 1]) {
            const hornBase = addHoloMesh(geoDragonHorn, dragonHeadGrp);
            hornBase.position.set(sx * 0.36, 0.62, -0.22);
            hornBase.rotation.set(-0.78, 0, sx * 0.32);
            const hornTip = addHoloMesh(geoDragonHornTip, dragonHeadGrp);
            hornTip.position.set(sx * 0.54, 1.06, -0.82);
            hornTip.rotation.set(-1.12, 0, sx * 0.42);
            const cheekSpike = addHoloMesh(geoDragonMane, dragonHeadGrp);
            cheekSpike.position.set(sx * 0.58, -0.05, -0.18);
            cheekSpike.rotation.set(-0.95, 0, sx * 0.78);
            cheekSpike.scale.setScalar(0.72);
          }

          // Bờm gai dọc đỉnh gáy rồng
          for (let m = 0; m < 3; m++) {
            const mane = addHoloMesh(geoDragonMane, dragonHeadGrp);
            mane.position.set(0, 0.58 - m * 0.12, -0.35 - m * 0.32);
            mane.rotation.x = -0.72 - m * 0.12;
          }

          // Râu rồng uốn lượn đặc trưng của Rồng Phương Đông
          const dragonWhiskersGrp = new THREE.Group();
          for (const sx of [-1, 1]) {
            const whisk = addHoloMesh(geoDragonWhisker, dragonWhiskersGrp);
            whisk.position.set(sx * 0.68, -0.12, 0.92);
            whisk.rotation.set(0.42, sx * -0.25, sx * 1.18);
          }
          dragonHeadGrp.add(dragonWhiskersGrp);
          dragonGrp.add(dragonHeadGrp);

          // Thân & Đuôi rồng gồm 22 đốt sống cơ bắp thuôn mượt tới vây đuôi năng lượng
          const DRAGON_SEG_COUNT = 22;
          const dragonSegs: any[] = [];
          for (let s = 0; s < DRAGON_SEG_COUNT; s++) {
            const sg = new THREE.Group();
            const tFrac = s / (DRAGON_SEG_COUNT - 1);
            // Cổ săn chắc -> Ngực nở cơ bắp (đốt 2..5) -> Thân thon dài -> Đuôi vút mảnh
            const thickness =
              s < 4
                ? 0.86 + Math.sin((s / 4) * Math.PI * 0.75) * 0.32
                : Math.max(0.2, 1.18 * Math.pow(1 - (tFrac - 0.12) * 0.88, 1.25));
            const segMesh = addHoloMesh(geoDragonSeg, sg);
            segMesh.scale.set(thickness * 0.92, thickness * 0.86, thickness * 1.46);

            if (s < DRAGON_SEG_COUNT - 2) {
              const spike = addHoloMesh(geoDragonSpike, sg);
              spike.position.y = 0.66 * thickness;
              spike.rotation.x = -0.45;
              spike.scale.setScalar(thickness * (s % 2 === 0 ? 0.95 : 0.68));
            } else if (s === DRAGON_SEG_COUNT - 1) {
              // Chóp đuôi xòe quạt vây năng lượng 3 cánh dũng mãnh
              for (const fanAng of [-0.38, 0, 0.38]) {
                const fan = addHoloMesh(geoDragonTailFan, sg);
                fan.position.set(Math.sin(fanAng) * 0.22, 0.04, -0.55);
                fan.rotation.y = fanAng;
                fan.scale.set(0.75, 0.22, 1.0);
              }
            }
            sg.position.set(0, 0.38, 2.45 - s * 0.38);
            dragonGrp.add(sg);
            dragonSegs.push(sg);
          }

          // 4 Chân Rồng Cơ Bắp Có Móng Vuốt Sắc Bén (2 chân trước + 2 chân sau đạp mây)
          const dragonLegs: any[] = [];
          const legConfigs: Array<{ side: -1 | 1; zOff: number; isFront: boolean }> = [
            { side: -1, zOff: 1.25, isFront: true },
            { side: 1, zOff: 1.25, isFront: true },
            { side: -1, zOff: -1.45, isFront: false },
            { side: 1, zOff: -1.45, isFront: false },
          ];
          for (const lc of legConfigs) {
            const hipPivot = new THREE.Group();
            hipPivot.position.set(lc.side * 0.72, 0.22, lc.zOff);
            const thigh = addHoloMesh(geoDragonThigh, hipPivot);
            thigh.position.set(lc.side * 0.16, -0.32, -0.08);
            thigh.rotation.set(0.42, 0, lc.side * 0.35);
            const shin = addHoloMesh(geoDragonShin, hipPivot);
            shin.position.set(lc.side * 0.28, -0.78, 0.12);
            shin.rotation.set(-0.55, 0, lc.side * 0.12);
            for (let cl = -1; cl <= 1; cl++) {
              const claw = new THREE.Mesh(geoDragonClaw, matDragonFang);
              claw.position.set(lc.side * 0.3 + cl * 0.09, -1.04, 0.34);
              claw.rotation.x = Math.PI * 0.62;
              hipPivot.add(claw);
            }
            dragonGrp.add(hipPivot);
            dragonLegs.push(hipPivot);
          }

          // Đôi cánh Rồng Hologram Xương 3 Ngón xòe rộng uy nghi
          const makeDragonWing = (side: -1 | 1) => {
            const pivot = new THREE.Group();
            pivot.position.set(side * 0.56, 0.78, 1.15);
            const arm = addHoloMesh(geoDragonWingArm, pivot);
            arm.position.set(side * 1.58, 0.18, 0.28);
            for (let fg = 0; fg < 3; fg++) {
              const finger = addHoloMesh(geoDragonWingFinger, pivot);
              finger.position.set(side * (2.05 + fg * 0.55), 0.08 - fg * 0.05, -0.45 - fg * 0.25);
              finger.rotation.set(0.55 + fg * 0.22, 0, side * (1.15 - fg * 0.18));
            }
            const mainW = addHoloMesh(geoDragonWingMain, pivot);
            mainW.position.set(side * 1.52, 0.02, -0.28);
            const tipW = addHoloMesh(geoDragonWingTip, pivot);
            tipW.position.set(side * 3.55, 0.08, -0.38);
            tipW.rotation.y = side * -0.22;
            if (side === -1) tipW.scale.x = -1;
            dragonGrp.add(pivot);
            return pivot;
          };
          const dragonLeftWing = makeDragonWing(-1);
          const dragonRightWing = makeDragonWing(1);

          const dragonOrbsGrp = new THREE.Group();
          dragonOrbsGrp.position.set(0, 1.25, 0.4);
          for (let o = 0; o < 4; o++) {
            const ang = (o * Math.PI) / 2;
            const orb = addHoloMesh(geoDragonOrb, dragonOrbsGrp);
            orb.position.set(Math.cos(ang) * 2.35, 0, Math.sin(ang) * 2.35);
          }
          dragonGrp.add(dragonOrbsGrp);
          dragonGrp.visible = false;
          root.add(dragonGrp);

          // 5) Tia Sét Năng Lượng Plasma Xanh chạy dọc xoắn quanh cơ thể (bodyPlasmaGrp) + Tia kéo đuôi (flashLightningGrp)
          const jaggedLightning = createJaggedLightningGroup(THREE);
          const flashLightningGrp = jaggedLightning.grp;
          const bodyPlasmaGrp = jaggedLightning.bodyGrp;
          root.add(flashLightningGrp);
          bodyPivot.add(bodyPlasmaGrp);

          // 6) Hiệu ứng Bay Siêu Nhân (Vòng năng lượng tỏa quanh người + Hạ cánh siêu nhân, KHÔNG hình nón, KHÔNG áo choàng)
          const supermanAuraGrp = new THREE.Group();

          const supermanRings: any[] = [];
          const auraRingColors = [0x38bdf8, 0xfacc15, 0xe879f9];
          for (let ar = 0; ar < 3; ar++) {
            const rm = new THREE.MeshBasicMaterial({
              color: auraRingColors[ar],
              transparent: true,
              opacity: 0.72,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0 + ar * 0.24, 0.045, 8, 28), rm);
            ring.rotation.x = Math.PI / 2;
            ring.position.set(0, 0.45 + ar * 0.72, 0);
            supermanAuraGrp.add(ring);
            supermanRings.push(ring);
          }
          supermanAuraGrp.visible = false;
          bodyPivot.add(supermanAuraGrp);

          // Vòng sóng xung kích mặt đất khi Siêu Nhân hạ cánh (Superhero Landing Shockwave)
          const landingShockMat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const landingShockRing = new THREE.Mesh(
            new THREE.RingGeometry(0.65, 1.18, 28),
            landingShockMat,
          );
          landingShockRing.rotation.x = -Math.PI / 2;
          landingShockRing.position.y = 0.14;
          landingShockRing.visible = false;
          root.add(landingShockRing);

          // Vật liệu dự phòng (luôn ẩn để nhân vật giữ nguyên màu gốc 100% khi tăng tốc)
          const glbOutlineMat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const glbHaloMat = new THREE.MeshBasicMaterial({
            color: 0xfacc15,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });

          root.visible = false;
          // Bật đổ bóng thật & nhận bóng sáng sọc PointLight cho nhân vật dự phòng & đạo cụ cơ khí
          [fallbackGrp, jetpackGrp].forEach((grp) => {
            grp.traverse((ch: any) => {
              if (ch.isMesh) {
                ch.castShadow = true;
                ch.receiveShadow = true;
              }
            });
          });
          [rBody, rStripe, rNose, rWin, rNozzle].forEach((m) => {
            m.castShadow = true;
            m.receiveShadow = true;
          });
          scene.add(root);

          return {
            root,
            bodyPivot,
            fallbackGrp,
            glbHolder,
            glbCharIdx: -1,
            glbMixer: null,
            glbActions: new Map(),
            glbAnimState: '',
            glbHasClips: false,
            glbTintMats: [],
            glbAllMats: [],
            glbLastColor: -1,
            glbOutlineMat,
            glbHaloMat,
            supermanAuraGrp,
            supermanRings,
            landingShockRing,
            landingShockMat,
            wasSuperman: false,
            supermanLandTimer: 0,
            landingBurstDone: false,
            dragonWhiskersGrp,
            dragonStyle: 'eastern',
            petHolder,
            petModelWrap,
            petLoadedIdx: -1,
            shadowMesh,
            leftArm,
            rightArm,
            leftLeg,
            rightLeg,
            torsoMat,
            pantsMat,
            skinMat,
            hatMat,
            sprintRing,
            jetpackGrp,
            jetFlames,
            rocketGrp,
            rocketFlameCore,
            rocketFlameOuter,
            rocketFlameInner,
            rocketRing,
            rocketShockRings,
            dragonGrp,
            dragonHeadGrp,
            dragonJawGrp,
            dragonSegs,
            dragonLegs,
            dragonLeftWing,
            dragonRightWing,
            dragonOrbsGrp,
            dragonHoloMeshes,
            sonicSpeedGrp,
            sonicSpeedRings,
            bodyPlasmaGrp,
            flashLightningGrp,
            jaggedLightning,
          };
        };

        const pool: RacerSlot[] = [];
        for (let i = 0; i < RACE_CONSTANTS.MAX_RENDERED_RACERS; i++) {
          pool.push(createRacerSlot());
        }

        // ---------- 5B. Pool 24 Khán Giả Cổ Vũ Đứng Dọc 2 Bên Đường Đua (User mới vào chưa join) ----------
        interface SpectatorSlot {
          root: any;
          bodyPivot: any;
          leftArm: any;
          rightArm: any;
          torsoMat: any;
          hatMat: any;
          dist: number;
          side: -1 | 1;
        }
        const spectatorPalette = [0x38bdf8, 0xf43f5e, 0x22c55e, 0xfacc15, 0xa855f7, 0xf97316, 0xec4899, 0x14b8a6];
        const spectatorPool: SpectatorSlot[] = [];
        for (let sp = 0; sp < 24; sp++) {
          const root = new THREE.Group();
          const bodyPivot = new THREE.Group();
          root.add(bodyPivot);
          const torsoMat = new THREE.MeshStandardMaterial({
            color: spectatorPalette[sp % spectatorPalette.length],
            roughness: 0.45,
          });
          const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
          const skinMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.5 });
          const hatMat = new THREE.MeshStandardMaterial({
            color: spectatorPalette[(sp + 3) % spectatorPalette.length],
            roughness: 0.4,
          });
          const faceMat = new THREE.MeshStandardMaterial({ map: sharedFaceTex, roughness: 0.45 });
          const head = new THREE.Mesh(geoHead, [skinMat, skinMat, skinMat, skinMat, faceMat, skinMat]);
          head.position.set(0, 2.38, 0);
          const hat = new THREE.Mesh(geoHatTop, hatMat);
          hat.position.set(0, 2.86, 0);
          const torso = new THREE.Mesh(geoTorso, torsoMat);
          torso.position.set(0, 1.44, 0);
          const makeSpecLimb = (x: number, y: number, mat: any) => {
            const p = new THREE.Group();
            p.position.set(x, y, 0);
            const m = new THREE.Mesh(geoLimb, mat);
            m.position.y = -0.42;
            p.add(m);
            bodyPivot.add(p);
            return p;
          };
          const leftArm = makeSpecLimb(-0.68, 1.88, skinMat);
          const rightArm = makeSpecLimb(0.68, 1.88, skinMat);
          makeSpecLimb(-0.25, 0.9, pantsMat);
          makeSpecLimb(0.25, 0.9, pantsMat);
          bodyPivot.add(head, hat, torso);
          root.traverse((ch: any) => {
            if (ch.isMesh) ch.castShadow = true;
          });
          root.scale.setScalar(0.92);
          scene.add(root);
          const side: -1 | 1 = sp % 2 === 0 ? -1 : 1;
          const dist = -8 + Math.floor(sp / 2) * 5.2;
          spectatorPool.push({ root, bodyPivot, leftArm, rightArm, torsoMat, hatMat, dist, side });
        }

        // Gắn/hoán đổi mô hình NotBlox GLB + khởi tạo AnimationMixer chuẩn NotBlox cho Top 24 tay đua
        const ensureSlotGlb = (slot: RacerSlot, wantGlb: boolean, charIdx: number) => {
          if (!wantGlb) {
            slot.glbHolder.visible = false;
            slot.fallbackGrp.visible = true;
            return;
          }
          let chosenIdx = charIdx % NOTBLOX_CHARACTER_MODELS.length;
          if (!glbTemplates[chosenIdx]) {
            const avail = glbTemplates.findIndex((t) => t !== null);
            if (avail === -1) {
              slot.glbHolder.visible = false;
              slot.fallbackGrp.visible = true;
              return;
            }
            chosenIdx = avail;
          }

          if (slot.glbCharIdx !== chosenIdx) {
            slot.glbHolder.clear();
            slot.glbActions.clear();
            slot.glbAnimState = '';
            slot.glbTintMats = [];
            slot.glbAllMats = [];
            slot.glbLastColor = -1;
            const tpl = glbTemplates[chosenIdx]!;
            const cloned = SkeletonUtils.clone(tpl.scene);

            // Chỉ tô màu vật liệu QUẦN ÁO theo Avatar (giữ nguyên màu da mặt, đầu, mắt, tay)
            cloned.updateMatrixWorld(true);
            const charBox = new THREE.Box3().setFromObject(cloned);
            const charH = Math.max(0.01, charBox.max.y - charBox.min.y);
            const meshEntries: Array<{ mesh: any; yRatio: number; nameLower: string }> = [];
            const allMatNames = new Set<string>();
            const headSkinMatNames = new Set<string>();

            cloned.traverse((child: any) => {
              if (child.isMesh && child.material) {
                child.castShadow = true;
                child.receiveShadow = true;
                const nameLower = `${child.name || ''}`.toLowerCase();
                const mb = new THREE.Box3().setFromObject(child);
                const yCenter = (mb.min.y + mb.max.y) * 0.5;
                const yRatio = (yCenter - charBox.min.y) / charH;
                meshEntries.push({ mesh: child, yRatio, nameLower });

                const mats = Array.isArray(child.material) ? child.material : [child.material];
                const isHeadMesh =
                  nameLower.includes('head') ||
                  nameLower.includes('face') ||
                  nameLower.includes('hair') ||
                  yRatio > 0.72;
                mats.forEach((m: any) => {
                  const mn = `${m.name || ''}`.toLowerCase();
                  if (mn) allMatNames.add(mn);
                  if (isHeadMesh && mn) headSkinMatNames.add(mn);
                });
              }
            });

            const hasMultipleMats = allMatNames.size > 1;

            meshEntries.forEach(({ mesh, yRatio, nameLower }) => {
              const isHeadOrFace =
                nameLower.includes('head') ||
                nameLower.includes('face') ||
                nameLower.includes('eye') ||
                nameLower.includes('mouth') ||
                nameLower.includes('hair') ||
                nameLower.includes('hand') ||
                yRatio > 0.72;

              const cloneOne = (m: any) => {
                const cm = m.clone();
                if (typeof cm.metalness === 'number') cm.metalness = 0;
                slot.glbAllMats.push(cm);
                const matName = `${cm.name || ''}`.toLowerCase();
                const isSkinMat =
                  matName.includes('skin') ||
                  matName.includes('head') ||
                  matName.includes('face') ||
                  matName.includes('eye') ||
                  matName.includes('mouth') ||
                  matName.includes('hair') ||
                  (hasMultipleMats && headSkinMatNames.has(matName));

                // Chỉ đưa vật liệu quần áo (thân/áo/quần) vào danh sách tô màu theo Avatar
                if (!isHeadOrFace && !isSkinMat && cm.color) {
                  slot.glbTintMats.push(cm);
                }
                return cm;
              };

              mesh.material = Array.isArray(mesh.material)
                ? mesh.material.map(cloneOne)
                : cloneOne(mesh.material);
            });

            slot.glbHolder.add(cloned);
            // Tạo 2 lớp Hào Quang (Lớp viền năng lượng sắc nét + Lớp vầng sáng tỏa mềm bên ngoài) bám khớp 100% theo hình hài nhân vật
            const outlineMeshes: any[] = [];
            cloned.traverse((ch: any) => {
              if (ch.isSkinnedMesh && ch.geometry && ch.skeleton) {
                const om = new THREE.SkinnedMesh(ch.geometry, slot.glbOutlineMat);
                om.bind(ch.skeleton, ch.bindMatrix);
                om.scale.setScalar(1.075);
                om.visible = false;
                om.frustumCulled = false;
                const halo = new THREE.SkinnedMesh(ch.geometry, slot.glbHaloMat);
                halo.bind(ch.skeleton, ch.bindMatrix);
                halo.scale.setScalar(1.16);
                halo.visible = false;
                halo.frustumCulled = false;
                if (ch.parent) ch.parent.add(om, halo);
                outlineMeshes.push(om, halo);
              } else if (ch.isMesh && ch.geometry && !ch.isSkinnedMesh) {
                const om = new THREE.Mesh(ch.geometry, slot.glbOutlineMat);
                om.scale.setScalar(1.075);
                om.visible = false;
                const halo = new THREE.Mesh(ch.geometry, slot.glbHaloMat);
                halo.scale.setScalar(1.16);
                halo.visible = false;
                ch.add(om, halo);
                outlineMeshes.push(om, halo);
              }
            });
            slot.glbHolder.userData.outlineMeshes = outlineMeshes;
            slot.glbCharIdx = chosenIdx;
            if (tpl.animations && tpl.animations.length > 0) {
              const mixer = new THREE.AnimationMixer(cloned);
              const rawActions = new Map<string, any>();
              tpl.animations.forEach((clip: any) => {
                const action = mixer.clipAction(clip);
                const key = clip.name.toLowerCase();
                rawActions.set(key, action);
                slot.glbActions.set(key, action);
              });

              // Đồng bộ tên gọi 6 trạng thái chuẩn ('idle', 'run', 'sprint', 'jump', 'dance', 'fall')
              // cho cả Character.glb (idle, run, fall, dance) và MiniCharacter.glb (idle, sprint, jump, fall, emote-yes)
              // TUYỆT ĐỐI KHÔNG bao giờ gán 'walk' vào 'run' hoặc 'sprint' để nhân vật luôn chạy nước rút sung sức!
              const syncStateMap: Record<NotBloxAnimState, string[]> = {
                idle: ['idle', 'static'],
                run: ['run', 'sprint'],
                sprint: ['sprint', 'run'],
                jump: ['jump', 'fall'],
                dance: ['dance', 'emote-yes', 'jump'],
                fall: ['fall', 'jump'],
              };
              (Object.keys(syncStateMap) as NotBloxAnimState[]).forEach((stateName) => {
                for (const candidate of syncStateMap[stateName]) {
                  const act = rawActions.get(candidate);
                  if (act) {
                    slot.glbActions.set(stateName, act);
                    break;
                  }
                }
              });

              slot.glbMixer = mixer;
              slot.glbHasClips = true;
            } else {
              slot.glbMixer = null;
              slot.glbHasClips = false;
            }
          }
          slot.glbHolder.visible = true;
          slot.fallbackGrp.visible = false;
        };

        // Gắn Thú Cưng VIP NotBlox nhỏ gọn chạy theo bên cạnh người chơi
        const ensureSlotPet = (slot: RacerSlot, petIdx: number | null) => {
          if (petIdx === null) {
            slot.petHolder.visible = false;
            return;
          }
          let chosenPet = petIdx % NOTBLOX_PET_MODELS.length;
          if (!petTemplates[chosenPet]) {
            const avail = petTemplates.findIndex((p) => p !== null);
            if (avail === -1) {
              slot.petHolder.visible = false;
              return;
            }
            chosenPet = avail;
          }
          if (slot.petLoadedIdx !== chosenPet) {
            slot.petModelWrap.clear();
            const petClone = SkeletonUtils.clone(petTemplates[chosenPet]);
            petClone.traverse((ch: any) => {
              if (ch.isMesh) ch.castShadow = true;
            });
            slot.petModelWrap.add(petClone);
            slot.petLoadedIdx = chosenPet;
          }
          slot.petHolder.visible = true;
        };

        // Ánh xạ đồng bộ 6 trạng thái hoạt ảnh chuẩn cho cả Character và MiniCharacter
        const ANIM_CANDIDATES: Record<NotBloxAnimState, string[]> = {
          idle: ['idle', 'static'],
          run: ['run', 'sprint'],
          sprint: ['sprint', 'run'],
          jump: ['jump', 'fall', 'sprint', 'run'],
          dance: ['dance', 'emote-yes', 'jump'],
          fall: ['fall', 'jump', 'idle'],
        };

        // Chuyển đổi AnimationState theo đúng AnimationSystem.ts của iErcann/NotBlox (fadeOut 0.2s / fadeIn 0.1s)
        const updateNotBloxAnimation = (
          slot: RacerSlot,
          requestedState: NotBloxAnimState,
          dt: number,
          speed: number,
          tSec: number,
          seed: number,
        ) => {
          if (slot.glbHasClips && slot.glbMixer) {
            if (slot.glbAnimState !== requestedState) {
              const prevMatched = slot.glbAnimState ? slot.glbActions.get(slot.glbAnimState) : undefined;
              slot.glbAnimState = requestedState;
              const candidates = ANIM_CANDIDATES[requestedState] || [requestedState];
              let matched: any = slot.glbActions.get(requestedState);
              if (!matched) {
                for (const cand of candidates) {
                  matched = slot.glbActions.get(cand);
                  if (matched) break;
                }
              }
              if (!matched) {
                matched = slot.glbActions.values().next().value;
              }
              // Nếu chuyển giữa 'run' và 'sprint' trên cùng 1 AnimationAction thì giữ nguyên chu kỳ sải chân, chỉ tăng timeScale!
              if (matched && matched !== prevMatched) {
                const uniqueActions = new Set<any>(slot.glbActions.values());
                uniqueActions.forEach((act) => {
                  if (act !== matched) act.fadeOut(0.18);
                });
                matched.reset().fadeIn(0.1).play();
              }
            }
            // Tăng tốc độ nhịp sải chân (timeScale) cho Character.glb (idx=0) và MiniCharacter.glb (idx=1)
            // để nhân vật chạy guồng chân cực nhanh & dứt khoát, không bao giờ trông như đang đi bộ
            const isFullChar = slot.glbCharIdx === 0;
            if (requestedState === 'sprint') {
              slot.glbMixer.timeScale = isFullChar
                ? Math.max(1.85, Math.min(2.65, speed / 12.2))
                : Math.max(1.65, Math.min(2.45, speed / 13.5));
            } else if (requestedState === 'run') {
              slot.glbMixer.timeScale = isFullChar
                ? Math.max(1.45, Math.min(2.15, speed / 13.2))
                : Math.max(1.3, Math.min(1.95, speed / 14.5));
            } else if (requestedState === 'dance') {
              slot.glbMixer.timeScale = 1.2;
            } else {
              slot.glbMixer.timeScale = 1.0;
            }
            slot.glbMixer.update(dt);

            // Tạo độ nhún chạy bộ (running bounce) sinh động theo sải chân khi ở trạng thái 'run' hoặc 'sprint'
            if (requestedState === 'run' || requestedState === 'sprint') {
              const strideFreq = requestedState === 'sprint' ? 16.5 : 13.0;
              const strideAmp = requestedState === 'sprint' ? 0.14 : 0.1;
              slot.glbHolder.position.y =
                Math.abs(Math.sin(tSec * strideFreq + seed * 1.3)) * strideAmp;
            } else {
              slot.glbHolder.position.y = 0;
            }
          } else {
            // Dự phòng cho model không có clip xương
            if (requestedState === 'run' || requestedState === 'sprint') {
              const hop = Math.abs(Math.sin(tSec * Math.min(18, speed * 0.55) + seed)) * 0.35;
              slot.glbHolder.position.y = hop;
              slot.glbHolder.rotation.x = Math.sin(tSec * 12 + seed) * 0.12;
            } else if (requestedState === 'jump' || requestedState === 'dance') {
              slot.glbHolder.position.y = Math.abs(Math.sin(tSec * 7 + seed)) * 0.45;
              slot.glbHolder.rotation.x = 0;
            } else {
              slot.glbHolder.position.y = 0;
              slot.glbHolder.rotation.x = 0;
            }
          }
        };

        // ---------- 6. Resize Handling ----------
        const handleResize = () => {
          const w = container.clientWidth || 540;
          const h = container.clientHeight || 960;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          resizeDrawingBuffer();
        };
        const ro = new ResizeObserver(handleResize);
        ro.observe(container);

        // ---------- 7. Render Loop 60 FPS + Camera Chuyển Đổi Siêu Mượt ----------
        let lastTime = performance.now();
        let nextDrawAt = lastTime;
        let fpsFrames = 0;
        let fpsAccum = 0;
        let lastBadgeSig = '';
        let fireworkTimer = 0;
        let windOpacity = 0;
        const projVec = new THREE.Vector3();

        const animate = (now: number) => {
          if (cancelled) return;
          rafId = requestAnimationFrame(animate);

          const isLow = graphicsQualityRef.current === 'low';
          const isMedium = graphicsQualityRef.current === 'medium';
          const interval = 1000 / (isLow ? 30 : 60);
          if (now + 0.5 < nextDrawAt) return;
          nextDrawAt = Math.max(now, nextDrawAt + interval);
          const elapsed = (now - lastTime) / 1000;
          const dt = Math.min(elapsed, 0.1);
          lastTime = now;

          fpsFrames++;
          fpsAccum += elapsed;
          if (fpsAccum >= 1.0) {
            const measuredFps = Math.round(fpsFrames / fpsAccum);
            setFps(measuredFps);
            onFpsSampleRef.current?.(measuredFps);
            fpsFrames = 0;
            fpsAccum = 0;
          }

          stepPhysicsRef.current(dt);
          rebuildTrackIfNeeded();

          const phase = phaseRef.current;
          const allRacers = Array.from(racersRef.current.values());
          allRacers.sort((a, b) => a.rank - b.rank);

          const visibleLimit = isLow ? 28 : isMedium ? 44 : RACE_CONSTANTS.MAX_RENDERED_RACERS;
          let visibleRacers: RacerState[];
          if (allRacers.length <= visibleLimit) {
            visibleRacers = allRacers;
          } else {
            const leaders = Math.ceil(visibleLimit * 0.58);
            const topPart = allRacers.slice(0, leaders);
            const rest = allRacers
              .slice(leaders)
              .sort((a, b) => b.lastInteractAt - a.lastInteractAt)
              .slice(0, visibleLimit - leaders);
            visibleRacers = [...topPart, ...rest];
          }

          const tSec = now * 0.001;
          cloudGroup.position.x = Math.sin(tSec * 0.06) * 8;
          for (let fl = 0; fl < floatingLandmarks.length; fl++) {
            const item = floatingLandmarks[fl];
            item.mesh.position.y = item.baseY + Math.sin(tSec * 1.15 + item.phase) * 1.8;
            item.mesh.rotation.y = tSec * 0.22 + item.phase;
          }

          const realSpecs = !isLow && spectatorsRef ? Array.from(spectatorsRef.current.values()) : [];
          const activeSpecCount = isLow ? 0 : Math.min(spectatorPool.length, Math.max(12, realSpecs.length));
          for (let sp = 0; sp < spectatorPool.length; sp++) {
            const sSlot = spectatorPool[sp];
            const showSpec = phase !== 'podium' && sp < activeSpecCount;
            sSlot.root.visible = showSpec;
            if (!showSpec) continue;
            const realViewer = realSpecs[sp];
            if (realViewer) {
              sSlot.torsoMat.color.setHex(realViewer.shirtColor);
            }
            const sc = sampleCircuit(sSlot.dist, sSlot.side * (halfW + 3.9));
            sSlot.root.position.set(sc.x, 0, sc.z);
            // Xoay mặt khán giả hướng vào trong mặt đường để xem và cổ vũ các tay đua!
            sSlot.root.rotation.set(0, sc.yaw + (sSlot.side === -1 ? Math.PI / 2 : -Math.PI / 2), 0);
            const cheerHop = Math.abs(Math.sin(tSec * (5.2 + (sp % 4) * 0.7) + sp * 1.3)) * 0.34;
            sSlot.bodyPivot.position.y = cheerHop;
            sSlot.leftArm.rotation.x = -2.45 + Math.sin(tSec * 9.5 + sp) * 0.42;
            sSlot.rightArm.rotation.x = -2.45 - Math.sin(tSec * 9.5 + sp) * 0.42;
          }

          // Cập nhật thời gian cho Shader Rồng Hologram & xác định tay đua tâm điểm
          matDragonHoloEast.uniforms.uTime.value = tSec;
          matDragonHoloWest.uniforms.uTime.value = tSec;
          const preSpotUserId = cameraDirectorRef.current.getHudState().spotlightUserId;
          const primaryFocusId = preSpotUserId || allRacers[0]?.id || '';
          let bestRocketTarget: { x: number; y: number; z: number; isPrimary: boolean } | null = null;
          let bestDragonTarget: {
            x: number;
            y: number;
            z: number;
            isEastern: boolean;
            isPrimary: boolean;
          } | null = null;

          // Cập nhật 60 nhân vật trên đường đua uốn lượn
          for (let i = 0; i < pool.length; i++) {
            const slot = pool[i];
            const r = visibleRacers[i];
            if (!r) {
              slot.root.visible = false;
              continue;
            }

            slot.root.visible = true;
            // Khi bật bóng đổ thật (Trung bình / Cao) thì ẩn chấm bóng tròn giả để thấy rõ bóng nhân vật & rồng sắc nét
            slot.shadowMesh.visible = graphicsQualityRef.current === 'low';
            const useGlb = i < RACE_CONSTANTS.MAX_GLB_RACERS;
            ensureSlotGlb(slot, useGlb, r.characterIdx);
            ensureSlotPet(slot, r.petIdx);

            // Áp màu vật liệu của NOTBLOX_CHARACTER_MODELS theo màu Avatar của người chơi
            if (slot.glbHolder.visible && slot.glbLastColor !== r.shirtColor) {
              slot.glbLastColor = r.shirtColor;
              for (let m = 0; m < slot.glbTintMats.length; m++) {
                slot.glbTintMats[m].color.setHex(r.shirtColor);
              }
            }

            slot.torsoMat.color.setHex(r.shirtColor);
            slot.pantsMat.color.setHex(r.pantsColor);
            slot.skinMat.color.setHex(r.skinColor);
            slot.hatMat.color.setHex(r.hatColor);

            // Pha Bục Vinh Danh 3D
            if (phase === 'podium' && r.rank <= 3) {
              const pod = getPodiumSlotWorld(r.rank);
              const jump = Math.abs(Math.sin(tSec * 5.2 + r.rank)) * 0.62;
              slot.root.position.set(pod.x, pod.y, pod.z);
              slot.root.rotation.set(0, pod.yaw, 0);
              slot.root.scale.setScalar(r.rank === 1 ? 1.35 : 1.15);
              slot.bodyPivot.position.set(0, jump, 0);
              slot.bodyPivot.rotation.set(0, 0, 0);
              if (slot.glbHolder.visible) {
                updateNotBloxAnimation(slot, 'dance', dt, 0, tSec, i);
              } else {
                slot.leftArm.rotation.x = -2.5 + Math.sin(tSec * 9) * 0.35;
                slot.rightArm.rotation.x = -2.5 - Math.sin(tSec * 9) * 0.35;
                slot.leftLeg.rotation.x = 0;
                slot.rightLeg.rotation.x = 0;
              }
              slot.sprintRing.visible = false;
              slot.jetpackGrp.visible = false;
              slot.rocketGrp.visible = false;
              slot.dragonGrp.visible = false;
              slot.sonicSpeedGrp.visible = false;
              slot.bodyPlasmaGrp.visible = false;
              slot.flashLightningGrp.visible = false;
              slot.supermanAuraGrp.visible = false;
              slot.landingShockRing.visible = false;
              slot.wasSuperman = false;
              slot.supermanLandTimer = 0;
              if (slot.petHolder.visible) {
                slot.petHolder.position.set(1.25, 0, 0.3);
                slot.petHolder.scale.setScalar(0.85);
                slot.petModelWrap.position.y = Math.abs(Math.sin(tSec * 6.5 + r.rank)) * 0.35;
                slot.petModelWrap.rotation.set(0, 0, 0);
              }
              continue;
            }

            // Chiếu tọa độ dọc đường đua uốn lượn khép kín
            const sample = sampleCircuit(r.z, r.x);
            slot.root.position.set(sample.x, 0, sample.z);
            slot.root.rotation.set(0, sample.yaw, 0);

            const isDragon = r.boost === 'dragon';
            const isSuperman = r.boost === 'superman';
            const isRocket = r.boost === 'rocket';
            const isJetpack = r.boost === 'jetpack';
            const isSprint = r.boost === 'sprint' || r.boost === 'chat' || r.boost === 'join';

            // Kích hoạt chuỗi Hạ Cánh Siêu Nhân (Superhero Landing) ngay khi vừa kết thúc bay Siêu Nhân
            if (isSuperman) {
              slot.wasSuperman = true;
              slot.supermanLandTimer = 0;
              slot.landingBurstDone = false;
            } else if (slot.wasSuperman) {
              slot.wasSuperman = false;
              slot.supermanLandTimer = 0.85;
              slot.landingBurstDone = false;
            }
            if (slot.supermanLandTimer > 0) {
              slot.supermanLandTimer = Math.max(0, slot.supermanLandTimer - dt);
            }
            const isLanding = slot.supermanLandTimer > 0;

            const scaleTarget = isDragon ? 1.85 : 1.0;
            slot.root.scale.setScalar(scaleTarget);

            // Nghiêng người ôm cua mượt mà theo độ cong đường đua
            const bankAngle = r.speed > 1 ? -sample.curvature * 0.38 : 0;

            if (isDragon) {
              const hover = 1.65 + Math.sin(tSec * 7 + i) * 0.25;
              slot.bodyPivot.position.set(0, hover + 0.56, 0.25);
              slot.bodyPivot.rotation.set(0.2, 0, bankAngle);
              slot.dragonGrp.position.y = hover - 0.15;
              slot.shadowMesh.scale.setScalar(1.6);
            } else if (isSuperman) {
              // Bay lao tới ngang kiểu Siêu Nhân + lượn nghiêng theo khúc cua cực ngầu
              const hover = 2.55 + Math.sin(tSec * 6.5 + i) * 0.22;
              slot.bodyPivot.position.set(0, hover, 0.2);
              slot.bodyPivot.rotation.set(1.16, 0, bankAngle * 1.45);
              slot.shadowMesh.scale.setScalar(1.1);
            } else if (isLanding) {
              // 0.85s -> 0.58s: Lao đáp xuống mặt đất; 0.58s -> 0s: Quỳ hạ cánh 3 điểm kiểu Siêu Nhân + Sóng xung kích bùng nổ!
              const tLand = slot.supermanLandTimer;
              if (tLand > 0.58) {
                const frac = (tLand - 0.58) / 0.27;
                slot.bodyPivot.position.set(0, frac * 2.55, 0);
                slot.bodyPivot.rotation.set(0.35 + frac * 0.8, 0, bankAngle);
              } else {
                const crouchFrac = Math.sin((tLand / 0.58) * Math.PI);
                slot.bodyPivot.position.set(0, -0.34 * crouchFrac, 0);
                slot.bodyPivot.rotation.set(0.46 * crouchFrac, 0, 0);
                if (!slot.landingBurstDone) {
                  slot.landingBurstDone = true;
                  for (let k = 0; k < 20; k++) {
                    const ang = (k / 20) * Math.PI * 2;
                    spawnParticle({
                      x: sample.x + Math.cos(ang) * 0.8,
                      y: 0.35,
                      z: sample.z + Math.sin(ang) * 0.8,
                      vx: Math.cos(ang) * (9 + Math.random() * 5),
                      vy: 2.2 + Math.random() * 2.5,
                      vz: Math.sin(ang) * (9 + Math.random() * 5),
                      life: 0.55,
                      size: 1.15,
                      grow: 1.5,
                      gravity: -6.5,
                      color: k % 2 === 0 ? 0x38bdf8 : 0xfacc15,
                    });
                  }
                }
              }
              slot.shadowMesh.scale.setScalar(1.25);
            } else if (isRocket) {
              const hover = 1.15 + Math.sin(tSec * 15 + i) * 0.14;
              slot.bodyPivot.position.set(0, hover + 0.52, -0.1);
              slot.bodyPivot.rotation.set(0.36, 0, bankAngle);
              slot.rocketGrp.position.y = hover;
              slot.shadowMesh.scale.setScalar(1.25);
            } else if (isJetpack) {
              const hover = 0.95 + Math.sin(tSec * 11 + i) * 0.16;
              slot.bodyPivot.position.set(0, hover, 0);
              slot.bodyPivot.rotation.set(0.28, 0, bankAngle);
              slot.shadowMesh.scale.setScalar(0.85);
            } else if (phase === 'lobby') {
              const isStartReady = timerRef.current <= 5;
              if (isStartReady) {
                const tense = Math.sin(tSec * 16 + i * 1.9) * 0.02;
                slot.bodyPivot.position.set(0, -0.22 + tense, 0);
                slot.bodyPivot.rotation.set(0.46, 0, 0);
              } else {
                const warmSlot = Math.floor(tSec / 2.8 + i * 0.7) % 4;
                if (warmSlot === 1) {
                  slot.bodyPivot.position.set(0, Math.abs(Math.sin(tSec * 6.5 + i)) * 0.42, 0);
                  slot.bodyPivot.rotation.set(0.06, 0, 0);
                } else if (warmSlot === 0) {
                  slot.bodyPivot.position.set(0, Math.abs(Math.sin(tSec * 11 + i)) * 0.14, 0);
                  slot.bodyPivot.rotation.set(0.14, Math.sin(tSec * 2 + i) * 0.1, 0);
                } else if (warmSlot === 2) {
                  slot.bodyPivot.position.set(0, Math.abs(Math.sin(tSec * 4.5 + i)) * 0.12, 0);
                  slot.bodyPivot.rotation.set(0, Math.sin(tSec * 3 + i) * 0.18, 0);
                } else {
                  slot.bodyPivot.position.set(0, 0, 0);
                  slot.bodyPivot.rotation.set(0, Math.sin(tSec * 1.4 + i) * 0.25, 0);
                }
              }
              slot.shadowMesh.scale.setScalar(1.0);
            } else {
              slot.bodyPivot.position.set(0, 0, 0);
              const forwardLean = isSprint ? 0.24 : r.speed > 1 ? 0.16 : 0;
              slot.bodyPivot.rotation.set(forwardLean, 0, bankAngle);
              slot.shadowMesh.scale.setScalar(1.0);
            }

            // GIỮ NGUYÊN MÀU GỐC NHÂN VẬT 100% khi tăng tốc / spotlight (KHÔNG đổi màu vật liệu hay phủ vỏ màu):
            // Nhân vật được chiếu sáng tự nhiên bởi cặp Quả Cầu Ánh Sáng Sọc Xoay (webgl_shadowmap_pointlight.html)!
            const outlineMeshes: any[] | undefined = slot.glbHolder.userData.outlineMeshes;
            if (outlineMeshes) {
              for (let omIdx = 0; omIdx < outlineMeshes.length; omIdx++) {
                outlineMeshes[omIdx].visible = false;
              }
            }
            for (let gm = 0; gm < slot.glbAllMats.length; gm++) {
              const mat = slot.glbAllMats[gm];
              if (mat.emissive && mat.emissiveIntensity !== 0) {
                mat.emissive.setHex(0x000000);
                mat.emissiveIntensity = 0;
              }
            }

            const hasBoost = r.boost !== 'none';
            // Hiệu ứng Sóng Xung Kích Tốc Độ (Sonic Slipstream Rings) xé gió quanh nhân vật khi tăng tốc
            const showSonic = hasBoost && (phase === 'racing' || phase === 'countdown') && i < (isLow ? 8 : 20);
            slot.sonicSpeedGrp.visible = showSonic;
            if (showSonic) {
              const sonicBaseY = isDragon
                ? 1.85
                : isSuperman
                  ? 2.45
                  : isRocket
                    ? 1.35
                    : isJetpack
                      ? 1.05
                      : 1.32;
              for (let sr = 0; sr < slot.sonicSpeedRings.length; sr++) {
                const ring = slot.sonicSpeedRings[sr];
                const p = (tSec * 3.8 + sr * 0.5 + i * 0.21) % 1;
                ring.position.set(0, sonicBaseY, 0.35 - p * 2.85);
                const sc = 0.58 + p * 0.95;
                ring.scale.set(sc, sc, 1);
                ring.material.opacity = (1 - p) * 0.52;
              }
            }

            // Hoạt ảnh chuyển động đồng bộ 6 trạng thái ('idle' | 'run' | 'sprint' | 'jump' | 'dance' | 'fall')
            if (slot.glbHolder.visible) {
              let animState: NotBloxAnimState;
              if (phase === 'lobby') {
                if (timerRef.current <= 5) {
                  animState = 'idle';
                } else {
                  const warmSlot = Math.floor(tSec / 2.8 + i * 0.7) % 4;
                  animState =
                    warmSlot === 0
                      ? 'run'
                      : warmSlot === 1
                        ? 'jump'
                        : warmSlot === 2
                          ? 'dance'
                          : 'idle';
                }
              } else {
                animState =
                  isRocket || isDragon || isSuperman
                    ? 'jump'
                    : isJetpack || isLanding
                      ? 'fall'
                      : isSprint && r.speed > 1
                        ? 'sprint'
                        : r.speed > 1
                          ? 'run'
                          : 'idle';
              }
              updateNotBloxAnimation(
                slot,
                animState,
                dt,
                phase === 'lobby' ? 16 : r.speed,
                tSec,
                i,
              );
            } else if (isSuperman) {
              slot.leftArm.rotation.x = -3.05;
              slot.rightArm.rotation.x = -3.05;
              slot.leftLeg.rotation.x = 0.12;
              slot.rightLeg.rotation.x = 0.12;
            } else if (isRocket || isDragon) {
              slot.leftLeg.rotation.x = -0.75;
              slot.rightLeg.rotation.x = -0.75;
              slot.leftArm.rotation.x = -1.2;
              slot.rightArm.rotation.x = -1.2;
            } else {
              const runFreq = r.speed > 0.5 ? Math.min(20, r.speed * 0.55) : 2.2;
              const amp = r.speed > 0.5 ? 0.92 : 0.08;
              const swing = Math.sin(tSec * runFreq + i * 1.7) * amp;
              slot.leftLeg.rotation.x = swing;
              slot.rightLeg.rotation.x = -swing;
              slot.leftArm.rotation.x = -swing * 0.85;
              slot.rightArm.rotation.x = swing * 0.85;
            }

            // Đạo cụ 3D & hạt lửa theo đúng hướng tiếp tuyến đường cong (-tx, -tz)
            slot.sprintRing.visible = isSprint;
            slot.jetpackGrp.visible = isJetpack;
            slot.rocketGrp.visible = isRocket;
            slot.dragonGrp.visible = isDragon;
            slot.supermanAuraGrp.visible = isSuperman;

            // Hiệu ứng vòng năng lượng tỏa quanh người khi bay Siêu Nhân
            if (isSuperman) {
              for (let ar = 0; ar < slot.supermanRings.length; ar++) {
                const ring = slot.supermanRings[ar];
                const wave = ((tSec * 2.8 + ar * 0.33) % 1);
                ring.position.y = 2.5 - wave * 2.8;
                ring.scale.setScalar(0.75 + wave * 0.85);
                ring.rotation.z = tSec * (ar % 2 === 0 ? 5 : -5);
              }
              if (i < 20 && Math.random() < 0.85) {
                spawnParticle({
                  x: sample.x + (Math.random() - 0.5) * 1.9,
                  y: 2.2 + (Math.random() - 0.5) * 1.4,
                  z: sample.z + (Math.random() - 0.5) * 1.9,
                  vx: -sample.tx * 12 + (Math.random() - 0.5) * 3.5,
                  vy: (Math.random() - 0.4) * 2.2,
                  vz: -sample.tz * 12 + (Math.random() - 0.5) * 3.5,
                  life: 0.42,
                  size: 1.05,
                  grow: 1.4,
                  color: Math.random() < 0.55 ? 0x38bdf8 : 0xfacc15,
                });
              }
            }

            // Vòng sóng xung kích mặt đất tỏa rộng khi Siêu Nhân hạ cánh
            if (isLanding && slot.supermanLandTimer <= 0.58) {
              const p = 1 - slot.supermanLandTimer / 0.58;
              slot.landingShockRing.visible = true;
              slot.landingShockRing.scale.setScalar(0.6 + p * 8.4);
              slot.landingShockMat.opacity = (1 - p) * 0.92;
              slot.landingShockMat.color.setHex(p < 0.4 ? 0xfacc15 : 0x38bdf8);
            } else {
              slot.landingShockRing.visible = false;
            }

            // Thú cưng VIP chạy lon ton theo sát bên cạnh người chơi
            if (slot.petHolder.visible) {
              const petScale = isDragon ? 0.62 : 1.0;
              slot.petHolder.scale.setScalar(petScale);
              const petHoverY =
                isDragon ? 1.45 : isRocket ? 0.95 : isJetpack ? 0.75 : 0;
              const swayX = 1.45 + Math.sin(tSec * 3.5 + i) * 0.22;
              const trailZ = -1.05 + Math.cos(tSec * 4.2 + i) * 0.18;
              slot.petHolder.position.set(swayX, petHoverY, trailZ);
              const hopFreq = r.speed > 1 ? Math.min(18, r.speed * 0.52) : 3.5;
              const hopAmp = r.speed > 1 ? 0.28 : 0.08;
              slot.petModelWrap.position.y = Math.abs(Math.sin(tSec * hopFreq + i * 1.3)) * hopAmp;
              slot.petModelWrap.rotation.set(
                r.speed > 1 ? Math.sin(tSec * hopFreq + i) * 0.14 : 0,
                0,
                bankAngle * 0.7,
              );
            }

            const backX = -sample.tx;
            const backZ = -sample.tz;

            // Hiệu ứng Tia Sét Năng Lượng Plasma Xanh chạy dọc & xoắn quanh cơ thể + Tia Lửa Đạn Đạo Nảy Trên Mặt Đường
            slot.bodyPlasmaGrp.visible = hasBoost;
            slot.flashLightningGrp.visible = hasBoost;
            if (hasBoost) {
              // Chủ đạo là Năng Lượng Plasma Xanh Điện (0x00b4ff / 0x22d3ee) sắc sảo chạy dọc quanh người!
              const plasmaHex = isDragon ? 0x22d3ee : 0x00b4ff;
              const coreHex = 0xe0f2fe;
              const trailColor = isRocket ? 0xff7a18 : plasmaHex;
              if (i < 18 && r.speed > 2 && Math.random() < 0.65) {
                spawnRoadGlow(
                  sample.x,
                  sample.z,
                  sample.yaw,
                  trailColor,
                  isDragon ? 2.1 : isSuperman || isRocket ? 1.55 : 1.15,
                );
              }
              const boltScale = isDragon ? 1.25 : isSuperman || isRocket ? 1.12 : 1.0;
              slot.flashLightningGrp.position.y =
                isDragon ? 1.15 : isSuperman ? 1.35 : isRocket ? 0.75 : isJetpack ? 0.55 : 0;
              slot.jaggedLightning.update(tSec, plasmaHex, coreHex, boltScale);

              if (i < 24 && Math.random() < 0.78) {
                spawnParticle({
                  x: sample.x + backX * 0.85 + (Math.random() - 0.5) * 0.95,
                  y: 0.28 + Math.random() * 1.15,
                  z: sample.z + backZ * 0.85 + (Math.random() - 0.5) * 0.95,
                  vx: backX * (9 + Math.random() * 8) + (Math.random() - 0.5) * 3.8,
                  vy: 1.6 + Math.random() * 3.4,
                  vz: backZ * (9 + Math.random() * 8) + (Math.random() - 0.5) * 3.8,
                  life: 0.36 + Math.random() * 0.25,
                  size: isDragon || isRocket ? 1.25 : 0.92,
                  color: isRocket ? 0xff9f1c : 0x38bdf8,
                });
              }
            }

            if (isSprint) {
              slot.sprintRing.scale.setScalar(0.95 + Math.sin(tSec * 18 + i) * 0.15);
              if (i < 16 && Math.random() < 0.35) {
                spawnParticle({
                  x: sample.x + backX * 0.7 + (Math.random() - 0.5) * 0.6,
                  y: 0.45 + Math.random() * 0.7,
                  z: sample.z + backZ * 0.7 + (Math.random() - 0.5) * 0.6,
                  vx: backX * 5,
                  vy: 1.0,
                  vz: backZ * 5,
                  life: 0.35,
                  size: 0.58,
                  color: r.boost === 'join' ? 0x34d399 : 0x38bdf8,
                });
              }
            }

            if (isJetpack) {
              const fScale = 0.85 + Math.sin(tSec * 34 + i) * 0.35;
              slot.jetFlames.forEach((f) => (f.scale.y = fScale));
              if (i < 18 && Math.random() < 0.65) {
                spawnParticle({
                  x: sample.x + backX * 0.8 + (Math.random() - 0.5) * 0.5,
                  y: 1.15,
                  z: sample.z + backZ * 0.8 + (Math.random() - 0.5) * 0.5,
                  vx: backX * 7 + (Math.random() - 0.5) * 1.5,
                  vy: -1.6,
                  vz: backZ * 7 + (Math.random() - 0.5) * 1.5,
                  life: 0.42,
                  size: 0.85,
                  grow: 1.8,
                  color: Math.random() < 0.55 ? 0xf97316 : 0xe2e8f0,
                });
              }
            }

            if (isRocket) {
              // Luồng lửa siêu thanh Afterburner 3 lớp + Vòng sóng xung kích Shock-Diamond trượt dọc luồng phụt
              slot.rocketFlameCore.scale.y = 2.15 + Math.sin(tSec * 56 + i) * 0.48;
              slot.rocketFlameInner.scale.y = 3.15 + Math.cos(tSec * 48 + i) * 0.72;
              slot.rocketFlameOuter.scale.y = 4.05 + Math.sin(tSec * 42 + i) * 0.95;
              const outerW = 2.65 + Math.sin(tSec * 36 + i) * 0.32;
              slot.rocketFlameOuter.scale.x = outerW;
              slot.rocketFlameOuter.scale.z = outerW;
              slot.rocketRing.scale.setScalar(1.05 + ((tSec * 5.2 + i) % 1) * 0.95);

              for (let sr = 0; sr < slot.rocketShockRings.length; sr++) {
                const sRing = slot.rocketShockRings[sr];
                const p = (tSec * 4.6 + sr * 0.33 + i * 0.17) % 1;
                sRing.position.z = -2.15 - p * 2.85;
                sRing.scale.setScalar(Math.max(0.18, (1 - p * 0.72) * 0.85));
              }

              // Ghi nhận vị trí đuôi lửa Tên Lửa để PointLight tỏa sáng rực rỡ lên toàn vùng xung quanh!
              const isPrim = r.id === primaryFocusId;
              if (!bestRocketTarget || (!bestRocketTarget.isPrimary && isPrim)) {
                bestRocketTarget = {
                  x: sample.x + backX * 2.95,
                  y: slot.rocketGrp.position.y + 0.35,
                  z: sample.z + backZ * 2.95,
                  isPrimary: isPrim,
                };
              }

              if (i < 22) {
                for (let spk = 0; spk < 2; spk++) {
                  spawnParticle({
                    x: sample.x + backX * (2.35 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.55,
                    y: slot.rocketGrp.position.y + (Math.random() - 0.5) * 0.35,
                    z: sample.z + backZ * (2.35 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.55,
                    vx: backX * (15 + Math.random() * 9) + (Math.random() - 0.5) * 3.8,
                    vy: 0.8 + (Math.random() - 0.3) * 3.2,
                    vz: backZ * (15 + Math.random() * 9) + (Math.random() - 0.5) * 3.8,
                    life: 0.42 + Math.random() * 0.25,
                    size: 1.45,
                    grow: 2.0,
                    color: Math.random() < 0.65 ? 0xff7a18 : 0xfef08a,
                  });
                }
              }
            }

            if (isDragon) {
              // Hóa thân Rồng Thần Hologram Ảo Diệu: Rồng Phương Đông (Cyan-Ngọc Bích-Vàng) vs Rồng Phương Tây (Lam Điện-Tím Hồng)
              let idHash = 0;
              for (let c = 0; c < r.id.length; c++) idHash = (idHash * 31 + r.id.charCodeAt(c)) | 0;
              const isEastern = Math.abs(idHash) % 2 === 0;
              slot.dragonStyle = isEastern ? 'eastern' : 'western';
              slot.dragonLeftWing.visible = !isEastern;
              slot.dragonRightWing.visible = !isEastern;
              slot.dragonWhiskersGrp.visible = isEastern;
              slot.dragonOrbsGrp.visible = isEastern;

              const targetHoloMat = isEastern ? matDragonHoloEast : matDragonHoloWest;
              if (
                slot.dragonHoloMeshes.length > 0 &&
                slot.dragonHoloMeshes[0].material !== targetHoloMat
              ) {
                for (let hm = 0; hm < slot.dragonHoloMeshes.length; hm++) {
                  slot.dragonHoloMeshes[hm].material = targetHoloMat;
                }
              }

              // Chuyển động uốn lượn 22 đốt sống liền mạch chân thật (tự xoay tiếp tuyến từng đốt theo đường sóng S)
              const waveSpd = isEastern ? 8.2 : 6.4;
              for (let s = 0; s < slot.dragonSegs.length; s++) {
                const seg = slot.dragonSegs[s];
                const waveAmp = isEastern ? 0.28 + s * 0.048 : 0.12 + s * 0.026;
                const ph = tSec * waveSpd - s * 0.36 + i;
                const sx = Math.sin(ph) * waveAmp;
                const sy =
                  (isEastern ? 0.48 : 0.44) + Math.cos(ph) * (isEastern ? 0.24 : 0.12);
                const sz = 2.45 - s * (isEastern ? 0.37 : 0.32);
                seg.position.set(sx, sy, sz);
                seg.rotation.y = Math.cos(ph) * waveAmp * 0.55;
                seg.rotation.x = -Math.sin(ph) * (isEastern ? 0.18 : 0.09);
              }

              // Hàm rồng khép mở thở năng lượng uy dũng & 4 chân móng vuốt đạp mây sinh động
              slot.dragonJawGrp.rotation.x = 0.14 + Math.max(0, Math.sin(tSec * 4.2 + i)) * 0.28;
              slot.dragonHeadGrp.position.y = 1.02 + Math.sin(tSec * 7.5 + i) * 0.22;
              slot.dragonHeadGrp.rotation.y = Math.sin(tSec * waveSpd + i) * 0.14;

              for (let lgIdx = 0; lgIdx < slot.dragonLegs.length; lgIdx++) {
                const leg = slot.dragonLegs[lgIdx];
                const legPh = tSec * 7.2 + lgIdx * Math.PI * 0.5 + i;
                leg.rotation.x = Math.sin(legPh) * 0.34;
              }

              if (!isEastern) {
                const flap = Math.sin(tSec * 8.2 + i) * 0.66;
                slot.dragonLeftWing.rotation.z = flap;
                slot.dragonRightWing.rotation.z = -flap;
              }
              slot.dragonOrbsGrp.rotation.y = tSec * 3.4;

              const isPrim = r.id === primaryFocusId;
              if (!bestDragonTarget || (!bestDragonTarget.isPrimary && isPrim)) {
                bestDragonTarget = {
                  x: sample.x,
                  y: 2.35,
                  z: sample.z,
                  isEastern,
                  isPrimary: isPrim,
                };
              }

              if (i < 20 && Math.random() < 0.72) {
                spawnParticle({
                  x: sample.x + backX * 2.2 + (Math.random() - 0.5) * 2.1,
                  y: 2.2 + (Math.random() - 0.5) * 1.5,
                  z: sample.z + backZ * 2.2 + (Math.random() - 0.5) * 2.1,
                  vx: backX * 10 + (Math.random() - 0.5) * 2.5,
                  vy: 1.2 + Math.random() * 2,
                  vz: backZ * 10 + (Math.random() - 0.5) * 2.5,
                  life: 0.58,
                  size: 1.25,
                  grow: 1.4,
                  color: isEastern
                    ? Math.random() < 0.65
                      ? 0x22d3ee
                      : 0x34d399
                    : Math.random() < 0.6
                      ? 0x38bdf8
                      : 0xe879f9,
                });
              }
            }
          }

          // Pháo hoa 3D nổ bung trên bầu trời Bục Vinh Danh
          if (phase === 'podium') {
            fireworkTimer -= dt;
            if (fireworkTimer <= 0) {
              fireworkTimer = 0.55;
              const pod1 = getPodiumSlotWorld(1);
              const fx = pod1.x + (Math.random() - 0.5) * 16;
              const fy = 8.5 + Math.random() * 6;
              const fz = pod1.z + (Math.random() - 0.5) * 10;
              const fwColors = [0xfacc15, 0xf43f5e, 0x38bdf8, 0x4ade80, 0xc084fc];
              const col = fwColors[Math.floor(Math.random() * fwColors.length)];
              for (let k = 0; k < 22; k++) {
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const spd = 4 + Math.random() * 6;
                spawnParticle({
                  x: fx,
                  y: fy,
                  z: fz,
                  vx: Math.sin(phi) * Math.cos(theta) * spd,
                  vy: Math.cos(phi) * spd,
                  vz: Math.sin(phi) * Math.sin(theta) * spd,
                  life: 0.95 + Math.random() * 0.35,
                  size: 1.15,
                  grow: 0.4,
                  gravity: -7.5,
                  color: col,
                });
              }
            }
          }

          // Cập nhật Tia Lửa Đạn Đạo 3D (có trọng lực & nảy trên mặt đường nhựa)
          sparkSystem.update(dt);

          // Cập nhật vệt sáng mặt đường The Flash (mờ dần mượt mà sau khi nhân vật chạy qua)
          for (let rg = 0; rg < FLASH_TRAIL_MAX; rg++) {
            const st = roadGlows[rg];
            if (!st.active) continue;
            st.life -= dt;
            if (st.life <= 0) {
              st.active = false;
              st.mesh.visible = false;
              continue;
            }
            const k = st.life / st.maxLife;
            st.mat.opacity = k * 0.46;
          }

          // ---------- Smart Race Camera Director (State Machine 8 trạng thái) ----------
          const director = cameraDirectorRef.current;
          const camPose = director.update({
            dt,
            tSec,
            matchPhase: phase,
            timerSec: timerRef.current,
            sortedRacers: allRacers,
            racersMap: racersRef.current,
            podiumCenter: { x: podiumCenterVec.x, y: podiumCenterVec.y, z: podiumCenterVec.z },
            podiumFrontDir: { x: podiumFrontPt.x, z: podiumFrontPt.z },
            podiumRightDir: { x: podiumRightPt.x, z: podiumRightPt.z },
          });

          const camHudNow = director.getHudState();
          const spotRacer =
            camHudNow.spotlightUserId ? racersRef.current.get(camHudNow.spotlightUserId) : undefined;
          const isSpotlightActive =
            Boolean(spotRacer) &&
            (camHudNow.state === 'FRONT_TRACKING' ||
              camHudNow.state === 'SIDE_TRACKING' ||
              camHudNow.state === 'CHASE');

          // Bỏ hẳn chùm đèn rọi hình nón chiếu vào nhân vật — đã thay bằng hào quang phát sáng trực tiếp theo hình hài nhân vật!
          spotlightBeam.visible = false;

          const focusRacerNow = spotRacer || allRacers[0];
          const focusBoost = focusRacerNow?.boost || 'none';

          // 1) Ánh sáng Điểm Động (KHÔNG quả cầu) làm nổi bật khối 3D nhân vật kết hợp Tia Sét Plasma Xanh (giữ nguyên màu gốc nhân vật)
          const isFocusLit =
            Boolean(focusRacerNow) &&
            (phase === 'racing' || phase === 'countdown') &&
            (focusBoost !== 'none' || isSpotlightActive);
          flashRoadLight.intensity = 0;
          if (isFocusLit && focusRacerNow) {
            const fs = sampleCircuit(focusRacerNow.z, focusRacerNow.x);
            const focusHoverY =
              focusBoost === 'dragon'
                ? 2.15
                : focusBoost === 'superman'
                  ? 2.35
                  : focusBoost === 'rocket'
                    ? 1.45
                    : focusBoost === 'jetpack'
                      ? 0.95
                      : 0.12;
            heroLightRig.update(
              true,
              fs.x,
              focusHoverY,
              fs.z,
              tSec,
              graphicsQualityRef.current !== 'low',
            );
          } else {
            heroLightRig.update(false, 0, 0, 0, tSec, false);
          }

          // 2) Ánh sáng rực lửa từ đuôi Tên Lửa Rocket tỏa sáng cả vùng đường nhựa, rào chắn & đối thủ xung quanh!
          if (bestRocketTarget && (phase === 'racing' || phase === 'countdown')) {
            rocketExhaustLight.position.set(
              bestRocketTarget.x,
              bestRocketTarget.y,
              bestRocketTarget.z,
            );
            rocketExhaustLight.color.setHex(Math.sin(tSec * 52) > 0 ? 0xff7a18 : 0xffae42);
            rocketExhaustLight.intensity = 18.5 + Math.sin(tSec * 48) * 4.8;
          } else {
            rocketExhaustLight.intensity = 0;
          }

          // 3) Ánh sáng Hologram huyền ảo từ Rồng Thần tỏa xuống mặt đường đua
          if (bestDragonTarget && (phase === 'racing' || phase === 'countdown')) {
            dragonHoloLight.position.set(
              bestDragonTarget.x,
              bestDragonTarget.y,
              bestDragonTarget.z,
            );
            dragonHoloLight.color.setHex(bestDragonTarget.isEastern ? 0x22d3ee : 0xa855f7);
            dragonHoloLight.intensity = 14.5 + Math.sin(tSec * 9.5) * 2.6;
          } else {
            dragonHoloLight.intensity = 0;
          }

          if (speedLinesRef.current) {
            const showLines =
              (phase === 'racing' || phase === 'countdown') &&
              (focusBoost === 'dragon' ||
                focusBoost === 'rocket' ||
                focusBoost === 'jetpack' ||
                focusBoost === 'sprint' ||
                focusBoost === 'join');
            speedLinesRef.current.style.opacity =
              focusBoost === 'dragon' || focusBoost === 'rocket'
                ? '0.45'
                : showLines
                  ? '0.24'
                  : '0';
          }

          // Hiệu ứng vệt gió siêu tốc 3D bay vút qua khung cảnh xung quanh khi tăng tốc (giống ảnh tham chiếu)
          const showWind3D =
            (phase === 'racing' || phase === 'countdown') &&
            focusBoost !== 'none';
          const targetWindOpacity = showWind3D ? (focusBoost === 'dragon' || focusBoost === 'rocket' ? 0.78 : 0.52) : 0;
          windOpacity += (targetWindOpacity - windOpacity) * (1 - Math.exp(-10 * dt));
          windStreaksGroup.visible = windOpacity > 0.015;
          if (windStreaksGroup.visible) {
            const boostMult =
              focusBoost === 'dragon'
                ? 2.2
                : focusBoost === 'rocket'
                  ? 1.9
                  : focusBoost === 'jetpack'
                    ? 1.5
                    : 1.15;
            windStreakMat.opacity = windOpacity;
            for (let ws = 0; ws < windStreaks.length; ws++) {
              const st = windStreaks[ws];
              st.mesh.visible = !isLow || ws < 12;
              if (!st.mesh.visible) continue;
              st.z += st.spd * boostMult * dt;
              if (st.z > 2) {
                st.z = -36 - (ws % 6) * 2.5;
              }
              st.mesh.position.set(st.x, st.y, st.z);
              st.mesh.scale.set(1, 1, boostMult * 0.9);
            }
          }

          if (Math.abs(camera.fov - camPose.fov) > 0.03) {
            camera.fov = camPose.fov;
            camera.updateProjectionMatrix();
          }

          camera.position.set(camPose.posX, camPose.posY, camPose.posZ);
          camera.lookAt(camPose.lookX, camPose.lookY, camPose.lookZ);

          // Cập nhật Bầu Trời Vật Lý (PBL Sky + Sao Đêm), Cảnh Sắc Thời Gian Thực & Đổ Bóng Theo Độ Cao Nguồn Sáng!
          // Map Thành Phố Về Đêm mặc định giữ bầu trời đêm rực sáng đèn phố & đường dầu phản chiếu khi ở chế độ 'realtime'
          const activeScenery = getActiveMap().theme.sceneryType;
          realTimeSky.update({
            enableReflections: !isLow,
            mode: timeOfDayModeRef.current,
            tSec,
            focusX: camPose.lookX,
            focusZ: camPose.lookZ,
            cameraPos: camera.position,
            sunLight,
            hemiLight,
            rimLight,
            fog: scene.fog,
            cloudMat,
            grassMat,
            leafMats: [leafMatA, leafMatB, leafMatC],
            lakeMat,
            streetLampMat: towerGlowMat,
            isForcedNightCity: activeScenery === 'city' && timeOfDayModeRef.current === 'realtime',
            isCityMap: activeScenery === 'city',
          });

          const cw = container.clientWidth || 540;
          const ch = container.clientHeight || 960;
          renderer.setScissorTest(false);
          renderer.setViewport(0, 0, cw, ch);
          renderer.render(scene, camera);

          // ---------- Camera Drone Toàn Cảnh (Góc phải bên dưới - Picture-in-Picture) ----------
          if (!isLow && droneCamOnRef.current && dronePipRef.current && phase !== 'podium') {
            const cRect = container.getBoundingClientRect();
            const pRect = dronePipRef.current.getBoundingClientRect();
            const pw = Math.round(pRect.width);
            const ph = Math.round(pRect.height);
            const px = Math.round(pRect.left - cRect.left);
            const py = Math.round(cRect.bottom - pRect.bottom);

            if (pw > 16 && ph > 16) {
              // Tính khung bao (Bounding Box) chứa TOÀN BỘ người chơi trên sân đua
              let minX = Infinity;
              let maxX = -Infinity;
              let minZ = Infinity;
              let maxZ = -Infinity;
              if (allRacers.length >= 2 && (phase === 'racing' || phase === 'countdown')) {
                for (let k = 0; k < allRacers.length; k++) {
                  const rs = sampleCircuit(allRacers[k].z, allRacers[k].x);
                  if (rs.x < minX) minX = rs.x;
                  if (rs.x > maxX) maxX = rs.x;
                  if (rs.z < minZ) minZ = rs.z;
                  if (rs.z > maxZ) maxZ = rs.z;
                }
              } else {
                minX = CIRCUIT_TRACK.minX;
                maxX = CIRCUIT_TRACK.maxX;
                minZ = CIRCUIT_TRACK.minZ;
                maxZ = CIRCUIT_TRACK.maxZ;
              }

              // Luôn bao quát toàn bộ đoàn đua với góc nhìn gần và sắc nét hơn trong khung Drone
              const targetCx = (minX + maxX) * 0.5;
              const targetCz = (minZ + maxZ) * 0.5;
              const rawSpan = Math.max(maxX - minX, maxZ - minZ);
              const fullTrackSpan = Math.max(
                CIRCUIT_TRACK.maxX - CIRCUIT_TRACK.minX,
                CIRCUIT_TRACK.maxZ - CIRCUIT_TRACK.minZ,
              );
              const targetSpan = Math.max(66, Math.min(fullTrackSpan * 1.04, rawSpan + 32));
              const damp = 1 - Math.exp(-3.8 * dt);
              droneCx += (targetCx - droneCx) * damp;
              droneCz += (targetCz - droneCz) * damp;
              droneSpan += (targetSpan - droneSpan) * damp;

              droneCamera.aspect = pw / Math.max(1, ph);
              droneCamera.updateProjectionMatrix();

              // Góc máy Drone Flycam từ trên cao rõ nét nhìn bao quát toàn sân
              const droneAlt = Math.max(70, droneSpan * 0.94);
              const swayX = Math.sin(tSec * 0.25) * 3.8;
              droneCamera.position.set(
                droneCx + swayX,
                droneAlt,
                droneCz - droneSpan * 0.3,
              );
              droneCamera.lookAt(droneCx, 0, droneCz);

              const savedFog = scene.fog.density;
              const savedBg = scene.background;
              const isNightCity = getActiveMap().theme.sceneryType === 'city';
              const savedHemiInt = hemiLight.intensity;
              const savedHemiSky = hemiLight.color.getHex();
              const savedSunInt = sunLight.intensity;
              const savedExposure = renderer.toneMappingExposure;
              const savedBldgEmissive = buildingBodyMat.emissive.getHex();
              const savedBldgEmissiveInt = buildingBodyMat.emissiveIntensity;
              const savedKeyVis = heroLightRig.keyLight.visible;
              const savedRimVis = heroLightRig.rimLight.visible;

              scene.fog.density = 0;
              realTimeSky.sky.visible = false;
              realTimeSky.sunDisc.visible = false;
              realTimeSky.stars.visible = false;
              heroLightRig.keyLight.visible = false;
              heroLightRig.rimLight.visible = false;
              scene.background = new THREE.Color(isNightCity ? 0x0b1120 : 0x1e293b);
              if (isNightCity) {
                hemiLight.intensity = 1.95;
                hemiLight.color.setHex(0xcbd5e1);
                sunLight.intensity = 1.75;
                renderer.toneMappingExposure = 1.35;
                buildingFacadeMats.forEach((bm) => {
                  bm.emissive.setHex(0xffffff);
                  bm.emissiveIntensity = 0.85;
                });
              }
              for (let k = 0; k < pool.length; k++) {
                if (pool[k].root.visible) {
                  pool[k].root.scale.multiplyScalar(2.45);
                }
              }

              renderer.setScissorTest(true);
              renderer.setViewport(px, py, pw, ph);
              renderer.setScissor(px, py, pw, ph);
              renderer.clearDepth();
              const updateShadows = renderer.shadowMap.autoUpdate;
              renderer.shadowMap.autoUpdate = false;
              renderer.render(scene, droneCamera);
              renderer.shadowMap.autoUpdate = updateShadows;
              renderer.setScissorTest(false);
              renderer.setViewport(0, 0, cw, ch);

              for (let k = 0; k < pool.length; k++) {
                if (pool[k].root.visible) {
                  pool[k].root.scale.divideScalar(2.45);
                }
              }
              if (isNightCity) {
                hemiLight.intensity = savedHemiInt;
                hemiLight.color.setHex(savedHemiSky);
                sunLight.intensity = savedSunInt;
                renderer.toneMappingExposure = savedExposure;
                buildingFacadeMats.forEach((bm) => {
                  bm.emissive.setHex(savedBldgEmissive);
                  bm.emissiveIntensity = savedBldgEmissiveInt;
                });
              }
              heroLightRig.keyLight.visible = savedKeyVis;
              heroLightRig.rimLight.visible = savedRimVis;
              realTimeSky.sky.visible = true;
              realTimeSky.sunDisc.visible = true;
              realTimeSky.stars.visible = true;
              scene.background = savedBg;
              scene.fog.density = savedFog;

              // Cập nhật & Chiếu tọa độ thẻ vị trí người chơi trên màn hình Drone Toàn Cảnh
              const droneRacers = allRacers.slice(0, MAX_DRONE_TAGS);
              const dSig = droneRacers
                .map((r) => `${r.id}:${r.rank}:${r.boost}:${r.nickname}`)
                .join('|');
              if (dSig !== lastDroneSig) {
                lastDroneSig = dSig;
                setDroneTags(
                  droneRacers.map((r) => ({
                    id: r.id,
                    nickname: r.nickname,
                    rank: r.rank,
                    color: '#' + r.shirtColor.toString(16).padStart(6, '0'),
                    boost: r.boost,
                  })),
                );
              }

              for (let k = 0; k < droneRacers.length; k++) {
                const tagEl = droneTagElsRef.current[k];
                if (!tagEl) continue;
                const r = droneRacers[k];
                const rs = sampleCircuit(r.z, r.x);
                projVec.set(rs.x, 4.5, rs.z);
                projVec.project(droneCamera);
                const inPip =
                  projVec.z > -1 &&
                  projVec.z < 1 &&
                  Math.abs(projVec.x) <= 0.96 &&
                  Math.abs(projVec.y) <= 0.96;
                if (!inPip) {
                  tagEl.style.opacity = '0';
                  continue;
                }
                const dx = (projVec.x * 0.5 + 0.5) * pw;
                const dy = (-projVec.y * 0.5 + 0.5) * ph;
                tagEl.style.opacity = '1';
                tagEl.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) translate(-50%, -100%)`;
              }
            }
          }

          // ---------- Chiếu tọa độ 3D -> 2D cho thẻ Tên + Avatar TikTok ----------
          const topForBadges = allRacers.slice(0, MAX_BADGES);
          if (spotRacer && !topForBadges.some((r) => r.id === spotRacer.id)) {
            topForBadges[topForBadges.length - 1] = spotRacer;
          }
          const nextSig = `${phase}|` + topForBadges
            .map((r) => `${r.id}:${r.rank}:${r.lap}:${r.level}:${r.boost}:${r.petName}:${r.nickname}`)
            .join('|');
          if (nextSig !== lastBadgeSig) {
            lastBadgeSig = nextSig;
            setBadges(
              topForBadges.map((r) => ({
                id: r.id,
                nickname: r.nickname,
                avatar: r.avatar,
                rank: r.rank,
                lap: r.lap,
                level: r.level || 1,
                boost: r.boost,
                boostLabel: r.boostLabel,
                petName: r.petName,
                isPodium: phase === 'podium' && r.rank <= 3,
              })),
            );
          }

          for (let i = 0; i < topForBadges.length; i++) {
            const el = badgeElsRef.current[i];
            if (!el) continue;
            const r = topForBadges[i];
            const spdEl = speedElsRef.current[i];
            if (spdEl) {
              const kmh = Math.round(Math.max(0, r.speed) * 3.6);
              if (phase === 'lobby' || phase === 'podium' || kmh < 3) {
                spdEl.style.display = 'none';
              } else {
                spdEl.style.display = 'inline-flex';
                spdEl.textContent = r.boost !== 'none' ? `⚡ ${kmh} KM/H` : `${kmh} km/h`;
              }
            }
            if (phase === 'podium' && r.rank <= 3) {
              // Gắn Avatar to đẹp + Tên ngay giữa mặt trước của từng bục trao giải 3D!
              const pod = getPodiumSlotWorld(r.rank);
              projVec.set(
                pod.x + podiumFrontPt.x * 2.25,
                pod.y * 0.52,
                pod.z + podiumFrontPt.z * 2.25,
              );
            } else if (phase === 'podium') {
              el.style.opacity = '0';
              continue;
            } else {
              const s = sampleCircuit(r.z, r.x);
              const headH =
                r.boost === 'dragon'
                  ? 8.5
                  : r.boost === 'superman'
                    ? 5.6
                    : r.boost === 'rocket'
                      ? 5.3
                      : r.boost === 'jetpack'
                        ? 4.6
                        : 3.75;
              projVec.set(s.x, headH, s.z);
            }
            projVec.project(camera);
            const visible =
              projVec.z > -1 &&
              projVec.z < 1 &&
              Math.abs(projVec.x) <= 1.15 &&
              Math.abs(projVec.y) <= 1.15;
            if (!visible) {
              el.style.opacity = '0';
              continue;
            }
            const sx = (projVec.x * 0.5 + 0.5) * cw;
            const sy = (-projVec.y * 0.5 + 0.5) * ch;
            el.style.opacity = '1';
            el.style.transform =
              phase === 'podium' && r.rank <= 3
                ? `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%)`
                : `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
          }
        };

        rafId = requestAnimationFrame(animate);

        cleanupFn = () => {
          ro.disconnect();
          dracoLoader.dispose();
          asphaltPBR.dispose();
          cityTarAsphaltPBR.dispose();
          buildingFacadeTex.dispose();
          cityPavementTex.dispose();
          buildingFacadeMats.forEach((m) => m.dispose());
          buildingRoofMat.dispose();
          buildingPenthouseMat.dispose();
          cityPlazaGroundMat.dispose();
          citySidewalkMat.dispose();
          softLampGlowTex.dispose();
          heroLightRig.dispose();
          matDragonHoloEast.dispose();
          matDragonHoloWest.dispose();
          grassPBR.dispose();
          sparkSystem.dispose();
          realTimeSky.dispose();
          pmrem.dispose();
          renderer.dispose();
        };
      } catch (err: any) {
        setErrorMsg(err?.message || 'Không thể khởi tạo WebGL / Three.js');
      }
    };

    void init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      cleanupFn?.();
    };
  }, [cameraDirectorRef, phaseRef, racersRef, timerRef]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-sky-400 select-none">
      {/* Three.js WebGL Mount */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Hiệu ứng vệt gió siêu tốc (Speed Lines) */}
      <div
        ref={speedLinesRef}
        style={{
          opacity: 0,
          transition: 'opacity 0.25s ease',
          background:
            'repeating-conic-gradient(from 0deg, rgba(255,255,255,0.22) 0deg 2deg, transparent 2deg 12deg)',
          WebkitMaskImage:
            'radial-gradient(circle at center, transparent 42%, rgba(0,0,0,0.95) 85%)',
          maskImage: 'radial-gradient(circle at center, transparent 42%, rgba(0,0,0,0.95) 85%)',
        }}
        className="pointer-events-none absolute inset-0 z-10"
      />

      {/* Thẻ Vị Trí (#Rank) trên đầu khi đua & Avatar To Đẹp gắn trực tiếp mặt trước 3 bục trao giải khi Podium */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-10">
        {badges.map((b, idx) => (
          <div
            key={b.id}
            ref={(el) => {
              badgeElsRef.current[idx] = el;
            }}
            style={{ opacity: 0, willChange: 'transform' }}
            className="absolute left-0 top-0 flex flex-col items-center gap-0.5"
          >
            {b.isPodium ? (
              <div
                className={`flex flex-col items-center rounded-2xl px-2 py-1.5 border-2 backdrop-blur-md shadow-[0_6px_22px_rgba(0,0,0,0.65)] ${b.rank === 1
                    ? 'bg-gradient-to-b from-amber-400/90 to-amber-600/90 border-yellow-100 text-slate-950'
                    : b.rank === 2
                      ? 'bg-gradient-to-b from-slate-200/90 to-slate-400/90 border-white text-slate-950'
                      : 'bg-gradient-to-b from-orange-400/90 to-amber-700/90 border-orange-200 text-white'
                  }`}
              >
                <span className="text-[10px] font-black leading-none mb-1">
                  {b.rank === 1 ? '👑 #1' : b.rank === 2 ? '🥈 #2' : '🥉 #3'}
                </span>
                <img
                  src={b.avatar}
                  alt={b.nickname}
                  className={`rounded-full object-cover border-2 border-white shadow-lg bg-slate-800 ${b.rank === 1 ? 'w-14 h-14' : 'w-11 h-11'
                    }`}
                />
                <span className="mt-1 text-[10px] font-black max-w-[78px] truncate leading-tight">
                  {b.nickname}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1">
                  {b.boost !== 'none' && b.boostLabel && (
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide uppercase whitespace-nowrap ${BOOST_BADGE_STYLE[b.boost]}`}
                    >
                      {b.boostLabel}
                    </span>
                  )}
                  <span
                    ref={(el) => {
                      speedElsRef.current[idx] = el;
                    }}
                    style={{ display: 'none' }}
                    className={`px-1.5 py-0.5 rounded-full text-[9px] font-mono font-black tracking-tight whitespace-nowrap border backdrop-blur-sm ${b.boost !== 'none'
                        ? 'bg-cyan-950/90 text-cyan-200 border-cyan-400/90 shadow-[0_0_12px_rgba(0,180,255,0.85)]'
                        : 'bg-slate-950/75 text-sky-300 border-sky-400/40'
                      }`}
                  />
                  {b.petName && (
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-amber-300/95 text-slate-950 border border-yellow-100 shadow whitespace-nowrap">
                      🐾 {b.petName}
                    </span>
                  )}
                </div>
                <div
                  className={`flex items-center gap-1 pr-2 pl-0.5 py-0.5 rounded-full border backdrop-blur-sm shadow-md ${b.rank === 1
                      ? 'bg-amber-400/95 border-yellow-100 text-slate-950 scale-105 shadow-[0_0_12px_rgba(251,191,36,0.75)]'
                      : b.rank === 2
                        ? 'bg-slate-200/95 border-white text-slate-900'
                        : b.rank === 3
                          ? 'bg-orange-400/95 border-orange-200 text-slate-950'
                          : 'bg-slate-950/80 border-white/30 text-white'
                    }`}
                >
                  <span
                    className={`px-1.5 py-[1px] rounded-full text-[10px] font-black leading-tight ${b.rank === 1
                        ? 'bg-slate-950 text-amber-300'
                        : b.rank === 2
                          ? 'bg-slate-800 text-white'
                          : b.rank === 3
                            ? 'bg-slate-950 text-orange-300'
                            : 'bg-sky-500 text-slate-950'
                      }`}
                  >
                    #{b.rank}
                  </span>
                  <img
                    src={b.avatar}
                    alt={b.nickname}
                    className="w-4 h-4 rounded-full object-cover border border-white/60 bg-slate-800"
                  />
                  <span className="text-[10px] font-bold max-w-[74px] truncate">{b.nickname}</span>
                  <span
                    className={`px-1 py-[1px] rounded text-[8.5px] font-black ${b.rank <= 3 ? 'bg-black/20 text-slate-950' : 'bg-black/40 text-amber-300'
                      }`}
                  >
                    V{b.lap}
                  </span>
                </div>
                {/* Mũi tên nhỏ chỉ trực tiếp xuống đỉnh đầu nhân vật */}
                <div
                  className={`w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[5px] -mt-0.5 ${b.rank === 1
                      ? 'border-t-amber-300'
                      : b.rank === 2
                        ? 'border-t-slate-200'
                        : b.rank === 3
                          ? 'border-t-orange-400'
                          : 'border-t-white/70'
                    }`}
                />
              </>
            )}
          </div>
        ))}
      </div>

      {/* Khung Camera Drone Toàn Cảnh (Kéo thả di chuyển & thu phóng trực tiếp trên Bảng Điều Khiển, đồng bộ sang Stage) */}
      <div
        ref={dronePipRef}
        onPointerDown={(e) => startDroneInteract(e, 'move')}
        style={{
          display: droneCamOn && graphicsQuality !== 'low' ? 'block' : 'none',
          left: `${droneRect.x}%`,
          top: `${droneRect.y}%`,
          width: `${droneRect.w}%`,
          height: `${droneRect.h}%`,
        }}
        className={`${canEditDrone ? 'pointer-events-auto cursor-move' : 'pointer-events-none'
          } absolute rounded-2xl border-2 border-sky-400/90 shadow-[0_0_28px_rgba(14,165,233,0.55)] overflow-hidden z-20 select-none`}
      >
        {/* Thanh tiêu đề Drone Live */}
        <div className="absolute top-0 left-0 right-0 px-2 py-1 bg-slate-950/85 border-b border-sky-400/50 backdrop-blur-sm flex items-center justify-between">
          <span className="text-[9px] font-black tracking-wide text-sky-300 flex items-center gap-1 truncate">
            🚁 DRONE {canEditDrone ? '(Kéo để chuyển)' : 'TOÀN CẢNH'}
          </span>
          <span className="flex items-center gap-0.5 text-[8px] font-black text-rose-400 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
            LIVE
          </span>
        </div>

        {/* Các thẻ định vị toàn bộ người chơi trên sân đua trong góc quay Drone */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {droneTags.map((t, idx) => (
            <div
              key={t.id}
              ref={(el) => {
                droneTagElsRef.current[idx] = el;
              }}
              style={{ opacity: 0, willChange: 'transform' }}
              className="absolute left-0 top-0 flex flex-col items-center"
            >
              <div
                className={`flex items-center gap-1 px-1.5 py-[1.5px] rounded-full border shadow-md whitespace-nowrap ${t.rank === 1
                    ? 'bg-amber-400/95 border-yellow-100 text-slate-950 font-black scale-105'
                    : t.boost !== 'none'
                      ? 'bg-cyan-400/95 border-white text-slate-950 font-black'
                      : 'bg-slate-950/85 border-white/50 text-white font-bold'
                  }`}
              >
                <span
                  style={{ backgroundColor: t.color }}
                  className="w-2 h-2 rounded-full border border-white/90 shrink-0"
                />
                <span className="text-[8.5px] leading-none">#{t.rank}</span>
                <span className="text-[8px] leading-none max-w-[54px] truncate">{t.nickname}</span>
              </div>
              <span
                style={{ backgroundColor: t.rank === 1 ? '#facc15' : t.color }}
                className="w-2 h-2 rounded-full border border-white shadow"
              />
            </div>
          ))}
        </div>

        {/* Chân khung Drone Cam */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-slate-950/90 to-transparent flex items-center justify-between text-[8px] font-bold text-slate-200">
          <span>TOÀN SÂN ĐUA</span>
          <span className="text-amber-300">{droneTags.length} TAY ĐUA</span>
        </div>

        {/* Tay cầm thu phóng ở góc phải bên dưới (chỉ hiện trên Bảng Điều Khiển) */}
        {canEditDrone && (
          <div
            onPointerDown={(e) => startDroneInteract(e, 'resize')}
            title="Kéo để thu phóng khung Camera Drone"
            className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-30 flex items-end justify-end p-0.5 bg-sky-500/80 rounded-tl-lg border-t border-l border-white/60 hover:bg-amber-400 transition"
          >
            <span className="text-[9px] leading-none text-slate-950 font-black">⤡</span>
          </div>
        )}
      </div>

      {/* Bộ đếm FPS & Trạng thái Model 3D GLB */}
      <div className="pointer-events-none absolute bottom-1.5 right-2 z-20 flex items-center gap-1.5">
        {loadedModelsCount > 0 && (
          <span className="rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-mono text-sky-300">
            NotBlox 3D: {loadedModelsCount}/{NOTBLOX_CHARACTER_MODELS.length + NOTBLOX_PET_MODELS.length}
          </span>
        )}
        <span className="rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300">
          {fps} FPS
        </span>
      </div>

      {errorMsg && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/85 p-6 text-center text-rose-300 text-sm">
          {errorMsg}
        </div>
      )}
    </div>
  );
};
