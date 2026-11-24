export type BroadcastOutputModeId = 'window_capture' | 'browser_source' | 'rtmp_stream';

export interface BroadcastChecklistProfile {
  /** Có cần Screen Wake Lock trên trình duyệt hay không */
  needsWakeLock: boolean;
  /** Có cần cảnh báo khi document.visibilityState === 'hidden' hay không */
  needsVisibleTabCheck: boolean;
  /** Có khuyến nghị dùng Webcam PiP trong web hay không */
  webcamInWebRecommended: boolean;
  /** Tự động thử mở khóa Audio Master Bus khi tải trang (phù hợp CEF Browser Source) */
  autoStartLive: boolean;
}

export interface BroadcastOutputModeMeta {
  id: BroadcastOutputModeId;
  label: string;
  shortLabel: string;
  icon: string;
  status: 'available' | 'coming_soon';
  badge?: string;
  description: string;
  recommendedSize?: string;
  checklistProfile: BroadcastChecklistProfile;
  setupSteps: string[];
}

export const BROADCAST_OUTPUT_MODES: BroadcastOutputModeMeta[] = [
  {
    id: 'window_capture',
    label: 'Window Capture (Cửa sổ Chrome)',
    shortLabel: 'Window Capture',
    icon: '🖥️',
    status: 'available',
    badge: 'Đầy đủ tính năng',
    description:
      'Mở trang Stage trên cửa sổ Chrome riêng rồi chọn nguồn Window Capture trong TikTok LIVE Studio. Hỗ trợ đầy đủ Wake Lock và Webcam PiP ngay trong web.',
    recommendedSize: '9:16 (giữ cửa sổ luôn hiển thị, không thu nhỏ)',
    checklistProfile: {
      needsWakeLock: true,
      needsVisibleTabCheck: true,
      webcamInWebRecommended: true,
      autoStartLive: false,
    },
    setupSteps: [
      'Bấm "Mở Chế Độ Live (9:16)" trên Chrome và giữ cửa sổ luôn hiển thị.',
      'Bấm nút "🔴 BẮT ĐẦU CHẾ ĐỘ LIVE" trên Stage để mở khóa Audio Master Bus & Wake Lock.',
      'Trong TikTok LIVE Studio: chọn Window Capture + System Audio + Microphone vật lý.',
    ],
  },
  {
    id: 'browser_source',
    label: 'Browser Source (Nguồn Trình Duyệt)',
    shortLabel: 'Browser Source',
    icon: '🌐',
    status: 'available',
    badge: 'Gọn nhẹ · Chống tụt FPS',
    description:
      'Nhúng thẳng URL Stage vào nguồn Link / Browser Source của TikTok LIVE Studio hoặc OBS. Không lo thu nhỏ tab Chrome, tự động đồng bộ Health Monitor & Pre-Live Checklist qua Server.',
    recommendedSize: '1080 × 1920 · 60 FPS',
    checklistProfile: {
      needsWakeLock: false,
      needsVisibleTabCheck: false,
      webcamInWebRecommended: false,
      autoStartLive: true,
    },
    setupSteps: [
      'Copy đường dẫn Browser Source bên dưới và dán vào nguồn Link / Browser trong TikTok LIVE Studio hoặc OBS (kích thước 1080×1920, 60 FPS).',
      'Stage sẽ tự động mở khóa âm thanh; nếu thấy lớp phủ chờ, bấm "Interact (Tương tác)" rồi click 1 lần.',
      'Thêm Camera chủ phòng trực tiếp bằng nguồn Camera của TikTok LIVE Studio để ổn định nhất.',
    ],
  },
  {
    id: 'rtmp_stream',
    label: 'URL Stream / RTMP Trực Tiếp',
    shortLabel: 'RTMP / URL Stream',
    icon: '📡',
    status: 'coming_soon',
    badge: 'Giai đoạn 3',
    description:
      'Đẩy luồng video + Audio Master Bus (MediaStreamAudioDestinationNode) trực tiếp tới Server URL & Stream Key (TikTok, Facebook, YouTube, Custom RTMP) qua FFmpeg mà không cần mở phần mềm trung gian.',
    recommendedSize: '1080 × 1920 · 60 FPS · CBR 4500–6000 kbps',
    checklistProfile: {
      needsWakeLock: true,
      needsVisibleTabCheck: true,
      webcamInWebRecommended: true,
      autoStartLive: false,
    },
    setupSteps: [
      'Nhánh MediaStreamAudioDestinationNode đã được đấu nối sẵn trong LiveRuntime Master Bus.',
      'Giai đoạn 3 sẽ bổ sung form nhập RTMP Server URL + Stream Key và worker FFmpeg ở backend.',
    ],
  },
];

export function getBroadcastModeMeta(id: BroadcastOutputModeId): BroadcastOutputModeMeta {
  return (
    BROADCAST_OUTPUT_MODES.find((m) => m.id === id) || BROADCAST_OUTPUT_MODES[0]
  );
}

export function isBroadcastOutputModeId(val: unknown): val is BroadcastOutputModeId {
  return val === 'window_capture' || val === 'browser_source' || val === 'rtmp_stream';
}

export function buildStageUrl(origin: string, mode: BroadcastOutputModeId): string {
  const base = origin ? `${origin}/?view=stage` : '/?view=stage';
  if (mode === 'browser_source') {
    return `${base}&output=browser_source`;
  }
  if (mode === 'window_capture') {
    return `${base}&output=window_capture`;
  }
  return base;
}

export function detectStageOutputModeFromUrl(): BroadcastOutputModeId {
  if (typeof window === 'undefined') return 'window_capture';
  try {
    const params = new URLSearchParams(window.location.search);
    const out = params.get('output');
    if (out === 'browser_source' || out === 'browser') return 'browser_source';
    if (out === 'rtmp_stream' || out === 'rtmp') return 'rtmp_stream';
  } catch {}
  return 'window_capture';
}

