/**
 * Trích xuất màu chủ đạo rực rỡ từ ảnh đại diện (Avatar) người chơi để tô màu vật liệu
 * cho mô hình NOTBLOX_CHARACTER_MODELS. Có bộ nhớ đệm (cache) để không ảnh hưởng 60 FPS.
 */

const avatarColorCache = new Map<string, number>();
const pendingUrls = new Set<string>();

function boostVibrance(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // Nếu ảnh quá xám/tối, đẩy nhẹ độ sáng & độ bão hòa để nhân vật nổi bật trên đường đua
  let nr = r;
  let ng = g;
  let nb = b;
  if (max < 90) {
    const lift = 120 - max;
    nr = Math.min(255, nr + lift);
    ng = Math.min(255, ng + lift);
    nb = Math.min(255, nb + lift);
  } else if (max - min > 12) {
    const avg = (nr + ng + nb) / 3;
    nr = Math.max(0, Math.min(255, Math.round(avg + (nr - avg) * 1.28)));
    ng = Math.max(0, Math.min(255, Math.round(avg + (ng - avg) * 1.28)));
    nb = Math.max(0, Math.min(255, Math.round(avg + (nb - avg) * 1.28)));
  }
  return (nr << 16) | (ng << 8) | nb;
}

/**
 * Lấy màu chủ đạo của avatar; nếu chưa có trong cache sẽ tự tải nền và gọi `onResolved`.
 */
export function resolveAvatarColor(
  avatarUrl: string,
  fallbackHex: number,
  onResolved?: (hex: number) => void,
): number {
  if (!avatarUrl) return fallbackHex;

  const cached = avatarColorCache.get(avatarUrl);
  if (typeof cached === 'number') return cached;

  // Nếu là SVG data URI nội bộ (Mock/Bot), đọc thẳng mã màu fill="#xxxxxx" tức thì
  if (avatarUrl.startsWith('data:image/svg+xml')) {
    const decoded = decodeURIComponent(avatarUrl);
    const m = decoded.match(/fill="(#[0-9a-fA-F]{6})"/);
    if (m) {
      const hex = parseInt(m[1].slice(1), 16);
      avatarColorCache.set(avatarUrl, hex);
      return hex;
    }
    return fallbackHex;
  }

  // Nếu là ảnh Avatar TikTok thật (http/https), lấy mẫu nhanh 16x16 trên canvas ẩn
  if (!pendingUrls.has(avatarUrl)) {
    pendingUrls.add(avatarUrl);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      pendingUrls.delete(avatarUrl);
      try {
        const cv = document.createElement('canvas');
        cv.width = 16;
        cv.height = 16;
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let wSum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 120) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Ưu tiên điểm ảnh có màu sắc rực rỡ hơn nền đen/trắng
          const sat = Math.max(r, g, b) - Math.min(r, g, b);
          const weight = 0.25 + (sat / 255) * 2.5;
          rSum += r * weight;
          gSum += g * weight;
          bSum += b * weight;
          wSum += weight;
        }
        if (wSum > 0) {
          const hex = boostVibrance(
            Math.round(rSum / wSum),
            Math.round(gSum / wSum),
            Math.round(bSum / wSum),
          );
          avatarColorCache.set(avatarUrl, hex);
          onResolved?.(hex);
        }
      } catch {
        // Nếu CDN avatar chặn CORS canvas, giữ nguyên fallbackHex
        avatarColorCache.set(avatarUrl, fallbackHex);
      }
    };
    img.onerror = () => {
      pendingUrls.delete(avatarUrl);
      avatarColorCache.set(avatarUrl, fallbackHex);
    };
    img.src = avatarUrl;
  }

  return fallbackHex;
}

