export type McStyle = 'esports' | 'humorous' | 'lively' | 'warm';

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

export interface AskRaceAiParams {
  mode?: 'chat' | 'race';
  eventKind?: 'overtake' | 'play_by_play' | 'podium' | 'final_lap' | 'gift' | 'lobby';
  userName?: string;
  question: string;
  raceContext?: string;
  mcStyle?: McStyle;
  geminiKey?: string;
  groqKey?: string;
  openrouterKey?: string;
  pollinationsKey?: string;
  platform?: 'tiktok' | 'facebook';
  speakOnStage?: boolean;
  forceTest?: boolean;
}

export interface AskRaceAiResult {
  ok: boolean;
  reply?: string;
  provider?: string;
  record?: AiReplyRecord;
  errorDetail?: string;
}

function cleanAiText(raw: string, maxLen = 260): string {
  return raw
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*#_`~"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function buildBrowserSysPrompt(params: AskRaceAiParams): string {
  const styleDesc =
    params.mcStyle === 'humorous'
      ? 'Phong cách giải trí lầy lội chuẩn Douyin, hài hước, cà khịa duyên dáng.'
      : params.mcStyle === 'lively'
        ? 'Phong cách hoạt náo viên sôi động, bùng nổ năng lượng, cổ vũ thả tim và tung quà.'
        : params.mcStyle === 'warm'
          ? 'Phong cách MC thân thiện, ấm áp, ai hỏi vận may/bói vui thì phán tích cực 9.5-10 điểm.'
          : 'Phong cách Bình Luận Viên Esports tốc độ cao, kịch tính, hào hứng.';

  if (params.mode === 'race') {
    return [
      'Bạn là Bình Luận Viên trực tiếp của game Đấu Trường Đua Tốc Độ 3D trên livestream.',
      styleDesc,
      params.raceContext ? `Tình hình đường đua: ${params.raceContext}` : '',
      'Viết đúng 1-2 câu bình luận tiếng Việt tự nhiên, sống động để đọc thành tiếng ngay (tối đa 40 từ), bám sát tên tay đua trong dữ liệu, không dùng markdown.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return [
    'Bạn là MC & Bình Luận Viên AI thông minh của game Đấu Trường Đua Tốc Độ 3D trên livestream.',
    styleDesc,
    params.raceContext ? `Tình hình đường đua: ${params.raceContext}` : '',
    `Trả lời ngắn gọn, tự nhiên trong 1-2 câu tiếng Việt dễ đọc thành tiếng cho "${params.userName || 'bạn'}" (tối đa 45 từ). Bấm Follow là vào đua, thả tim bật Tia Sét Plasma, tặng quà hóa Rocket / Siêu Nhân / Rồng Thần. Không dùng markdown.`,
  ]
    .filter(Boolean)
    .join(' ');
}

async function tryDirectGroqBrowser(
  params: AskRaceAiParams,
): Promise<{ text?: string; provider?: string; error?: string }> {
  const key = (params.groqKey || '').trim();
  if (!key) return {};
  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  let lastError = '';
  for (const model of models) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: buildBrowserSysPrompt(params) },
            {
              role: 'user',
              content:
                params.mode === 'race'
                  ? `Diễn biến vừa xảy ra: ${params.question}`
                  : `${params.userName || 'Khán giả'} bình luận: "${params.question}"`,
            },
          ],
          max_tokens: 180,
          temperature: params.mode === 'race' ? 0.75 : 0.5,
        }),
        signal: AbortSignal.timeout(4500),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        lastError = `Groq(${model}) HTTP ${r.status}: ${errText.slice(0, 90)}`;
        continue;
      }
      const data: any = await r.json().catch(() => null);
      const text = cleanAiText(data?.choices?.[0]?.message?.content || '');
      if (text) return { text, provider: `Groq (${model.split('/').pop()})` };
    } catch (err: any) {
      lastError = err?.message || 'network';
    }
  }
  return { error: lastError };
}

let puterLoadingPromise: Promise<any> | null = null;

async function ensurePuterLoaded(): Promise<any> {
  if (typeof window === 'undefined') return null;
  if ((window as any)?.puter?.ai?.chat) return (window as any).puter;
  if (!puterLoadingPromise) {
    puterLoadingPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://js.puter.com/v2/';
      s.async = true;
      s.onload = () => resolve((window as any)?.puter || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }
  return puterLoadingPromise;
}

export async function tryPuterBrowserAi(params: AskRaceAiParams): Promise<string | null> {
  const puter = await ensurePuterLoaded();
  if (!puter?.ai?.chat) return null;
  try {
    const resp = await Promise.race([
      puter.ai.chat(
        [
          { role: 'system', content: buildBrowserSysPrompt(params) },
          {
            role: 'user',
            content:
              params.mode === 'race'
                ? `Diễn biến vừa xảy ra: ${params.question}`
                : `${params.userName || 'Khán giả'} bình luận: "${params.question}"`,
          },
        ],
        { model: 'gpt-4o-mini' },
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4200)),
    ]);
    if (!resp) return null;
    const content =
      typeof resp === 'string'
        ? resp
        : typeof resp?.message?.content === 'string'
          ? resp.message.content
          : Array.isArray(resp?.message?.content)
            ? resp.message.content.map((c: any) => c?.text || '').join(' ')
            : '';
    const cleaned = cleanAiText(content);
    return cleaned || null;
  } catch {
    return null;
  }
}

async function broadcastClientAiReply(
  params: AskRaceAiParams,
  reply: string,
  provider: string,
): Promise<AiReplyRecord | undefined> {
  try {
    const res = await fetch('/api/npc/ai-broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: params.mode || 'chat',
        userName: params.userName || (params.mode === 'race' ? 'BLV AI' : 'Tay đua'),
        question: params.question,
        reply,
        provider,
        platform: params.platform === 'facebook' ? 'facebook' : 'tiktok',
        speakOnStage: params.speakOnStage !== false,
        priority: params.mode !== 'race' || params.eventKind === 'overtake' || params.eventKind === 'podium',
      }),
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      return json?.data as AiReplyRecord | undefined;
    }
  } catch {}
  return undefined;
}

/**
 * Chuỗi gọi AI tự nhiên đa tầng (tương đồng 100% với npc-action-live):
 * 1) Server `/api/npc/ai-reply`: Groq -> Gemini -> OpenRouter Free -> Cerebras/ChatGPT -> Pollinations Free (không cần key)
 * 2) Browser Fallback: Groq trực tiếp (nếu đang nhập nháp Key) -> Puter.js GPT-4o-mini miễn phí không cần API key!
 */
export async function askRaceFreeAi(params: AskRaceAiParams): Promise<AskRaceAiResult> {
  let errorDetail: string | undefined;
  let serverDisabled = false;

  try {
    const res = await fetch('/api/npc/ai-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...params,
        skipOfflineBroadcast: true,
      }),
      signal: AbortSignal.timeout(params.mode === 'race' ? 4200 : 8500),
    });
    if (res.ok) {
      const data: any = await res.json().catch(() => null);
      if (data?.disabled) {
        serverDisabled = true;
      } else {
        errorDetail = data?.errorDetail;
        if (data?.success && data?.data?.reply && !data?.needClientFallback) {
          return {
            ok: true,
            reply: data.data.reply,
            provider: data.data.provider,
            record: data.data,
            errorDetail,
          };
        }
      }
    }
  } catch (err: any) {
    errorDetail = err?.message || 'timeout';
  }

  if (serverDisabled) {
    return { ok: false, errorDetail: 'AI đang tắt' };
  }

  if ((params.groqKey || '').trim()) {
    const direct = await tryDirectGroqBrowser(params);
    if (direct.text) {
      const prov = direct.provider || 'Groq';
      const rec = await broadcastClientAiReply(params, direct.text, prov);
      return { ok: true, reply: direct.text, provider: prov, record: rec };
    }
    if (direct.error) errorDetail = direct.error;
  }

  const puterReply = await tryPuterBrowserAi(params);
  if (puterReply) {
    const rec = await broadcastClientAiReply(params, puterReply, 'Puter GPT-4o Free');
    return { ok: true, reply: puterReply, provider: 'Puter GPT-4o Free', record: rec, errorDetail };
  }

  return { ok: false, errorDetail };
}
