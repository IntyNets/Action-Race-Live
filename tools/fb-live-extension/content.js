// Content Script chạy ngầm tự động: nhận Bình luận, Thả Tim/Like, Tặng Sao & Quà từ cả Network GraphQL + quét DOM Facebook Live
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
  let lastDomReactionCount = -1;

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
      '🟢 <b>Kết nối Action Race Live 3D (Bình luận · Tim/Like · Sao & Quà FB)</b><br/><span style="font-size:11px;color:#a7f3d0">' +
      (lastText ? lastText.slice(0, 68) : 'Đang lắng nghe tương tác Facebook Live...') +
      '</span>';
  }

  function detectStarsInText(str) {
    if (!str) return 0;
    const m =
      str.match(
        /(?:đã gửi|vừa gửi|gửi tặng|đã tặng|tặng|ủng hộ|sent|gifted)\s+(\d[\d.,]*)\s*(?:sao|stars?|⭐)/i,
      ) ||
      str.match(/⭐\s*(\d[\d.,]*)\s*(?:sao|stars?)?/i) ||
      str.match(/\b(\d[\d.,]*)\s*(?:sao|stars?)\b/i);
    if (!m || !m[1]) return 0;
    const val = parseInt(m[1].replace(/[.,]/g, ''), 10);
    return val > 0 && val <= 1000000 ? val : 0;
  }

  function detectGiftInText(str) {
    if (!str) return { coins: 0, giftName: '' };
    if (
      /(?:đã gửi|vừa gửi|đã tặng|gửi tặng)\s+(?:một\s+)?(?:phần quà|món quà|quà tặng|quà\b|vương miện|rồng|tên lửa|hoa hồng)/i.test(
        str,
      ) ||
      /\b(?:sent a gift|sent a virtual gift|gifted a)\b/i.test(str)
    ) {
      if (/rồng|dragon|vương miện|crown|vip/i.test(str)) {
        return { coins: 120, giftName: '🐉 Quà VIP Facebook' };
      }
      if (/siêu nhân|pháo hoa|kim cương/i.test(str)) {
        return { coins: 60, giftName: '🦸 Siêu Quà Facebook' };
      }
      return { coins: 25, giftName: '🎁 Quà Facebook Live' };
    }
    return { coins: 0, giftName: '' };
  }

  function forwardItem(item) {
    if (!item || !item.nickname) return;
    const stars = Number(item.stars) || detectStarsInText(item.comment) || 0;
    const giftDet = detectGiftInText(`${item.giftName || ''} ${item.comment || ''}`);
    const coins = Number(item.coins) || stars || giftDet.coins || 0;
    const giftName =
      item.giftName ||
      (stars > 0 ? `⭐ ${stars} Sao Facebook` : giftDet.giftName || '');
    const isLike = Boolean(item.isLike);
    if (!item.comment && !coins && !isLike) return;

    const key = `${item.nickname}|${item.comment || ''}|${coins}|${isLike ? 'L' : ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 3000) {
      const first = seen.values().next().value;
      if (first) seen.delete(first);
    }

    const label =
      coins > 0
        ? `⭐ ${item.nickname} tặng ${giftName || coins + ' Sao'}`
        : isLike
          ? `❤️ ${item.nickname} thả tim / like!`
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
            comment: item.comment || (isLike ? '❤️' : ''),
            avatar: item.avatar || '',
            stars,
            coins,
            giftName,
            isLike,
          },
        ],
      },
    });
  }

  function forwardReaction(r) {
    const likes = Math.max(1, Math.min(100, Number(r?.likes) || 1));
    ensureBadge(
      r?.nickname
        ? `❤️ ${r.nickname} vừa thả tim / cảm xúc!`
        : `❤️ +${likes} lượt thả tim / like trên Facebook Live!`,
    );
    chrome.runtime.sendMessage({
      type: 'FB_LIVE_INGEST',
      payload: {
        videoId: location.href.slice(0, 120),
        pageName:
          document.title.replace(/\(\d+\)\s*/, '').slice(0, 45) ||
          'Facebook Live',
        likes,
        username: r?.username || '',
        nickname: r?.nickname || 'Khán giả Facebook',
        avatar: r?.avatar || '',
      },
    });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.type === 'VN_FB_EXT_CAPTURED' && e.data.item) {
      forwardItem(e.data.item);
    } else if (e.data.type === 'VN_FB_EXT_REACTION' && e.data.reaction) {
      forwardReaction(e.data.reaction);
    }
  });

  function safeAttr(node, attr) {
    return node && typeof node.getAttribute === 'function'
      ? node.getAttribute(attr) || ''
      : '';
  }

  function parseCompactCount(raw) {
    if (!raw) return -1;
    const clean = String(raw).trim().replace(/\s+/g, '');
    const m = clean.match(/^(\d+(?:[.,]\d+)?)([KMBkmb]|nghìn|triệu)?$/i);
    if (!m) return -1;
    let numStr = m[1];
    const suffix = (m[2] || '').toLowerCase();
    if (suffix) {
      const val = parseFloat(numStr.replace(',', '.'));
      if (suffix === 'k' || suffix === 'nghìn') return Math.round(val * 1000);
      if (suffix === 'm' || suffix === 'triệu') return Math.round(val * 1000000);
      if (suffix === 'b') return Math.round(val * 1000000000);
    }
    const digits = parseInt(numStr.replace(/[.,]/g, ''), 10);
    return Number.isFinite(digits) ? digits : -1;
  }

  // Quét bộ đếm tổng lượt Thích / Cảm xúc (👍 ❤️) trên giao diện video Facebook Live
  function scanLiveReactionsCounter(isInitial) {
    if (!document.body) return;
    let bestCount = -1;
    const nodes = document.querySelectorAll(
      '[aria-label*="cảm xúc"], [aria-label*="lượt thích"], [aria-label*="reaction"], [aria-label*="like"], span[role="toolbar"] ~ span',
    );
    nodes.forEach((el) => {
      const aria = safeAttr(el, 'aria-label');
      const txt = (el.textContent || '').trim();
      const source = aria || txt;
      const m =
        source.match(/(\d+(?:[.,]\d+)?\s*(?:[KMBkmb]|nghìn|triệu)?)\s*(?:lượt thích|cảm xúc|reactions?|likes?)/i) ||
        source.match(/^(?:Tất cả cảm xúc:|All reactions:)\s*(\d+(?:[.,]\d+)?\s*(?:[KMBkmb]|nghìn|triệu)?)/i);
      if (m && m[1]) {
        const parsed = parseCompactCount(m[1]);
        if (parsed > bestCount) bestCount = parsed;
      } else if (!aria && /^\d{1,7}$/.test(txt)) {
        const parsed = parseInt(txt, 10);
        if (parsed > bestCount) bestCount = parsed;
      }
    });

    if (bestCount >= 0) {
      if (isInitial || lastDomReactionCount < 0) {
        lastDomReactionCount = bestCount;
      } else if (bestCount > lastDomReactionCount) {
        const delta = Math.min(50, bestCount - lastDomReactionCount);
        lastDomReactionCount = bestCount;
        forwardReaction({ likes: delta });
      }
    }
  }

  function parseArticle(el, isInitial) {
    if (!el || typeof el.getAttribute !== 'function') return;
    const aria = safeAttr(el, 'aria-label');

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
    if (!nickname) return;

    const textBlocks = [];
    el.querySelectorAll('div[dir="auto"], span[dir="auto"]').forEach((d) => {
      if (d.querySelector('div[dir="auto"], span[dir="auto"]')) return;
      if (d.closest('a[role="link"]')) return;
      const t = (d.innerText || d.textContent || '').trim();
      if (
        t &&
        t !== nickname &&
        !/^(Thích|Phản hồi|Chia sẻ|Like|Reply|Share|Theo dõi|Follow|\d+\s*(phút|giờ|giây|ngày|tuần|m|h|s|d|w))$/i.test(
          t,
        )
      ) {
        textBlocks.push(t);
      }
    });

    // Bắt thêm emoji / sticker (👍 / ❤️) nếu bình luận chỉ có hình nhãn dán mà không có chữ
    let emojiAlt = '';
    let isStickerLike = false;
    el.querySelectorAll('img[alt], div[role="img"][aria-label]').forEach((imgNode) => {
      const alt = safeAttr(imgNode, 'alt') || safeAttr(imgNode, 'aria-label');
      if (alt && alt.length <= 16) {
        emojiAlt += alt;
      } else if (/thích|like|trái tim|heart|love|yêu thích|care|thương thương/i.test(alt)) {
        isStickerLike = true;
      }
    });

    const comment = (textBlocks.join(' ').trim() || emojiAlt).trim();
    const fullArticleText = `${comment} ${aria} ${(el.innerText || '').replace(/\s+/g, ' ')}`;

    let stars = detectStarsInText(fullArticleText);
    const giftDet = detectGiftInText(fullArticleText);

    if (!stars) {
      el.querySelectorAll('[aria-label], img[alt]').forEach((node) => {
        if (stars) return;
        const s = detectStarsInText(
          safeAttr(node, 'aria-label') || safeAttr(node, 'alt'),
        );
        if (s > 0) stars = s;
      });
    }

    const coins = stars || giftDet.coins;
    if (!comment && !coins && !isStickerLike) return;

    let avatar = '';
    const svgImg = el.querySelector('svg image');
    if (svgImg)
      avatar = safeAttr(svgImg, 'xlink:href') || safeAttr(svgImg, 'href');
    if (!avatar) {
      const img = el.querySelector('img');
      if (img && img.src && !img.src.includes('emoji')) avatar = img.src;
    }

    const key = `${nickname}|${comment}|${coins}|${isStickerLike ? 'L' : ''}`;
    if (isInitial) {
      seen.add(key);
      return;
    }
    forwardItem({
      id: `${key}|${Date.now()}`,
      nickname,
      comment: comment || (isStickerLike ? '❤️' : ''),
      avatar,
      stars,
      coins,
      giftName: giftDet.giftName,
      isLike: isStickerLike,
    });
  }

  setTimeout(() => {
    if (location.hostname.includes('facebook.com')) {
      document
        .querySelectorAll('div[role="article"]')
        .forEach((el) => parseArticle(el, true));
      scanLiveReactionsCounter(true);
    }
    if (location.href.includes('live') || location.href.includes('video') || location.href.includes('watch')) {
      ensureBadge();
    }
  }, 1500);

  setInterval(() => {
    if (location.hostname.includes('facebook.com')) {
      document
        .querySelectorAll('div[role="article"]')
        .forEach((el) => parseArticle(el, false));
      scanLiveReactionsCounter(false);
    }
  }, 850);
})();
