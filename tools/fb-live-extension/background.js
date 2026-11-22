// Service Worker chạy ở tầng trình duyệt (miễn nhiễm 100% với Content-Security-Policy của trang facebook.com)
const DEFAULT_SERVER = 'http://localhost:3002';

async function sendPayload(server, payload) {
  try {
    const r = await fetch(`${server}/api/facebook/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      const t = await r.text();
      if (t) return JSON.parse(t);
    }
  } catch {}

  const list = Array.isArray(payload.comments) ? payload.comments : [];
  for (const item of list) {
    const commentText = String(item.comment || '').trim();
    let stars = Number(item.stars) || 0;
    if (!stars && commentText) {
      const m =
        commentText.match(
          /(?:đã gửi|vừa gửi|gửi tặng|đã tặng|tặng|sent|gifted)\s+(\d{1,7})\s*(?:sao|stars?|⭐)/i,
        ) || commentText.match(/⭐\s*(\d{1,7})\s*(?:sao|stars?)?/i);
      if (m && m[1]) stars = parseInt(m[1], 10);
    }
    if (!commentText && !stars) continue;

    const nickname = item.nickname || 'Khán giả FB';
    const username =
      item.username ||
      'fb_' +
        nickname
          .normalize('NFKD')
          .replace(/[^a-zA-Z0-9]/g, '')
          .toLowerCase();

    if (commentText) {
      await fetch(`${server}/api/test/emit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'chat',
          data: {
            userId: username,
            username,
            nickname,
            platform: 'facebook',
            comment: commentText,
            avatar: item.avatar || '',
          },
        }),
      });
    }

    if (stars > 0) {
      await fetch(`${server}/api/test/emit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'gift',
          data: {
            userId: username,
            username,
            nickname,
            platform: 'facebook',
            giftName: '⭐ Sao Facebook',
            giftId: 9901,
            diamondCount: stars,
            repeatCount: 1,
            coins: stars,
            avatar: item.avatar || '',
          },
        }),
      });
    }
  }
  return { success: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === 'FB_LIVE_INGEST' && msg.payload) {
    const server = msg.server || DEFAULT_SERVER;
    sendPayload(server, msg.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  return false;
});
