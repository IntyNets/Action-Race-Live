// Chạy ngầm ở tầng MAIN của trang Facebook: Tự động bắt gói tin JSON GraphQL bình luận, Thả Tim/Like, Sao & Quà Facebook Live
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
  } catch { }

  if (!location.hostname.includes('facebook.com')) return;
  if (window.__VN_FB_NET_HOOKED) return;
  window.__VN_FB_NET_HOOKED = true;

  const seenIds = new Set();
  const feedbackReactionMap = new Map();

  function rememberId(key) {
    if (seenIds.has(key)) return false;
    seenIds.add(key);
    if (seenIds.size > 3500) {
      const first = seenIds.values().next().value;
      if (first) seenIds.delete(first);
    }
    return true;
  }

  function extractStarsFromText(text) {
    if (!text || typeof text !== 'string') return 0;
    const m =
      text.match(
        /(?:đã gửi|vừa gửi|gửi tặng|đã tặng|tặng|ủng hộ|sent|gifted)\s+(\d[\d.,]*)\s*(?:sao|stars?|⭐)/i,
      ) ||
      text.match(/⭐\s*(\d[\d.,]*)\s*(?:sao|stars?)?/i) ||
      text.match(/\b(\d[\d.,]*)\s*(?:sao|stars?)\s*⭐/i);
    if (!m || !m[1]) return 0;
    const n = parseInt(m[1].replace(/[.,]/g, ''), 10);
    return n > 0 && n <= 1000000 ? n : 0;
  }

  function extractGiftAndStarsFromNode(obj) {
    if (!obj || typeof obj !== 'object') return { stars: 0, coins: 0, giftName: '', isStickerLike: false };
    const directStars =
      Number(obj.stars_count) ||
      Number(obj.star_count) ||
      Number(obj.stars_amount) ||
      Number(obj.amount_in_stars) ||
      Number(obj.comment_stars_info?.stars_count) ||
      Number(obj.comment_stars_info?.star_count) ||
      Number(obj.comment_stars_info?.amount) ||
      Number(obj.stars_transaction?.stars_count) ||
      Number(obj.stars_transaction?.amount) ||
      Number(obj.live_video_stars_info?.stars_count) ||
      0;
    if (directStars > 0) {
      return { stars: directStars, coins: directStars, giftName: `⭐ ${directStars} Sao Facebook`, isStickerLike: false };
    }

    // Quà ảo Facebook Live (Virtual Gift / Paid Gift)
    const vg =
      obj.virtual_gift ||
      obj.live_virtual_gift ||
      obj.gift_info ||
      obj.comment_gift_info ||
      obj.paid_entity;
    if (vg && typeof vg === 'object') {
      const gCoins =
        Number(vg.stars_count) ||
        Number(vg.star_count) ||
        Number(vg.coin_count) ||
        Number(vg.amount) ||
        Number(vg.price) ||
        25;
      const gName =
        vg.name ||
        vg.title ||
        vg.gift_name ||
        vg.label ||
        '🎁 Quà Facebook Live';
      return { stars: gCoins, coins: gCoins, giftName: String(gName), isStickerLike: false };
    }

    let isStickerLike = false;
    if (Array.isArray(obj.attachments)) {
      for (const att of obj.attachments) {
        const n =
          Number(att?.target?.stars_count) ||
          Number(att?.target?.star_count) ||
          Number(att?.target?.amount) ||
          Number(att?.target?.coin_count) ||
          extractStarsFromText(att?.title_with_entities?.text) ||
          extractStarsFromText(att?.description?.text) ||
          extractStarsFromText(att?.media?.accessibility_caption);
        if (n > 0) {
          return { stars: n, coins: n, giftName: `⭐ ${n} Sao Facebook`, isStickerLike: false };
        }
        const attText = `${att?.title_with_entities?.text || ''} ${att?.description?.text || ''}`.trim();
        if (/(?:phần quà|món quà|quà tặng|sent a gift|virtual gift)/i.test(attText)) {
          return { stars: 25, coins: 25, giftName: attText.slice(0, 40) || '🎁 Quà Facebook', isStickerLike: false };
        }
        const styleStr = JSON.stringify(att?.style_list || att?.__typename || '').toLowerCase();
        if (styleStr.includes('sticker') || att?.media?.__typename === 'Sticker') {
          isStickerLike = true;
        }
      }
    }
    return { stars: 0, coins: 0, giftName: '', isStickerLike };
  }

  function emitComment(c) {
    if (!c || !c.nickname || (!c.comment && !c.stars && !c.coins && !c.giftName && !c.isLike)) return;
    const key =
      c.id || `${c.nickname}|${c.comment || ''}|${c.stars || c.coins || 0}|${c.isLike ? 'L' : ''}`;
    if (!rememberId(key)) return;
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
          coins: Number(c.coins) || 0,
          giftName: c.giftName || '',
          isLike: Boolean(c.isLike),
        },
      },
      '*',
    );
  }

  function emitReaction(info) {
    const likes = Math.max(1, Math.min(100, Number(info.likes) || 1));
    const key = info.id || `react_${info.username || info.nickname || 'anon'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (!rememberId(key)) return;
    window.postMessage(
      {
        type: 'VN_FB_EXT_REACTION',
        reaction: {
          likes,
          username: info.username || '',
          nickname: info.nickname || '',
          avatar: info.avatar || '',
        },
      },
      '*',
    );
  }

  function scanGraphQlObject(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 15) return;

    // 1) Bắt sự kiện Thả Tim / Like trực tiếp theo người dùng (Live Reaction / Feedback Reaction)
    const reactor = obj.reactor || (obj.reaction_type && (obj.actor || obj.user || obj.author));
    if (reactor && typeof reactor === 'object' && typeof reactor.name === 'string') {
      const rKey = `ureact_${obj.id || ''}_${reactor.id || reactor.name}_${obj.reaction_type || 'LIKE'}_${Math.floor(Date.now() / 1500)}`;
      emitReaction({
        id: rKey,
        likes: 1,
        username: reactor.id ? String(reactor.id) : '',
        nickname: reactor.name,
        avatar: reactor.profile_picture?.uri || '',
      });
    }

    // 2) Theo dõi tổng số cảm xúc (reaction_count / reactors) của luồng Live tăng lên theo thời gian thực
    const fbId = typeof obj.id === 'string' ? obj.id : '';
    const totalReactCount =
      typeof obj.reaction_count?.count === 'number'
        ? obj.reaction_count.count
        : typeof obj.reactors?.count === 'number'
          ? obj.reactors.count
          : null;
    if (fbId && totalReactCount !== null && totalReactCount >= 0) {
      const prev = feedbackReactionMap.get(fbId);
      feedbackReactionMap.set(fbId, totalReactCount);
      if (typeof prev === 'number' && totalReactCount > prev) {
        const delta = Math.min(50, totalReactCount - prev);
        emitReaction({
          id: `fbreact_${fbId}_${totalReactCount}`,
          likes: delta,
        });
      }
    }

    // 3) Bắt Bình luận, Tặng Sao, Quà Ảo & Sticker Thả Tim/Like
    const author = obj.author || obj.sender || obj.actor || obj.user || obj.stars_sender;
    if (author && typeof author === 'object' && typeof author.name === 'string') {
      const bodyText =
        typeof obj.body?.text === 'string'
          ? obj.body.text
          : typeof obj.message?.text === 'string'
            ? obj.message.text
            : '';
      const giftMeta = extractGiftAndStarsFromNode(obj);
      const textStars = extractStarsFromText(bodyText);
      const finalStars = giftMeta.stars || textStars;
      const finalCoins = giftMeta.coins || finalStars;

      if (bodyText || finalCoins > 0 || giftMeta.giftName || giftMeta.isStickerLike) {
        const createdTime = Number(obj.created_time) || 0;
        if (!createdTime || Date.now() / 1000 - createdTime < 90) {
          emitComment({
            id:
              obj.id ||
              `${author.id || author.name}_${createdTime}_${bodyText.slice(0, 20)}_${finalCoins}_${giftMeta.isStickerLike ? 'S' : ''}`,
            username: author.id ? String(author.id) : '',
            nickname: author.name,
            comment: bodyText || (giftMeta.isStickerLike ? '❤️' : ''),
            stars: finalStars,
            coins: finalCoins,
            giftName: giftMeta.giftName,
            isLike: giftMeta.isStickerLike,
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
      !text.includes('"gift"') &&
      !text.includes('"reaction"') &&
      !text.includes('"reactors"') &&
      !text.includes('"sticker"') &&
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
      } catch { }
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
      (this.__vnUrl.includes('graphql') ||
        this.__vnUrl.includes('comment') ||
        this.__vnUrl.includes('live'))
    ) {
      this.addEventListener('load', function () {
        try {
          if (typeof this.responseText === 'string') {
            inspectResponseText(this.responseText);
          }
        } catch { }
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
      if (url.includes('graphql') || url.includes('comment') || url.includes('live')) {
        res
          .clone()
          .text()
          .then((t) => inspectResponseText(t))
          .catch(() => { });
      }
    } catch { }
    return res;
  };
})();
