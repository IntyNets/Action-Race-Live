import express, { type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type VoiceMode = 'duo' | 'male' | 'female' | 'custom';
export type McStyle = 'esports' | 'humorous' | 'lively' | 'warm';

export interface HostSettingsDisk {
  aiEnabled: boolean;
  aiRaceEnabled: boolean;
  mcStyle: McStyle;
  autoCopyReply: boolean;
  voice: VoiceMode;
  voiceId: string;
  groqKey: string;
  geminiKey: string;
  openrouterKey: string;
  pollinationsKey: string;
  elevenKey: string;
}

export interface AiReplyRecord {
  id: number;
  userName: string;
  question: string;
  reply: string;
  provider: string;
  kind: 'chat' | 'race';
  platform: 'tiktok' | 'facebook';
  at: number;
}

type AudienceComment = {
  userId?: string;
  username?: string;
  nickname?: string;
  comment?: string;
  platform?: string;
  isFollower?: boolean;
  [field: string]: unknown;
};

export interface GenerateRaceAiParams {
  mode?: 'chat' | 'race';
  eventKind?: 'overtake' | 'play_by_play' | 'podium' | 'final_lap' | 'gift' | 'lobby';
  userName?: string;
  question: string;
  raceContext?: string;
  mcStyle?: string;
  geminiKey?: string;
  groqKey?: string;
  openrouterKey?: string;
  pollinationsKey?: string;
}

const voiceIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const voiceModes = new Set<VoiceMode>(['duo', 'male', 'female', 'custom']);
const mcStyles = new Set<McStyle>(['esports', 'humorous', 'lively', 'warm']);
const sampleTypes: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
};

const MAP_LABELS: Record<string, string> = {
  classic: 'Đường Đua Huyền Thoại',
  desert: 'Sa Mạc Rực Lửa',
  jungle: 'Rừng Nhiệt Đới',
  city: 'Thành Phố Đêm Neon',
};

const BOOST_LABELS: Record<string, string> = {
  sprint: 'Tia Sét Plasma Xanh',
  chat: 'Bứt Tốc Bình Luận',
  jetpack: 'Động Cơ Phản Lực Jetpack',
  rocket: 'Tên Lửa Siêu Thanh',
  superman: 'Siêu Nhân Bất Tử',
  dragon: 'Rồng Thần Hologram VIP',
};

function maskSecret(val: string, envVal: string): { configured: boolean; fromEnv: boolean; preview: string } {
  const clean = (val || '').trim();
  if (clean) {
    const pre = clean.length > 8 ? `${clean.slice(0, 4)}••••${clean.slice(-4)}` : '••••••••';
    return { configured: true, fromEnv: false, preview: pre };
  }
  const envClean = (envVal || '').trim();
  if (envClean) {
    return { configured: true, fromEnv: true, preview: 'Đã cấu hình sẵn (.env)' };
  }
  return { configured: false, fromEnv: false, preview: '' };
}

function cleanAiText(raw: string, maxLen = 280): string {
  return raw
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*#_`~"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// Cache danh sách model Groq đang bật trên từng API key trong 10 phút (giống npc-action-live)
const groqModelCache = new Map<string, { models: string[]; at: number }>();

async function getAvailableGroqModels(key: string): Promise<string[]> {
  const cached = groqModelCache.get(key);
  if (cached && Date.now() - cached.at < 600_000) return cached.models;

  const defaults = [
    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant',
  ];

  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return defaults;
    const data: any = await r.json().catch(() => null);
    const ids: string[] = (Array.isArray(data?.data) ? data.data : [])
      .filter((m: any) => m?.active !== false && typeof m?.id === 'string')
      .map((m: any) => m.id as string)
      .filter((id: string) => !/(whisper|tts|guard|safeguard|orpheus|embed|playai)/i.test(id));
    if (!ids.length) return [];
    const rank = (id: string) => {
      if (/llama-3\.3-70b/i.test(id)) return 1;
      if (/gpt-oss-120b/i.test(id)) return 2;
      if (/llama-4|maverick|scout/i.test(id)) return 3;
      if (/qwen|deepseek/i.test(id)) return 4;
      if (/gpt-oss-20b/i.test(id)) return 5;
      if (/70b|32b/i.test(id)) return 6;
      if (/llama-3\.1-8b/i.test(id)) return 7;
      return 8;
    };
    ids.sort((a, b) => rank(a) - rank(b));
    groqModelCache.set(key, { models: ids, at: Date.now() });
    return ids;
  } catch {
    return defaults;
  }
}

async function fetchQuickRealtimeHint(question: string): Promise<string | null> {
  if (!/(thời tiết|mấy giờ|ngày mấy|hôm nay|giá vàng|tỷ giá|tin tức|ai là|năm nào|\?)/iu.test(question)) {
    return null;
  }
  if (!/(giá|thời tiết|tin tức|mới nhất|hiện nay|tổng thống|vô địch|tỷ số)/iu.test(question)) {
    return null;
  }
  try {
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(question)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    const html = await r.text();
    const snippets: string[] = [];
    const re = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && snippets.length < 3) {
      const text = m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 15) snippets.push(text);
    }
    return snippets.length ? `THÔNG TIN THỰC TẾ MỚI NHẤT:\n- ${snippets.join('\n- ')}` : null;
  } catch {
    return null;
  }
}

export function summarizeRaceSnapshot(snap: any, targetUser?: { userId?: string; nickname?: string }): string {
  if (!snap || typeof snap !== 'object') return '';
  const mapName = MAP_LABELS[String(snap.mapId || '')] || 'Đường Đua 3D';
  const phase = String(snap.phase || 'lobby');
  const totalLaps = Number(snap.totalLaps || 3);
  const matchNo = Number(snap.matchNo || 1);
  const racers: any[] = Array.isArray(snap.racers) ? [...snap.racers] : [];
  racers.sort((a, b) => (Number(a.rank) || 99) - (Number(b.rank) || 99));

  const phaseVi =
    phase === 'racing'
      ? `Đang đua gay cấn (Vòng ${racers[0]?.lap || 1}/${totalLaps})`
      : phase === 'countdown'
        ? 'Nước rút 5 giây cuối tranh Top 3'
        : phase === 'podium'
          ? 'Đang vinh danh Bục Chiến Thắng Top 3'
          : 'Phòng chờ xuất phát';

  const top3 = racers
    .slice(0, 3)
    .map((r, idx) => {
      const bst = r.boost && r.boost !== 'none' ? ` [${BOOST_LABELS[r.boost] || r.boost}]` : '';
      const pet = r.petName ? ` (Pet ${r.petName})` : '';
      return `Top ${idx + 1}: ${r.nickname} Lv.${r.level || 1}${pet}${bst}`;
    })
    .join('; ');

  const gap12 =
    racers[0] && racers[1] ? Math.max(1, Math.round(Math.abs(Number(racers[0].z || 0) - Number(racers[1].z || 0)))) : 0;

  let viewerStatus = '';
  if (targetUser?.userId || targetUser?.nickname) {
    const lowNick = String(targetUser.nickname || '').trim().toLowerCase();
    const found = racers.find(
      (r) =>
        (targetUser.userId && r.id === targetUser.userId) ||
        (lowNick && String(r.nickname || '').trim().toLowerCase() === lowNick),
    );
    if (found) {
      viewerStatus = `Khán giả "${found.nickname}" ĐANG TRÊN ĐƯỜNG ĐUA ở Hạng ${found.rank}/${racers.length} (Lv.${found.level || 1}, thắng ${found.wins || 0} trận${found.petName ? `, thú cưng ${found.petName}` : ''}).`;
    } else {
      viewerStatus = `Khán giả "${targetUser.nickname}" chưa có nhân vật trong ván #${matchNo} (nhắc nhẹ bấm Follow hoặc nhắn 1 tin để nhảy vào đua).`;
    }
  }

  return [
    `Bối cảnh ván đua #${matchNo} tại bản đồ "${mapName}": ${phaseVi}, tổng ${racers.length} tay đua.`,
    top3 ? `Dẫn đầu hiện tại: ${top3}${gap12 ? ` (Top 1 cách Top 2 khoảng ${gap12}m)` : ''}.` : '',
    viewerStatus,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface HostBroadcastCallbacks {
  emitHostSpeech: (payload: { text: string; priority?: boolean; kind?: 'normal' | 'event' | 'phase' | 'gift'; provider?: string }) => void;
  emitAiReply: (record: AiReplyRecord) => void;
  emitSettings: (viewData: Record<string, unknown>) => void;
  emitClientFallbackTask: (task: {
    userName: string;
    question: string;
    raceContext: string;
    mcStyle: McStyle;
    mode: 'chat' | 'race';
    platform: 'tiktok' | 'facebook';
  }) => void;
  getLatestSnapshot: () => any;
}

export function createHostCommentary(settingsFile: string, cb: HostBroadcastCallbacks) {
  const controlToken = process.env.RACE_HOST_TOKEN?.trim() || '';
  const envGroq = process.env.GROQ_API_KEY?.trim() || '';
  const envGemini = process.env.GEMINI_API_KEY?.trim() || '';
  const envOpenrouter = process.env.OPENROUTER_API_KEY?.trim() || '';
  const envPollinations = process.env.POLLINATIONS_API_KEY?.trim() || '';
  const envOpenai = process.env.OPENAI_API_KEY?.trim() || '';
  const envCerebras = process.env.CEREBRAS_API_KEY?.trim() || '';
  const envEleven = process.env.ELEVENLABS_API_KEY?.trim() || '';

  let settings: HostSettingsDisk = {
    aiEnabled: true,
    aiRaceEnabled: true,
    mcStyle: 'esports',
    autoCopyReply: false,
    voice: 'duo',
    voiceId: '',
    groqKey: '',
    geminiKey: '',
    openrouterKey: '',
    pollinationsKey: '',
    elevenKey: '',
  };

  try {
    const disk = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    settings = {
      aiEnabled: typeof disk.aiEnabled === 'boolean' ? disk.aiEnabled : true,
      aiRaceEnabled: typeof disk.aiRaceEnabled === 'boolean' ? disk.aiRaceEnabled : true,
      mcStyle: mcStyles.has(disk.mcStyle) ? disk.mcStyle : 'esports',
      autoCopyReply: Boolean(disk.autoCopyReply),
      voice: voiceModes.has(disk.voice) ? disk.voice : 'duo',
      voiceId: typeof disk.voiceId === 'string' && voiceIdPattern.test(disk.voiceId) ? disk.voiceId : '',
      groqKey: typeof disk.groqKey === 'string' ? disk.groqKey.trim() : '',
      geminiKey: typeof disk.geminiKey === 'string' ? disk.geminiKey.trim() : '',
      openrouterKey: typeof disk.openrouterKey === 'string' ? disk.openrouterKey.trim() : '',
      pollinationsKey: typeof disk.pollinationsKey === 'string' ? disk.pollinationsKey.trim() : '',
      elevenKey: typeof disk.elevenKey === 'string' ? disk.elevenKey.trim() : '',
    };
  } catch {
    /* Khởi tạo mặc định khi phòng thuê mới chưa có file cài đặt */
  }

  const recentAiHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const recentReplies: AiReplyRecord[] = [];
  const recentChatOutbox: Array<{
    id: number;
    userName: string;
    reply: string;
    platform: 'tiktok' | 'facebook';
    at: number;
  }> = [];

  function pushReplyRecord(record: AiReplyRecord) {
    recentReplies.unshift(record);
    if (recentReplies.length > 25) recentReplies.length = 25;
    if (record.kind === 'chat') {
      recentChatOutbox.unshift({
        id: record.id,
        userName: record.userName,
        reply: record.reply,
        platform: record.platform,
        at: record.at,
      });
      if (recentChatOutbox.length > 30) recentChatOutbox.length = 30;
    }
    cb.emitAiReply(record);
  }

  function activeElevenKey(): string {
    return settings.elevenKey || envEleven;
  }

  function view() {
    const groqInfo = maskSecret(settings.groqKey, envGroq);
    const geminiInfo = maskSecret(settings.geminiKey, envGemini);
    const orInfo = maskSecret(settings.openrouterKey, envOpenrouter);
    const pollInfo = maskSecret(settings.pollinationsKey, envPollinations);
    const elevenInfo = maskSecret(settings.elevenKey, envEleven);

    return {
      aiEnabled: settings.aiEnabled,
      aiRaceEnabled: settings.aiRaceEnabled,
      mcStyle: settings.mcStyle,
      autoCopyReply: settings.autoCopyReply,
      voice: settings.voice,
      voiceId: settings.voiceId,
      // Luôn sẵn sàng vì đã có Pollinations Free + Puter GPT-4o miễn phí không cần key
      aiAvailable: true,
      customVoiceAvailable: Boolean(activeElevenKey()),
      protected: controlToken.length >= 16,
      providers: {
        groq: groqInfo,
        gemini: geminiInfo,
        openrouter: orInfo,
        pollinations: pollInfo,
        elevenlabs: elevenInfo,
        freeBuiltIn: true,
      },
      recentReplies: recentReplies.slice(0, 8),
    };
  }

  function save(next: HostSettingsDisk) {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    const temporary = `${settingsFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, settingsFile);
    settings = next;
    const v = view();
    cb.emitSettings(v);
    return v;
  }

  function authorize(req: Request, res: Response, next: NextFunction) {
    const expected = Buffer.from(`Bearer ${controlToken}`);
    const supplied = Buffer.from(req.get('Authorization') || '');
    if (controlToken.length >= 16 && (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))) {
      res.status(401).json({ success: false, error: 'Khóa điều khiển MC không đúng.' });
      return;
    }
    next();
  }

  function buildStylePrompt(style: McStyle): string {
    switch (style) {
      case 'humorous':
        return 'Phong cách: BLV Giải Trí Lầy Lội Chuẩn Douyin — bình luận cực kỳ hài hước, duyên dáng, bắt trend trẻ trung, trêu đùa vui vẻ những pha vượt mặt, lật kèo và khích lệ khán giả thả tim phục thù.';
      case 'lively':
        return 'Phong cách: Hoạt Náo Viên Đại Tiệc Đua Top — năng lượng bùng nổ, hào hứng, khuấy động không khí liên tục, cổ vũ khán giả thả tim bật Tia Sét và tung Tên Lửa / Rồng Thần.';
      case 'warm':
        return 'Phong cách: MC Giao Lưu Thân Thiện & Xem Vía Đường Đua — ấm áp, gần gũi, khích lệ từng tay đua, ai hỏi vận may/bói vui/chấm điểm tên thì phán tích cực 9.5–10 điểm may mắn trên đường đua.';
      default:
        return 'Phong cách: Bình Luận Viên Thể Thao Tốc Độ (Esports Caster) — kịch tính, gãy gọn, giàu cảm xúc như bình luận chung kết F1, nhấn mạnh khoảng cách, cú bứt tốc và màn rượt đuổi sát nút.';
    }
  }

  async function generateAiCommentary(params: GenerateRaceAiParams): Promise<{
    reply: string;
    provider: string;
    needClientFallback?: boolean;
    errorDetail?: string;
  }> {
    const mode = params.mode === 'race' ? 'race' : 'chat';
    const userName = String(params.userName || 'Tay đua').trim().slice(0, 40) || 'Tay đua';
    const question = String(params.question || '').trim().slice(0, 320);
    const style: McStyle = mcStyles.has(params.mcStyle as McStyle) ? (params.mcStyle as McStyle) : settings.mcStyle;
    const errors: string[] = [];

    const nowVn = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date());

    const raceCtx = params.raceContext || summarizeRaceSnapshot(cb.getLatestSnapshot(), mode === 'chat' ? { nickname: userName } : undefined);
    const webHint = mode === 'chat' ? await fetchQuickRealtimeHint(question) : null;

    const sysPrompt =
      mode === 'race'
        ? [
            'Bạn là Bình Luận Viên trực tiếp của game Đấu Trường Đua Tốc Độ 3D trên livestream.',
            buildStylePrompt(style),
            raceCtx ? `Trạng thái thực tế trên đường đua ngay lúc này: ${raceCtx}` : '',
            'Quy tắc bắt buộc:',
            '1. Viết ĐÚNG 1 đến 2 câu bình luận tiếng Việt tự nhiên, sống động, giàu hình ảnh để đọc thành tiếng ngay lập tức (tối đa 42 từ).',
            '2. Bám sát đúng tên tay đua, khoảng cách, vòng đua và hiệu ứng tăng tốc trong dữ liệu được cung cấp; KHÔNG bịa tên người lạ, KHÔNG lặp khuôn mẫu nhàm chán.',
            '3. Không dùng ký tự markdown (*, #, **, ngoặc kép), không đọc emoji hay URL.',
          ]
            .filter(Boolean)
            .join('\n')
        : [
            'Bạn là MC & Bình Luận Viên AI thông minh của phòng live Đấu Trường Đua Tốc Độ 3D.',
            `Thời gian hiện tại ở Việt Nam: ${nowVn}.`,
            buildStylePrompt(style),
            raceCtx ? `Tình hình đường đua hiện tại: ${raceCtx}` : '',
            webHint || '',
            'Luật chơi nhanh: Bấm Follow kênh là vào đua ngay (ai đã Follow chỉ cần nhắn 1 tin bất kỳ); chạm thả tim kích hoạt Tia Sét Plasma xanh; tặng quà bật Jetpack, Tên Lửa, Siêu Nhân hoặc cưỡi Rồng Thần Hologram.',
            'Quy tắc trả lời:',
            `1. Trả lời trực tiếp, tự nhiên và thông minh cho "${userName}" bằng tiếng Việt dễ đọc thành tiếng trong 1-2 câu gọn gàng (tối đa 48 từ). Chỉ gọi tên "${userName}" 1 lần.`,
            '2. Nếu khán giả đang có mặt trên đường đua, hãy khéo léo nhắc tới thứ hạng hoặc cổ vũ họ bứt tốc. Nếu họ hỏi kiến thức thực tế hoặc xem bói/vận may/chấm điểm tên, hãy trả lời chính xác hoặc phán vui vẻ 9.5-10 điểm may mắn.',
            '3. Không dùng markdown (*, #, **), không đọc URL hay lời tiêu cực.',
          ]
            .filter(Boolean)
            .join('\n');

    const userPrompt =
      mode === 'race'
        ? `Diễn biến vừa xảy ra cần bình luận ngay: ${question}`
        : `${userName} bình luận trên live: "${question}"`;

    const maxLen = mode === 'race' ? 230 : 260;
    const temp = mode === 'race' ? 0.78 : 0.55;

    const pushHist = (reply: string) => {
      recentAiHistory.push({ role: 'user', content: userPrompt }, { role: 'assistant', content: reply });
      if (recentAiHistory.length > 8) recentAiHistory.splice(0, 2);
    };

    // 1. Groq Free Tier (tự động chọn model nhanh & thông minh nhất đang mở trên Key)
    const grKey = (params.groqKey || settings.groqKey || envGroq).trim();
    if (grKey) {
      const models = await getAvailableGroqModels(grKey);
      if (models.length === 0) {
        errors.push('Groq Key chưa bật model chat trên console.groq.com');
      }
      const ordered = mode === 'race' ? [...models].sort((a, b) => (/8b|20b|scout/i.test(a) ? -1 : /8b|20b|scout/i.test(b) ? 1 : 0)) : models;
      for (const groqModel of ordered.slice(0, 3)) {
        const useSearch = mode === 'chat' && Boolean(webHint) && /gpt-oss/i.test(groqModel);
        const attempts = useSearch ? [true, false] : [false];
        for (const withTool of attempts) {
          try {
            const bodyObj: Record<string, unknown> = {
              model: groqModel,
              messages: [
                { role: 'system', content: sysPrompt },
                ...recentAiHistory.slice(-4),
                { role: 'user', content: userPrompt },
              ],
              max_tokens: 180,
              temperature: temp,
            };
            if (withTool) {
              bodyObj.tools = [{ type: 'browser_search' }];
              bodyObj.tool_choice = 'auto';
            }
            const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${grKey}`,
              },
              body: JSON.stringify(bodyObj),
              signal: AbortSignal.timeout(mode === 'race' ? 3500 : 6500),
            });
            if (r.ok) {
              const data: any = await r.json();
              const raw = data?.choices?.[0]?.message?.content?.trim();
              if (raw) {
                const reply = cleanAiText(raw, maxLen);
                if (reply) {
                  pushHist(reply);
                  return { reply, provider: `Groq (${groqModel.split('/').pop()})` };
                }
              }
            } else {
              const errBody = await r.text().catch(() => '');
              if (withTool && r.status === 400) continue;
              errors.push(`Groq(${groqModel}) HTTP ${r.status}: ${errBody.slice(0, 90)}`);
              break;
            }
          } catch (err: any) {
            errors.push(`Groq(${groqModel}): ${err?.message || 'timeout'}`);
            break;
          }
        }
      }
    }

    // 2. Google Gemini Free Tier (gemini-2.0-flash / gemini-2.5-flash)
    const gKey = (params.geminiKey || settings.geminiKey || envGemini).trim();
    if (gKey) {
      for (const gemModel of ['gemini-2.0-flash', 'gemini-2.5-flash']) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${gemModel}:generateContent?key=${encodeURIComponent(gKey)}`;
          const payload: Record<string, unknown> = {
            systemInstruction: { parts: [{ text: sysPrompt }] },
            contents: [
              ...recentAiHistory.slice(-4).map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
              })),
              { role: 'user', parts: [{ text: userPrompt }] },
            ],
            generationConfig: { maxOutputTokens: 200, temperature: temp },
          };
          if (mode === 'chat' && webHint) {
            payload.tools = [{ google_search: {} }];
          }
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(mode === 'race' ? 4000 : 7500),
          });
          if (r.ok) {
            const data: any = await r.json();
            const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (raw) {
              const reply = cleanAiText(raw, maxLen);
              if (reply) {
                pushHist(reply);
                return { reply, provider: gemModel === 'gemini-2.5-flash' ? 'Gemini 2.5' : 'Gemini 2.0' };
              }
            }
          } else {
            errors.push(`${gemModel} HTTP ${r.status}`);
          }
        } catch (err: any) {
          errors.push(`${gemModel}: ${err?.message || 'timeout'}`);
        }
      }
    }

    // 3. OpenRouter Free Router (openrouter/free — tự định tuyến sang các model miễn phí tốt nhất)
    const orKey = (params.openrouterKey || settings.openrouterKey || envOpenrouter).trim();
    if (orKey) {
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${orKey}`,
          },
          body: JSON.stringify({
            model: 'openrouter/free',
            messages: [
              { role: 'system', content: sysPrompt },
              ...recentAiHistory.slice(-4),
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 180,
            temperature: temp,
          }),
          signal: AbortSignal.timeout(mode === 'race' ? 4500 : 7500),
        });
        if (r.ok) {
          const data: any = await r.json();
          const raw = data?.choices?.[0]?.message?.content?.trim();
          if (raw) {
            const reply = cleanAiText(raw, maxLen);
            if (reply) {
              pushHist(reply);
              return { reply, provider: 'OpenRouter Free' };
            }
          }
        } else {
          errors.push(`OpenRouter HTTP ${r.status}`);
        }
      } catch (err: any) {
        errors.push(`OpenRouter: ${err?.message || 'timeout'}`);
      }
    }

    // 4. Cerebras / OpenAI (nếu có cấu hình trong .env)
    if (envCerebras) {
      try {
        const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${envCerebras}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b',
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 180,
            temperature: temp,
          }),
          signal: AbortSignal.timeout(4000),
        });
        if (r.ok) {
          const data: any = await r.json();
          const reply = cleanAiText(data?.choices?.[0]?.message?.content || '', maxLen);
          if (reply) {
            pushHist(reply);
            return { reply, provider: 'Cerebras Llama-70B' };
          }
        }
      } catch {}
    }

    if (envOpenai) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${envOpenai}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: sysPrompt },
              ...recentAiHistory.slice(-4),
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 180,
            temperature: temp,
          }),
          signal: AbortSignal.timeout(5500),
        });
        if (r.ok) {
          const data: any = await r.json();
          const reply = cleanAiText(data?.choices?.[0]?.message?.content || '', maxLen);
          if (reply) {
            pushHist(reply);
            return { reply, provider: 'ChatGPT' };
          }
        }
      } catch {}
    }

    // 5. Pollinations Free AI (MIỄN PHÍ KHÔNG CẦN API KEY — giống bên npc-action-live!)
    const pKey = (params.pollinationsKey || settings.pollinationsKey || envPollinations).trim();
    const pollEndpoints = pKey
      ? ['https://gen.pollinations.ai/v1/chat/completions', 'https://text.pollinations.ai/openai']
      : ['https://text.pollinations.ai/openai'];
    for (const endpoint of pollEndpoints) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (pKey && endpoint.includes('gen.pollinations.ai')) {
          headers.Authorization = `Bearer ${pKey}`;
        }
        const r = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: 'openai',
            messages: [
              { role: 'system', content: sysPrompt },
              ...recentAiHistory.slice(-2),
              { role: 'user', content: userPrompt },
            ],
            temperature: temp,
            max_tokens: 180,
          }),
          signal: AbortSignal.timeout(mode === 'race' ? 3200 : 4800),
        });
        if (r.ok) {
          const contentType = r.headers.get('content-type') || '';
          let text = '';
          if (contentType.includes('application/json')) {
            const data: any = await r.json().catch(() => null);
            text = data?.choices?.[0]?.message?.content || '';
          } else {
            text = await r.text().catch(() => '');
          }
          const reply = cleanAiText(text, maxLen);
          if (reply && reply.length >= 6) {
            pushHist(reply);
            return { reply, provider: pKey ? 'Pollinations Pro' : 'Pollinations Free' };
          }
        }
      } catch {
        // Chuyển sang Puter GPT-4o-mini miễn phí trên trình duyệt
      }
    }

    const errorDetail = errors.length ? errors.join(' | ') : undefined;
    return {
      reply:
        mode === 'race'
          ? ''
          : `Chào ${userName}! Cả nhà nhớ bấm Follow và thả tim liên tục để bật Tia Sét bứt tốc lên ngôi đầu bảng nhé!`,
      provider: 'BLV Đường Đua',
      needClientFallback: true,
      errorDetail,
    };
  }

  const router = express.Router();

  router.get('/settings', (_req, res) => {
    res.json({ success: true, data: view() });
  });

  router.get('/replies', (_req, res) => {
    res.json({ success: true, data: recentReplies.slice(0, 15) });
  });

  router.put('/settings', authorize, (req, res) => {
    const body = req.body || {};
    const nextVoice: VoiceMode = voiceModes.has(body.voice) ? body.voice : settings.voice;
    const nextStyle: McStyle = mcStyles.has(body.mcStyle) ? body.mcStyle : settings.mcStyle;
    const nextVoiceId =
      typeof body.voiceId === 'string' ? body.voiceId.trim() : settings.voiceId;

    if (nextVoiceId !== '' && !voiceIdPattern.test(nextVoiceId)) {
      return res.status(400).json({ success: false, error: 'Voice ID không hợp lệ.' });
    }

    const resolveKeyField = (incoming: unknown, current: string) =>
      typeof incoming === 'string' ? incoming.trim().slice(0, 300) : current;

    const nextElevenKey = resolveKeyField(body.elevenKey, settings.elevenKey);
    if (nextVoice === 'custom' && !(nextElevenKey || envEleven || nextVoiceId)) {
      return res.status(400).json({
        success: false,
        error: 'Để dùng giọng riêng, hãy nhập ElevenLabs API Key và Voice ID.',
      });
    }

    const next: HostSettingsDisk = {
      aiEnabled: typeof body.aiEnabled === 'boolean' ? body.aiEnabled : settings.aiEnabled,
      aiRaceEnabled:
        typeof body.aiRaceEnabled === 'boolean' ? body.aiRaceEnabled : settings.aiRaceEnabled,
      mcStyle: nextStyle,
      autoCopyReply:
        typeof body.autoCopyReply === 'boolean' ? body.autoCopyReply : settings.autoCopyReply,
      voice: nextVoice,
      voiceId: nextVoiceId,
      groqKey: resolveKeyField(body.groqKey, settings.groqKey),
      geminiKey: resolveKeyField(body.geminiKey, settings.geminiKey),
      openrouterKey: resolveKeyField(body.openrouterKey, settings.openrouterKey),
      pollinationsKey: resolveKeyField(body.pollinationsKey, settings.pollinationsKey),
      elevenKey: nextElevenKey,
    };

    try {
      return res.json({ success: true, data: save(next) });
    } catch {
      return res.status(500).json({ success: false, error: 'Không lưu được cài đặt MC AI.' });
    }
  });

  let cloning = false;
  const uploadSample = express.raw({ type: Object.keys(sampleTypes), limit: '10mb' });
  router.post('/voice', authorize, uploadSample, async (req, res) => {
    const elevenKey = activeElevenKey();
    if (!elevenKey) {
      return res.status(503).json({
        success: false,
        error: 'Hãy nhập ElevenLabs API Key ở trên (hoặc cấu hình ELEVENLABS_API_KEY) trước khi tạo giọng.',
      });
    }
    if (cloning) return res.status(409).json({ success: false, error: 'Đang tạo một giọng khác.' });
    const contentType = req.get('Content-Type')?.split(';')[0] || '';
    const extension = sampleTypes[contentType];
    const name = typeof req.query.name === 'string' ? req.query.name.trim().slice(0, 60) : '';
    if (
      req.get('X-Voice-Consent') !== 'yes' ||
      !name ||
      !extension ||
      !Buffer.isBuffer(req.body) ||
      !req.body.length
    ) {
      return res
        .status(400)
        .json({ success: false, error: 'Hãy đặt tên, xác nhận quyền sử dụng và chọn mẫu âm thanh.' });
    }

    cloning = true;
    try {
      const form = new FormData();
      form.set('name', name);
      form.append('files', new Blob([Uint8Array.from(req.body)], { type: contentType }), `voice.${extension}`);
      const result = await fetch('https://api.elevenlabs.io/v1/voices/add', {
        method: 'POST',
        headers: { 'xi-api-key': elevenKey },
        body: form,
        signal: AbortSignal.timeout(45000),
      });
      if (!result.ok) {
        await result.body?.cancel();
        return res.status(502).json({
          success: false,
          error: `ElevenLabs từ chối mẫu giọng (${result.status}). Kiểm tra tệp và quyền API.`,
        });
      }
      const { voice_id: voiceId, requires_verification: requiresVerification } = await result.json();
      if (typeof voiceId !== 'string' || !voiceIdPattern.test(voiceId)) throw new Error('Invalid voice ID');
      if (requiresVerification) {
        return res.json({ success: true, voiceId, requiresVerification: true });
      }
      return res.json({ success: true, data: save({ ...settings, voice: 'custom', voiceId }) });
    } catch {
      return res.status(502).json({ success: false, error: 'Không hoàn tất được tạo giọng trên ElevenLabs.' });
    } finally {
      cloning = false;
    }
  });

  router.use((error: { status?: number }, _req: Request, res: Response, next: NextFunction) => {
    if (error.status !== 413) return next(error);
    res.status(413).json({ success: false, error: 'Mẫu giọng phải dưới 10 MB.' });
  });

  // Trả lời tự động bình luận của khán giả trên TikTok LIVE / Facebook Live
  let nextReplyAt = 0;
  let replying = false;
  const conversations = new Map<string, { comment: string; reply: string; at: number }>();

  async function replyToComment(event: AudienceComment) {
    const now = Date.now();
    const comment = String(event.comment || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    if (!settings.aiEnabled || replying || now < nextReplyAt || !/\p{L}{2}/u.test(comment)) return;
    // Bỏ qua các lệnh join 1 từ thuần túy hoặc spam tim thuần túy để dành thời lượng cho giao lưu thật
    if (/^(join|vào|vao|vào đua|vao dua|đua|dua|tim+|like+|thả tim|tha tim)$/iu.test(comment)) return;

    const name = String(event.nickname || event.username || 'bạn').replace(/\s+/g, ' ').trim().slice(0, 40);
    const platform: 'tiktok' | 'facebook' = event.platform === 'facebook' ? 'facebook' : 'tiktok';
    const userKey = `${platform}:${event.userId || event.username || name}`.slice(0, 180);
    const previous = conversations.get(userKey);
    const isDirectQuestion = /(\?|mc|blv|ơi|bói|vận may|chấm điểm|mấy giờ|hạng mấy|ai thắng)/iu.test(comment);
    if (previous && now - previous.at < (isDirectQuestion ? 10_000 : 22_000)) return;

    nextReplyAt = now + (isDirectQuestion ? 5500 : 8500);
    replying = true;
    try {
      const raceContext = summarizeRaceSnapshot(cb.getLatestSnapshot(), {
        userId: String(event.userId || event.username || ''),
        nickname: name,
      });

      const res = await generateAiCommentary({
        mode: 'chat',
        userName: name,
        question: comment,
        raceContext,
        mcStyle: settings.mcStyle,
      });

      if (!settings.aiEnabled) return;

      if (res.needClientFallback) {
        // Nhờ trình duyệt đang mở chạy Puter GPT-4o-mini miễn phí không cần API key!
        cb.emitClientFallbackTask({
          userName: name,
          question: comment,
          raceContext,
          mcStyle: settings.mcStyle,
          mode: 'chat',
          platform,
        });
        return;
      }

      if (!res.reply) return;
      conversations.set(userKey, { comment, reply: res.reply, at: now });
      if (conversations.size > 120) conversations.delete(conversations.keys().next().value!);

      const record: AiReplyRecord = {
        id: Date.now(),
        userName: name,
        question: comment,
        reply: res.reply,
        provider: res.provider,
        kind: 'chat',
        platform,
        at: now,
      };
      pushReplyRecord(record);
      cb.emitHostSpeech({ text: res.reply, priority: true, kind: 'event', provider: res.provider });
    } catch {
      /* Giữ luồng đua bình thường nếu mạng AI chập chờn */
    } finally {
      replying = false;
    }
  }

  // API chung `/api/npc/ai-reply` & `/api/npc/ai-broadcast` tương thích 100% với npc-action-live & CPanel Proxy!
  async function handleAiReplyHttp(req: Request, res: Response) {
    try {
      const mode: 'chat' | 'race' = req.body?.mode === 'race' ? 'race' : 'chat';
      if (mode === 'race' && !settings.aiRaceEnabled && !req.body?.forceTest) {
        return res.json({ success: false, disabled: true });
      }
      const userName = String(req.body?.userName || 'Tay đua').trim().slice(0, 40) || 'Tay đua';
      const question = String(req.body?.question || '').trim().slice(0, 320);
      if (!question) {
        return res.status(400).json({ success: false, error: 'Thiếu nội dung bình luận / sự kiện.' });
      }
      const platform: 'tiktok' | 'facebook' = req.body?.platform === 'facebook' ? 'facebook' : 'tiktok';
      const skipOfflineBroadcast = Boolean(req.body?.skipOfflineBroadcast);
      const speakOnStage = req.body?.speakOnStage !== false;

      const generated = await generateAiCommentary({
        mode,
        eventKind: req.body?.eventKind,
        userName,
        question,
        raceContext: typeof req.body?.raceContext === 'string' ? req.body.raceContext.slice(0, 600) : undefined,
        mcStyle: typeof req.body?.mcStyle === 'string' ? req.body.mcStyle : settings.mcStyle,
        groqKey: typeof req.body?.groqKey === 'string' ? req.body.groqKey : undefined,
        geminiKey: typeof req.body?.geminiKey === 'string' ? req.body.geminiKey : undefined,
        openrouterKey: typeof req.body?.openrouterKey === 'string' ? req.body.openrouterKey : undefined,
        pollinationsKey: typeof req.body?.pollinationsKey === 'string' ? req.body.pollinationsKey : undefined,
      });

      const record: AiReplyRecord = {
        id: Date.now(),
        userName: mode === 'race' ? 'BLV AI' : userName,
        question,
        reply: generated.reply,
        provider: generated.provider,
        kind: mode,
        platform,
        at: Date.now(),
      };

      if (generated.reply && (!generated.needClientFallback || !skipOfflineBroadcast)) {
        pushReplyRecord(record);
        if (speakOnStage) {
          const priority = mode === 'chat' || req.body?.eventKind === 'overtake' || req.body?.eventKind === 'podium';
          cb.emitHostSpeech({
            text: generated.reply,
            priority,
            kind: priority ? 'event' : 'normal',
            provider: generated.provider,
          });
        }
      }

      return res.json({
        success: Boolean(generated.reply) && !generated.needClientFallback,
        data: record,
        needClientFallback: Boolean(generated.needClientFallback),
        errorDetail: generated.errorDetail,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Lỗi xử lý AI' });
    }
  }

  function handleAiBroadcastHttp(req: Request, res: Response) {
    const mode: 'chat' | 'race' = req.body?.mode === 'race' ? 'race' : 'chat';
    const userName = String(req.body?.userName || (mode === 'race' ? 'BLV AI' : 'Tay đua')).trim().slice(0, 40);
    const question = String(req.body?.question || '').trim().slice(0, 320);
    const reply = cleanAiText(String(req.body?.reply || ''), 280);
    const provider = String(req.body?.provider || 'Puter GPT-4o').trim().slice(0, 40);
    const platform: 'tiktok' | 'facebook' = req.body?.platform === 'facebook' ? 'facebook' : 'tiktok';
    if (!reply) return res.status(400).json({ success: false, error: 'Thiếu nội dung reply' });

    const record: AiReplyRecord = {
      id: Date.now(),
      userName,
      question,
      reply,
      provider,
      kind: mode,
      platform,
      at: Date.now(),
    };
    pushReplyRecord(record);
    if (req.body?.speakOnStage !== false) {
      const priority = mode === 'chat' || Boolean(req.body?.priority);
      cb.emitHostSpeech({
        text: reply,
        priority,
        kind: priority ? 'event' : 'normal',
        provider,
      });
    }
    return res.json({ success: true, data: record });
  }

  const customTimes: number[] = [];
  async function synthesize(text: string, voiceId: string) {
    const elevenKey = activeElevenKey();
    if (!elevenKey) return;
    const now = Date.now();
    while (customTimes.length && now - customTimes[0] > 60000) customTimes.shift();
    if (customTimes.length >= 30) return;
    customTimes.push(now);
    try {
      const result = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(3500),
          headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', language_code: 'vi' }),
        },
      );
      if (result.ok && result.headers.get('content-type')?.startsWith('audio/')) {
        return Buffer.from(await result.arrayBuffer());
      }
      await result.body?.cancel();
    } catch {
      /* Tự động lùi về giọng Nam Minh / Hoài My tích hợp sẵn nếu ElevenLabs quá tải */
    }
  }

  return {
    router,
    replyToComment,
    handleAiReplyHttp,
    handleAiBroadcastHttp,
    chatOutbox: () => recentChatOutbox,
    view,
    synthesize,
    voice: () => settings.voice,
    voiceId: () => (settings.voice === 'custom' && activeElevenKey() ? settings.voiceId : ''),
    authorize,
  };
}
