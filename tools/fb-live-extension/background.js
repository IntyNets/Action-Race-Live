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

  if (typeof payload.likes === 'number' && payload.likes > 0) {
    const uid =
      payload.username ||
      (payload.nickname && payload.nickname !== 'Khán giả Facebook'
        ? 'fb_' +
          payload.nickname
            .normalize('NFKD')
            .replace(/[^a-zA-Z0-9]/g, '')
            .toLowerCase()
        : 'fb_reaction');
    await fetch(`${server}/api/test/emit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'like',
        data: {
          userId: uid,
          username: uid,
          nickname: payload.nickname || 'Khán giả Facebook',
          avatar: payload.avatar || '',
          likeCount: payload.likes,
          platform: 'facebook',
        },
      }),
    }).catch(() => {});
  }

  const list = Array.isArray(payload.comments) ? payload.comments : [];
  for (const item of list) {
    const commentText = String(item.comment || '').trim();
    let coins = Math.max(Number(item.coins) || 0, Number(item.stars) || 0);
    if (!coins && commentText) {
      const m =
        commentText.match(
          /(?:đã gửi|vừa gửi|gửi tặng|đã tặng|tặng|ủng hộ|sent|gifted)\s+(\d[\d.,]*)\s*(?:sao|stars?|⭐)/i,
        ) || commentText.match(/⭐\s*(\d[\d.,]*)\s*(?:sao|stars?)?/i);
      if (m && m[1]) coins = parseInt(m[1].replace(/[.,]/g, ''), 10);
    }
    if (!commentText && !coins && !item.isLike) continue;

    const nickname = item.nickname || 'Khán giả FB';
    const username =
      item.username ||
      'fb_' +
        nickname
          .normalize('NFKD')
          .replace(/[^a-zA-Z0-9]/g, '')
          .toLowerCase();

    if (commentText || item.isLike) {
      await fetch(`${server}/api/test/emit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'chat',
          data: {
            userId: username,
            username,
            nickname,
            isFollower: true,
            platform: 'facebook',
            comment: commentText || '❤️',
            avatar: item.avatar || '',
          },
        }),
      }).catch(() => {});
    }

    if (item.isLike) {
      await fetch(`${server}/api/test/emit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'like',
          data: {
            userId: username,
            username,
            nickname,
            platform: 'facebook',
            likeCount: 3,
            avatar: item.avatar || '',
          },
        }),
      }).catch(() => {});
    }

    if (coins > 0) {
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
            giftName: item.giftName || `⭐ ${coins} Sao Facebook`,
            giftId: 9901,
            diamondCount: coins,
            repeatCount: 1,
            coins,
            avatar: item.avatar || '',
          },
        }),
      }).catch(() => {});
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
