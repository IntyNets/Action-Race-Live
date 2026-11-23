import { getLapLength } from './trackCurve';

export type MatchPhase = 'lobby' | 'racing' | 'countdown' | 'podium';

export type BoostKind = 'none' | 'join' | 'chat' | 'sprint' | 'jetpack' | 'rocket' | 'superman' | 'dragon';

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface DroneRect {
  /** Phần trăm từ mép trái khung 9:16 (0..80) */
  x: number;
  /** Phần trăm từ mép trên khung 9:16 (0..80) */
  y: number;
  /** Chiều rộng theo % khung 9:16 (18..68) */
  w: number;
  /** Chiều cao theo % khung 9:16 (14..50) */
  h: number;
}

export interface UserProfile {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  platform: 'tiktok' | 'facebook';
  level: number;
  points: number;
  wins: number;
  podiums: number;
  matches: number;
  totalCoins: number;
  characterIdx: number;
  shirtColor: number;
  pantsColor: number;
  skinColor: number;
  hatColor: number;
  petIdx: number | null;
  petName: string;
  petSpeedBonus: number;
  isFollower?: boolean;
  updatedAt: number;
}

export interface RacerState {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  platform?: 'tiktok' | 'facebook';
  isBot?: boolean;
  /** Cấp độ nhân vật tích lũy của người chơi (Lv.1+) */
  level: number;
  /** Điểm kinh nghiệm / tích lũy của người chơi */
  points: number;
  /** Số lần vô địc
  wins: number;
  /** Tổng số trận đã tham gia */
  matches: number;
  /** Chỉ số nhân vật người chơi NotBlox (0: Character.glb, 1: MiniCharacter.glb) */
  characterIdx: number;
  /** Chỉ số thú cưng VIP ngẫu nhiên đi theo (null nếu chưa có thú cưng) */
  petIdx: number | null;
  /** Tên hiển thị của thú cưng VIP (vd: '🐱 Mèo', '🐺 Sói Con') */
  petName: string;
  /** Phần trăm tăng tốc cộng thêm khi dẫn thú cưng VIP (vd: 0.18 = +18% tốc độ) */
  petSpeedBonus: number;
  /** Tổng quãng đường đã chạy dọc đường đua khép kín (0 -> LAP_LENGTH * totalLaps) */
  z: number;
  /** Vòng đua hiện tại (1..totalLaps) */
  lap: number;
  /** Vị trí lệch ngang so với tâm đường đua (-TRACK_HALF_W -> +TRACK_HALF_W) */
  x: number;
  targetX: number;
  /** Tốc độ cơ bản (m/s) */
  baseSpeed: number;
  /** Tốc độ hiện tại (m/s) */
  speed: number;
  /** Màu sắc đặc trưng (viền hào quang, mũ, trang phục dự phòng) */
  shirtColor: number;
  pantsColor: number;
  skinColor: number;
  hatColor: number;
  /** Năng lượng thả tim tích lũy */
  likeEnergy: number;
  /** Cooldown bình luận (2 giây/người) */
  lastChatBoostAt: number;
  /** Thời điểm tương tác gần nhất (ưu tiên render trong giới hạn 60 nhân vật) */
  lastInteractAt: number;
  /** Hiệu ứng tăng tốc đang kích hoạt */
  boost: BoostKind;
  boostUntil: number;
  boostLabel: string;
  /** Thời điểm hoàn thành đủ số vòng (null nếu chưa về đích) */
  finishedAt: number | null;
  /** Thứ hạng hiện tại (1-based) */
  rank: number;
  /** Tổng số xu đã tặng trong trận */
  coinsSpent: number;
}

export interface MinimapDot {
  id: string;
  x: number;
  y: number;
  rank: number;
  isTop1: boolean;
  isSpotlight?: boolean;
  color: string;
}

export interface SpectatorInfo {
  id: string;
  nickname: string;
  avatar: string;
  shirtColor: number;
  joinedAt: number;
}

export interface VipBannerEvent {
  id: number;
  nickname: string;
  avatar: string;
  giftName: string;
  coins: number;
  tier: 'jetpack' | 'rocket' | 'superman' | 'dragon';
}

export interface FacebookLiveStats {
  isConnected: boolean;
  isConnecting: boolean;
  mode: 'graph' | 'bridge' | '';
  videoId: string;
  pageName: string;
  viewerCount: number;
  totalReactions: number;
  commentsReceived: number;
  error?: string;
}

export interface LiveStatus {
  connected: boolean;
  connecting: boolean;
  username: string;
  roomId?: string;
  viewerCount: number;
  totalLikes?: number;
  error: string;
  fb?: FacebookLiveStats;
}

export const RACE_CONSTANTS = {
  /** Chiều dài 1 vòng của map đang chọn (m) */
  get LAP_LENGTH(): number {
    return getLapLength();
  },
  DEFAULT_LAPS: 3, // Mặc định chạy 3 vòng
  TRACK_WIDTH: 22,
  LOBBY_SECONDS: 15,
  MAX_RACE_SECONDS: 300,
  FINISH_COUNTDOWN_SECONDS: 5,
  PODIUM_SECONDS: 10,
  MAX_RENDERED_RACERS: 60, // Tối ưu giữ 60 FPS ổn định cùng OBS
  MAX_GLB_RACERS: 24, // Top 24 tay đua dùng trực tiếp nhân vật & thú cưng 3D GLB từ iErcann/NotBlox
  CHAT_COOLDOWN_MS: 2000,
  LIKE_SPRINT_THRESHOLD: 3, // Tích đủ 3 tim -> kích hoạt Sprint 2s
  JOIN_BOOST_MS: 3600, // Tăng tốc nhẹ 3.6 giây cho người mới vào giữa trận lấy cảm hứng
} as const;
