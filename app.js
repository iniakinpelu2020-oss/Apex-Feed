(function () {
  'use strict';

  var KEY = 'apex.feed.v1';
  var LIMIT = 400;
  var RELAY_HINT = 'Could not read that feed. The site may block cross-origin requests \u2014 try a relay under CORS relay.';

  var state = { feeds: [], items: [], proxy: '' };
  var selected = 'all';
  var openKey = null;
  var busy = false;

  var el = {
    addForm: document.getElementById('addForm'),
    feedUrl: document.getElementById('feedUrl'),
    refreshAll: document.getElementById('refreshAll'),
    feedList: document.getElementById('feedList'),
    feedsEmpty: document.getElementById('feedsEmpty'),
    proxy: document.getElementById('proxy'),
    listPane: document.getElementById('listPane'),
    paneTitle: document.getElementById('paneTitle'),
    markAll: document.getElementById('markAll'),
    unsub: document.getElementById('unsub'),
    itemList: document.getElementById('itemList'),
    itemsEmpty: document.getElementById('itemsEmpty'),
    reader: document.getElementById('reader'),
    back: document.getElementById('back'),
    readerFeed: document.getElementById('readerFeed'),
    readerTitle: document.getElementById('readerTitle'),
    readerMeta: document.getElementById('readerMeta'),
    readerBody: document.getElementById('readerBody'),
    readerLink: document.getElementById('readerLink'),
    toast: document.getElementById('toast')
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.toast.hidden = true; }, 3200);
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (err) {
      return url;
    }
  }

  function load() {
    var raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (err) {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') raw = {};

    state.proxy = typeof raw.proxy === 'string' ? raw.proxy : '';
    state.feeds = (Array.isArray(raw.feeds) ? raw.feeds : []).filter(function (f) {
      return f && typeof f.url === 'string' && f.url;
    }).map(function (f) {
      return {
        id: f.id || uid(),
        url: f.url,
        title: typeof f.title === 'string' && f.title ? f.title : hostOf(f.url),
        added: Number(f.added) || Date.now(),
        error: typeof f.error === 'string' ? f.error : ''
      };
    });

    var ids = {};
    state.feeds.forEach(function (f) { ids[f.id] = true; });

    state.items = (Array.isArray(raw.items) ? raw.items : []).filter(function (it) {
      return it && it.feedId && ids[it.feedId] && typeof it.key === 'string';
    }).map(function (it) {
      return {
        key: it.key,
        feedId: it.feedId,
        title: typeof it.title === 'string' && it.title ? it.title : 'Untitled',
        link: typeof it.link === 'string' ? it.link : '',
        date: Number(it.date) || 0,
        text: typeof it.text === 'string' ? it.text : '',
        read: it.read === true
      };
    });
  }

  function save() {
    try {
      if (state.items.length > LIMIT) {
        state.items.sort(function (a, b) { return b.date - a.date; });
        state.items = state.items.slice(0, LIMIT);
      }
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      toast('Could not save \u2014 device storage may be full');
    }
  }

  function normalUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    try {
      var u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.href;
    } catch (err) {
      return '';
    }
  }

  function firstText(parent, names) {
    for (var i = 0; i < names.length; i++) {
      var found = parent.getElementsByTagName(names[i]);
      for (var j = 0; j < found.length; j++) {
        var t = (found[j].textContent || '').trim();
        if (t) return t;
      }
    }
    return '';
  }

  function linkOf(item) {
    var links = item.getElementsByTagName('link');
    var fallback = '';
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      if (!href) continue;
      var rel = links[i].getAttribute('rel');
      if (!rel || rel === 'alternate') return href;
      if (!fallback) fallback = href;
    }
    return fallback || firstText(item, ['link']);
  }

  function pickSummary(item) {
    var order = ['encoded', 'content', 'description', 'summary'];
    var kids = item.getElementsByTagName('*');
    for (var w = 0; w < order.length; w++) {
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].localName === order[w] && (kids[i].textContent || '').trim()) {
          return kids[i].textContent;
        }
      }
    }
    return '';
  }

  function htmlToText(html) {
    var text;
    if (/<[a-z!\/]/i.test(html)) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      Array.prototype.forEach.call(doc.querySelectorAll('script,style,noscript'), function (n) {
        n.parentNode.removeChild(n);
      });
      Array.prototype.forEach.call(doc.querySelectorAll('p,div,br,li,h1,h2,h3,h4,blockquote,tr'), function (n) {
        n.appendChild(doc.createTextNode('\n'));
      });
      text = doc.body ? doc.body.textContent : '';
    } else {
      text = html;
    }
    return text
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function parseFeed(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('That address did not return valid RSS or Atom');
    }
    var root = doc.documentElement;
    if (!root) throw new Error('That address returned an empty document');

    var isAtom = root.localName === 'feed';
    var channel = doc.getElementsByTagName('channel')[0] || root;
    var title = isAtom ? firstText(root, ['title']) : firstText(channel, ['title']);

    var nodes = isAtom
      ? root.getElementsByTagName('entry')
      : (channel.getElementsByTagName('item').length
        ? channel.getElementsByTagName('item')
        : root.getElementsByTagName('item'));

    var items = [];
    for (var i = 0; i < nodes.length; i++) {
      var item = nodes[i];
      var link = linkOf(item);
      var when = firstText(item, ['pubDate', 'published', 'updated', 'date']);
      var stamp = when ? Date.parse(when) : 0;
      var guid = firstText(item, ['guid', 'id']);
      items.push({
        title: firstText(item, ['title']) || 'Untitled',
        link: link,
        date: isFinite(stamp) ? stamp : 0,
        guid: guid || link,
        text: htmlToText(pickSummary(item))
      });
    }

    if (!items.length) throw new Error('No entries found in that feed');
    return { title: title, items: items };
  }

  function merge(feed, parsed) {
    if (parsed.title) feed.title = parsed.title;
    var known = {};
    state.items.forEach(function (it) { known[it.key] = true; });

    var added = 0;
    parsed.items.forEach(function (p) {
      var key = feed.id + '|' + (p.guid || p.title);
      if (known[key]) return;
      known[key] = true;
      state.items.push({
        key: key,
        feedId: feed.id,
        title: p.title,
        link: p.link,
        date: p.date,
        text: p.text,
        read: false
      });
      added += 1;
    });
    feed.error = '';
    save();
    return added;
  }

  function fetchFeed(feed) {
    var target = state.proxy ? state.proxy + encodeURIComponent(feed.url) : feed.url;
    return fetch(target, { cache: 'no-store', redirect: 'follow' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from that address');
      return res.text();
    }).then(function (text) {
      return parseFeed(text);
    }).catch(function (err) {
      var msg = err && err.message ? err.message : '';
      if (!msg || /failed to fetch|networkerror|load failed/i.test(msg)) msg = RELAY_HINT;
      throw new Error(msg);
    });
  }

  function refreshFeed(feed) {
    return fetchFeed(feed).then(function (parsed) {
      return merge(feed, parsed);
    }).catch(function (err) {
      feed.error = err.message;
      save();
      throw err;
    });
  }

  function unreadOf(feedId) {
    var n = 0;
    state.items.forEach(function (it) {
      if (!it.read && (feedId === 'all' || it.feedId === feedId)) n += 1;
    });
    return n;
  }

  function feedOf(feedId) {
    for (var i = 0; i < state.feeds.length; i++) {
      if (state.feeds[i].id === feedId) return state.feeds[i];
    }
    return null;
  }

  function visibleItems() {
    return state.items.filter(function (it) {
      return selected === 'all' || it.feedId === selected;
    }).sort(function (a, b) {
      if (a.date !== b.date) return b.date - a.date;
      return a.title < b.title ? 1 : -1;
    });
  }

  function shortDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    var opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString([], opts);
  }

  function renderFeeds() {
    el.feedList.textContent = '';

    var all = node('li');
    var allBtn = node('button');
    allBtn.type = 'button';
    allBtn.setAttribute('aria-current', selected === 'all' ? 'true' : 'false');
    allBtn.appendChild(node('span', 'nm', 'All items'));
    allBtn.appendChild(node('span', 'ct' + (unreadOf('all') ? '' : ' zero'), String(unreadOf('all'))));
    allBtn.addEventListener('click', function () {
      selected = 'all';
      openKey = null;
      render();
    });
    all.appendChild(allBtn);
    el.feedList.appendChild(all);

    state.feeds.forEach(function (feed) {
      var li = node('li');
      var btn = node('button');
      btn.type = 'button';
      btn.setAttribute('aria-current', selected === feed.id ? 'true' : 'false');
      btn.appendChild(node('span', 'nm', feed.title));
      btn.appendChild(node('span', 'ct' + (unreadOf(feed.id) ? '' : ' zero'), String(unreadOf(feed.id))));
      btn.title = feed.url;
      btn.addEventListener('click', function () {
        selected = feed.id;
        openKey = null;
        render();
      });
      li.appendChild(btn);
      if (feed.error) li.appendChild(node('div', 'err', feed.error));
      el.feedList.appendChild(li);
    });

    el.feedsEmpty.hidden = state.feeds.length !== 0;
  }

  function renderList() {
    var feed = selected === 'all' ? null : feedOf(selected);
    el.paneTitle.textContent = feed ? feed.title : 'All items';
    el.unsub.hidden = !feed;

    var items = visibleItems();
    el.itemList.textContent = '';

    items.forEach(function (it) {
      var owner = feedOf(it.feedId);
      var li = node('li', it.read ? '' : 'unread');
      var btn = node('button');
      btn.type = 'button';
      btn.appendChild(node('span', 'dot' + (it.read ? ' read' : '')));
      btn.appendChild(node('span', 'tt', it.title));
      if (!feed) btn.appendChild(node('span', 'fd', owner ? owner.title : ''));
      btn.appendChild(node('span', 'dt', shortDate(it.date)));
      btn.addEventListener('click', function () {
        it.read = true;
        save();
        openKey = it.key;
        render();
      });
      li.appendChild(btn);
      el.itemList.appendChild(li);
    });

    el.itemsEmpty.hidden = items.length !== 0;
    el.itemsEmpty.textContent = state.feeds.length
      ? 'No entries cached yet. Press Refresh all.'
      : 'Nothing here yet. Add a feed, then press Refresh all.';
    el.markAll.disabled = unreadOf(selected) === 0;
  }

  function renderReader() {
    var item = null;
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].key === openKey) item = state.items[i];
    }
    if (!item) {
      el.reader.hidden = true;
      el.listPane.hidden = false;
      return;
    }
    var owner = feedOf(item.feedId);
    el.readerFeed.textContent = owner ? owner.title : '';
    el.readerTitle.textContent = item.title;
    el.readerMeta.textContent = shortDate(item.date) || 'Undated';

    el.readerBody.textContent = '';
    if (item.text) {
      item.text.split(/\n{2,}/).forEach(function (para) {
        var chunk = para.trim();
        if (chunk) el.readerBody.appendChild(node('p', '', chunk));
      });
    } else {
      el.readerBody.appendChild(node('p', 'muted', 'This entry carries no summary text. Open the original to read it.'));
    }

    if (item.link) {
      el.readerLink.href = item.link;
      el.readerLink.hidden = false;
    } else {
      el.readerLink.removeAttribute('href');
      el.readerLink.hidden = true;
    }

    el.reader.hidden = false;
    el.listPane.hidden = true;
  }

  function render() {
    renderFeeds();
    renderList();
    renderReader();
  }

  function refreshMany(feeds) {
    if (busy || !feeds.length) return;
    busy = true;
    el.refreshAll.disabled = true;
    el.refreshAll.textContent = 'Refreshing\u2026';
    var failures = 0;
    var added = 0;

    var chain = Promise.resolve();
    feeds.forEach(function (feed) {
      chain = chain.then(function () {
        return refreshFeed(feed).then(function (n) {
          added += n;
        }).catch(function () {
          failures += 1;
        });
      });
    });

    chain.then(function () {
      busy = false;
      el.refreshAll.disabled = false;
      el.refreshAll.textContent = 'Refresh all';
      render();
      if (!failures) {
        toast(added ? added + ' new entr' + (added === 1 ? 'y' : 'ies') : 'No new entries');
      } else {
        toast(failures === feeds.length
          ? 'Refresh failed \u2014 see the note under each feed'
          : added + ' new, ' + failures + ' feed' + (failures === 1 ? '' : 's') + ' failed');
      }
    });
  }

  el.addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var url = normalUrl(el.feedUrl.value);
    if (!url) {
      toast('Enter an http(s) feed address');
      el.feedUrl.focus();
      return;
    }
    var existing = state.feeds.filter(function (f) { return f.url === url; })[0];
    if (existing) {
      toast('That feed is already in the list');
      selected = existing.id;
      render();
      return;
    }

    var feed = { id: uid(), url: url, title: hostOf(url), added: Date.now(), error: '' };
    state.feeds.push(feed);
    selected = feed.id;
    el.feedUrl.value = '';
    render();

    var button = el.addForm.querySelector('button');
    button.disabled = true;
    button.textContent = 'Adding\u2026';

    fetchFeed(feed).then(function (parsed) {
      var n = merge(feed, parsed);
      button.disabled = false;
      button.textContent = 'Add feed';
      render();
      toast('Added ' + feed.title + (n ? ' with ' + n + ' entr' + (n === 1 ? 'y' : 'ies') : ''));
    }).catch(function (err) {
      feed.error = err.message;
      save();
      button.disabled = false;
      button.textContent = 'Add feed';
      render();
      toast(err.message);
    });
  });

  el.refreshAll.addEventListener('click', function () {
    if (!state.feeds.length) {
      toast('Add a feed first');
      return;
    }
    refreshMany(state.feeds.slice());
  });

  el.markAll.addEventListener('click', function () {
    var changed = 0;
    state.items.forEach(function (it) {
      if (!it.read && (selected === 'all' || it.feedId === selected)) {
        it.read = true;
        changed += 1;
      }
    });
    save();
    render();
    toast(changed ? 'Marked ' + changed + ' as read' : 'Nothing unread here');
  });

  el.unsub.addEventListener('click', function () {
    var feed = selected === 'all' ? null : feedOf(selected);
    if (!feed) return;
    if (!window.confirm('Unsubscribe from "' + feed.title + '" and forget its cached entries?')) return;
    state.feeds = state.feeds.filter(function (f) { return f.id !== feed.id; });
    state.items = state.items.filter(function (it) { return it.feedId !== feed.id; });
    selected = 'all';
    openKey = null;
    save();
    render();
    toast('Unsubscribed');
  });

  el.back.addEventListener('click', function () {
    openKey = null;
    render();
  });

  el.proxy.value = state.proxy;
  el.proxy.addEventListener('change', function () {
    state.proxy = el.proxy.value.trim();
    save();
    toast(state.proxy ? 'Relay saved' : 'Relay cleared \u2014 fetching direct');
  });

  load();
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }
})();
