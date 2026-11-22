// Content Script chạy ngầm tự động: nhận bình luận từ cả Network GraphQL Interceptor + quét DOM
// Tuyệt đối KHÔNG CẦN bấm F12 hay mở Console!
(() => {
  try {
    if (typeof Node !== 'undefined' && !Node.prototype.getAttribute) {
      Object.defineProperty(Node.prototype, 'getAttribute', {
        value: function () {
          return null;
        },
        configurable: true,
        writable: true,
      });
    }
  } catch {}

  const seen = new Set();
  let badge = null;

  function ensureBadge(lastText = '') {
    if (!document.body) return;
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'vn-fb-ext-badge';
      badge.style.cssText =
        'position:fixed;bottom:16px;right:16px;z-index:999999;background:linear-gradient(135deg,#065f46,#0f172a);color:#fff;padding:9px 14px;border-radius:12px;font:600 12px/1.45 system-ui,sans-serif;box-shadow:0 8px 22px rgba(0,0,0,0.5);border:1.5px solid #34d399;pointer-events:none;transition:all 0.2s;';
      document.body.appendChild(badge);
    }
    badge.innerHTML =
      '🟢 <b>Kết nối 3D Race Live (Tự động bắt bình luận & Sao FB)</b><br/><span style="font-size:11px;color:#a7f3d0">' +
      (lastText ? lastText.slice(0, 62) : 'Đang lắng nghe bình luận Facebook Live...') +
      '</span>';
  }

  function detectStarsInText(str) {
    if (!str) return 0;
    const m =
      str.match(
        /(?:đã gửi|vừa gửi|gửi tặng|đã tặng|tặng|sent|gifted)\s+(\d{1,7})\s*(?:sao|stars?|⭐)/i,
      ) ||
      str.match(/⭐\s*(\d{1,7})\s*(?:sao|stars?)?/i) ||
      str.match(/\b(\d{1,7})\s*(?:sao|stars?)\b/i);
    return m && m[1] ? parseInt(m[1], 10) : 0;
  }

  function forwardItem(item) {
    if (!item || !item.nickname || (!item.comment && !item.stars)) return;
    const stars = Number(item.stars) || detectStarsInText(item.comment) || 0;
    const key = `${item.nickname}|${item.comment || ''}|${stars}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 3000) {
      const first = seen.values().next().value;
      if (first) seen.delete(first);
    }

    const label =
      stars > 0
        ? `⭐ ${item.nickname} tặng ${stars} Sao ${item.comment || ''}`
        : `${item.nickname}: ${item.comment}`;
    ensureBadge(label);

    chrome.runtime.sendMessage({
      type: 'FB_LIVE_INGEST',
      payload: {
        videoId: location.href.slice(0, 120),
        pageName:
          document.title.replace(/\(\d+\)\s*/, '').slice(0, 45) ||
          'Facebook Live',
        comments: [
          {
            id: item.id || `${key}|${Date.now()}`,
            username: item.username || '',
            nickname: item.nickname,
            comment: item.comment || '',
            avatar: item.avatar || '',
            stars,
          },
        ],
      },
    });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data && e.data.type === 'VN_FB_EXT_CAPTURED' && e.data.item) {
      forwardItem(e.data.item);
    }
  });

  function safeAttr(node, attr) {
    return node && typeof node.getAttribute === 'function'
      ? node.getAttribute(attr) || ''
      : '';
  }

  function parseArticle(el, isInitial) {
    if (!el || typeof el.getAttribute !== 'function') return;
    const aria = safeAttr(el, 'aria-label');
    if (!aria && !el.querySelector('div[dir="auto"]')) return;

    let nickname = '';
    const linkSpans = el.querySelectorAll(
      'a[role="link"] span[dir="auto"], a span[dir="auto"], span[dir="auto"] a',
    );
    for (const s of linkSpans) {
      const t = (s.textContent || '').trim();
      if (
        t &&
        t.length >= 2 &&
        t.length <= 50 &&
        !/^(Thích|Phản hồi|Chia sẻ|Like|Reply|Share|Theo dõi|Follow|Tác giả|Author|\d+\s*(phút|giờ|giây|ngày|tuần|m|h|s|d|w))$/i.test(
          t,
        )
      ) {
        nickname = t;
        break;
      }
    }

    const textBlocks = [];
    el.querySelectorAll('div[dir="auto"]').forEach((d) => {
      if (d.querySelector('div[dir="auto"]')) return;
      const t = (d.innerText || d.textContent || '').trim();
      if (t && t !== nickname) textBlocks.push(t);
    });
    const comment = textBlocks.join(' ').trim();
    let stars = detectStarsInText(comment) || detectStarsInText(aria);
    if (!stars) {
      el.querySelectorAll('[aria-label], img[alt]').forEach((node) => {
        if (stars) return;
        const s = detectStarsInText(
          safeAttr(node, 'aria-label') || safeAttr(node, 'alt'),
        );
        if (s > 0) stars = s;
      });
    }
    if (!nickname || (!comment && !stars)) return;

    let avatar = '';
    const svgImg = el.querySelector('svg image');
    if (svgImg)
      avatar = safeAttr(svgImg, 'xlink:href') || safeAttr(svgImg, 'href');
    if (!avatar) {
      const img = el.querySelector('img');
      if (img && img.src && !img.src.includes('emoji')) avatar = img.src;
    }

    const key = `${nickname}|${comment}|${stars}`;
    if (isInitial) {
      seen.add(key);
      return;
    }
    forwardItem({
      id: `${key}|${Date.now()}`,
      nickname,
      comment,
      avatar,
      stars,
    });
  }

  setTimeout(() => {
    if (location.hostname.includes('facebook.com')) {
      document
        .querySelectorAll('div[role="article"]')
        .forEach((el) => parseArticle(el, true));
    }
    if (location.href.includes('live') || location.href.includes('video')) {
      ensureBadge();
    }
  }, 1500);

  setInterval(() => {
    if (location.hostname.includes('facebook.com')) {
      document
        .querySelectorAll('div[role="article"]')
        .forEach((el) => parseArticle(el, false));
    }
  }, 850);
})();
