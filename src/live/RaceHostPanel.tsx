import { useEffect, useRef, useState, type FormEvent } from 'react';
import { askRaceFreeAi, type AiReplyRecord, type McStyle } from './aiClient';

interface ProviderStatus {
  configured: boolean;
  fromEnv: boolean;
  preview: string;
}

export interface HostSettingsView {
  aiEnabled: boolean;
  aiRaceEnabled: boolean;
  mcStyle: McStyle;
  autoCopyReply: boolean;
  aiAvailable: boolean;
  customVoiceAvailable: boolean;
  protected: boolean;
  voice: 'duo' | 'male' | 'female' | 'custom';
  voiceId: string;
  providers?: {
    groq: ProviderStatus;
    gemini: ProviderStatus;
    openrouter: ProviderStatus;
    pollinations: ProviderStatus;
    elevenlabs: ProviderStatus;
    freeBuiltIn: boolean;
  };
  recentReplies?: AiReplyRecord[];
}

const keyName = 'raceHostKey';
const sampleTypes: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
};

const MC_STYLE_OPTIONS: Array<{ id: McStyle; title: string; desc: string }> = [
  {
    id: 'esports',
    title: '🏆 BLV Esports Kịch Tính',
    desc: 'Tường thuật tốc độ cao như chung kết F1, đọc sát khoảng cách & cú vượt mặt nghẹt thở',
  },
  {
    id: 'humorous',
    title: '😜 Giải Trí Lầy Lội (Chuẩn Douyin)',
    desc: 'Bình luận hài hước, cà khịa duyên dáng các pha lật kèo, giữ chân người xem cực tốt',
  },
  {
    id: 'lively',
    title: '🔥 Hoạt Náo Viên Đại Tiệc Đua Top',
    desc: 'Khuấy động phòng live liên tục, cổ vũ thả tim bật Tia Sét & gọi Rồng Thần / Rocket',
  },
  {
    id: 'warm',
    title: '🔮 Giao Lưu & Xem Vía Đường Đua',
    desc: 'Thân thiện chào hỏi, chấm điểm tên may mắn (9.5–10đ) & cổ vũ từng tay đua',
  },
];

const field =
  'min-w-0 flex-1 rounded-lg border border-white/15 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-400 focus:outline-none';
const button =
  'rounded-lg border border-emerald-400/30 bg-emerald-950 px-3 py-1.5 text-xs font-bold text-emerald-100 hover:bg-emerald-900 disabled:opacity-40 transition';

function readKey() {
  try {
    return sessionStorage.getItem(keyName) || '';
  } catch {
    return '';
  }
}

export function hostAuthorization(key = readKey()): Record<string, string> {
  return key.trim() ? { Authorization: `Bearer ${key.trim()}` } : {};
}

export function RaceHostPanel({ liveReplies }: { liveReplies?: AiReplyRecord[] }) {
  const [settings, setSettings] = useState<HostSettingsView>();
  const [authKey, setAuthKey] = useState(readKey);
  const [groqDraft, setGroqDraft] = useState('');
  const [geminiDraft, setGeminiDraft] = useState('');
  const [orDraft, setOrDraft] = useState('');
  const [pollDraft, setPollDraft] = useState('');
  const [elevenDraft, setElevenDraft] = useState('');
  const [testQ, setTestQ] = useState('Hôm nay vía đua của mình có hên không MC ơi?');
  const [testingMode, setTestingMode] = useState<'chat' | 'race' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [sample, setSample] = useState<File>();
  const [sampleName, setSampleName] = useState('Giọng MC riêng');
  const [consent, setConsent] = useState(false);
  const [localReplies, setLocalReplies] = useState<AiReplyRecord[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/host/settings', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const { data } = await res.json();
        if (!data) throw new Error();
        setSettings(data);
        if (Array.isArray(data.recentReplies)) {
          setLocalReplies(data.recentReplies);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMessage({ ok: false, text: 'Không tải được cài đặt MC AI.' });
        }
      });
    return () => {
      controller.abort();
      audio.current?.pause();
    };
  }, []);

  const mergedReplies = (() => {
    const map = new Map<number, AiReplyRecord>();
    for (const r of [...(liveReplies || []), ...localReplies]) {
      if (r && typeof r.id === 'number' && !map.has(r.id)) {
        map.set(r.id, r);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.at - a.at)
      .slice(0, 6);
  })();

  useEffect(() => {
    if (settings?.autoCopyReply && mergedReplies[0] && mergedReplies[0].kind === 'chat') {
      const top = mergedReplies[0];
      void navigator.clipboard?.writeText(`@${top.userName} ${top.reply}`).catch(() => {});
    }
  }, [mergedReplies[0]?.id, settings?.autoCopyReply]);

  async function patchSettings(patch: Record<string, unknown>, okNotice?: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/host/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...hostAuthorization(authKey) },
        body: JSON.stringify(patch),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Không lưu được cài đặt MC AI.');
      }
      setSettings(result.data);
      if (okNotice) setMessage({ ok: true, text: okNotice });
      return result.data as HostSettingsView;
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'Không lưu được cài đặt MC AI.',
      });
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function saveKeysAndVoice(event?: FormEvent) {
    event?.preventDefault();
    if (!settings) return;
    const payload: Record<string, unknown> = {
      aiEnabled: settings.aiEnabled,
      aiRaceEnabled: settings.aiRaceEnabled,
      mcStyle: settings.mcStyle,
      autoCopyReply: settings.autoCopyReply,
      voice: settings.voice,
      voiceId: settings.voiceId.trim(),
    };
    if (groqDraft.trim()) payload.groqKey = groqDraft.trim();
    if (geminiDraft.trim()) payload.geminiKey = geminiDraft.trim();
    if (orDraft.trim()) payload.openrouterKey = orDraft.trim();
    if (pollDraft.trim()) payload.pollinationsKey = pollDraft.trim();
    if (elevenDraft.trim()) payload.elevenKey = elevenDraft.trim();

    const updated = await patchSettings(payload, 'Đã lưu API Key & cấu hình Bình luận viên AI cho Stage!');
    if (updated) {
      setGroqDraft('');
      setGeminiDraft('');
      setOrDraft('');
      setPollDraft('');
      setElevenDraft('');
    }
  }

  async function clearProviderKey(fieldKey: 'groqKey' | 'geminiKey' | 'openrouterKey' | 'pollinationsKey' | 'elevenKey', label: string) {
    await patchSettings({ [fieldKey]: '' }, `Đã xóa ${label} (tự động chuyển sang các nguồn AI miễn phí còn lại).`);
  }

  async function runAiTest(mode: 'chat' | 'race') {
    if (testingMode) return;
    const q =
      mode === 'race'
        ? 'Hoàng Long vừa bật Tia Sét Plasma xanh lách qua Minh Khôi ở khoảng cách chỉ 2 mét để chiếm ngôi Top 1 tại vòng 2 trên 3!'
        : testQ.trim() || 'Chào MC, cổ vũ mình đua Top 1 ván này đi!';

    if (groqDraft.trim() || geminiDraft.trim() || orDraft.trim() || pollDraft.trim()) {
      await saveKeysAndVoice();
    }

    setTestingMode(mode);
    setMessage(null);
    try {
      const result = await askRaceFreeAi({
        mode,
        eventKind: mode === 'race' ? 'overtake' : undefined,
        userName: mode === 'race' ? 'BLV AI' : 'Tay Đua Test',
        question: q,
        mcStyle: settings?.mcStyle || 'esports',
        groqKey: groqDraft.trim() || undefined,
        geminiKey: geminiDraft.trim() || undefined,
        openrouterKey: orDraft.trim() || undefined,
        pollinationsKey: pollDraft.trim() || undefined,
        speakOnStage: true,
        forceTest: true,
      });
      if (result.ok && result.reply) {
        if (result.record) {
          setLocalReplies((prev) => [result.record!, ...prev.filter((x) => x.id !== result.record!.id)].slice(0, 8));
        }
        setMessage({
          ok: true,
          text: `Đã bình luận qua ${result.provider || 'AI'}: "${result.reply}"`,
        });
      } else {
        setMessage({
          ok: false,
          text: result.errorDetail || 'Kết nối AI đang bận, hãy thử lại hoặc thêm Groq / Gemini Key miễn phí.',
        });
      }
    } finally {
      setTestingMode(null);
    }
  }

  async function createVoice(event: FormEvent) {
    event.preventDefault();
    if (!sample || !consent) return;
    const format = sampleTypes[sample.name.split('.').pop()?.toLowerCase() || ''];
    if (!format || sample.size > 10 * 1024 * 1024) {
      setMessage({ ok: false, text: 'Chọn tệp MP3, WAV, M4A, WebM hoặc OGG dưới 10 MB.' });
      return;
    }
    if (elevenDraft.trim()) {
      await saveKeysAndVoice();
    }
    setBusy(true);
    setMessage({ ok: true, text: 'Đang tạo giọng trên ElevenLabs…' });
    try {
      const response = await fetch(`/api/host/voice?name=${encodeURIComponent(sampleName.trim())}`, {
        method: 'POST',
        body: sample,
        headers: { 'Content-Type': format, 'X-Voice-Consent': 'yes', ...hostAuthorization(authKey) },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Không tạo được giọng nói.');
      }
      if (result.requiresVerification) {
        setSettings((cur) => cur && { ...cur, voiceId: result.voiceId });
        setMessage({
          ok: false,
          text: `ElevenLabs yêu cầu xác minh giọng (Voice ID: ${result.voiceId}).`,
        });
        return;
      }
      setSettings(result.data);
      setMessage({ ok: true, text: 'Đã tạo và kích hoạt giọng MC riêng thành công!' });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'Không tạo được giọng nói.',
      });
    } finally {
      setBusy(false);
    }
  }

  function previewVoice() {
    audio.current?.pause();
    const words = 'Xin chào cả nhà! Bấm Follow kênh và thả tim để bật Tia Sét Plasma bứt tốc trên đường đua 3D nhé!';
    const player = new Audio(`/api/tts?text=${encodeURIComponent(words)}&hype=1&preview=${Date.now()}`);
    audio.current = player;
    void player.play().catch(() =>
      setMessage({ ok: false, text: 'Không nghe thử được giọng đọc trên trình duyệt này.' }),
    );
  }

  const p = settings?.providers;

  return (
    <section className="rounded-2xl border border-sky-400/25 bg-slate-900/95 p-4 text-slate-200 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-sky-300">
            🤖 AI Bình Luận Viên Thông Minh Miễn Phí (Groq Llama-70B · Gemini · OpenRouter · Pollinations · Puter GPT-4o)
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400 leading-relaxed">
            Bình luận diễn biến cuộc đua tự nhiên & trả lời khán giả như người thật (y hệt <b>NPC Action Live</b>). Có sẵn{' '}
            <b className="text-emerald-300">Pollinations + Puter GPT-4o miễn phí không cần Key</b>, hoặc dán{' '}
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer"
              className="font-bold text-emerald-300 underline hover:text-emerald-200"
            >
              Groq API Key miễn phí
            </a>{' '}
            / <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-bold text-sky-300 underline hover:text-sky-200">Gemini Key</a> ngay bên dưới để tốc độ phản hồi siêu tốc (~0.3s).
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-bold border border-white/10">
            <input
              type="checkbox"
              checked={settings?.aiRaceEnabled ?? true}
              disabled={!settings || busy}
              onChange={(e) => {
                const val = e.target.checked;
                setSettings((s) => s && { ...s, aiRaceEnabled: val });
                void patchSettings({ aiRaceEnabled: val }, val ? 'Đã BẬT AI bình luận diễn biến đua!' : 'Đã TẮT AI bình luận diễn biến đua.');
              }}
              className="accent-emerald-400"
            />
            <span>{settings?.aiRaceEnabled !== false ? '🟢 AI Bình luận Đua' : '⚪ Tắt AI Đua'}</span>
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-bold border border-white/10">
            <input
              type="checkbox"
              checked={settings?.aiEnabled ?? true}
              disabled={!settings || busy}
              onChange={(e) => {
                const val = e.target.checked;
                setSettings((s) => s && { ...s, aiEnabled: val });
                void patchSettings({ aiEnabled: val }, val ? 'Đã BẬT AI trả lời bình luận khán giả!' : 'Đã TẮT AI trả lời bình luận.');
              }}
              className="accent-sky-400"
            />
            <span>{settings?.aiEnabled !== false ? '🟢 AI Trả lời Chat' : '⚪ Tắt AI Chat'}</span>
          </label>
        </div>
      </div>

      {settings?.protected && (
        <label className="grid gap-1 text-xs">
          <span>🔒 Khóa điều khiển MC (`RACE_HOST_TOKEN`)</span>
          <input
            className={field}
            type="password"
            autoComplete="off"
            value={authKey}
            placeholder="Nhập khóa điều khiển MC..."
            onChange={(event) => {
              const value = event.target.value;
              setAuthKey(value);
              try {
                sessionStorage.setItem(keyName, value);
              } catch {}
            }}
          />
        </label>
      )}

      {/* Chọn Phong cách Bình luận viên AI */}
      <div className="rounded-xl bg-slate-950/70 p-3 border border-white/10">
        <div className="mb-2 text-[11px] font-black uppercase tracking-wider text-amber-300">
          🎭 Chọn Phong Cách Bình Luận Viên AI (Đồng bộ cả bình luận đường đua & giao lưu chat):
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {MC_STYLE_OPTIONS.map((st) => {
            const active = (settings?.mcStyle || 'esports') === st.id;
            return (
              <button
                key={st.id}
                type="button"
                disabled={!settings || busy}
                onClick={() => {
                  setSettings((s) => s && { ...s, mcStyle: st.id });
                  void patchSettings({ mcStyle: st.id }, `Đã chuyển sang phong cách: ${st.title}`);
                }}
                className={`rounded-xl border p-2.5 text-left transition ${
                  active
                    ? 'border-amber-400 bg-amber-500/15 text-white shadow'
                    : 'border-white/10 bg-slate-900/80 text-slate-200 hover:border-white/25'
                }`}
              >
                <div className="text-xs font-extrabold">{st.title}</div>
                <div className="mt-0.5 text-[10.5px] text-slate-400">{st.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ô Test Bình Luận AI Nhanh */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          type="text"
          value={testQ}
          onChange={(e) => setTestQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void runAiTest('chat')}
          placeholder="Nhập thử bình luận khán giả (VD: Xem bói vận may đua hôm nay cho mình với!)..."
          className={field}
        />
        <button
          type="button"
          disabled={Boolean(testingMode)}
          onClick={() => void runAiTest('chat')}
          className="rounded-lg bg-sky-500 px-3 py-1.5 font-black text-slate-950 hover:bg-sky-400 disabled:opacity-50"
        >
          {testingMode === 'chat' ? '⏳ Đang hỏi AI...' : '💬 Thử Trả Lời Chat'}
        </button>
        <button
          type="button"
          disabled={Boolean(testingMode)}
          onClick={() => void runAiTest('race')}
          className="rounded-lg bg-amber-400 px-3 py-1.5 font-black text-slate-950 hover:bg-amber-300 disabled:opacity-50"
        >
          {testingMode === 'race' ? '⏳ Đang bình luận...' : '🎙️ Thử AI Bình Luận Pha Vượt'}
        </button>
      </div>

      {/* Nhập API Key trực tiếp như CPanel NPC Action Live */}
      <form onSubmit={saveKeysAndVoice} className="rounded-xl bg-slate-950/75 p-3 border border-white/10 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="font-bold text-slate-300">
            🔑 Cấu hình API Key trực tiếp cho Phòng Đua này (Lưu riêng bền vững trên máy chủ, không cần sửa `.env`):
          </span>
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10.5px] font-bold text-emerald-300 border border-emerald-500/30">
            🆓 Pollinations & Puter GPT-4o: Sẵn sàng (Không cần Key)
          </span>
        </div>

        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="flex items-center gap-1.5">
            <span className="w-24 shrink-0 font-bold text-emerald-300">⚡ Groq Key:</span>
            <input
              type="password"
              value={groqDraft}
              onChange={(e) => setGroqDraft(e.target.value)}
              placeholder={p?.groq.configured ? `Đã lưu: ${p.groq.preview}` : 'gsk_... (Llama 3.3 70B Free)'}
              className={field}
            />
            {p?.groq.configured && !p.groq.fromEnv && (
              <button
                type="button"
                onClick={() => void clearProviderKey('groqKey', 'Groq Key')}
                className="rounded bg-slate-800 px-2 py-1 text-[10px] text-rose-300 hover:bg-slate-700"
                title="Xóa Groq Key đã lưu"
              >
                Xóa
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-24 shrink-0 font-bold text-sky-300">✨ Gemini Key:</span>
            <input
              type="password"
              value={geminiDraft}
              onChange={(e) => setGeminiDraft(e.target.value)}
              placeholder={p?.gemini.configured ? `Đã lưu: ${p.gemini.preview}` : 'AIza... (Gemini 2.0/2.5 Free)'}
              className={field}
            />
            {p?.gemini.configured && !p.gemini.fromEnv && (
              <button
                type="button"
                onClick={() => void clearProviderKey('geminiKey', 'Gemini Key')}
                className="rounded bg-slate-800 px-2 py-1 text-[10px] text-rose-300 hover:bg-slate-700"
                title="Xóa Gemini Key đã lưu"
              >
                Xóa
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-24 shrink-0 font-bold text-amber-300">🌐 OpenRouter:</span>
            <input
              type="password"
              value={orDraft}
              onChange={(e) => setOrDraft(e.target.value)}
              placeholder={p?.openrouter.configured ? `Đã lưu: ${p.openrouter.preview}` : 'sk-or-... (openrouter/free)'}
              className={field}
            />
            {p?.openrouter.configured && !p.openrouter.fromEnv && (
              <button
                type="button"
                onClick={() => void clearProviderKey('openrouterKey', 'OpenRouter Key')}
                className="rounded bg-slate-800 px-2 py-1 text-[10px] text-rose-300 hover:bg-slate-700"
                title="Xóa OpenRouter Key đã lưu"
              >
                Xóa
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-24 shrink-0 font-bold text-purple-300">🎨 Pollinations:</span>
            <input
              type="password"
              value={pollDraft}
              onChange={(e) => setPollDraft(e.target.value)}
              placeholder={p?.pollinations.configured ? `Đã lưu: ${p.pollinations.preview}` : 'Tùy chọn (Mặc định miễn phí không cần Key)'}
              className={field}
            />
            {p?.pollinations.configured && !p.pollinations.fromEnv && (
              <button
                type="button"
                onClick={() => void clearProviderKey('pollinationsKey', 'Pollinations Key')}
                className="rounded bg-slate-800 px-2 py-1 text-[10px] text-rose-300 hover:bg-slate-700"
              >
                Xóa
              </button>
            )}
          </div>
        </div>

        {/* Trạng thái các nguồn AI hiện có */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {p?.groq.configured && (
            <span className="rounded bg-emerald-950/90 border border-emerald-500/30 px-2 py-0.5 text-emerald-300">
              ✅ Groq ({p.groq.preview})
            </span>
          )}
          {p?.gemini.configured && (
            <span className="rounded bg-sky-950/90 border border-sky-500/30 px-2 py-0.5 text-sky-300">
              ✅ Gemini ({p.gemini.preview})
            </span>
          )}
          {p?.openrouter.configured && (
            <span className="rounded bg-amber-950/90 border border-amber-500/30 px-2 py-0.5 text-amber-300">
              ✅ OpenRouter ({p.openrouter.preview})
            </span>
          )}
          <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
            🌐 Dự phòng tự động: Pollinations Free → Puter GPT-4o
          </span>
        </div>

        {/* Cấu hình Giọng đọc MC & Tự copy */}
        {settings && (
          <div className="mt-1 grid gap-2 border-t border-white/10 pt-2.5 sm:grid-cols-2 items-end">
            <label className="grid gap-1 text-xs">
              <span className="font-semibold text-slate-300">🎙️ Chế độ Giọng Đọc MC</span>
              <select
                className={field}
                disabled={busy}
                value={settings.voice}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    voice: event.target.value as HostSettingsView['voice'],
                  })
                }
              >
                <option value="duo">Song tấu Nam Minh & Hoài My (Mặc định sôi động)</option>
                <option value="male">BLV Nam Minh</option>
                <option value="female">BLV Hoài My</option>
                <option value="custom">Giọng nhân bản riêng (ElevenLabs)</option>
              </select>
            </label>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 border border-white/10">
                <input
                  type="checkbox"
                  checked={settings.autoCopyReply}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setSettings({ ...settings, autoCopyReply: val });
                    void patchSettings({ autoCopyReply: val });
                  }}
                  className="accent-emerald-400"
                />
                <span>📋 Tự copy câu trả lời</span>
              </label>
              <button type="button" className={button} disabled={busy} onClick={previewVoice}>
                🔊 Nghe thử
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
                disabled={busy || (settings.protected && !authKey.trim())}
              >
                💾 Lưu Key & Cài Đặt
              </button>
            </div>
          </div>
        )}

        {settings?.voice === 'custom' && (
          <div className="grid gap-2 sm:grid-cols-2 border-t border-white/10 pt-2 text-xs">
            <label className="grid gap-1">
              <span>🔑 ElevenLabs API Key (để trống nếu đã lưu)</span>
              <input
                type="password"
                className={field}
                value={elevenDraft}
                onChange={(e) => setElevenDraft(e.target.value)}
                placeholder={p?.elevenlabs.configured ? `Đã lưu: ${p.elevenlabs.preview}` : 'sk_...'}
              />
            </label>
            <label className="grid gap-1">
              <span>🆔 ElevenLabs Voice ID</span>
              <input
                className={field}
                value={settings.voiceId}
                maxLength={128}
                placeholder="Nhập Voice ID hoặc tạo từ tệp ghi âm bên dưới..."
                onChange={(event) => setSettings({ ...settings, voiceId: event.target.value })}
              />
            </label>
          </div>
        )}
      </form>

      {settings?.voice === 'custom' && (
        <form onSubmit={createVoice} className="grid gap-2 rounded-xl bg-slate-950/60 p-3 border border-white/10 text-xs">
          <h3 className="font-bold text-emerald-300">🎤 Nhân bản giọng MC từ bản ghi âm (ElevenLabs)</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1">
              <span>Tên giọng</span>
              <input
                className={field}
                required
                maxLength={60}
                value={sampleName}
                onChange={(event) => setSampleName(event.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span>Mẫu âm thanh (MP3/WAV/M4A &lt; 10MB)</span>
              <input
                className={field}
                type="file"
                accept=".mp3,.wav,.m4a,.webm,.ogg"
                onChange={(event) => setSample(event.target.files?.[0])}
              />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>Tôi xác nhận có quyền sử dụng mẫu giọng này để tạo giọng đọc trên ElevenLabs.</span>
          </label>
          <button
            className={`${button} justify-self-start`}
            disabled={busy || !sample || !consent || (!p?.elevenlabs.configured && !elevenDraft.trim())}
          >
            ✨ Tạo & Kích hoạt giọng này
          </button>
        </form>
      )}

      {message && (
        <p className={`text-xs font-semibold ${message.ok ? 'text-emerald-300' : 'text-amber-300'}`} role="status">
          {message.ok ? '🟢 ' : '⚠️ '}
          {message.text}
        </p>
      )}

      {mergedReplies.length > 0 && (
        <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-xl bg-slate-950/75 p-2.5 text-xs border border-white/10">
          {mergedReplies.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-900/90 px-2.5 py-1.5 border border-white/5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                  <b className={r.kind === 'race' ? 'text-amber-300' : 'text-sky-300'}>
                    {r.kind === 'race' ? '🏁 Diễn biến đua' : `@${r.userName}`}
                  </b>
                  <span className="truncate max-w-[260px]">{r.question}</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                    {r.provider}
                  </span>
                </div>
                <div className="mt-0.5 font-semibold text-amber-100">🎙️ {r.reply}</div>
              </div>
              {r.kind === 'chat' && (
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(`@${r.userName} ${r.reply}`)}
                  className="shrink-0 rounded bg-slate-800 px-2 py-1 text-[10.5px] font-semibold text-slate-200 hover:bg-slate-700"
                  title="Copy câu trả lời để dán vào khung chat"
                >
                  📋 Copy
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
