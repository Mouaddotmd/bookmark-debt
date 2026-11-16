// Bookmark Debt — runs inside your own logged-in https://x.com/i/bookmarks tab.
//
// It asks X's own page to load the next pages of your bookmarks (the same
// loader the page uses when you scroll to the bottom, so the requests are
// X's own), and reads the posts from the page's memory. Nothing is
// written to disk, nothing leaves the page except what your agent reads.
// It never likes, reposts, unbookmarks or touches cookies.
//
//   await bd.load({ from: '2026-11-01', to: '2026-11-03' })   // by the day you SAVED them
//   bd.summary()        // while loading: bd.loaded / bd.reachedBack
//   bd.page(0)          // compact text of bookmarks 0–19, for reading
//   bd.get(['id', …])   // full detail (images, video, avatar) for the good ones
(() => {
  // A bookmark's sortIndex is a snowflake of the moment you saved it:
  // (sortIndex >> 22) + EPOCH = save time in ms. Calibrated against real
  // bookmarks; accurate to within minutes.
  const EPOCH = 1345287750720;
  const savedAt = (sortIndex) => Number(BigInt(sortIndex) >> 22n) + EPOCH;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const day = (v, end) => {
    if (v == null) return end ? Infinity : 0;
    if (typeof v === 'number') return v;
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${end ? '23:59:59.999' : '00:00:00'}` : v);
    if (Number.isNaN(t)) throw new Error(`Can't read the date "${v}"`);
    return t;
  };

  function fiberProps(test) {
    const root = document.querySelector('#react-root');
    if (!root) return null;
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
    const stack = [root[key]];
    let n = 0;
    while (stack.length && n++ < 100000) {
      const f = stack.pop();
      if (!f) continue;
      if (f.memoizedProps && test(f.memoizedProps)) return f.memoizedProps;
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  }

  function parts() {
    const store = fiberProps((p) => p.store && typeof p.store.getState === 'function')?.store;
    const timeline = fiberProps((p) => typeof p.fetchBottom === 'function' && p.module?.timelineId === 'bookmarks');
    if (!store || !timeline) throw new Error('Open https://x.com/i/bookmarks (logged in) and let it load, then try again.');
    return { store, timeline };
  }

  const decode = (s) => (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const clean = (u) => (u || '').split('?')[0];

  function textOf(t) {
    let text = t.note_tweet?.text || t.full_text || t.text || '';
    for (const u of [...(t.entities?.urls || []), ...(t.note_tweet?.entity_set?.urls || [])]) if (u.url) text = text.split(u.url).join(clean(u.expanded_url) || '');
    for (const m of t.extended_entities?.media || []) if (m.url) text = text.split(m.url).join('');
    return decode(text).trim();
  }

  function mediaOf(t) {
    return (t.extended_entities?.media || []).map((m) => {
      const mp4 = (m.video_info?.variants || []).filter((v) => v.content_type === 'video/mp4').sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
      return {
        type: m.type === 'photo' ? 'image' : m.type === 'animated_gif' ? 'gif' : 'video',
        image: m.media_url_https, alt: m.ext_alt_text || null,
        duration: m.video_info?.duration_millis ? Math.round(m.video_info.duration_millis / 1000) : null,
        video: mp4[0] ? clean(mp4[0].url) : null,
      };
    });
  }

  function cardOf(c) {
    if (!c || typeof c !== 'object') return null;
    const bv = c.binding_values || c.legacy?.binding_values;
    const vals = {};
    if (Array.isArray(bv)) for (const v of bv) vals[v.key] = v.value; else if (bv) Object.assign(vals, bv);
    const s = (k) => vals[k]?.string_value || null;
    return s('title') ? { title: s('title'), description: s('description') } : null;
  }

  function build(entry, st) {
    const tweets = st.entities.tweets.entities;
    const users = st.entities.users.entities;
    const cards = (st.entities.cards || {}).entities || {};
    const t = tweets[entry.content.id];
    if (!t) return null;
    const u = users[t.user] || {};
    const q = t.quoted_status ? tweets[t.quoted_status] : null;
    return {
      id: entry.content.id,
      saved: savedAt(entry.sortIndex),
      posted: Date.parse(t.created_at),
      url: `https://x.com/${u.screen_name || 'i'}/status/${entry.content.id}`,
      author: { name: u.name, handle: u.screen_name, avatar: u.profile_image_url_https },
      text: textOf(t),
      media: mediaOf(t),
      card: cardOf(typeof t.card === 'string' ? cards[t.card] : t.card),
      quoted: q ? { handle: (users[q.user] || {}).screen_name, text: textOf(q), media: mediaOf(q) } : null,
      likes: t.favorite_count, views: Number(t.views?.count) || null,
    };
  }

  const S = {
    items: [], range: null, status: 'idle', reason: null, pages: 0, seconds: 0, loaded: 0, reachedBack: null,

    // Loads every bookmark you saved between `from` and `to` (dates or ISO
    // times). Stops as soon as it passes `from`. ~20 bookmarks per page.
    async load({ from, to, max = 5000 } = {}) {
      const start = performance.now();
      const lo = day(from, false), hi = day(to, true);
      const { store, timeline } = parts();
      Object.assign(S, { status: 'loading', reason: null, pages: 0, range: { from: new Date(lo).toISOString(), to: hi === Infinity ? null : new Date(hi).toISOString() } });

      const tweetsIn = () => store.getState().urt.bookmarks.entries.filter((e) => e.type === 'tweet');
      let stuck = 0;
      try {
        while (true) {
          const entries = tweetsIn();
          const oldest = entries.length ? savedAt(entries[entries.length - 1].sortIndex) : Infinity;
          S.loaded = entries.length;
          S.reachedBack = oldest === Infinity ? null : new Date(oldest).toISOString().slice(0, 10);
          if (oldest < lo) { S.reason = 'reached the start of the range'; break; }
          if (entries.length >= max) { S.reason = `stopped at ${max} bookmarks`; break; }

          const before = entries.length;
          const r = timeline.fetchBottom();
          if (r && r.then) await r;
          let waited = 0;
          while (tweetsIn().length === before && waited < 8000) { await sleep(150); waited += 150; }
          S.pages++;
          if (tweetsIn().length === before) {
            if (++stuck >= 2) { S.reason = 'reached your oldest bookmark'; break; }
          } else stuck = 0;
          // A short, uneven pause between pages: brisk, but not a hammer.
          await sleep(500 + Math.random() * 700);
        }
        const st = store.getState();
        S.items = tweetsIn().map((e) => build(e, st)).filter((b) => b && b.saved >= lo && b.saved <= hi);
        S.status = 'done';
      } catch (err) {
        S.status = 'error';
        S.reason = String(err?.message || err);
      }
      S.seconds = Math.round((performance.now() - start) / 1000);
      return S.summary();
    },

    summary() {
      const it = S.items;
      return {
        status: S.status, reason: S.reason, bookmarks: it.length, pages: S.pages, seconds: S.seconds,
        newestSaved: it[0] ? new Date(it[0].saved).toISOString() : null,
        oldestSaved: it.length ? new Date(it[it.length - 1].saved).toISOString() : null,
        withVideo: it.filter((b) => b.media.some((m) => m.type !== 'image')).length,
        withImages: it.filter((b) => b.media.some((m) => m.type === 'image')).length,
        pagesToRead: Math.ceil(it.length / 20),
      };
    },

    // Compact text for reading and scoring, 20 at a time. Returned as a list
    // because browser tools cut long single strings short.
    page(i = 0, size = 20) {
      return S.items.slice(i * size, (i + 1) * size).map((b) => {
        const lines = [`### ${b.id} · @${b.author.handle} · saved ${new Date(b.saved).toISOString().slice(0, 10)}`];
        if (b.text) lines.push(b.text.length > 900 ? b.text.slice(0, 900) + ' […]' : b.text);
        const media = b.media.map((m) => m.type === 'video' ? `video ${m.duration || '?'}s` : m.type);
        if (media.length) lines.push(`media: ${media.join(', ')}${b.media.some((m) => m.alt) ? ` (alt: ${b.media.map((m) => m.alt).filter(Boolean).join(' / ').slice(0, 200)})` : ''}`);
        if (b.card) lines.push(`link: ${[b.card.title, b.card.description].filter(Boolean).join(' — ').slice(0, 250)}`);
        if (b.quoted) lines.push(`quoting @${b.quoted.handle}: ${b.quoted.text.slice(0, 400)}`);
        return lines.join('\n');
      });
    },

    // What the board and media step need for the chosen bookmarks, kept
    // small. (`by`, not `author`: browser tools redact a key named author.)
    get(ids) {
      const want = new Set(ids.map(String));
      return S.items.filter((b) => want.has(b.id)).map((b) => ({
        id: b.id, saved: b.saved, url: b.url,
        by: { name: b.author.name, handle: b.author.handle, avatar: b.author.avatar },
        text: b.text.length > 400 ? b.text.slice(0, 400) + '…' : b.text,
        media: [...b.media, ...(b.quoted?.media || [])].map(({ type, image, duration, video }) => ({ type, image, duration, video })),
        link: b.card?.title || null,
      }));
    },

    // Hands every loaded bookmark to bridge.mjs on this computer, so no agent
    // has to copy them. X's page can't talk to localhost itself, and browsers
    // only allow the small helper window after a real click, so this adds one
    // button to the page. Click it, then poll bd.saved.
    save({ port, token, name = 'incoming.json' }) {
      const base = `http://127.0.0.1:${port}`;
      const handle = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.replace('/', '') || null;
      const body = JSON.stringify({
        range: S.range, account: handle,
        items: S.items.map((b) => ({
          id: b.id, saved: b.saved, posted: b.posted, url: b.url,
          by: { name: b.author.name, handle: b.author.handle, avatar: b.author.avatar },
          text: b.text, media: [...b.media, ...(b.quoted?.media || [])], card: b.card,
          quoted: b.quoted ? { handle: b.quoted.handle, text: b.quoted.text } : null,
          likes: b.likes, views: b.views,
        })),
      });
      S.saved = { status: 'waiting for click', bytes: body.length };
      document.getElementById('bookmark-debt-save')?.remove();
      const button = document.createElement('button');
      button.id = 'bookmark-debt-save';
      button.textContent = 'Save to Bookmark Debt';
      button.style.cssText = 'position:fixed;left:50%;top:40%;transform:translateX(-50%);z-index:2147483647;width:220px;height:64px;font:600 16px system-ui;background:#000;color:#fff;border:2px solid #fff;border-radius:12px;cursor:pointer';
      button.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation(); button.remove();
        const win = window.open(`${base}/receiver?token=${token}`, 'bookmark_debt_receiver', 'width=420,height=160');
        if (!win) { S.saved = { status: 'popup blocked' }; return; }
        S.saved.status = 'sending';
        const listen = (m) => {
          if (m.origin !== base || !m.data?.bd) return;
          if (m.data.bd === 'ready') win.postMessage({ token, name, body, last: true }, base);
          if (m.data.bd === 'saved') { S.saved = { status: m.data.ok ? 'done' : 'failed', name, bytes: body.length }; removeEventListener('message', listen); }
        };
        addEventListener('message', listen);
      }, true);
      document.body.appendChild(button);
      return S.saved;
    },
  };

  window.bd = S;
  return 'Bookmark Debt ready: await bd.load({ from: "YYYY-MM-DD", to: "YYYY-MM-DD" })';
})();
