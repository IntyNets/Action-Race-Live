import React, { useEffect, useRef, useState } from 'react';
import {
  DroneRect,
  GraphicsQuality,
  MatchPhase,
  RACE_CONSTANTS,
  RacerState,
  SpectatorInfo,
} from './raceTypes';
import {
  CIRCUIT_TRACK,
  MapTheme,
  getActiveMap,
  getTrackVersion,
  sampleCircuit,
} from './trackCurve';
import { CameraDirector } from './camera/CameraDirector';

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
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const badgeElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const dronePipRef = useRef<HTMLDivElement | null>(null);
  const droneTagElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const speedLinesRef = useRef<HTMLDivElement | null>(null);
  const [badges, setBadges] = useState<LabelBadgeInfo[]>([]);
  const [droneTags, setDroneTags] = useState<DroneTagInfo[]>([]);
  const [fps, setFps] = useState<number>(60);
  const [loadedModelsCount, setLoadedModelsCount] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const stepPhysicsRef = useRef(stepPhysics);
  stepPhysicsRef.current = stepPhysics;
  const droneCamOnRef = useRef(droneCamOn);
  droneCamOnRef.current = droneCamOn;
  const graphicsQualityRef = useRef<GraphicsQuality>(graphicsQuality);
  graphicsQualityRef.current = graphicsQuality;
  const droneRectRef = useRef<DroneRect>(droneRect);
  droneRectRef.current = droneRect;

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
        const [THREE, gltfMod, dracoMod, skelMod, roomEnvMod] = await Promise.all([
          dynamicImport('three'),
          dynamicImport('three/addons/loaders/GLTFLoader.js'),
          dynamicImport('three/addons/loaders/DRACOLoader.js'),
          dynamicImport('three/addons/utils/SkeletonUtils.js'),
          dynamicImport('three/addons/environments/RoomEnvironment.js'),
        ]);
        if (cancelled) return;

        const { GLTFLoader } = gltfMod;
        const { DRACOLoader } = dracoMod;
        const SkeletonUtils = skelMod;
        const { RoomEnvironment } = roomEnvMod;

        // ---------- Renderer + RoomEnvironment PBR + Đổ Bóng Mềm Chân Thực (PCFSoftShadowMap) ----------
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
        renderer.setSize(container.clientWidth || 540, container.clientHeight || 960);
        renderer.shadowMap.enabled = graphicsQualityRef.current !== 'low';
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x93c5fd, 0.0036);

        const pmrem = new THREE.PMREMGenerator(renderer);
        const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = envTex;

        const camera = new THREE.PerspectiveCamera(
          52,
          (container.clientWidth || 540) / (container.clientHeight || 960),
          0.5,
          480,
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

        // Sky Dome 3D Gradient
        const makeSkyTexture = (
          colors: [string, string, string, string, string] = [
            '#0284c7',
            '#38bdf8',
            '#bae6fd',
            '#fef08a',
            '#fde68a',
          ],
        ) => {
          const cv = document.createElement('canvas');
          cv.width = 32;
          cv.height = 256;
          const ctx = cv.getContext('2d')!;
          const grad = ctx.createLinearGradient(0, 0, 0, 256);
          grad.addColorStop(0.0, colors[0]);
          grad.addColorStop(0.45, colors[1]);
          grad.addColorStop(0.75, colors[2]);
          grad.addColorStop(0.92, colors[3]);
          grad.addColorStop(1.0, colors[4]);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, 32, 256);
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          return tex;
        };
        const skyDome = new THREE.Mesh(
          new THREE.SphereGeometry(320, 20, 14),
          new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false }),
        );
        scene.add(skyDome);

        // Ánh sáng 3 điểm + Nguồn sáng Mặt Trời đổ bóng rõ nét cho nhân vật, cây cối, hoa cỏ & khán giả
        const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x166534, 0.78);
        scene.add(hemiLight);
        const sunLight = new THREE.DirectionalLight(0xfff7ed, 1.85);
        sunLight.position.set(36, 58, -28);
        sunLight.castShadow = graphicsQualityRef.current !== 'low';
        sunLight.shadow.mapSize.set(
          graphicsQualityRef.current === 'high' ? 2048 : 1024,
          graphicsQualityRef.current === 'high' ? 2048 : 1024,
        );
        sunLight.shadow.camera.near = 6;
        sunLight.shadow.camera.far = 175;
        sunLight.shadow.camera.left = -58;
        sunLight.shadow.camera.right = 58;
        sunLight.shadow.camera.top = 58;
        sunLight.shadow.camera.bottom = -58;
        sunLight.shadow.bias = -0.0005;
        sunLight.shadow.normalBias = 0.04;
        scene.add(sunLight);
        scene.add(sunLight.target);
        const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
        rimLight.position.set(-50, 30, 80);
        scene.add(rimLight);
        // Đèn chiếu sáng mặt đường động kiểu The Flash ("chạy tới đâu đường sáng tới đó")
        const flashRoadLight = new THREE.PointLight(0xfacc15, 0, 30, 1.35);
        flashRoadLight.position.set(0, 1.8, 0);
        scene.add(flashRoadLight);

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

        // Vật liệu & hình khối dùng chung giữa các lần dựng map
        const grassTex = makeGrassTexture();
        const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.92 });
        const roadMat = new THREE.MeshStandardMaterial({
          map: makeAsphaltTexture(),
          roughness: 0.65,
          metalness: 0.08,
        });
        const curbMat = new THREE.MeshStandardMaterial({ map: makeCurbTexture(), roughness: 0.45 });
        const barrierGeo = new THREE.BoxGeometry(0.7, 1.05, 3.6);
        const barrierRed = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 });
        const barrierWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
        // Cây xanh tự nhiên nhiều tầng tán lá + bụi cây & cụm cỏ 3D chi tiết ven đường
        const trunkGeo = new THREE.CylinderGeometry(0.28, 0.56, 4.1, 7);
        const leafBotGeo = new THREE.IcosahedronGeometry(2.05, 1);
        const leafTopGeo = new THREE.IcosahedronGeometry(1.48, 1);
        const bushGeo = new THREE.DodecahedronGeometry(1.05, 1);
        const grassBladeGeo = new THREE.ConeGeometry(0.22, 0.95, 4);
        const flowerGeo = new THREE.OctahedronGeometry(0.28, 0);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b3a19, roughness: 0.92 });
        const leafMatA = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.82, flatShading: true });
        const leafMatB = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.78, flatShading: true });
        const leafMatC = new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.75, flatShading: true });
        const grassBladeMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.85, flatShading: true });
        const flowerMatPink = new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.55 });
        const flowerMatGold = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 });
        const standGeo = new THREE.BoxGeometry(6.5, 4.4, 18);
        const standRoofGeo = new THREE.BoxGeometry(7.6, 0.6, 18.6);
        const standMat = new THREE.MeshStandardMaterial({ color: 0x4f46e5, roughness: 0.55 });
        const roofMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 });
        const lakeMat = new THREE.MeshStandardMaterial({
          color: 0x0ea5e9,
          emissive: 0x0369a1,
          emissiveIntensity: 0.25,
          roughness: 0.15,
          metalness: 0.5,
        });
        const gatePillarGeo = new THREE.BoxGeometry(1.3, 10.2, 1.3);
        const gatePillarMat = new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          metalness: 0.4,
          roughness: 0.3,
        });
        const gateBannerMat = new THREE.MeshBasicMaterial({ map: makeCheckeredTexture(22, 3) });
        const finishLineMat = new THREE.MeshBasicMaterial({ map: makeCheckeredTexture(14, 2) });

        // Hình khối & vật liệu riêng cho 4 bản đồ (Park / Stadium / Mountain / Neon City)
        const pineConeBotGeo = new THREE.ConeGeometry(2.3, 3.6, 6);
        const pineConeTopGeo = new THREE.ConeGeometry(1.6, 2.8, 6);
        const mountainPeakGeo = new THREE.ConeGeometry(1.0, 1.0, 5);
        const mountainSnowGeo = new THREE.ConeGeometry(0.42, 0.42, 5);
        const boulderGeo = new THREE.DodecahedronGeometry(1.6, 0);
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.92, flatShading: true });
        const snowMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 });

        const fountainBaseGeo = new THREE.CylinderGeometry(4.5, 5.2, 0.9, 16);
        const fountainJetGeo = new THREE.CylinderGeometry(0.7, 1.15, 7.5, 12);
        const fountainRingGeo = new THREE.TorusGeometry(2.6, 0.28, 8, 20);
        const fountainStoneMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 });
        const fountainWaterMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.82,
        });
        const balloonEnvelopeGeo = new THREE.SphereGeometry(3.2, 12, 10);
        const balloonBasketGeo = new THREE.BoxGeometry(1.5, 1.2, 1.5);
        const balloonPalette = [0xef4444, 0xfacc15, 0x38bdf8, 0xec4899, 0x22c55e, 0xa855f7];
        const balloonMats = balloonPalette.map(
          (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.45 }),
        );

        const towerPoleGeo = new THREE.BoxGeometry(0.85, 18.0, 0.85);
        const towerHeadGeo = new THREE.BoxGeometry(4.6, 1.8, 0.9);
        const towerGlowMat = new THREE.MeshBasicMaterial({ color: 0xfef9c3 });
        const trophyBaseGeo = new THREE.CylinderGeometry(4.0, 4.8, 2.2, 12);
        const trophyStemGeo = new THREE.CylinderGeometry(1.0, 1.6, 4.0, 12);
        const trophyCupGeo = new THREE.CylinderGeometry(4.2, 1.8, 4.8, 12);
        const trophyGoldMat = new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          emissive: 0xd97706,
          emissiveIntensity: 0.4,
          metalness: 0.85,
          roughness: 0.2,
        });

        const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
        const buildingBodyMat = new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          roughness: 0.45,
          metalness: 0.35,
        });
        const matDarkMetal = new THREE.MeshStandardMaterial({
          color: 0x334155,
          metalness: 0.8,
          roughness: 0.3,
        });
        const neonCyanMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
        const neonPinkMat = new THREE.MeshBasicMaterial({ color: 0xec4899 });
        const neonAmberMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
        const streetPostGeo = new THREE.BoxGeometry(0.42, 7.2, 0.42);
        const streetArmGeo = new THREE.BoxGeometry(2.4, 0.32, 0.42);
        const streetLampGeo = new THREE.BoxGeometry(1.1, 0.35, 0.65);

        const floatingLandmarks: Array<{ mesh: any; baseY: number; phase: number }> = [];

        // Mây khối 3D (neo theo tâm map, dựng 1 lần)
        const cloudAnchor = new THREE.Group();
        const cloudGroup = new THREE.Group();
        const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
        const cloudGeo1 = new THREE.BoxGeometry(10, 2.8, 6);
        const cloudGeo2 = new THREE.BoxGeometry(6, 2.4, 4.5);
        for (let i = 0; i < 24; i++) {
          const cg = new THREE.Group();
          cg.add(new THREE.Mesh(cloudGeo1, cloudMat));
          const m2 = new THREE.Mesh(cloudGeo2, cloudMat);
          m2.position.set(2.5, 1.6, 0);
          cg.add(m2);
          cg.position.set(-140 + (i % 6) * 56, 34 + (i % 4) * 6, -170 + Math.floor(i / 6) * 110);
          cloudGroup.add(cg);
        }
        cloudAnchor.add(cloudGroup);
        scene.add(cloudAnchor);

        // Bục Vinh Danh 3D (dựng 1 lần, đặt lại vị trí theo từng map) — không có biển chữ để màn hình gọn gàng
        const podiumGroup = new THREE.Group();
        const makePodiumBlock = (x: number, h: number, color: number) => {
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(4.4, h, 4.4),
            new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.25 }),
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

        // Luồng ánh sáng Spotlight 3D chiếu từ trên cao xuống nhân vật đang được CameraDirector tập trung
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

        // Tọa độ thế giới của từng vị trí trên Bục Top 1-2-3
        const getPodiumSlotWorld = (rank: number) => {
          const lx = rank === 1 ? 0 : rank === 2 ? -5.0 : 5.0;
          const ly = rank === 1 ? 3.4 : rank === 2 ? 2.3 : 1.6;
          const v = new THREE.Vector3(lx, ly, 0);
          podiumGroup.localToWorld(v);
          return { x: v.x, y: v.y, z: v.z, yaw: podiumGroup.rotation.y };
        };

        // Áp dụng chủ đề màu (ngày/đêm/hoàng hôn) và màu lề đường của từng map
        const applyMapTheme = (th: MapTheme) => {
          if (skyDome.material.map) skyDome.material.map.dispose();
          skyDome.material.map = makeSkyTexture(th.sky);
          skyDome.material.needsUpdate = true;
          if (curbMat.map) curbMat.map.dispose();
          curbMat.map = makeCurbTexture(th.curbColorA, th.curbColorB);
          curbMat.needsUpdate = true;
          barrierRed.color.setHex(th.curbColorA);
          barrierWhite.color.setHex(th.curbColorB);
          scene.fog.color.setHex(th.fog);
          scene.fog.density = th.fogDensity;
          renderer.toneMappingExposure = th.exposure;
          hemiLight.color.setHex(th.hemiSky);
          hemiLight.groundColor.setHex(th.hemiGround);
          sunLight.color.setHex(th.sunColor);
          sunLight.intensity = th.sunIntensity;
          grassMat.color.setHex(th.grassTint);
          leafMatA.color.setHex(th.leafA);
          leafMatB.color.setHex(th.leafB);
          cloudMat.color.setHex(th.cloudColor);
        };

        // Dải mặt đường / lề cong khép kín theo CIRCUIT_TRACK hiện tại
        const buildClosedRibbon = (
          innerOffset: number,
          outerOffset: number,
          yHeight: number,
          uvRepeatPerMeter: number,
        ) => {
          const totalLen = CIRCUIT_TRACK.totalLength;
          const segs = Math.max(220, Math.min(700, Math.ceil(totalLen / 3)));
          const positions: number[] = [];
          const normals: number[] = [];
          const uvs: number[] = [];
          const indices: number[] = [];

          for (let i = 0; i <= segs; i++) {
            const dist = (i / segs) * totalLen;
            const s = sampleCircuit(dist, 0);
            positions.push(
              s.x + s.rx * innerOffset,
              yHeight,
              s.z + s.rz * innerOffset,
              s.x + s.rx * outerOffset,
              yHeight,
              s.z + s.rz * outerOffset,
            );
            normals.push(0, 1, 0, 0, 1, 0);
            const v = dist * uvRepeatPerMeter;
            uvs.push(0, v, 1, v);

            if (i < segs) {
              const a = i * 2;
              indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
            }
          }

          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
          geo.setIndex(indices);
          return geo;
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
          const isHigh = q === 'high';
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isHigh ? 1.5 : isLow ? 1.0 : 1.25));
          renderer.shadowMap.enabled = !isLow;
          sunLight.castShadow = !isLow;
          const targetMapSize = isHigh ? 2048 : 1024;
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

          const quality = graphicsQualityRef.current;
          applyGraphicsQualitySettings(quality);
          const enableWorldShadows = quality !== 'low';

          // Mặt nền toàn khu vực (nhận bóng đổ chân thực)
          const grassSize = ext + 520;
          grassTex.repeat.set(grassSize / 18, grassSize / 18);
          const grass = new THREE.Mesh(new THREE.PlaneGeometry(grassSize, grassSize), grassMat);
          grass.rotation.x = -Math.PI / 2;
          grass.position.set(cx, -0.08, cz);
          grass.receiveShadow = enableWorldShadows;
          trackRoot.add(grass);

          // Mặt đường nhựa + lề màu riêng theo từng map (nhận bóng đổ chân thực của nhân vật, rồng, rocket!)
          const roadMesh = new THREE.Mesh(buildClosedRibbon(-halfW, halfW, 0.01, 0.055), roadMat);
          roadMesh.receiveShadow = enableWorldShadows;
          const curbL = new THREE.Mesh(buildClosedRibbon(-halfW - 1.5, -halfW, 0.06, 0.14), curbMat);
          const curbR = new THREE.Mesh(buildClosedRibbon(halfW, halfW + 1.5, 0.06, 0.14), curbMat);
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

          // Duy nhất 1 cổng XUẤT PHÁT / VỀ ĐÍCH (distance = 0)
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
            line.position.set(0, 0.07, 0);
            grp.add(leftP, rightP, banner, line);
            grp.position.set(s.x, 0, s.z);
            grp.rotation.y = s.yaw;
            trackRoot.add(grp);
          }

          // Hồ nước + Đài phun nước 3D ở map Công Viên
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
            if (r >= 9) {
              lakeR = r;
              const lake = new THREE.Mesh(new THREE.CircleGeometry(r, 32), lakeMat);
              lake.rotation.x = -Math.PI / 2;
              lake.position.set(lakeX, -0.02, lakeZ);
              trackRoot.add(lake);

              // Đài phun nước giữa hồ
              const fGrp = new THREE.Group();
              const fBase = new THREE.Mesh(fountainBaseGeo, fountainStoneMat);
              fBase.position.y = 0.45;
              const fJet = new THREE.Mesh(fountainJetGeo, fountainWaterMat);
              fJet.position.y = 4.2;
              const fRing = new THREE.Mesh(fountainRingGeo, fountainWaterMat);
              fRing.rotation.x = Math.PI / 2;
              fRing.position.y = 7.4;
              fGrp.add(fBase, fJet, fRing);
              fGrp.position.set(lakeX, 0, lakeZ);
              trackRoot.add(fGrp);
            }
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

          // 1) Cây xanh tự nhiên chi tiết nhiều tầng tán lá + Bụi cây & Cụm cỏ 3D ven đường (tùy chỉnh theo cấu hình Thấp/Trung bình/Cao)
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
          // Trên mức Trung bình & Cao: thêm tầng tán lá phụ thứ 3 tạo dáng cây xum xuê chân thực như ảnh tham chiếu
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
            // 65 Tòa nhà chọc trời Cyberpunk có dải đèn Neon + Cột đèn đường Neon dọc lộ
            const bldgPos: Array<{ x: number; z: number; w: number; d: number; h: number; c: number }> = [];
            for (let b = 0; b < 180 && bldgPos.length < 65; b++) {
              const ang = b * 2.39996 + 0.3;
              const rad = ext * 0.18 + (b % 9) * 24;
              const bx = cx + Math.cos(ang) * rad;
              const bz = cz + Math.sin(ang) * rad;
              if (!isSafeScenerySpot(bx, bz, halfW + 13)) continue;
              bldgPos.push({
                x: bx,
                z: bz,
                w: 8 + (b % 4) * 2.5,
                d: 8 + ((b + 2) % 4) * 2.5,
                h: 16 + (b % 7) * 5.2,
                c: b % 3,
              });
            }
            if (bldgPos.length > 0) {
              const bBodyInst = new THREE.InstancedMesh(buildingGeo, buildingBodyMat, bldgPos.length);
              const bNeonInstA = new THREE.InstancedMesh(buildingGeo, neonCyanMat, bldgPos.length);
              const bNeonInstB = new THREE.InstancedMesh(buildingGeo, neonPinkMat, bldgPos.length);
              bldgPos.forEach((bp, idx) => {
                dummy.rotation.set(0, 0, 0);
                dummy.position.set(bp.x, bp.h / 2, bp.z);
                dummy.scale.set(bp.w, bp.h, bp.d);
                dummy.updateMatrix();
                bBodyInst.setMatrixAt(idx, dummy.matrix);

                // Dải viền đèn Neon trên nóc & thân tòa nhà
                dummy.position.set(bp.x, bp.h * 0.92, bp.z);
                dummy.scale.set(bp.w + 0.35, 0.9, bp.d + 0.35);
                dummy.updateMatrix();
                if (bp.c === 0) bNeonInstA.setMatrixAt(idx, dummy.matrix);
                else bNeonInstB.setMatrixAt(idx, dummy.matrix);

                if (bp.c === 0) {
                  dummy.scale.set(0, 0, 0);
                  dummy.updateMatrix();
                  bNeonInstB.setMatrixAt(idx, dummy.matrix);
                } else {
                  dummy.scale.set(0, 0, 0);
                  dummy.updateMatrix();
                  bNeonInstA.setMatrixAt(idx, dummy.matrix);
                }
              });
              trackRoot.add(bBodyInst, bNeonInstA, bNeonInstB);
            }

            // Cột đèn đường Neon xen kẽ Hồng / Cyan hai bên đại lộ
            for (let sl = 0; sl < 26; sl++) {
              const side = sl % 2 === 0 ? -1 : 1;
              const s = sampleCircuit((sl / 26) * total, side * (halfW + 3.4));
              const lg = new THREE.Group();
              const post = new THREE.Mesh(streetPostGeo, matDarkMetal);
              post.position.y = 3.6;
              const arm = new THREE.Mesh(streetArmGeo, matDarkMetal);
              arm.position.set(-side * 1.0, 7.1, 0);
              const lampMat = sl % 3 === 0 ? neonAmberMat : sl % 2 === 0 ? neonCyanMat : neonPinkMat;
              const lamp = new THREE.Mesh(streetLampGeo, lampMat);
              lamp.position.set(-side * 1.9, 6.95, 0);
              lg.add(post, arm, lamp);
              lg.position.set(s.x, 0, s.z);
              lg.rotation.y = s.yaw;
              trackRoot.add(lg);
            }
          }

          // Khán đài cơ bản cho map Công Viên / Đèo (Stadium đã tự xây 12 khán đài)
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
              sg.add(base, roof);
              sg.position.set(s.x, 0, s.z);
              sg.rotation.y = s.yaw;
              trackRoot.add(sg);
            });
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


        // ---------- 3. Hệ thống Hạt 3D Thật (Lửa, Khói, Tia Sét, Pháo Hoa) ----------
        const glowTex = makeGlowParticleTexture();
        interface Particle {
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
          grow: number;
          gravity: number;
          sprite: any;
          mat: any;
        }
        const particles: Particle[] = [];
        for (let i = 0; i < MAX_PARTICLES; i++) {
          const mat = new THREE.SpriteMaterial({
            map: glowTex,
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          const sprite = new THREE.Sprite(mat);
          sprite.visible = false;
          scene.add(sprite);
          particles.push({
            active: false,
            x: 0,
            y: 0,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            life: 0,
            maxLife: 1,
            size: 1,
            grow: 0,
            gravity: 0,
            sprite,
            mat,
          });
        }

        let particleCursor = 0;
        const spawnParticle = (_opts: {
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
          // Không dùng hạt mịn/nhiễu rời rạc để giữ toàn bộ hiệu ứng 3D (tia sét, hào quang, vòng năng lượng, vệt đèn đường, lửa) siêu mượt mà & sắc nét!
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

        // Hình khối Rồng liền khối mượt mà (Rồng Trung Quốc & Rồng Châu Âu)
        const geoDragonHead = new THREE.SphereGeometry(0.74, 14, 12);
        const geoDragonSnout = new THREE.CapsuleGeometry(0.32, 0.58, 6, 10);
        geoDragonSnout.rotateX(Math.PI / 2);
        const geoDragonHorn = new THREE.ConeGeometry(0.13, 1.05, 8);
        const geoDragonWhisker = new THREE.CylinderGeometry(0.035, 0.015, 1.65, 6);
        const geoDragonEye = new THREE.SphereGeometry(0.14, 10, 10);
        const geoDragonSeg = new THREE.SphereGeometry(0.68, 14, 12);
        const geoDragonSpike = new THREE.ConeGeometry(0.13, 0.56, 6);
        const geoDragonWingArm = new THREE.CylinderGeometry(0.11, 0.16, 3.2, 8);
        geoDragonWingArm.rotateZ(Math.PI / 2);
        const geoDragonWingMain = new THREE.BoxGeometry(2.85, 0.08, 1.55);
        const geoDragonWingTip = new THREE.ConeGeometry(0.95, 2.25, 4);
        geoDragonWingTip.rotateZ(-Math.PI / 2);
        const geoDragonOrb = new THREE.SphereGeometry(0.24, 12, 10);
        const geoBoltMain = new THREE.BoxGeometry(0.08, 0.08, 1.35);
        const geoBoltDiag = new THREE.BoxGeometry(0.07, 0.07, 0.95);

        const matShadow = new THREE.MeshBasicMaterial({
          map: sharedShadowTex,
          transparent: true,
          depthWrite: false,
        });
        const matChrome = new THREE.MeshStandardMaterial({
          color: 0xe2e8f0,
          metalness: 0.75,
          roughness: 0.22,
        });
        const matRocketRed = new THREE.MeshStandardMaterial({
          color: 0xef4444,
          metalness: 0.35,
          roughness: 0.25,
        });
        const matGlass = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x0284c7,
          emissiveIntensity: 0.65,
          metalness: 0.85,
          roughness: 0.1,
        });
        const matFlameOuter = new THREE.MeshBasicMaterial({
          color: 0xf97316,
          transparent: true,
          opacity: 0.88,
        });
        const matFlameInner = new THREE.MeshBasicMaterial({ color: 0xfef08a });
        const matFlameCyan = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.85,
        });
        const matDragonGold = new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          emissive: 0xd97706,
          emissiveIntensity: 0.48,
          metalness: 0.78,
          roughness: 0.2,
        });
        const matDragonCrimson = new THREE.MeshStandardMaterial({
          color: 0xdc2626,
          emissive: 0x991b1b,
          emissiveIntensity: 0.42,
          metalness: 0.55,
          roughness: 0.24,
        });
        const matDragonRoyalBlue = new THREE.MeshStandardMaterial({
          color: 0x1d4ed8,
          emissive: 0x1e3a8a,
          emissiveIntensity: 0.48,
          metalness: 0.68,
          roughness: 0.22,
        });
        const matDragonWingMembrane = new THREE.MeshStandardMaterial({
          color: 0xf97316,
          emissive: 0xc2410c,
          emissiveIntensity: 0.55,
          metalness: 0.3,
          roughness: 0.35,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
        });
        const matDragonEye = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
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
          rocketFlameOuter: any;
          rocketFlameInner: any;
          rocketRing: any;
          dragonGrp: any;
          dragonHeadGrp: any;
          dragonSegs: any[];
          dragonLeftWing: any;
          dragonRightWing: any;
          dragonOrbsGrp: any;
          flashLightningGrp: any;
          flashBolts: any[];
          flashMatA: any;
          flashMatB: any;
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

          // 1) Sprint Aura Ring
          const sprintRing = new THREE.Mesh(geoShockRing, matSprintRing);
          sprintRing.rotation.x = Math.PI / 2;
          sprintRing.position.y = 0.22;
          sprintRing.visible = false;
          root.add(sprintRing);

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

          // 3) Tên Lửa 3D
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
          const rocketFlameOuter = new THREE.Mesh(geoFlameOuter, matFlameOuter);
          rocketFlameOuter.rotation.x = -Math.PI / 2;
          rocketFlameOuter.scale.set(2.3, 2.9, 2.3);
          rocketFlameOuter.position.z = -3.35;
          const rocketFlameInner = new THREE.Mesh(geoFlameInner, matFlameInner);
          rocketFlameInner.rotation.x = -Math.PI / 2;
          rocketFlameInner.scale.set(2.1, 2.6, 2.1);
          rocketFlameInner.position.z = -2.8;
          const rocketRing = new THREE.Mesh(geoShockRing, matFlameCyan);
          rocketRing.position.z = -2.1;
          rocketGrp.add(
            rBody,
            rStripe,
            rNose,
            rWin,
            rNozzle,
            rocketFlameOuter,
            rocketFlameInner,
            rocketRing,
          );
          rocketGrp.visible = false;
          root.add(rocketGrp);

          // 4) Rồng Thần Liền Khối Mượt Mà (Ngẫu nhiên Rồng Trung Quốc Hoàng Kim hoặc Rồng Châu Âu Hoàng Gia Cánh Lớn)
          const dragonGrp = new THREE.Group();
          dragonGrp.position.set(0, 0.4, 0);
          const dragonHeadGrp = new THREE.Group();
          dragonHeadGrp.position.set(0, 0.95, 2.85);
          const dHead = new THREE.Mesh(geoDragonHead, matDragonGold);
          dHead.scale.set(0.95, 0.85, 1.25);
          const dSnout = new THREE.Mesh(geoDragonSnout, matDragonGold);
          dSnout.position.set(0, -0.08, 0.85);
          const dJaw = new THREE.Mesh(geoDragonSnout, matDragonCrimson);
          dJaw.position.set(0, -0.36, 0.72);
          dJaw.scale.set(0.82, 0.65, 0.88);
          dJaw.rotation.x = 0.2;
          const dEyeL = new THREE.Mesh(geoDragonEye, matDragonEye);
          dEyeL.position.set(-0.42, 0.18, 0.52);
          const dEyeR = new THREE.Mesh(geoDragonEye, matDragonEye);
          dEyeR.position.set(0.42, 0.18, 0.52);
          const dHornL = new THREE.Mesh(geoDragonHorn, matDragonGold);
          dHornL.position.set(-0.34, 0.68, -0.25);
          dHornL.rotation.set(-0.65, 0, 0.28);
          const dHornR = new THREE.Mesh(geoDragonHorn, matDragonGold);
          dHornR.position.set(0.34, 0.68, -0.25);
          dHornR.rotation.set(-0.65, 0, -0.28);
          // Râu rồng dài đặc trưng của Rồng Trung Quốc (chỉ hiện khi là Rồng Trung Quốc)
          const dragonWhiskersGrp = new THREE.Group();
          const whiskL = new THREE.Mesh(geoDragonWhisker, matDragonGold);
          whiskL.position.set(-0.68, -0.15, 0.75);
          whiskL.rotation.set(0.35, 0, 1.15);
          const whiskR = new THREE.Mesh(geoDragonWhisker, matDragonGold);
          whiskR.position.set(0.68, -0.15, 0.75);
          whiskR.rotation.set(0.35, 0, -1.15);
          dragonWhiskersGrp.add(whiskL, whiskR);
          dragonHeadGrp.add(dHead, dSnout, dJaw, dEyeL, dEyeR, dHornL, dHornR, dragonWhiskersGrp);
          dragonGrp.add(dragonHeadGrp);

          // Thân rồng liền khối gồm 16 đốt cầu thuôn gối lên nhau sát khít tạo đường cong liền mạch 100%
          const dragonSegs: any[] = [];
          for (let s = 0; s < 16; s++) {
            const sg = new THREE.Group();
            const tFrac = s / 15;
            // Độ dày cơ thể thuôn mượt từ ngực/vai đầy đặn tới chóp đuôi thanh thoát
            const thickness =
              s < 3
                ? 0.92 + s * 0.08
                : Math.max(0.28, 1.12 * Math.pow(1 - (tFrac - 0.15) * 0.82, 1.1));
            const segMesh = new THREE.Mesh(
              geoDragonSeg,
              s % 3 === 1 ? matDragonCrimson : matDragonGold,
            );
            segMesh.scale.set(thickness * 0.95, thickness * 0.88, thickness * 1.48);
            sg.add(segMesh);
            if (s % 2 === 0 && s < 14) {
              const spike = new THREE.Mesh(geoDragonSpike, matDragonGold);
              spike.position.y = 0.68 * thickness;
              spike.rotation.x = -0.35;
              spike.scale.setScalar(thickness * 0.85);
              sg.add(spike);
            }
            sg.position.set(0, 0.35, 2.25 - s * 0.44);
            dragonGrp.add(sg);
            dragonSegs.push(sg);
          }

          // Đôi cánh Rồng Châu Âu uy nghi (xương cánh hoàng kim + màng cánh đỏ cam phát sáng)
          const makeDragonWing = (side: -1 | 1) => {
            const pivot = new THREE.Group();
            pivot.position.set(side * 0.52, 0.72, 0.95);
            const arm = new THREE.Mesh(geoDragonWingArm, matDragonGold);
            arm.position.set(side * 1.55, 0.14, 0.25);
            const mainW = new THREE.Mesh(geoDragonWingMain, matDragonWingMembrane);
            mainW.position.set(side * 1.45, 0, -0.25);
            const tipW = new THREE.Mesh(geoDragonWingTip, matDragonWingMembrane);
            tipW.position.set(side * 3.45, 0.08, -0.35);
            tipW.rotation.y = side * -0.22;
            if (side === -1) tipW.scale.x = -1;
            pivot.add(arm, mainW, tipW);
            dragonGrp.add(pivot);
            return pivot;
          };
          const dragonLeftWing = makeDragonWing(-1);
          const dragonRightWing = makeDragonWing(1);
          const dragonOrbsGrp = new THREE.Group();
          dragonOrbsGrp.position.set(0, 1.25, 0.4);
          for (let o = 0; o < 4; o++) {
            const ang = (o * Math.PI) / 2;
            const orb = new THREE.Mesh(geoDragonOrb, matDragonGold);
            orb.position.set(Math.cos(ang) * 2.25, 0, Math.sin(ang) * 2.25);
            dragonOrbsGrp.add(orb);
          }
          dragonGrp.add(dragonOrbsGrp);
          dragonGrp.visible = false;
          root.add(dragonGrp);

          // 5) Tia sét 3D kiểu The Flash Speed-Force (5 tia gãy khúc phóng điện quanh người & kéo vệt sau lưng)
          const flashMatA = new THREE.MeshBasicMaterial({
            color: 0xfacc15,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const flashMatB = new THREE.MeshBasicMaterial({
            color: 0xfef08a,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const flashLightningGrp = new THREE.Group();
          const flashBolts: any[] = [];
          const boltConfigs = [
            { x: -0.78, y: 1.5, z: -0.6 },
            { x: 0.78, y: 1.7, z: -0.6 },
            { x: 0.0, y: 2.35, z: -0.7 },
            { x: -0.5, y: 0.85, z: -0.8 },
            { x: 0.5, y: 0.95, z: -0.8 },
          ];
          boltConfigs.forEach((cfg, bIdx) => {
            const bolt = new THREE.Group();
            bolt.position.set(cfg.x, cfg.y, cfg.z);
            const seg1 = new THREE.Mesh(geoBoltMain, bIdx % 2 === 0 ? flashMatA : flashMatB);
            seg1.position.set(0, 0.08, -0.3);
            seg1.rotation.set(0.18, 0.25, 0);
            const seg2 = new THREE.Mesh(geoBoltDiag, bIdx % 2 === 0 ? flashMatB : flashMatA);
            seg2.position.set(bIdx % 2 === 0 ? 0.22 : -0.22, -0.1, -1.25);
            seg2.rotation.set(-0.28, bIdx % 2 === 0 ? -0.35 : 0.35, 0);
            const seg3 = new THREE.Mesh(geoBoltMain, bIdx % 2 === 0 ? flashMatA : flashMatB);
            seg3.position.set(0, 0.06, -2.2);
            seg3.rotation.set(0.16, 0.18, 0);
            const seg4 = new THREE.Mesh(geoBoltDiag, flashMatB);
            seg4.position.set(bIdx % 2 === 0 ? -0.18 : 0.18, -0.05, -3.05);
            seg4.rotation.set(-0.22, -0.2, 0);
            bolt.add(seg1, seg2, seg3, seg4);
            flashLightningGrp.add(bolt);
            flashBolts.push(bolt);
          });
          flashLightningGrp.visible = false;
          root.add(flashLightningGrp);

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

          // 2 lớp vật liệu Hào Quang bám theo đúng hình hài nhân vật (Lớp viền sắc nét + Lớp vầng sáng mềm bên ngoài)
          const glbOutlineMat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.88,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const glbHaloMat = new THREE.MeshBasicMaterial({
            color: 0xfacc15,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.34,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });

          root.visible = false;
          // Bật đổ bóng thật cho nhân vật dự phòng & đạo cụ (Jetpack, Tên Lửa, Rồng Thần)
          [fallbackGrp, jetpackGrp, rocketGrp, dragonGrp].forEach((grp) => {
            grp.traverse((ch: any) => {
              if (ch.isMesh) ch.castShadow = true;
            });
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
            rocketFlameOuter,
            rocketFlameInner,
            rocketRing,
            dragonGrp,
            dragonHeadGrp,
            dragonSegs,
            dragonLeftWing,
            dragonRightWing,
            dragonOrbsGrp,
            flashLightningGrp,
            flashBolts,
            flashMatA,
            flashMatB,
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
          renderer.setSize(w, h);
        };
        const ro = new ResizeObserver(handleResize);
        ro.observe(container);

        // ---------- 7. Render Loop 60 FPS + Camera Chuyển Đổi Siêu Mượt ----------
        let lastTime = performance.now();
        let fpsFrames = 0;
        let fpsAccum = 0;
        let lastBadgeSig = '';
        let fireworkTimer = 0;
        const projVec = new THREE.Vector3();

        const animate = (now: number) => {
          if (cancelled) return;
          rafId = requestAnimationFrame(animate);

          const dt = Math.min((now - lastTime) / 1000, 0.05);
          lastTime = now;

          fpsFrames++;
          fpsAccum += dt;
          if (fpsAccum >= 1.0) {
            setFps(Math.round(fpsFrames / fpsAccum));
            fpsFrames = 0;
            fpsAccum = 0;
          }

          stepPhysicsRef.current(dt);
          rebuildTrackIfNeeded();

          const phase = phaseRef.current;
          const allRacers = Array.from(racersRef.current.values());
          allRacers.sort((a, b) => a.rank - b.rank);

          let visibleRacers: RacerState[];
          if (allRacers.length <= RACE_CONSTANTS.MAX_RENDERED_RACERS) {
            visibleRacers = allRacers;
          } else {
            const topPart = allRacers.slice(0, 35);
            const rest = allRacers
              .slice(35)
              .sort((a, b) => b.lastInteractAt - a.lastInteractAt)
              .slice(0, RACE_CONSTANTS.MAX_RENDERED_RACERS - 35);
            visibleRacers = [...topPart, ...rest];
          }

          const tSec = now * 0.001;
          cloudGroup.position.x = Math.sin(tSec * 0.06) * 8;
          for (let fl = 0; fl < floatingLandmarks.length; fl++) {
            const item = floatingLandmarks[fl];
            item.mesh.position.y = item.baseY + Math.sin(tSec * 1.15 + item.phase) * 1.8;
            item.mesh.rotation.y = tSec * 0.22 + item.phase;
          }

          // Cập nhật khán giả đứng xem & cổ vũ dọc 2 bên đường đua (bao gồm các user mới vào chưa nhắn join!)
          const realSpecs = spectatorsRef ? Array.from(spectatorsRef.current.values()) : [];
          const activeSpecCount = Math.min(spectatorPool.length, Math.max(12, realSpecs.length));
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
              slot.bodyPivot.position.set(0, hover + 0.52, 0.15);
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
                  // Nổ vòng tia năng lượng tỏa tròn xung quanh chân khi tiếp đất
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
              // Trong thời gian chờ (> 5s): nhân vật khởi động chân tay ngẫu nhiên tự nhiên;
              // Còn <= 5s cuối: toàn bộ nhân vật cúi người vào thế chuẩn bị xuất phát!
              const isStartReady = timerRef.current <= 5;
              if (isStartReady) {
                const tense = Math.sin(tSec * 16 + i * 1.9) * 0.02;
                slot.bodyPivot.position.set(0, -0.22 + tense, 0);
                slot.bodyPivot.rotation.set(0.46, 0, 0);
              } else {
                const warmSlot = Math.floor(tSec / 2.8 + i * 0.7) % 4;
                if (warmSlot === 1) {
                  // Nhảy bật khởi động tại chỗ
                  slot.bodyPivot.position.set(0, Math.abs(Math.sin(tSec * 6.5 + i)) * 0.42, 0);
                  slot.bodyPivot.rotation.set(0.06, 0, 0);
                } else if (warmSlot === 0) {
                  // Chạy bước nhỏ làm nóng tại chỗ
                  slot.bodyPivot.position.set(0, Math.abs(Math.sin(tSec * 11 + i)) * 0.14, 0);
                  slot.bodyPivot.rotation.set(0.14, Math.sin(tSec * 2 + i) * 0.1, 0);
                } else if (warmSlot === 2) {
                  // Vung tay nhún nhảy khởi động
                  slot.bodyPivot.position.set(0, Math.abs(Math.sin(tSec * 4.5 + i)) * 0.12, 0);
                  slot.bodyPivot.rotation.set(0, Math.sin(tSec * 3 + i) * 0.18, 0);
                } else {
                  // Thở sâu, xoay vai quan sát đối thủ
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

            // Bật 2 lớp hào quang phát sáng nổi bật bám theo đúng hình hài nhân vật (khi bay/hạ cánh Siêu Nhân HOẶC khi đang được Camera Spotlight)
            const activeSpotUserId = cameraDirectorRef.current.getHudState().spotlightUserId;
            const isHeroSpotlight = Boolean(activeSpotUserId && activeSpotUserId === r.id);
            const showEnergyRim = isSuperman || isLanding || isHeroSpotlight;
            const outlineMeshes: any[] | undefined = slot.glbHolder.userData.outlineMeshes;
            // Chuyển sắc hào quang đa màu rực rỡ, sang trọng (Cyan -> Vàng Kim -> Hồng Tím)
            const phaseColorIdx = Math.floor(tSec * 2.4 + i) % 3;
            const auraPrimary =
              isDragon
                ? 0xfde047
                : isRocket
                  ? 0xfb7185
                  : phaseColorIdx === 0
                    ? 0x22d3ee
                    : phaseColorIdx === 1
                      ? 0xfacc15
                      : 0xe879f9;
            const auraSecondary =
              isDragon
                ? 0xf97316
                : phaseColorIdx === 0
                  ? 0xfacc15
                  : phaseColorIdx === 1
                    ? 0x38bdf8
                    : 0xf472b6;
            if (outlineMeshes) {
              slot.glbOutlineMat.color.setHex(auraPrimary);
              slot.glbHaloMat.color.setHex(auraSecondary);
              slot.glbOutlineMat.opacity = isSuperman
                ? 0.85 + Math.sin(tSec * 12 + i) * 0.12
                : isLanding
                  ? Math.min(0.9, slot.supermanLandTimer * 1.4)
                  : 0.72 + Math.sin(tSec * 6 + i) * 0.16;
              slot.glbHaloMat.opacity = isSuperman ? 0.38 : 0.28;
              for (let omIdx = 0; omIdx < outlineMeshes.length; omIdx++) {
                outlineMeshes[omIdx].visible = showEnergyRim;
              }
            }
            for (let gm = 0; gm < slot.glbAllMats.length; gm++) {
              const mat = slot.glbAllMats[gm];
              if (mat.emissive) {
                if (showEnergyRim) {
                  mat.emissive.setHex(auraPrimary);
                  mat.emissiveIntensity = isSuperman ? 0.42 : 0.28;
                } else if (mat.emissiveIntensity !== 0) {
                  mat.emissive.setHex(0x000000);
                  mat.emissiveIntensity = 0;
                }
              }
            }
            // Đốm sáng sao & tia lửa tự nhiên bay lơ lửng quanh nhân vật khi phát sáng hào quang
            if (showEnergyRim && i < 16 && Math.random() < 0.55) {
              const ang = Math.random() * Math.PI * 2;
              const rad = 0.7 + Math.random() * 1.1;
              spawnParticle({
                x: sample.x + Math.cos(ang) * rad,
                y: (isSuperman ? 2.2 : 0.6) + Math.random() * 1.8,
                z: sample.z + Math.sin(ang) * rad,
                vx: Math.cos(ang) * 1.4 - sample.tx * 2.5,
                vy: 1.6 + Math.random() * 2.2,
                vz: Math.sin(ang) * 1.4 - sample.tz * 2.5,
                life: 0.55 + Math.random() * 0.35,
                size: 0.55 + Math.random() * 0.45,
                grow: 0.3,
                color: Math.random() < 0.5 ? auraPrimary : auraSecondary,
              });
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
              // Tư thế bay Siêu Nhân cho model dự phòng: 1 tay giơ thẳng về trước, 2 chân duỗi thẳng
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

            // Đạo cụ 3D & hạt khói lửa theo đúng hướng tiếp tuyến đường cong (-tx, -tz)
            slot.sprintRing.visible = isSprint;
            slot.jetpackGrp.visible = isJetpack;
            slot.rocketGrp.visible = isRocket;
            slot.dragonGrp.visible = isDragon;
            slot.supermanAuraGrp.visible = isSuperman;

            // Hiệu ứng vòng năng lượng tỏa quanh người khi bay Siêu Nhân (đã tắt hình nón)
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

            // Thú cưng VIP chạy lon ton theo sát bên cạnh người chơi (tự co giãn cân đối kể cả khi hóa Rồng)
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

            // Hiệu ứng Tia Sét Speed-Force kiểu The Flash + Phát sáng đường đi như đèn ("chạy tới đâu đường sáng tới đó")
            const hasBoost = r.boost !== 'none';
            slot.flashLightningGrp.visible = hasBoost;
            if (hasBoost) {
              const trailColor = isDragon
                ? 0xfde047
                : isSuperman
                  ? 0x38bdf8
                  : isRocket
                    ? 0xf43f5e
                    : isJetpack
                      ? 0xfb923c
                      : 0xfacc15;
              // In dấu ánh sáng lên mặt đường ngay dưới chân tay đua để đường sáng rực theo từng bước chạy!
              if (i < 18 && r.speed > 2 && Math.random() < 0.65) {
                spawnRoadGlow(
                  sample.x,
                  sample.z,
                  sample.yaw,
                  trailColor,
                  isDragon ? 2.1 : isSuperman || isRocket ? 1.45 : 1.05,
                );
              }
              if (isDragon) {
                slot.flashMatA.color.setHex(0xfef08a);
                slot.flashMatB.color.setHex(0xf97316);
              } else if (isSuperman) {
                slot.flashMatA.color.setHex(0x38bdf8);
                slot.flashMatB.color.setHex(0xfacc15);
              } else if (isRocket) {
                slot.flashMatA.color.setHex(0xf43f5e);
                slot.flashMatB.color.setHex(0xfacc15);
              } else if (isJetpack) {
                slot.flashMatA.color.setHex(0xf97316);
                slot.flashMatB.color.setHex(0xfde047);
              } else {
                slot.flashMatA.color.setHex(0xfacc15);
                slot.flashMatB.color.setHex(0x38bdf8);
              }
              slot.flashLightningGrp.position.y =
                isDragon ? 1.55 : isRocket ? 1.05 : isJetpack ? 0.85 : 0;
              for (let bIdx = 0; bIdx < slot.flashBolts.length; bIdx++) {
                const bolt = slot.flashBolts[bIdx];
                const jitter = Math.sin(tSec * 48 + bIdx * 2.1 + i * 1.7);
                const jitter2 = Math.cos(tSec * 62 + bIdx * 3.3 + i);
                bolt.rotation.z = jitter * 0.65;
                bolt.rotation.x = jitter2 * 0.28;
                bolt.scale.z = 0.85 + Math.abs(jitter) * 0.95;
                bolt.position.x = (bIdx === 2 ? 0 : bIdx % 2 === 0 ? -0.68 : 0.68) + jitter * 0.25;
                bolt.position.y = (bIdx < 2 ? 1.55 : bIdx === 2 ? 2.25 : 0.85) + jitter2 * 0.25;
              }
              // Tia lửa điện Speed-Force phóng ra phía sau gót chân
              if (i < 24 && Math.random() < 0.72) {
                const sparkColor =
                  isDragon || isJetpack
                    ? Math.random() < 0.6
                      ? 0xfacc15
                      : 0xf97316
                    : isRocket
                      ? Math.random() < 0.5
                        ? 0xf43f5e
                        : 0xfacc15
                      : Math.random() < 0.65
                        ? 0xfacc15
                        : 0x38bdf8;
                spawnParticle({
                  x: sample.x + backX * 0.9 + (Math.random() - 0.5) * 1.1,
                  y: 0.4 + Math.random() * 1.6,
                  z: sample.z + backZ * 0.9 + (Math.random() - 0.5) * 1.1,
                  vx: backX * (8 + Math.random() * 6) + (Math.random() - 0.5) * 2.2,
                  vy: (Math.random() - 0.3) * 2.2,
                  vz: backZ * (8 + Math.random() * 6) + (Math.random() - 0.5) * 2.2,
                  life: 0.28,
                  size: isDragon || isRocket ? 1.1 : 0.78,
                  grow: 0.9,
                  color: sparkColor,
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
                  smoke: Math.random() >= 0.55,
                });
              }
            }

            if (isRocket) {
              slot.rocketFlameOuter.scale.y = 2.4 + Math.sin(tSec * 40 + i) * 0.75;
              slot.rocketFlameInner.scale.y = 2.0 + Math.cos(tSec * 44 + i) * 0.55;
              slot.rocketRing.scale.setScalar(1.0 + ((tSec * 4 + i) % 1) * 0.9);
              if (i < 20) {
                spawnParticle({
                  x: sample.x + backX * 2.5 + (Math.random() - 0.5) * 0.4,
                  y: slot.rocketGrp.position.y,
                  z: sample.z + backZ * 2.5 + (Math.random() - 0.5) * 0.4,
                  vx: backX * 12 + (Math.random() - 0.5) * 2,
                  vy: (Math.random() - 0.3) * 1.5,
                  vz: backZ * 12 + (Math.random() - 0.5) * 2,
                  life: 0.5,
                  size: 1.35,
                  grow: 2.2,
                  color: Math.random() < 0.6 ? 0xf97316 : 0xfef08a,
                });
                if (Math.random() < 0.65) {
                  spawnParticle({
                    x: sample.x + backX * 3.0 + (Math.random() - 0.5) * 0.6,
                    y: slot.rocketGrp.position.y,
                    z: sample.z + backZ * 3.0 + (Math.random() - 0.5) * 0.6,
                    vx: backX * 6 + (Math.random() - 0.5) * 2,
                    vy: 1.4,
                    vz: backZ * 6 + (Math.random() - 0.5) * 2,
                    life: 0.72,
                    size: 1.6,
                    grow: 2.6,
                    color: 0xf1f5f9,
                    smoke: true,
                  });
                }
              }
            }

            if (isDragon) {
              // Chọn ngẫu nhiên (tất định theo userId) Rồng Trung Quốc Hoàng Kim (thân uốn lượn dài, râu rồng, ngọc rồng)
              // hoặc Rồng Châu Âu Hoàng Gia (đôi cánh uy nghi đập mạnh, thân liền khối dũng mãnh)
              let idHash = 0;
              for (let c = 0; c < r.id.length; c++) idHash = (idHash * 31 + r.id.charCodeAt(c)) | 0;
              const isEastern = Math.abs(idHash) % 2 === 0;
              slot.dragonStyle = isEastern ? 'eastern' : 'western';
              slot.dragonLeftWing.visible = !isEastern;
              slot.dragonRightWing.visible = !isEastern;
              slot.dragonWhiskersGrp.visible = isEastern;
              slot.dragonOrbsGrp.visible = isEastern;

              // Đổi sắc thân rồng tôn phái: Rồng Trung Quốc (Hoàng Kim - Chu Sa) vs Rồng Châu Âu (Xanh Lam Hoàng Gia - Vàng Kim)
              for (let s = 0; s < slot.dragonSegs.length; s++) {
                const seg = slot.dragonSegs[s];
                const bodyMesh = seg.children[0];
                if (bodyMesh) {
                  bodyMesh.material = isEastern
                    ? s % 3 === 1
                      ? matDragonCrimson
                      : matDragonGold
                    : s % 3 === 0
                      ? matDragonGold
                      : matDragonRoyalBlue;
                }
                const waveAmp = isEastern ? 0.34 + s * 0.055 : 0.14 + s * 0.03;
                const waveSpd = isEastern ? 8.5 : 6.2;
                seg.position.x = Math.sin(tSec * waveSpd - s * 0.42 + i) * waveAmp;
                seg.position.y =
                  (isEastern ? 0.48 : 0.42) +
                  Math.cos(tSec * waveSpd - s * 0.42 + i) * (isEastern ? 0.24 : 0.12);
                seg.position.z = 2.25 - s * (isEastern ? 0.44 : 0.37);
              }

              if (!isEastern) {
                const flap = Math.sin(tSec * 8.5 + i) * 0.62;
                slot.dragonLeftWing.rotation.z = flap;
                slot.dragonRightWing.rotation.z = -flap;
              }
              slot.dragonHeadGrp.position.y = 0.95 + Math.sin(tSec * 7.5 + i) * 0.2;
              slot.dragonOrbsGrp.rotation.y = tSec * 3.2;
              if (i < 20) {
                spawnParticle({
                  x: sample.x + backX * 2.2 + (Math.random() - 0.5) * 1.8,
                  y: 2.2 + (Math.random() - 0.5) * 1.4,
                  z: sample.z + backZ * 2.2 + (Math.random() - 0.5) * 1.8,
                  vx: backX * 10 + (Math.random() - 0.5) * 2.5,
                  vy: 1.2 + Math.random() * 2,
                  vz: backZ * 10 + (Math.random() - 0.5) * 2.5,
                  life: 0.65,
                  size: 1.35,
                  grow: 1.5,
                  color: isEastern
                    ? Math.random() < 0.65
                      ? 0xfde047
                      : 0xf97316
                    : Math.random() < 0.6
                      ? 0x38bdf8
                      : 0xfacc15,
                });
                if (Math.random() < 0.5) {
                  spawnParticle({
                    x: sample.x + sample.tx * 5.2,
                    y: 3.1,
                    z: sample.z + sample.tz * 5.2,
                    vx: sample.tx * 9 + (Math.random() - 0.5) * 1.5,
                    vy: (Math.random() - 0.5) * 1.0,
                    vz: sample.tz * 9 + (Math.random() - 0.5) * 1.5,
                    life: 0.32,
                    size: 1.15,
                    grow: 1.4,
                    color: isEastern ? 0xef4444 : 0x38bdf8,
                  });
                }
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

          // Cập nhật hạt 3D
          for (let i = 0; i < MAX_PARTICLES; i++) {
            const p = particles[i];
            if (!p.active) continue;
            p.life -= dt;
            if (p.life <= 0) {
              p.active = false;
              p.sprite.visible = false;
              continue;
            }
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            const ratio = p.life / p.maxLife;
            p.sprite.position.set(p.x, Math.max(0.1, p.y), p.z);
            p.sprite.scale.setScalar(p.size * (1 + (1 - ratio) * p.grow));
            p.mat.opacity = ratio * (p.mat.blending === THREE.NormalBlending ? 0.5 : 0.95);
          }

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

          // Ánh sáng hào quang thực từ nhân vật chiếu tỏa ra nền đất & các vật thể lân cận khi đang Spotlight hoặc tăng tốc/bay!
          const isFocusLit =
            Boolean(focusRacerNow) &&
            (phase === 'racing' || phase === 'countdown') &&
            (focusBoost !== 'none' || isSpotlightActive);
          if (isFocusLit && focusRacerNow) {
            const fs = sampleCircuit(focusRacerNow.z, focusRacerNow.x);
            flashRoadLight.position.set(
              fs.x,
              focusBoost === 'superman' || focusBoost === 'dragon' ? 2.6 : 1.9,
              fs.z,
            );
            const litPhase = Math.floor(tSec * 2.4) % 3;
            flashRoadLight.color.setHex(
              focusBoost === 'dragon'
                ? 0xfde047
                : focusBoost === 'superman'
                  ? litPhase === 0
                    ? 0x22d3ee
                    : litPhase === 1
                      ? 0xfacc15
                      : 0xe879f9
                  : focusBoost === 'rocket'
                    ? 0xfb7185
                    : focusBoost === 'jetpack'
                      ? 0xfdba74
                      : 0xfef08a,
            );
            flashRoadLight.intensity =
              focusBoost === 'dragon' || focusBoost === 'superman'
                ? 7.2
                : isSpotlightActive
                  ? 5.8
                  : 4.5;
          } else {
            flashRoadLight.intensity = 0;
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
          windStreaksGroup.visible = showWind3D;
          if (showWind3D) {
            const boostMult =
              focusBoost === 'dragon'
                ? 2.2
                : focusBoost === 'rocket'
                  ? 1.9
                  : focusBoost === 'jetpack'
                    ? 1.5
                    : 1.15;
            windStreakMat.opacity =
              focusBoost === 'dragon' || focusBoost === 'rocket' ? 0.78 : 0.52;
            for (let ws = 0; ws < windStreaks.length; ws++) {
              const st = windStreaks[ws];
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
          skyDome.position.copy(camera.position);

          // Di chuyển nguồn sáng Mặt Trời & Shadow Camera bám sát nhân vật đang được quay để đổ bóng thật siêu sắc nét
          if (sunLight.castShadow) {
            sunLight.position.set(camPose.lookX + 32, 54, camPose.lookZ - 26);
            sunLight.target.position.set(camPose.lookX, 0, camPose.lookZ);
            sunLight.target.updateMatrixWorld();
          }

          const cw = container.clientWidth || 540;
          const ch = container.clientHeight || 960;
          renderer.setScissorTest(false);
          renderer.setViewport(0, 0, cw, ch);
          renderer.render(scene, camera);

          // ---------- Camera Drone Toàn Cảnh (Góc phải bên dưới - Picture-in-Picture) ----------
          if (droneCamOnRef.current && dronePipRef.current && phase !== 'podium') {
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

              // Tạm tắt skyDome (tránh bầu trời hồng/tím của map Thành Phố Về Đêm phủ lên góc Drone) và bật nền tối tự nhiên rõ nét
              const savedFog = scene.fog.density;
              const savedBg = scene.background;
              const isNightCity = getActiveMap().theme.sceneryType === 'city';
              const savedHemiInt = hemiLight.intensity;
              const savedHemiSky = hemiLight.color.getHex();
              const savedSunInt = sunLight.intensity;
              const savedExposure = renderer.toneMappingExposure;
              const savedBldgEmissive = buildingBodyMat.emissive.getHex();
              const savedBldgEmissiveInt = buildingBodyMat.emissiveIntensity;

              scene.fog.density = 0;
              skyDome.visible = false;
              scene.background = new THREE.Color(isNightCity ? 0x0b1120 : 0x1e293b);
              if (isNightCity) {
                hemiLight.intensity = 1.95;
                hemiLight.color.setHex(0xcbd5e1);
                sunLight.intensity = 1.75;
                renderer.toneMappingExposure = 1.35;
                buildingBodyMat.emissive.setHex(0x1e293b);
                buildingBodyMat.emissiveIntensity = 0.4;
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
              renderer.render(scene, droneCamera);
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
                buildingBodyMat.emissive.setHex(savedBldgEmissive);
                buildingBodyMat.emissiveIntensity = savedBldgEmissiveInt;
              }
              skyDome.visible = true;
              scene.background = savedBg;
              scene.fog.density = savedFog;
              skyDome.position.copy(camera.position);

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
          pmrem.dispose();
          envTex.dispose();
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
                className={`flex flex-col items-center rounded-2xl px-2 py-1.5 border-2 backdrop-blur-md shadow-[0_6px_22px_rgba(0,0,0,0.65)] ${
                  b.rank === 1
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
                  className={`rounded-full object-cover border-2 border-white shadow-lg bg-slate-800 ${
                    b.rank === 1 ? 'w-14 h-14' : 'w-11 h-11'
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
                  {b.petName && (
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-amber-300/95 text-slate-950 border border-yellow-100 shadow whitespace-nowrap">
                      🐾 {b.petName}
                    </span>
                  )}
                </div>
                <div
                  className={`flex items-center gap-1 pr-2 pl-0.5 py-0.5 rounded-full border backdrop-blur-sm shadow-md ${
                    b.rank === 1
                      ? 'bg-amber-400/95 border-yellow-100 text-slate-950 scale-105 shadow-[0_0_12px_rgba(251,191,36,0.75)]'
                      : b.rank === 2
                        ? 'bg-slate-200/95 border-white text-slate-900'
                        : b.rank === 3
                          ? 'bg-orange-400/95 border-orange-200 text-slate-950'
                          : 'bg-slate-950/80 border-white/30 text-white'
                  }`}
                >
                  <span
                    className={`px-1.5 py-[1px] rounded-full text-[10px] font-black leading-tight ${
                      b.rank === 1
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
                    className={`px-1 py-[1px] rounded text-[8.5px] font-black ${
                      b.rank <= 3 ? 'bg-black/20 text-slate-950' : 'bg-black/40 text-amber-300'
                    }`}
                  >
                    V{b.lap}
                  </span>
                </div>
                {/* Mũi tên nhỏ chỉ trực tiếp xuống đỉnh đầu nhân vật */}
                <div
                  className={`w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[5px] -mt-0.5 ${
                    b.rank === 1
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
          display: droneCamOn ? 'block' : 'none',
          left: `${droneRect.x}%`,
          top: `${droneRect.y}%`,
          width: `${droneRect.w}%`,
          height: `${droneRect.h}%`,
        }}
        className={`${
          canEditDrone ? 'pointer-events-auto cursor-move' : 'pointer-events-none'
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
                className={`flex items-center gap-1 px-1.5 py-[1.5px] rounded-full border shadow-md whitespace-nowrap ${
                  t.rank === 1
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
