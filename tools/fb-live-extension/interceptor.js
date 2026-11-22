// Chạy ngầm ở tầng MAIN của trang Facebook: Tự động bắt gói tin JSON GraphQL bình luận Live của Facebook
// Hoạt động ngay cả khi cửa sổ Facebook bị thu nhỏ (Minimize) hoặc chuyển sang tab khác!
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
    if (typeof Window !== 'undefined' && !Window.prototype.getAttribute) {
      Object.defineProperty(Window.prototype, 'getAttribute', {
        value: function () {
          return null;
        },
        configurable: true,
        writable: true,
      });
    }
  } catch {}

  if (!location.hostname.includes('facebook.com')) return;
  if (window.__VN_FB_NET_HOOKED) return;
  window.__VN_FB_NET_HOOKED = true;

  const seenIds = new Set();

  function extractStarsFromText(text) {
    if (!text || typeof text !== 'string') return 0;
    const m =
      text.match(
        /(?:đã gửi|vừa gửi|gửi tặng|đã tặng|tặng|sent|gifted)\s+(\d{1,7})\s*(?:sao|stars?|⭐)/i,
      ) ||
      text.match(/⭐\s*(\d{1,7})\s*(?:sao|stars?)?/i) ||
      text.match(/\b(\d{1,7})\s*(?:sao|stars?)\s*⭐/i);
    return m && m[1] ? parseInt(m[1], 10) : 0;
  }

  function extractStarsFromNode(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    const direct =
      Number(obj.stars_count) ||
      Number(obj.star_count) ||
      Number(obj.stars_amount) ||
      Number(obj.comment_stars_info?.stars_count) ||
      Number(obj.comment_stars_info?.star_count) ||
      Number(obj.comment_stars_info?.amount) ||
      Number(obj.stars_transaction?.stars_count) ||
      Number(obj.stars_transaction?.amount) ||
      Number(obj.live_video_stars_info?.stars_count) ||
      0;
    if (direct > 0) return direct;

    if (Array.isArray(obj.attachments)) {
      for (const att of obj.attachments) {
        const n =
          Number(att?.target?.stars_count) ||
          Number(att?.target?.star_count) ||
          Number(att?.target?.amount) ||
          extractStarsFromText(att?.title_with_entities?.text) ||
          extractStarsFromText(att?.description?.text) ||
          extractStarsFromText(att?.media?.accessibility_caption);
        if (n > 0) return n;
      }
    }
    return 0;
  }

  function emitComment(c) {
    if (!c || !c.nickname || (!c.comment && !c.stars)) return;
    const key = c.id || `${c.nickname}|${c.comment || ''}|${c.stars || 0}`;
    if (seenIds.has(key)) return;
    seenIds.add(key);
    if (seenIds.size > 3000) {
      const first = seenIds.values().next().value;
      if (first) seenIds.delete(first);
    }
    window.postMessage(
      {
        type: 'VN_FB_EXT_CAPTURED',
        item: {
          id: String(key),
          username: c.username || '',
          nickname: String(c.nickname).trim(),
          comment: String(c.comment || '').trim(),
          avatar: c.avatar || '',
          stars: Number(c.stars) || 0,
        },
      },
      '*',
    );
  }

  function scanGraphQlObject(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 14) return;

    const author = obj.author || obj.sender || obj.actor || obj.user;
    if (author && typeof author === 'object' && typeof author.name === 'string') {
      const bodyText =
        typeof obj.body?.text === 'string'
          ? obj.body.text
          : typeof obj.message?.text === 'string'
            ? obj.message.text
            : '';
      const nodeStars =
        extractStarsFromNode(obj) || extractStarsFromText(bodyText);

      if (bodyText || nodeStars > 0) {
        const createdTime = Number(obj.created_time) || 0;
        if (!createdTime || Date.now() / 1000 - createdTime < 60) {
          emitComment({
            id:
              obj.id ||
              `${author.id || author.name}_${createdTime}_${bodyText.slice(0, 20)}_${nodeStars}`,
            username: author.id ? String(author.id) : '',
            nickname: author.name,
            comment: bodyText,
            stars: nodeStars,
            avatar:
              author.profile_picture?.uri ||
              author.profile_picture_depth_0?.uri ||
              '',
          });
        }
      }
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) scanGraphQlObject(obj[i], depth + 1);
    } else {
      for (const k of Object.keys(obj)) {
        const val = obj[k];
        if (val && typeof val === 'object') scanGraphQlObject(val, depth + 1);
      }
    }
  }

  function inspectResponseText(text) {
    if (!text || typeof text !== 'string') return;
    if (
      !text.includes('"body"') &&
      !text.includes('"stars"') &&
      !text.includes('"star_count"') &&
      !text.includes('"message"')
    )
      return;
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim().replace(/^for\s*\(\s*;\s*;\s*\)\s*;/, '');
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        scanGraphQlObject(parsed, 0);
      } catch {}
    }
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__vnUrl = String(url || '');
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (
      this.__vnUrl &&
      (this.__vnUrl.includes('graphql') || this.__vnUrl.includes('comment'))
    ) {
      this.addEventListener('load', function () {
        try {
          if (typeof this.responseText === 'string') {
            inspectResponseText(this.responseText);
          }
        } catch {}
      });
    }
    return origSend.apply(this, args);
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url =
        typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('graphql') || url.includes('comment')) {
        res
          .clone()
          .text()
          .then((t) => inspectResponseText(t))
          .catch(() => {});
      }
    } catch {}
    return res;
  };
})();
