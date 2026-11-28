import express from 'express';
import dotenv from 'dotenv';
import { createHostCommentary } from './hostCommentary.ts';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;
const HOST = process.env.HOST || '0.0.0.0';

// Cho phép tab Facebook Live / Extension gửi bình luận trực tiếp về /api/facebook/ingest và mở /api/facebook/bridge
const fbOriginOk = (origin?: string) => {
  if (!origin) return false;
  if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) return true;
  const host = origin.replace(/^https?:\/\//, '').replace(/:\d+$/, '').toLowerCase();
  return (
    host === 'facebook.com' ||
    host.endsWith('.facebook.com') ||
    host === 'fb.com' ||
    host.endsWith('.fb.com') ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === 'lvh.me'
  );
};

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    req.path.startsWith('/api/facebook/ingest') ||
    req.path.startsWith('/api/facebook/bridge') ||
    req.path.startsWith('/api/test/emit')
  ) {
    if (origin && fbOriginOk(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  next();
});

app.use(express.json({ limit: '512kb' }));

// ---------- Lưu trữ bền vững Hồ sơ Người chơi (Cấp độ, Điểm, Đặc điểm Nhân vật, Thú cưng VIP) ----------
export interface StoredUserProfile {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  platform: 'tiktok' | 'facebook';
  level: number;
  points: number;
  levelResetAt?: number;
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

const RAW_USERS_FILE = process.env.USERS_FILE || path.join(__dirname, 'data', 'users.json');
function resolveUsersFilePath(): string {
  try {
    if (fs.existsSync(RAW_USERS_FILE) && fs.statSync(RAW_USERS_FILE).isDirectory()) {
      return path.join(RAW_USERS_FILE, 'users.json');
    }
  } catch {}
  return RAW_USERS_FILE;
}

const hostCommentary = createHostCommentary(
  path.join(path.dirname(resolveUsersFilePath()), 'host-commentary.json'),
  {
    emitHostSpeech: (payload) => broadcastWs('hostReply', payload),
    emitAiReply: (record) => broadcastWs('aiReply', record),
    emitSettings: (viewData) => broadcastWs('hostSettings', viewData),
    emitAudienceState: (state) => broadcastWs('audienceState', state),
    emitClientFallbackTask: (task) => broadcastWs('aiClientTask', task),
    getLatestSnapshot: () => latestRaceSnapshot,
  },
);
app.use('/api/host', hostCommentary.router);
app.post('/api/npc/ai-reply', (req, res) => void hostCommentary.handleAiReplyHttp(req, res));
app.post('/api/npc/ai-broadcast', (req, res) => hostCommentary.handleAiBroadcastHttp(req, res));
app.get('/api/npc/chat-outbox', (_req, res) => res.json({ success: true, data: hostCommentary.chatOutbox() }));

let usersStore: Record<string, StoredUserProfile> = {};
const knownFollowers = new Set<string>();
try {
  const fp = resolveUsersFilePath();
  if (fs.existsSync(fp)) {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      usersStore = raw;
      for (const [uid, prof] of Object.entries(usersStore)) {
        if (prof?.isFollower) {
          knownFollowers.add(uid);
          if (prof.username) knownFollowers.add(prof.username);
        }
      }
    }
  }
} catch (err) {
  console.warn('Không đọc được data/users.json, khởi tạo mới:', err);
}

function markFollower(userId: string) {
  if (!userId || userId.startsWith('bot_')) return;
  knownFollowers.add(userId);
  const existing = usersStore[userId];
  if (existing && !existing.isFollower) {
    existing.isFollower = true;
    existing.updatedAt = Date.now();
    scheduleSaveUsers();
  }
}

let saveUsersTimer: ReturnType<typeof setTimeout> | null = null;
function writeUsersStore() {
  const filename = resolveUsersFilePath();
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(usersStore, null, 2), 'utf8');
  fs.renameSync(temporary, filename);
}

function scheduleSaveUsers() {
  if (saveUsersTimer) return;
  saveUsersTimer = setTimeout(() => {
    saveUsersTimer = null;
    try {
      writeUsersStore();
    } catch (err) {
      console.error('Không lưu được users.json:', err);
    }
  }, 600);
}

function computeLevel(points: number): number {
  return Math.max(1, 1 + Math.floor(Math.max(0, points) / 100));
}

function getSortedUsersList(): StoredUserProfile[] {
  return Object.values(usersStore).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.updatedAt - a.updatedAt;
  });
}

// ---------- Trạng thái kết nối TikTok LIVE & Facebook Live (giống npc-action-live) ----------
interface FacebookLiveStats {
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

interface LiveStatusState {
  connected: boolean;
  connecting: boolean;
  username: string;
  roomId: string;
  viewerCount: number;
  totalLikes: number;
  error: string;
  fb: FacebookLiveStats;
}

const emptyFbStats = (): FacebookLiveStats => ({
  isConnected: false,
  isConnecting: false,
  mode: '',
  videoId: '',
  pageName: '',
  viewerCount: 0,
  totalReactions: 0,
  commentsReceived: 0,
  error: '',
});

const emptyLiveStatus = (fb: FacebookLiveStats = emptyFbStats()): LiveStatusState => ({
  connected: false,
  connecting: false,
  username: '',
  roomId: '',
  viewerCount: fb.viewerCount,
  totalLikes: 0,
  error: '',
  fb,
});

let tiktokConn: InstanceType<typeof TikTokLiveConnection> | null = null;
let liveStatus: LiveStatusState = emptyLiveStatus();
let latestRaceSnapshot: Record<string, unknown> | null = null;
let latestStageHealth: Record<string, unknown> | null = null;

// ---------- SSE (/api/tiktok/events giống npc-action-live) + WebSocket (/ws) ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set<WebSocket>();
let sseClients: express.Response[] = [];
let eventSeq = 1;

server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/ws')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});

function broadcastWs(type: string, data: unknown) {
  const eid = eventSeq++;
  const ts = Date.now();
  const enriched =
    data && typeof data === 'object' && !Array.isArray(data)
      ? { ...(data as Record<string, unknown>), _eid: eid }
      : data;

  // 1) Đẩy qua SSE (/api/tiktok/events - tương thích 100% Nginx Proxy Manager / Cloudflare như npc-action-live)
  const ssePayload = `event: ${type}\ndata: ${JSON.stringify(enriched)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(ssePayload);
    } catch {}
  }

  // 2) Đẩy qua WebSocket (/ws)
  const wsPayload = JSON.stringify({ type, data: enriched, eid, ts });
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(wsPayload);
      } catch {}
    }
  }
}

function broadcastAudienceChat(data: Parameters<typeof hostCommentary.replyToComment>[0]) {
  broadcastWs('chat', data);
  if (sseClients.length || wsClients.size) void hostCommentary.replyToComment(data);
}

app.get('/api/tiktok/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Tắt bộ đệm trên Nginx Proxy Manager để sự kiện đẩy về tức thì
  res.flushHeaders?.();
  res.write(`event: status\ndata: ${JSON.stringify(liveStatus)}\n\n`);
  res.write(`event: users\ndata: ${JSON.stringify(getSortedUsersList())}\n\n`);
  res.write(`event: hostSettings\ndata: ${JSON.stringify(hostCommentary.view())}\n\n`);
  if (latestRaceSnapshot) {
    res.write(`event: raceSync\ndata: ${JSON.stringify(latestRaceSnapshot)}\n\n`);
  }
  if (
    latestStageHealth &&
    Date.now() - Number(latestStageHealth.timestamp || 0) < 5000
  ) {
    res.write(`event: stageHealth\ndata: ${JSON.stringify(latestStageHealth)}\n\n`);
  }
  sseClients.push(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter((c) => c !== res);
  });
});

wss.on('connection', (ws) => {
  wsClients.add(ws);
  try {
    ws.send(JSON.stringify({ type: 'status', data: liveStatus, ts: Date.now() }));
    ws.send(JSON.stringify({ type: 'users', data: getSortedUsersList(), ts: Date.now() }));
    ws.send(JSON.stringify({ type: 'hostSettings', data: hostCommentary.view(), ts: Date.now() }));
    if (latestRaceSnapshot) {
      ws.send(JSON.stringify({ type: 'raceSync', data: latestRaceSnapshot, ts: Date.now() }));
    }
    if (
      latestStageHealth &&
      Date.now() - Number(latestStageHealth.timestamp || 0) < 5000
    ) {
      ws.send(JSON.stringify({ type: 'stageHealth', data: latestStageHealth, ts: Date.now() }));
    }
  } catch {}
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg?.type === 'raceSync' && msg.data && typeof msg.data === 'object') {
        latestRaceSnapshot = msg.data;
        broadcastWs('raceSync', msg.data);
      } else if (msg?.type === 'stageHealth' && msg.data && typeof msg.data === 'object') {
        latestStageHealth = { ...msg.data, transport: 'server' };
        broadcastWs('stageHealth', latestStageHealth);
      } else if (msg?.type === 'ttsTestResult' && msg.data && typeof msg.data === 'object') {
        broadcastWs('ttsTestResult', msg.data);
      }
    } catch {}
  });
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

// Đồng bộ trạng thái cuộc đua 100% giữa Bảng Điều Khiển (/) và Màn Hình Live (/?view=stage)
app.post('/api/race/sync', (req, res) => {
  const snap = req.body;
  if (!snap || typeof snap !== 'object') {
    return res.status(400).json({ success: false });
  }
  latestRaceSnapshot = snap;
  broadcastWs('raceSync', snap);
  res.json({ success: true });
});

// Đồng bộ StageHealthMonitor qua server (hoạt động xuyên trình duyệt: Browser Source CEF <-> Chrome Dashboard)
app.post('/api/stage/health', (req, res) => {
  const snap = req.body;
  if (!snap || typeof snap !== 'object') {
    return res.status(400).json({ success: false });
  }
  latestStageHealth = { ...snap, transport: 'server' };
  broadcastWs('stageHealth', latestStageHealth);
  res.json({ success: true });
});

app.post('/api/stage/tts-test-result', (req, res) => {
  const result = req.body;
  if (!result || typeof result !== 'object') {
    return res.status(400).json({ success: false });
  }
  broadcastWs('ttsTestResult', result);
  res.json({ success: true });
});

app.get('/api/race/sync', (_req, res) => {
  res.json({ success: true, data: latestRaceSnapshot });
});

// ---------- API Health & Status ----------
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: Math.floor(process.uptime()),
    clients: wsClients.size + sseClients.length,
    savedUsers: Object.keys(usersStore).length,
    liveStatus,
  });
});

app.get('/api/tiktok/status', (_req, res) => {
  res.json({ success: true, data: liveStatus });
});

// ---------- API Quản lý Hồ sơ Người chơi Đã Lưu (/api/users) ----------
app.get('/api/users', (_req, res) => {
  res.json({
    success: true,
    data: getSortedUsersList(),
  });
});

app.post('/api/users/reset-level', hostCommentary.authorize, (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  if (!userId || !Object.hasOwn(usersStore, userId)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy hồ sơ tay đua.' });
  }
  const previous = usersStore[userId];
  const now = Date.now();
  const profile = { ...previous, points: 0, level: 1,
    petSpeedBonus: previous.petIdx == null ? 0 : previous.petSpeedBonus,
    levelResetAt: Math.max(now, (previous.levelResetAt || 0) + 1), updatedAt: now };
  usersStore[userId] = profile;
  try {
    writeUsersStore();
  } catch {
    usersStore[userId] = previous;
    return res.status(500).json({ success: false, error: 'Không lưu được cấp độ mới.' });
  }
  broadcastWs('users', getSortedUsersList());
  res.json({ success: true, data: profile });
});

app.post('/api/users/sync', (req, res) => {
  const rawList = Array.isArray(req.body?.users)
    ? req.body.users
    : req.body?.user
      ? [req.body.user]
      : [];
  let updated = 0;

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const userId = String(item.userId || item.username || '').trim();
    if (!userId || userId.startsWith('bot_')) continue;

    const existing = usersStore[userId];
    if (existing?.levelResetAt && item.levelResetAt !== existing.levelResetAt) continue;
    const points = Math.max(0, Number(item.points ?? existing?.points ?? 0));
    const level = computeLevel(points);
    const petIdx =
      typeof item.petIdx === 'number'
        ? item.petIdx
        : existing?.petIdx !== undefined
          ? existing.petIdx
          : null;
    const petName = String(item.petName || existing?.petName || '');
    const petSpeedBonus = Math.max(
      Number(item.petSpeedBonus ?? 0),
      Number(existing?.petSpeedBonus ?? 0),
    );

    usersStore[userId] = {
      userId,
      username: String(item.username || existing?.username || userId),
      nickname: String(item.nickname || existing?.nickname || userId),
      avatar:
        item.avatar && String(item.avatar).startsWith('http')
          ? String(item.avatar)
          : existing?.avatar && existing.avatar.startsWith('http')
            ? existing.avatar
            : String(item.avatar || existing?.avatar || ''),
      platform: item.platform === 'facebook' ? 'facebook' : existing?.platform || 'tiktok',
      level,
      points,
      levelResetAt: existing?.levelResetAt,
      wins: Math.max(0, Number(item.wins ?? existing?.wins ?? 0)),
      podiums: Math.max(0, Number(item.podiums ?? existing?.podiums ?? 0)),
      matches: Math.max(1, Number(item.matches ?? existing?.matches ?? 1)),
      totalCoins: Math.max(0, Number(item.totalCoins ?? existing?.totalCoins ?? 0)),
      characterIdx:
        typeof item.characterIdx === 'number'
          ? item.characterIdx
          : existing?.characterIdx ?? 0,
      shirtColor:
        typeof item.shirtColor === 'number'
          ? item.shirtColor
          : existing?.shirtColor ?? 0x3b82f6,
      pantsColor:
        typeof item.pantsColor === 'number'
          ? item.pantsColor
          : existing?.pantsColor ?? 0x1e293b,
      skinColor:
        typeof item.skinColor === 'number'
          ? item.skinColor
          : existing?.skinColor ?? 0xfde68a,
      hatColor:
        typeof item.hatColor === 'number'
          ? item.hatColor
          : existing?.hatColor ?? 0xfacc15,
      petIdx,
      petName,
      petSpeedBonus,
      isFollower: Boolean(item.isFollower || existing?.isFollower || knownFollowers.has(userId)),
      updatedAt: Date.now(),
    };
    if (usersStore[userId].isFollower) {
      knownFollowers.add(userId);
    }
    updated++;
  }

  if (updated > 0) {
    scheduleSaveUsers();
    broadcastWs('users', getSortedUsersList());
  }
  res.json({ success: true, updated, total: Object.keys(usersStore).length });
});

// ---------- Kết nối & Ngắt kết nối TikTok LIVE (proto v3 giống npc-action-live) ----------
const userOf = (data: any) =>
  String(
    data?.user?.displayId ||
      data?.user?.uniqueId ||
      data?.uniqueId ||
      data?.user?.userId ||
      data?.userId ||
      'viewer',
  );
const nickOf = (data: any) =>
  String(
    data?.user?.nickname ||
      data?.nickname ||
      data?.user?.displayId ||
      data?.user?.uniqueId ||
      data?.uniqueId ||
      'Tay đua',
  );
const avatarOf = (data: any) =>
  String(
    data?.user?.avatarThumb?.urlList?.[0] ||
      data?.user?.profilePicture?.url?.[0] ||
      data?.profilePictureUrl ||
      '',
  );
// Kiểm tra người xem đã Follow kênh chưa (từ TikTok proto v3 followInfo.followStatus >= 1 hoặc followRole >= 1 hoặc đã Follow trước đó)
const isFollowerOf = (data: any, username: string): boolean => {
  const status = Number(
    data?.user?.followInfo?.followStatus ??
      data?.followInfo?.followStatus ??
      data?.followRole ??
      0,
  );
  const followed = status >= 1 || Boolean(data?.isFollower) || knownFollowers.has(username);
  if (followed) markFollower(username);
  return followed;
};

app.post('/api/tiktok/connect', async (req, res) => {
  const cleanUser = String(req.body?.username || '')
    .replace(/^@+/, '')
    .trim();
  if (!cleanUser) {
    return res.status(400).json({ success: false, error: 'Chưa nhập username TikTok' });
  }

  if (tiktokConn) {
    try {
      tiktokConn.disconnect();
    } catch {}
    tiktokConn = null;
  }

  liveStatus = {
    ...emptyLiveStatus(liveStatus.fb),
    connecting: true,
    username: cleanUser,
  };
  broadcastWs('status', liveStatus);

  const conn = new TikTokLiveConnection(cleanUser, {
    processInitialData: true,
    enableExtendedGiftInfo: false,
  });

  conn.on(ControlEvent.CONNECTED, (state: any) => {
    console.log(`[TikTok] Đã kết nối @${cleanUser}, room ${state?.roomId}`);
    liveStatus = {
      ...liveStatus,
      connected: true,
      connecting: false,
      roomId: state?.roomId || '',
      error: '',
    };
    broadcastWs('status', liveStatus);

    // Tự động cho chủ phòng (@cleanUser) xuất hiện trên đường đua ngay khi kết nối thành công!
    const owner = state?.roomInfo?.owner || state?.roomInfo?.host;
    const hostNick = String(owner?.nickname || owner?.displayId || cleanUser);
    const hostAvatar = String(
      owner?.avatarThumb?.urlList?.[0] ||
        owner?.profilePicture?.url?.[0] ||
        '',
    );
    markFollower(cleanUser);
    broadcastWs('member', {
      userId: cleanUser,
      username: cleanUser,
      nickname: hostNick,
      avatar: hostAvatar,
      isFollower: true,
      isHost: true,
      platform: 'tiktok',
      timestamp: Date.now(),
    });
  });

  conn.on(ControlEvent.DISCONNECTED, () => {
    console.log(`[TikTok] Mất kết nối @${cleanUser}`);
    liveStatus = { ...liveStatus, connected: false, connecting: false };
    broadcastWs('status', liveStatus);
  });

  conn.on(WebcastEvent.STREAM_END, () => {
    liveStatus = {
      ...liveStatus,
      connected: false,
      connecting: false,
      error: 'Phiên live đã kết thúc',
    };
    broadcastWs('status', liveStatus);
  });

  conn.on(WebcastEvent.CHAT, (data: any) => {
    const username = userOf(data);
    const isFollower = isFollowerOf(data, username);
    broadcastAudienceChat({
      userId: username,
      username,
      nickname: nickOf(data),
      comment: String(data?.content || data?.comment || '').trim(),
      avatar: avatarOf(data),
      isFollower,
      platform: 'tiktok',
      timestamp: Date.now(),
    });
  });

  // TikTok gửi lại quà combo với repeatCount cộng dồn; chỉ chuyển phần mới giống npc-action-live
  const streakCounts = new Map<string, number>();
  conn.on(WebcastEvent.GIFT, (data: any) => {
    const username = userOf(data);
    const giftId = data?.giftId || 0;
    const key = `${username}_${giftId}`;
    const total = Math.max(1, Number(data?.repeatCount || 1));
    const delta = total - (streakCounts.get(key) || 0);
    const isStreakable =
      (data?.gift?.type ?? data?.giftDetails?.giftType ?? data?.giftType) === 1;
    if (isStreakable && !data?.repeatEnd) streakCounts.set(key, total);
    else streakCounts.delete(key);
    if (delta <= 0) return;

    const diamondCount = Math.max(
      1,
      Number(
        data?.gift?.diamondCount ||
          data?.diamondCount ||
          data?.giftDetails?.diamondCount ||
          1,
      ),
    );
    broadcastWs('gift', {
      userId: username,
      username,
      nickname: nickOf(data),
      giftName:
        data?.gift?.name || data?.giftDetails?.giftName || data?.giftName || 'Quà tặng',
      giftId,
      diamondCount,
      repeatCount: delta,
      totalCoins: diamondCount * delta,
      coins: diamondCount * delta,
      avatar: avatarOf(data),
      platform: 'tiktok',
      timestamp: Date.now(),
    });
  });

  conn.on(WebcastEvent.MEMBER, (data: any) => {
    const username = userOf(data);
    const isFollower = isFollowerOf(data, username);
    broadcastWs('member', {
      userId: username,
      username,
      nickname: nickOf(data),
      avatar: avatarOf(data),
      isFollower,
      platform: 'tiktok',
      timestamp: Date.now(),
    });
  });

  conn.on(WebcastEvent.FOLLOW, (data: any) => {
    const username = userOf(data);
    markFollower(username);
    broadcastWs('follow', {
      userId: username,
      username,
      nickname: nickOf(data),
      avatar: avatarOf(data),
      isFollower: true,
      platform: 'tiktok',
      timestamp: Date.now(),
    });
  });

  conn.on(WebcastEvent.SHARE, (data: any) => {
    const username = userOf(data);
    broadcastWs('share', {
      userId: username,
      username,
      nickname: nickOf(data),
      avatar: avatarOf(data),
      platform: 'tiktok',
      timestamp: Date.now(),
    });
  });

  conn.on(WebcastEvent.ROOM_USER, (data: any) => {
    if (typeof data?.viewerCount === 'number') {
      liveStatus.viewerCount = data.viewerCount;
      broadcastWs('status', liveStatus);
    }
  });

  conn.on(WebcastEvent.LIKE, (data: any) => {
    if (typeof data?.totalLikeCount === 'number') {
      liveStatus.totalLikes = data.totalLikeCount;
    }
    const username = userOf(data);
    broadcastWs('like', {
      userId: username,
      username,
      nickname: nickOf(data),
      avatar: avatarOf(data),
      likeCount: Math.max(1, Number(data?.likeCount || 1)),
      totalLikes: liveStatus.totalLikes,
      platform: 'tiktok',
    });
  });

  conn.on(ControlEvent.ERROR, (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[TikTok] Lỗi @${cleanUser}:`, msg);
    liveStatus.error = msg;
    broadcastWs('status', liveStatus);
  });

  tiktokConn = conn;

  try {
    const live = await conn.fetchIsLive().catch(() => true);
    if (!live) {
      throw new Error(
        'TikTok báo tài khoản này CHƯA LIVE. Bấm Phát trực tiếp trong LIVE Studio trước rồi mới kết nối',
      );
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const state = await Promise.race([
      conn.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Quá 30 giây không vào được phòng live')),
          30_000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    return res.json({ success: true, roomId: state?.roomId, data: liveStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (tiktokConn === conn) {
      try {
        conn.disconnect();
      } catch {}
      tiktokConn = null;
      liveStatus = {
        ...liveStatus,
        connected: false,
        connecting: false,
        error: msg,
      };
      broadcastWs('status', liveStatus);
    }
    return res.status(400).json({
      success: false,
      error: `Không kết nối được @${cleanUser}: ${msg}`,
    });
  }
});

app.post('/api/tiktok/disconnect', (_req, res) => {
  if (tiktokConn) {
    try {
      tiktokConn.disconnect();
    } catch {}
    tiktokConn = null;
  }
  liveStatus = emptyLiveStatus(liveStatus.fb);
  broadcastWs('status', liveStatus);
  res.json({ success: true, data: liveStatus });
});

// ---------- Kết nối Facebook Live (Graph API + Cầu nối Trình duyệt trực tiếp giống npc-action-live) ----------
let fbPollTimer: ReturnType<typeof setInterval> | null = null;
const seenFbCommentIds = new Set<string>();

function extractFbVideoId(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{6,25}$/.test(s)) return s;
  const patterns = [
    /[?&]v=(\d{6,25})/i,
    /\/videos\/(?:[^/]+\/)?(\d{6,25})/i,
    /\/reel\/(\d{6,25})/i,
    /\/live\/?\?v=(\d{6,25})/i,
    /story_fbid=(\d{6,25})/i,
    /\/posts\/(\d{6,25})/i,
    /(\d{8,25})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) return m[1];
  }
  return s.slice(0, 80);
}

function stopFacebookLive() {
  if (fbPollTimer) {
    clearInterval(fbPollTimer);
    fbPollTimer = null;
  }
}

function normalizeFbUserId(rawUsername?: string, nickname?: string): string {
  const cleanUser = String(rawUsername || '').trim();
  if (cleanUser && cleanUser !== 'fb_reaction') return cleanUser;
  const cleanNick = String(nickname || '').trim();
  if (!cleanNick || cleanNick === 'Khán giả Facebook' || cleanNick === 'Khán giả FB') {
    return cleanUser || 'fb_reaction';
  }
  const slug = cleanNick
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
  return slug ? `fb_${slug}` : 'fb_user';
}

function parseFbStarsAndGift(opts: {
  text?: string;
  stars?: number;
  coins?: number;
  giftName?: string;
  attachmentType?: string;
  attachmentTitle?: string;
}): { coins: number; giftName: string; isStickerLike: boolean } {
  const rawText = `${opts.text || ''} ${opts.attachmentTitle || ''}`.trim();
  const explicitCoins = Math.max(Number(opts.stars) || 0, Number(opts.coins) || 0);
  if (explicitCoins > 0) {
    return {
      coins: explicitCoins,
      giftName: opts.giftName || (Number(opts.stars) > 0 ? `⭐ ${explicitCoins} Sao Facebook` : '🎁 Quà Facebook'),
      isStickerLike: false,
    };
  }

  // 1) Nhận diện tặng Sao Facebook (hỗ trợ cả dấu chấm/phẩy phân tách hàng nghìn: 100 sao, 1.000 sao, ⭐ 50, sent 75 stars...)
  const starMatch =
    rawText.match(
      /(?:đã gửi|vừa gửi|gửi tặng|đã tặng|tặng|ủng hộ|sent|gifted)\s+(\d[\d.,]*)\s*(?:sao|stars?|⭐)/i,
    ) ||
    rawText.match(/⭐\s*(\d[\d.,]*)\s*(?:sao|stars?)?/i) ||
    rawText.match(/\b(\d[\d.,]*)\s*(?:sao|stars?)\s*⭐/i) ||
    rawText.match(/^(\d{1,6})\s*(?:sao|stars?)$/i);

  if (starMatch?.[1]) {
    const parsed = parseInt(starMatch[1].replace(/[.,]/g, ''), 10);
    if (parsed > 0 && parsed <= 1_000_000) {
      return { coins: parsed, giftName: `⭐ ${parsed} Sao Facebook`, isStickerLike: false };
    }
  }

  // 2) Nhận diện Quà Ảo Facebook Live (Virtual Gifts / Paid Gifts: "đã gửi một phần quà", "đã tặng quà", "sent a gift"...)
  const giftActionMatch =
    /(?:đã gửi|vừa gửi|đã tặng|gửi tặng)\s+(?:một\s+)?(?:phần quà|món quà|quà tặng|quà\b|siêu sao|vương miện|rồng|tên lửa|hoa hồng)/i.test(
      rawText,
    ) ||
    /\b(?:sent a gift|sent a virtual gift|gifted a|virtual_gift)\b/i.test(rawText) ||
    Boolean(opts.giftName);

  if (giftActionMatch) {
    const lower = `${opts.giftName || ''} ${rawText}`.toLowerCase();
    let inferredCoins = 25; // Mặc định quà Facebook bật Tên Lửa
    let gName = opts.giftName || '🎁 Quà Facebook Live';
    if (/rồng|dragon|vương miện|crown|siêu xe|lâu đài|du thuyền|vip/i.test(lower)) {
      inferredCoins = 120;
      gName = opts.giftName || '🐉 Quà VIP Facebook';
    } else if (/siêu nhân|superman|pháo hoa|kim cương|diamond/i.test(lower)) {
      inferredCoins = 60;
      gName = opts.giftName || '🦸 Siêu Quà Facebook';
    } else if (/tên lửa|rocket|lửa|fire|xe đua/i.test(lower)) {
      inferredCoins = 25;
      gName = opts.giftName || '🚀 Tên Lửa Facebook';
    } else if (/hoa|rose|tim|heart|cà phê|coffee/i.test(lower)) {
      inferredCoins = 8;
      gName = opts.giftName || '🌹 Quà Tặng Facebook';
    }
    return { coins: inferredCoins, giftName: gName, isStickerLike: false };
  }

  // 3) Nhận diện Nhãn dán Cảm xúc / Thả Tim / Like (Sticker Like/Heart không kèm chữ trên Facebook Live)
  const attType = String(opts.attachmentType || '').toLowerCase();
  const isSticker = attType.includes('sticker') || attType.includes('animated_image');
  const isHeartOrLikeText =
    /^(?:[❤️♥️💖💗💓💘💝💞💕❣️😍🥰👍🔥👏🎉✨\s]+|thả tim|tha tim|tim+|like+|thích)$/iu.test(
      String(opts.text || '').trim(),
    );

  return {
    coins: 0,
    giftName: '',
    isStickerLike: isSticker || (Boolean(opts.text?.trim()) && isHeartOrLikeText),
  };
}

function handleFbComment(item: {
  id?: string;
  username?: string;
  nickname?: string;
  comment?: string;
  avatar?: string;
  stars?: number;
  coins?: number;
  giftName?: string;
  isLike?: boolean;
  likeCount?: number;
  attachmentType?: string;
  attachmentTitle?: string;
}) {
  const commentText = String(item.comment || '').trim();
  const nickname =
    String(item.nickname || 'Khán giả Facebook').trim() || 'Khán giả Facebook';
  const username = normalizeFbUserId(item.username, nickname);

  const parsedGift = parseFbStarsAndGift({
    text: commentText,
    stars: item.stars,
    coins: item.coins,
    giftName: item.giftName,
    attachmentType: item.attachmentType,
    attachmentTitle: item.attachmentTitle,
  });

  const isLikeAction = Boolean(item.isLike) || parsedGift.isStickerLike;
  if (!commentText && parsedGift.coins <= 0 && !isLikeAction) return false;

  const dedupKey =
    item.id ||
    `${username}:${commentText}:${parsedGift.coins}:${isLikeAction ? 'L' : ''}:${Math.floor(Date.now() / 2500)}`;
  if (seenFbCommentIds.has(dedupKey)) return false;
  seenFbCommentIds.add(dedupKey);
  if (seenFbCommentIds.size > 2500) {
    const first = seenFbCommentIds.values().next().value;
    if (first) seenFbCommentIds.delete(first);
  }

  const avatar =
    item.avatar ||
    (/^\d+$/.test(username)
      ? `https://graph.facebook.com/${username}/picture?type=normal`
      : '');

  if (commentText || (isLikeAction && parsedGift.coins <= 0)) {
    liveStatus.fb.commentsReceived += 1;
    broadcastAudienceChat({
      userId: username,
      username,
      nickname,
      comment: commentText || '❤️',
      avatar,
      isFollower: true,
      platform: 'facebook',
      timestamp: Date.now(),
    });
  }

  if (isLikeAction) {
    const likeDelta = Math.max(1, Number(item.likeCount) || 3);
    liveStatus.fb.totalReactions += likeDelta;
    liveStatus.totalLikes += likeDelta;
    broadcastWs('like', {
      userId: username,
      username,
      nickname,
      avatar,
      likeCount: likeDelta,
      totalLikes: liveStatus.totalLikes,
      platform: 'facebook',
      timestamp: Date.now(),
    });
  }

  if (parsedGift.coins > 0) {
    broadcastWs('gift', {
      userId: username,
      username,
      nickname,
      giftName: parsedGift.giftName,
      giftId: 9901,
      diamondCount: parsedGift.coins,
      repeatCount: 1,
      totalCoins: parsedGift.coins,
      coins: parsedGift.coins,
      avatar,
      platform: 'facebook',
      timestamp: Date.now(),
    });
  }

  broadcastWs('status', liveStatus);
  return true;
}

app.get('/api/facebook/status', (_req, res) =>
  res.json({ success: true, data: liveStatus.fb }),
);

function parseEmbeddedFbComments(html: string, isInitial: boolean) {
  if (!html || !html.includes('"body"')) return;
  const re =
    /"author"\s*:\s*\{[^{}]*"name"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*\}[^{}]*"body"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const nickname = JSON.parse(`"${m[1]}"`);
      const comment = JSON.parse(`"${m[2]}"`);
      const key = `bg_${nickname}|${comment}`;
      if (isInitial) {
        seenFbCommentIds.add(key);
      } else {
        handleFbComment({ id: key, nickname, comment });
      }
    } catch {}
  }
}

app.post('/api/facebook/launch-auto-browser', (req, res) => {
  if (process.platform !== 'win32') {
    return res.json({
      success: false,
      inDocker: true,
      message:
        'Server đang chạy trong Docker. Hãy nhấp đúp file MO-FACEBOOK-TU-DONG.bat ngoài thư mục dự án (hoặc tải & cài tiện ích tools/fb-live-extension 1 lần vào Chrome/Edge).',
    });
  }
  const targetUrl = String(
    req.body?.url || 'https://www.facebook.com/watch/live/',
  ).trim();
  const batPath = path.join(__dirname, 'MO-FACEBOOK-TU-DONG.bat');
  try {
    spawn('cmd', ['/c', 'start', '', batPath, targetUrl], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/facebook/connect', async (req, res) => {
  const rawInput = String(req.body?.videoId || '').trim();
  const token = String(
    req.body?.accessToken || process.env.FB_ACCESS_TOKEN || '',
  ).trim();
  const cookie = String(req.body?.cookie || process.env.FB_COOKIE || '').trim();
  const reqMode = req.body?.mode === 'bridge' || !token ? 'bridge' : 'graph';
  const cleanVid = extractFbVideoId(rawInput) || 'fb-live';

  stopFacebookLive();
  seenFbCommentIds.clear();

  // Chế độ 1: Tự động chạy ngầm (Cầu nối trình duyệt + Extension ngầm - Không cần Token)
  if (reqMode === 'bridge') {
    liveStatus.fb = {
      isConnected: true,
      isConnecting: false,
      mode: 'bridge',
      videoId: cleanVid,
      pageName: rawInput ? `FB Live (${cleanVid})` : 'Cầu nối Trình duyệt FB',
      viewerCount: 0,
      totalReactions: 0,
      commentsReceived: 0,
      error: '',
    };
    broadcastWs('status', liveStatus);
    console.log(`[Facebook Live] Đã bật chế độ Cầu nối Trình duyệt cho ${cleanVid}`);

    if (/^\d{6,25}$/.test(cleanVid)) {
      const watchUrl = `https://www.facebook.com/watch/live/?v=${cleanVid}`;
      const headers: Record<string, string> = {
        'User-Agent': cookie
          ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          : 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
      };
      if (cookie) headers.Cookie = cookie;

      let firstScan = true;
      const pollPublicPage = async () => {
        try {
          const r = await fetch(watchUrl, { headers });
          if (r.ok) {
            const html = await r.text();
            parseEmbeddedFbComments(html, firstScan);
            firstScan = false;
          }
        } catch {}
      };
      void pollPublicPage();
      fbPollTimer = setInterval(pollPublicPage, 3500);
    }

    return res.json({ success: true, mode: 'bridge', videoId: cleanVid, data: liveStatus });
  }

  // Chế độ 2: Facebook Graph API (Video ID + Access Token)
  if (!cleanVid || cleanVid === 'fb-live') {
    return res.status(400).json({
      success: false,
      error: 'Vui lòng nhập Link hoặc Video ID buổi phát trực tiếp Facebook',
    });
  }

  liveStatus.fb = {
    ...emptyFbStats(),
    isConnecting: true,
    mode: 'graph',
    videoId: cleanVid,
  };
  broadcastWs('status', liveStatus);

  try {
    const metaUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(cleanVid)}?fields=id,title,description,live_views,from{id,name},reactions.summary(total_count)&access_token=${encodeURIComponent(token)}`;
    const metaRes = await fetch(metaUrl);
    const metaData: any = await metaRes.json();

    if (metaData?.error) {
      throw new Error(metaData.error.message || 'Token hoặc Video ID không hợp lệ');
    }

    const pageName =
      metaData?.from?.name || metaData?.title || `Video ${cleanVid}`;
    const initViews = Number(metaData?.live_views) || 0;
    const initReactions = Number(metaData?.reactions?.summary?.total_count) || 0;

    liveStatus.fb = {
      isConnected: true,
      isConnecting: false,
      mode: 'graph',
      videoId: cleanVid,
      pageName,
      viewerCount: initViews,
      totalReactions: initReactions,
      commentsReceived: 0,
      error: '',
    };
    if (!liveStatus.connected) liveStatus.viewerCount = initViews;
    broadcastWs('status', liveStatus);
    console.log(`[Facebook Live] Đã kết nối Graph API: ${pageName} (${cleanVid})`);

    try {
      const initCommentsUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(cleanVid)}/comments?fields=id,from{id,name,picture.type(normal)},message,created_time&filter=stream&order=reverse_chronological&limit=25&access_token=${encodeURIComponent(token)}`;
      const cRes = await fetch(initCommentsUrl);
      const cData: any = await cRes.json();
      if (Array.isArray(cData?.data)) {
        const now = Date.now();
        for (const c of cData.data) {
          const created = c?.created_time ? new Date(c.created_time).getTime() : 0;
          if (now - created > 15000 && c?.id) {
            seenFbCommentIds.add(c.id);
          }
        }
      }
    } catch {}

    let tickCount = 0;
    fbPollTimer = setInterval(async () => {
      tickCount++;
      try {
        const cUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(cleanVid)}/comments?fields=id,from{id,name,picture.type(normal)},message,attachment{type,title,description},created_time&filter=stream&order=reverse_chronological&limit=20&access_token=${encodeURIComponent(token)}`;
        const r = await fetch(cUrl);
        const d: any = await r.json();
        if (d?.error) {
          liveStatus.fb.error = d.error.message;
          broadcastWs('status', liveStatus);
          return;
        }
        if (Array.isArray(d?.data) && d.data.length > 0) {
          const items = [...d.data].reverse();
          for (const c of items) {
            if (!c?.id || seenFbCommentIds.has(c.id)) continue;
            handleFbComment({
              id: c.id,
              username: c.from?.id,
              nickname: c.from?.name || 'Khán giả FB',
              comment: c.message || '',
              avatar: c.from?.picture?.data?.url || '',
              attachmentType: c.attachment?.type || '',
              attachmentTitle:
                `${c.attachment?.title || ''} ${c.attachment?.description || ''}`.trim(),
            });
          }
        }

        const vUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(cleanVid)}?fields=live_views,reactions.summary(total_count)&access_token=${encodeURIComponent(token)}`;
        const vr = await fetch(vUrl);
        const vd: any = await vr.json();
        if (!vd?.error) {
          if (typeof vd?.live_views === 'number') {
            liveStatus.fb.viewerCount = vd.live_views;
            if (!liveStatus.connected) liveStatus.viewerCount = vd.live_views;
          }
          const newReactions = vd?.reactions?.summary?.total_count;
          if (
            typeof newReactions === 'number' &&
            newReactions > liveStatus.fb.totalReactions
          ) {
            const delta = newReactions - liveStatus.fb.totalReactions;
            liveStatus.fb.totalReactions = newReactions;
            liveStatus.totalLikes += delta;
            broadcastWs('like', {
              userId: 'fb_reaction',
              username: 'fb_reaction',
              nickname: 'Khán giả Facebook',
              likeCount: delta,
              totalLikes: liveStatus.totalLikes,
              platform: 'facebook',
              timestamp: Date.now(),
            });
          }
          if (tickCount % 2 === 0) {
            broadcastWs('status', liveStatus);
          }
        }
      } catch (pollErr) {
        console.warn(
          '[Facebook Live] Lỗi poll:',
          pollErr instanceof Error ? pollErr.message : pollErr,
        );
      }
    }, 2000);

    return res.json({
      success: true,
      mode: 'graph',
      videoId: cleanVid,
      pageName,
      data: liveStatus,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stopFacebookLive();
    liveStatus.fb = {
      ...emptyFbStats(),
      videoId: cleanVid,
      error: msg,
    };
    broadcastWs('status', liveStatus);
    return res.status(400).json({
      success: false,
      error: `Không kết nối được Facebook Graph API: ${msg}. Bạn có thể chuyển sang chế độ "Cầu nối Trình duyệt (Không cần Token)"!`,
    });
  }
});

app.post('/api/facebook/disconnect', (_req, res) => {
  stopFacebookLive();
  liveStatus.fb = emptyFbStats();
  broadcastWs('status', liveStatus);
  res.json({ success: true, data: liveStatus });
});

function processFbIngestPayload(body: any) {
  if (!body || typeof body !== 'object') return 0;
  if (!liveStatus.fb.isConnected) {
    liveStatus.fb = {
      ...liveStatus.fb,
      isConnected: true,
      isConnecting: false,
      mode: 'bridge',
      videoId: body.videoId || liveStatus.fb.videoId || 'fb-browser',
      pageName:
        body.pageName || liveStatus.fb.pageName || 'Facebook Live (Trình duyệt)',
      error: '',
    };
  }
  let count = 0;
  const hasSingleEvent = Boolean(
    body.comment ||
      Number(body.stars) > 0 ||
      Number(body.coins) > 0 ||
      body.giftName ||
      body.isLike,
  );
  const list = Array.isArray(body.comments)
    ? body.comments
    : hasSingleEvent
      ? [body]
      : [];
  for (const item of list) {
    if (handleFbComment(item)) count++;
  }
  if (Array.isArray(body.gifts)) {
    for (const g of body.gifts) {
      if (handleFbComment(g)) count++;
    }
  }
  if (typeof body.likes === 'number' && body.likes > 0) {
    const delta = Math.min(500, Math.round(body.likes));
    liveStatus.fb.totalReactions += delta;
    liveStatus.totalLikes += delta;
    const likeUserId = normalizeFbUserId(body.username, body.nickname);
    broadcastWs('like', {
      userId: likeUserId,
      username: likeUserId,
      nickname: body.nickname || 'Khán giả Facebook',
      avatar: body.avatar || '',
      likeCount: delta,
      totalLikes: liveStatus.totalLikes,
      platform: 'facebook',
      timestamp: Date.now(),
    });
    count++;
  }
  if (typeof body.viewerCount === 'number' && body.viewerCount >= 0) {
    liveStatus.fb.viewerCount = body.viewerCount;
    if (!liveStatus.connected) liveStatus.viewerCount = body.viewerCount;
  }
  broadcastWs('status', liveStatus);
  return count;
}

app.post(
  '/api/facebook/ingest',
  express.text({ type: '*/*', limit: '256kb' }),
  (req, res) => {
    try {
      const body =
        typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const processed = processFbIngestPayload(body);
      res.json({ success: true, processed });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Bad payload',
      });
    }
  },
);

app.get('/api/facebook/ingest', (req, res) => {
  try {
    const raw = String(req.query.d || '');
    if (raw) {
      const body = JSON.parse(raw);
      processFbIngestPayload(body);
    }
  } catch {}
  const gif1x1 = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64',
  );
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store');
  res.send(gif1x1);
});

app.get('/api/facebook/bridge', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Cầu nối Facebook Live - Đấu Trường Đua Tốc Độ 3D (Action Race Live)</title>
  <style>
    body {
      margin: 0;
      padding: 16px;
      background: #091326;
      color: #f8fafc;
      font: 14px/1.5 system-ui, -apple-system, sans-serif;
    }
    .box {
      border: 1.5px solid #38bdf8;
      background: linear-gradient(135deg, #0f172a, #1e3a8a);
      border-radius: 14px;
      padding: 14px 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    h3 { margin: 0 0 6px; font-size: 15px; color: #38bdf8; }
    .stat { font-size: 13px; color: #cbd5e1; }
    .last {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(0,0,0,0.35);
      font-size: 12px;
      color: #fde047;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .note { margin-top: 8px; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="box">
    <h3>🟢 Cầu nối Facebook Live đang hoạt động</h3>
    <div class="stat">Đã chuyển tiếp: <b id="cnt" style="color:#4ade80;font-size:16px">0</b> bình luận về Đường Đua 3D</div>
    <div class="last" id="last">Đang lắng nghe bình luận từ tab Facebook Live...</div>
    <div class="note">💡 Giữ nguyên cửa sổ nhỏ này (có thể thu nhỏ xuống thanh tác vụ) trong suốt buổi Live.</div>
  </div>
  <script>
    let total = 0;
    const cntEl = document.getElementById('cnt');
    const lastEl = document.getElementById('last');

    function notifyOpener() {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'VN_FB_BRIDGE_READY', total }, '*');
        }
      } catch (e) {}
    }
    notifyOpener();
    setInterval(notifyOpener, 2000);

    fetch('/api/facebook/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'bridge', videoId: 'fb-bridge-popup' }),
    }).catch(() => {});

    window.addEventListener('message', async (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object' || d.type !== 'FB_LIVE_INGEST' || !d.payload) return;
      try {
        const r = await fetch('/api/facebook/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(d.payload),
        });
        const j = await r.json();
        total += (j.processed || 1);
        cntEl.textContent = String(total);
        const c = d.payload.comments && d.payload.comments[0];
        if (c && (c.stars || c.coins || c.giftName)) {
          lastEl.textContent = '⭐ ' + (c.nickname || 'Khán giả') + ' tặng ' + (c.giftName || ((c.stars || c.coins) + ' Sao'));
        } else if (c) {
          lastEl.textContent = '💬 ' + (c.nickname || 'Khán giả') + ': ' + (c.comment || '❤️');
        } else if (d.payload.likes) {
          lastEl.textContent = '❤️ +' + d.payload.likes + ' lượt thả tim / like Facebook!';
        }
        if (e.source) {
          e.source.postMessage({ type: 'VN_FB_BRIDGE_ACK', total }, '*');
        }
      } catch (err) {
        lastEl.textContent = '⚠️ Lỗi gửi về server: ' + err;
      }
    });
  </script>
</body>
</html>`);
});

// Tạo file .zip chuẩn ngay trong bộ nhớ để tải Chrome Extension từ Dashboard (giống npc-action-live)
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZipArchive(files: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const compressed = zlib.deflateRawSync(f.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(f.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(f.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralSize = centralParts.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

app.get('/api/extension/download', (req, res) => {
  try {
    const proto =
      (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ||
      req.protocol ||
      'http';
    const host =
      (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() ||
      req.get('host') ||
      `localhost:${PORT}`;
    const serverOrigin = `${proto}://${host}`;

    const extDir = path.join(process.cwd(), 'tools', 'fb-live-extension');
    const fileNames = [
      'manifest.json',
      'background.js',
      'content.js',
      'interceptor.js',
    ];
    const files: Array<{ name: string; data: Buffer }> = [];
    for (const fn of fileNames) {
      const fp = path.join(extDir, fn);
      if (fs.existsSync(fp)) {
        let text = fs.readFileSync(fp, 'utf8');
        if (fn === 'manifest.json' && !text.includes(serverOrigin)) {
          try {
            const mObj = JSON.parse(text);
            mObj.host_permissions = Array.from(
              new Set([
                ...(mObj.host_permissions || []),
                `${serverOrigin}/*`,
                'https://*.anfloral.com.vn/*',
              ]),
            );
            text = JSON.stringify(mObj, null, 2);
          } catch {}
        }
        if (fn === 'background.js') {
          text = text.replace(
            /const DEFAULT_SERVER = '[^']+';/,
            `const DEFAULT_SERVER = '${serverOrigin}';`,
          );
          if (!text.includes(`'${serverOrigin}'`)) {
            text = text.replace(
              'const SERVERS_TO_POLL = [',
              `const SERVERS_TO_POLL = [\n  '${serverOrigin}',`,
            );
          }
        }
        files.push({
          name: `action-race-live-extension/${fn}`,
          data: Buffer.from(text, 'utf8'),
        });
      }
    }
    if (!files.length) {
      return res
        .status(404)
        .send('Không tìm thấy thư mục tools/fb-live-extension');
    }
    const zipBuf = buildZipArchive(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="action-race-live-extension.zip"',
    );
    res.send(zipBuf);
  } catch (err: any) {
    res.status(500).send(err?.message || 'Lỗi đóng gói Extension');
  }
});

// ---------- API Giả lập sự kiện (Mock Mode) ----------
app.post('/api/test/emit', (req, res) => {
  const { type, data } = req.body || {};
  if (!['chat', 'like', 'gift', 'member', 'follow', 'share'].includes(type)) {
    return res
      .status(400)
      .json({ success: false, error: 'Loại sự kiện không hợp lệ' });
  }
  const event = { timestamp: Date.now(), avatar: '', ...(data || {}) };
  if (type === 'like') {
    liveStatus.totalLikes += Number(event.likeCount) || 1;
    event.totalLikes = liveStatus.totalLikes;
  }
  if (type === 'chat') {
    broadcastAudienceChat(event);
  } else {
    broadcastWs(type, event);
  }
  res.json({ success: true, clients: wsClients.size });
});

// ---------- API Đồng bộ điều khiển từ Bảng Điều Khiển (/) sang Chế Độ Live (/?view=stage) ----------
app.post('/api/control', (req, res) => {
  const { action, value } = req.body || {};
  if (!action) {
    return res.status(400).json({ success: false, error: 'Thiếu action' });
  }
  broadcastWs('control', { action: String(action), value });
  res.json({ success: true, clients: wsClients.size });
});

// ---------- Edge TTS Bình luận viên Tiếng Việt (+ Google TTS Fallback giống npc-action-live) ----------
const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function googleTtsFallback(text: string): Promise<Buffer> {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(text.slice(0, 190))}`;
  const r = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://translate.google.com/',
    },
  });
  if (!r.ok) throw new Error(`Google TTS lỗi ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const ttsCache = new Map<string, Buffer>();
function cacheTts(key: string, audio: Buffer) {
  if (ttsCache.size >= 160) ttsCache.delete(ttsCache.keys().next().value!);
  ttsCache.set(key, audio);
}

app.get('/api/tts', async (req, res) => {
  const text = String(req.query.text || '').trim().slice(0, 320);
  const voiceParam = String(req.query.voice || '').toLowerCase();
  const voiceMode = hostCommentary.voice();
  const voiceName =
    voiceMode === 'male' || (voiceMode !== 'female' && (voiceParam === 'm' || voiceParam === 'namminh'))
      ? 'vi-VN-NamMinhNeural'
      : voiceMode === 'female' || voiceParam === 'f' || voiceParam === 'hoaimy'
        ? 'vi-VN-HoaiMyNeural'
        : String(process.env.TTS_VOICE || 'vi-VN-NamMinhNeural');
  const hype = req.query.hype === '1';
  if (!text) return res.status(400).end();
  res.setHeader('Cache-Control', 'no-store');

  const customVoiceId = hostCommentary.voiceId();
  if (customVoiceId) {
    const key = `custom|${customVoiceId}|${text}`;
    const customAudio = ttsCache.get(key) || await hostCommentary.synthesize(text, customVoiceId);
    if (customAudio) {
      if (!ttsCache.has(key)) cacheTts(key, customAudio);
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.send(customAudio);
    }
    res.setHeader('X-Race-Voice', 'fallback');
  }

  const cacheKey = `${voiceName}|${hype ? '1' : '0'}|${text}`;
  const cached = ttsCache.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'audio/mpeg');
    return res.send(cached);
  }

  try {
    let buf: Buffer;
    try {
      const tts = new MsEdgeTTS();
      try {
        await tts.setMetadata(
          voiceName,
          OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
        );
        const { audioStream } = tts.toStream(escapeXml(text), {
          rate: hype ? '+20%' : '+15%',
          pitch: hype ? '+4%' : '+2%',
          volume: hype ? '+45%' : '+30%',
        });
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          audioStream.on('data', (c: Buffer) => chunks.push(c));
          audioStream.on('end', () => resolve());
          audioStream.on('error', reject);
        });
        buf = Buffer.concat(chunks);
      } finally {
        tts.close();
      }
    } catch {
      buf = await googleTtsFallback(text);
    }

    cacheTts(cacheKey, buf);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buf);
  } catch {
    res.status(502).end();
  }
});

// ---------- Vite Middleware (Dev) hoặc Static Dist (Prod) ----------
async function startServer() {
  const distDir = path.join(__dirname, 'dist');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, HOST, () => {
    console.log(
      `🏁 Đấu Trường Đua Tốc Độ 3D — Action Race Live đang chạy tại http://${HOST}:${PORT}`,
    );
  });
}

void startServer();
