import { useEffect, useRef, useState, type FormEvent } from 'react';

interface HostSettings {
  aiEnabled: boolean;
  aiAvailable: boolean;
  customVoiceAvailable: boolean;
  protected: boolean;
  voice: 'duo' | 'male' | 'female' | 'custom';
  voiceId: string;
}

const keyName = 'raceHostKey';
const sampleTypes: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  webm: 'audio/webm', ogg: 'audio/ogg' };
const field = 'rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white';
const button = 'rounded-lg border border-emerald-400/30 bg-emerald-950 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-900 disabled:opacity-40';

function readKey() {
  try { return sessionStorage.getItem(keyName) || ''; } catch { return ''; }
}

export function hostAuthorization(key = readKey()): Record<string, string> {
  return key.trim() ? { Authorization: `Bearer ${key.trim()}` } : {};
}

export function RaceHostPanel() {
  const [settings, setSettings] = useState<HostSettings>();
  const [key, setKey] = useState(readKey);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sample, setSample] = useState<File>();
  const [sampleName, setSampleName] = useState('Giọng của tôi');
  const [consent, setConsent] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/host/settings', { signal: controller.signal }).then(async (res) => {
      if (!res.ok) throw new Error();
      const { data } = await res.json();
      if (!data) throw new Error();
      setSettings(data);
    }).catch(() => { if (!controller.signal.aborted) setMessage('Không tải được cài đặt MC.'); });
    return () => { controller.abort(); audio.current?.pause(); };
  }, []);

  async function apply(response: Response) {
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Không lưu được cài đặt MC.');
    if (result.requiresVerification) {
      setSettings((current) => current && { ...current, voiceId: result.voiceId });
      setMessage(`ElevenLabs yêu cầu xác minh giọng. Voice ID ${result.voiceId}. Xác minh trong ElevenLabs trước khi chọn giọng này.`);
      return;
    }
    setSettings(result.data);
    setMessage('Đã lưu cài đặt MC cho Stage.');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setMessage('');
    try {
      await apply(await fetch('/api/host/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...hostAuthorization(key) },
        body: JSON.stringify({ aiEnabled: settings.aiEnabled, voice: settings.voice, voiceId: settings.voiceId.trim() }),
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không lưu được cài đặt MC.');
    } finally { setBusy(false); }
  }

  async function createVoice(event: FormEvent) {
    event.preventDefault();
    if (!sample || !consent) return;
    const format = sampleTypes[sample.name.split('.').pop()?.toLowerCase() || ''];
    if (!format || sample.size > 10 * 1024 * 1024) {
      setMessage('Chọn tệp MP3, WAV, M4A, WebM hoặc OGG dưới 10 MB.');
      return;
    }
    setBusy(true);
    setMessage('Đang tạo giọng trên ElevenLabs…');
    try {
      await apply(await fetch(`/api/host/voice?name=${encodeURIComponent(sampleName.trim())}`, {
        method: 'POST', body: sample,
        headers: { 'Content-Type': format, 'X-Voice-Consent': 'yes', ...hostAuthorization(key) },
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không tạo được giọng nói.');
    } finally { setBusy(false); }
  }

  function previewVoice() {
    audio.current?.pause();
    const words = 'Chào cả nhà. Bấm Follow để vào đường đua cùng mình nhé!';
    const player = new Audio(`/api/tts?text=${encodeURIComponent(words)}&preview=${Date.now()}`);
    audio.current = player;
    void player.play().catch(() => setMessage('Không nghe thử được giọng đã lưu.'));
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/90 p-4 text-slate-200">
      <h2 className="mb-3 text-sm font-black text-emerald-300">MC AI và giọng nói</h2>
      {settings && <>
        {settings.protected && <label className="mb-3 grid gap-1 text-xs">
          Khóa điều khiển MC
          <input className={field} type="password" autoComplete="off" value={key} onChange={(event) => {
            const value = event.target.value;
            setKey(value);
            try { sessionStorage.setItem(keyName, value); } catch {}
          }} />
        </label>}
        <form onSubmit={save} className="grid gap-3">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={settings.aiEnabled && settings.aiAvailable} disabled={!settings.aiAvailable || busy}
              onChange={(event) => setSettings({ ...settings, aiEnabled: event.target.checked })} />
            MC tự đọc câu trả lời cho bình luận trên live
          </label>
          {!settings.aiAvailable && <p className="text-xs text-slate-400">Bật Groq bằng GROQ_API_KEY và RACE_HOST_TOKEN trên máy chủ.</p>}
          <label className="grid gap-1 text-xs">Giọng MC
            <select className={field} disabled={busy} value={settings.voice} onChange={(event) => setSettings({ ...settings, voice: event.target.value as HostSettings['voice'] })}>
              <option value="duo">Nam Minh và Hoài My</option>
              <option value="male">Nam Minh</option>
              <option value="female">Hoài My</option>
              <option value="custom" disabled={!settings.customVoiceAvailable}>Giọng riêng qua ElevenLabs</option>
            </select>
          </label>
          {settings.voice === 'custom' && <label className="grid gap-1 text-xs">Voice ID
            <input className={field} value={settings.voiceId} maxLength={128} required
              onChange={(event) => setSettings({ ...settings, voiceId: event.target.value })} />
          </label>}
          <div className="flex gap-2">
            <button className={button} disabled={busy || (settings.protected && !key.trim())}>Lưu cài đặt</button>
            <button className={button} type="button" disabled={busy} onClick={previewVoice}>Nghe thử giọng đã lưu</button>
          </div>
        </form>
        {settings.customVoiceAvailable ? <form onSubmit={createVoice} className="mt-4 grid gap-2 border-t border-white/10 pt-3">
          <h3 className="text-xs font-bold">Tạo giọng từ bản ghi âm</h3>
          <label className="grid gap-1 text-xs">Tên giọng <input className={field} required maxLength={60} value={sampleName}
            onChange={(event) => setSampleName(event.target.value)} /></label>
          <label className="grid gap-1 text-xs">Mẫu âm thanh <input className={field} type="file" accept=".mp3,.wav,.m4a,.webm,.ogg"
            onChange={(event) => setSample(event.target.files?.[0])} /></label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            Tôi có quyền sử dụng mẫu giọng này. Tệp sẽ được gửi tới ElevenLabs.
          </label>
          <button className={`${button} justify-self-start`} disabled={busy || !sample || !consent || !key.trim()}>Tạo và dùng giọng này</button>
        </form> : <p className="mt-3 text-xs text-slate-400">Giọng riêng cần ELEVENLABS_API_KEY và RACE_HOST_TOKEN trên máy chủ.</p>}
      </>}
      {message && <p className="mt-2 text-xs text-amber-200" role="status">{message}</p>}
    </section>
  );
}
