/* Token Radar's page. It reads window.RADAR (written by main.ts from the
   same board), renders the ranking, and lets a reader search, filter,
   sort, open a protocol's detail view, and try the model in a sandbox.
   The page makes no network request: everything it shows comes from
   data.js, loaded beside it. */
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) {
    document.getElementById('meta').textContent = 'No radar data found.';
    return;
  }

  function el(id) { return document.getElementById(id); }
  var SORT_MAP = {
    rank: 'rank',
    name: 'name',
    category: 'category',
    tvl_usd: 'tvl',
    change_7d: 'change',
    age_days: 'age',
    chains: 'chainsN',
    implied_value_usd: 'value',
  };
  var view = {
    query: '',
    category: '',
    chain: '',
    watchlistOnly: false,
    breakoutOnly: false,
    tab: 'pre',
    key: 'value',
    dir: -1,
    open: null,
  };
  var lab = { active: true, base: DATA.model.base_multiple, growth: DATA.model.growth_weight };

  function sandboxChanged() {
    return lab.active && (
      Math.abs(lab.base - DATA.model.base_multiple) > 1e-6 ||
      Math.abs(lab.growth - DATA.model.growth_weight) > 1e-6
    );
  }

  function moneyShort(n) {
    var units = [[1e9, 'B', 2], [1e6, 'M', 1], [1e3, 'K', 1]];
    for (var i = 0; i < units.length; i++) {
      var cut = units[i][0];
      if (n < cut) continue;
      var shown = (n / cut).toFixed(units[i][2]).replace(/\.0+$/, '');
      return '$' + shown + units[i][1];
    }
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageLabel(d) { return d === null || d === undefined ? '—' : d + 'd'; }
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* The same model as lib/model.ts, for the sandbox and the detail view.
     Base and growth come from the sandbox sliders; the other factors are
     the row's own, since they do not move with those two sliders. */
  function recompute(row) {
    var g = Math.min(DATA.model.growth_cap, Math.max(DATA.model.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var gm = 1 + (g / 100) * lab.growth;
    var days = row.age_days === null ? DATA.model.unknown_age_days : row.age_days;
    var mm = DATA.model.maturity_floor +
      (Math.min(Math.max(days, 0), DATA.model.maturity_days) / DATA.model.maturity_days) * DATA.model.maturity_range;
    var cm = 1 + DATA.model.chain_step * Math.min(Math.max(row.chains.length - 1, 0), DATA.model.chain_cap);
    return {
      value: Math.max(1, Math.round(row.tvl_usd * lab.base * gm * mm * cm * row.category_mult * row.breakout_mult)),
      growthMult: gm,
      maturityMult: mm,
      chainMult: cm,
      growthPct: g,
    };
  }

  function oneLineWhy(r) {
    if (r.breakout_mult > 1) return 'Young and growing fast — the early signal.';
    if (r.chain_mult >= 1.2) return 'Pre-token TVL across ' + r.chains.length + ' chains.';
    if (r.age_days !== null && r.age_days >= 900) return 'Running ' + r.age_days + ' days with no token.';
    if ((r.change_7d || 0) > 10) return 'TVL up ' + pct(r.change_7d) + ' in 7 days.';
    return 'Pre-token TVL of ' + moneyShort(r.tvl_usd) + '.';
  }

  /* Compute effective pre-token rows with live sandbox rank and rank delta. */
  function rankedPreRows() {
    var items = [];
    var useLab = lab.active;
    for (var i = 0; i < DATA.rows.length; i++) {
      var r = DATA.rows[i];
      var value = useLab ? recompute(r).value : r.implied_value_usd;
      items.push({
        baseRank: r.rank,
        rank: r.rank,
        delta: 0,
        name: r.name,
        slug: r.slug,
        category: r.category,
        tvl: r.tvl_usd,
        change: r.change_7d,
        age: r.age_days,
        chainsN: r.chains.length,
        value: value,
        starred: !!r.on_watchlist,
        breakout: r.breakout_mult > 1,
        source: r,
        kind: 'pre',
      });
    }
    if (sandboxChanged()) {
      items.sort(function (a, b) {
        return b.value - a.value || b.tvl - a.tvl || a.slug.localeCompare(b.slug);
      });
      for (var j = 0; j < items.length; j++) {
        items[j].rank = j + 1;
        items[j].delta = items[j].baseRank - items[j].rank;
      }
    }
    return items;
  }

  function visibleRows() {
    var list;
    if (view.tab === 'live') {
      list = [];
      for (var i = 0; i < DATA.live.length; i++) {
        var r = DATA.live[i];
        list.push({
          rank: i + 1,
          delta: 0,
          name: r.name,
          slug: r.slug,
          category: r.category,
          tvl: r.tvl_usd,
          change: r.change_7d,
          age: null,
          chainsN: r.chains.length,
          value: r.mcap_usd,
          starred: false,
          breakout: false,
          source: r,
          kind: 'live',
        });
      }
    } else {
      list = rankedPreRows();
    }

    if (view.query) {
      var q = view.query.toLowerCase();
      list = list.filter(function (v) {
        return v.name.toLowerCase().indexOf(q) >= 0 ||
          v.slug.toLowerCase().indexOf(q) >= 0 ||
          v.category.toLowerCase().indexOf(q) >= 0;
      });
    }
    if (view.category) list = list.filter(function (v) { return v.category === view.category; });
    if (view.chain) {
      list = list.filter(function (v) { return v.source.chains.indexOf(view.chain) >= 0; });
    }
    if (view.tab === 'pre') {
      if (view.watchlistOnly) list = list.filter(function (v) { return v.starred; });
      if (view.breakoutOnly) list = list.filter(function (v) { return v.breakout; });
    }

    var key = view.key;
    list.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av == null && bv == null) return a.rank - b.rank;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * view.dir || (a.rank - b.rank);
      return (av - bv) * view.dir || (a.rank - b.rank);
    });
    return list;
  }

  function paintTop5() {
    var box = el('top5');
    var top = rankedPreRows().slice(0, 5);
    var html = '';
    for (var i = 0, n = top.length; i < n; i++) {
      var item = top[i];
      var r = item.source;
      var deltaHtml = item.delta !== 0
        ? '<span class="' + (item.delta > 0 ? 'up' : 'down') + '">' + (item.delta > 0 ? '↑' + item.delta : '↓' + (-item.delta)) + '</span>'
        : '';
      html += '<article class="card" data-slug="' + esc(r.slug) + '"><div class="place"><span>#' + item.rank +
        (r.on_watchlist ? ' · watchlist' : '') + '</span>' + deltaHtml + '</div>' +
        '<div class="name">' + esc(r.name) + '</div><div class="value">' + moneyShort(item.value) + '</div>' +
        '<div class="why">' + esc(oneLineWhy(r)) + '</div></article>';
    }
    box.innerHTML = html;
    var cards = box.querySelectorAll('.card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', function () { showDetail(this.getAttribute('data-slug'), 'pre'); });
    }
  }

  function syncFilterControls() {
    var isLive = view.tab === 'live';
    el('pill-watchlist').disabled = isLive;
    el('pill-breakout').disabled = isLive;
    el('pill-watchlist').setAttribute('aria-pressed', !isLive && view.watchlistOnly ? 'true' : 'false');
    el('pill-breakout').setAttribute('aria-pressed', !isLive && view.breakoutOnly ? 'true' : 'false');
    var hasFilter = !!(view.query || view.category || view.chain || (!isLive && (view.watchlistOnly || view.breakoutOnly)));
    el('clear-filters').hidden = !hasFilter;
  }

  function paintBoard() {
    syncFilterControls();
    var rows = visibleRows();
    var peak = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].value > peak) peak = rows[i].value;
    var html = '';
    for (var k = 0; k < rows.length; k++) {
      var v = rows[k];
      var change = v.change === null
        ? '<span>—</span>'
        : '<span class="' + (v.change >= 0 ? 'up' : 'down') + '">' + pct(v.change) + '</span>';
      var bar = peak > 0
        ? '<span class="bar" style="width:' + Math.max(2, Math.round((v.value / peak) * 90)) + 'px"></span>'
        : '';
      var deltaHtml = v.delta !== 0
        ? '<span class="delta ' + (v.delta > 0 ? 'up' : 'down') + '">' + (v.delta > 0 ? '↑' + v.delta : '↓' + (-v.delta)) + '</span>'
        : '';
      var breakoutBadge = v.breakout ? '<span class="badge-breakout" title="Young &amp; growing &gt;20% in 7d">⚡ Breakout</span>' : '';
      html += '<tr data-slug="' + esc(v.slug) + '" data-kind="' + v.kind + '"><td>' + v.rank + deltaHtml + '</td>' +
        '<td>' + esc(v.name) + (v.starred ? ' <span class="star" title="On the watchlist">★</span>' : '') + breakoutBadge +
        '<br><span class="slug">' + esc(v.slug) + '</span></td>' +
        '<td>' + esc(v.category) + '</td><td class="num">' + moneyShort(v.tvl) + '</td><td class="num">' + change + '</td>' +
        '<td class="num">' + ageLabel(v.age) + '</td><td class="num">' + v.chainsN + '</td>' +
        '<td class="num">' + bar + moneyShort(v.value) + '</td></tr>';
    }
    el('rows').innerHTML = html || '<tr><td colspan="8">Nothing matches these filters.</td></tr>';
    var trs = el('rows').querySelectorAll('tr[data-slug]');
    for (var m = 0; m < trs.length; m++) {
      trs[m].addEventListener('click', function () {
        showDetail(this.getAttribute('data-slug'), this.getAttribute('data-kind'));
      });
    }
    var total = view.tab === 'live' ? DATA.live.length : DATA.rows.length;
    var note = rows.length + ' of ' + total +
      (view.tab === 'live' ? ' live-token protocols' : ' pre-token protocols') + '.';
    if (sandboxChanged() && view.tab === 'pre') {
      note += ' Sandbox: base ' + lab.base.toFixed(2) + ', growth weight ' + lab.growth.toFixed(2) + ' — this page only.';
    }
    el('count').textContent = note;
    var heads = document.querySelectorAll('#board th');
    for (var h = 0; h < heads.length; h++) {
      var sortName = heads[h].getAttribute('data-sort');
      var mapped = SORT_MAP[sortName] || sortName;
      var label = heads[h].textContent.replace(/ [▲▼]$/, '');
      if (h === heads.length - 1) label = view.tab === 'live' ? 'Market cap' : 'Implied value';
      if (mapped === view.key) {
        heads[h].textContent = label + (view.dir === -1 ? ' ▼' : ' ▲');
        heads[h].setAttribute('aria-sort', view.dir === -1 ? 'descending' : 'ascending');
      } else {
        heads[h].textContent = label;
        heads[h].setAttribute('aria-sort', 'none');
      }
    }
  }

  function showDetail(slug, kind) {
    var dlg = el('detail');
    var r = null;
    if (kind !== 'live') {
      for (var i = 0; i < DATA.rows.length; i++) {
        if (DATA.rows[i].slug === slug) { r = DATA.rows[i]; break; }
      }
    }
    if (r) {
      var eff = lab.active
        ? recompute(r)
        : {
            value: r.implied_value_usd,
            growthMult: r.growth_mult,
            maturityMult: r.maturity_mult,
            chainMult: r.chain_mult,
            growthPct: r.growth_pct,
          };
      var chainText = r.chains.length > 3
        ? r.chains.slice(0, 3).join(', ') + ' and ' + (r.chains.length - 3) + ' more'
        : r.chains.join(', ');
      var base = lab.active ? lab.base : DATA.model.base_multiple;
      var html = '<button class="close" id="detail-close" aria-label="Close">×</button><div class="inner">' +
        '<h2>' + esc(r.name) + (r.on_watchlist ? ' <span class="star">★</span>' : '') +
        (r.breakout_mult > 1 ? ' <span class="badge-breakout">⚡ Breakout</span>' : '') + '</h2>' +
        '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category) + ' · ' + esc(chainText) +
        (r.on_watchlist ? ' · on the watchlist' : '') + '</p>' +
        '<div class="big">' + moneyFull(eff.value) + '</div>' +
        '<p class="sub">Implied value — this radar\u2019s own claim, never a promise. No market cap, no CoinGecko id, no symbol.</p>' +
        '<h3>Why it ranks here</h3><table><tbody>' +
        '<tr><th>TVL × base multiple (' + base.toFixed(2) + ')</th><td class="num">' + moneyFull(r.tvl_usd * base) + '</td></tr>' +
        '<tr><th>Growth: ' + pct(eff.growthPct) + ' in 7 days</th><td class="num">× ' + eff.growthMult.toFixed(3) + '</td></tr>' +
        '<tr><th>Maturity: ' + (r.age_days === null ? 'listed date unknown' : r.age_days + ' days listed') +
        '</th><td class="num">× ' + eff.maturityMult.toFixed(3) + '</td></tr>' +
        '<tr><th>Chains: ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') +
        '</th><td class="num">× ' + eff.chainMult.toFixed(3) + '</td></tr>' +
        '<tr><th>Category: ' + esc(r.category) + '</th><td class="num">× ' + r.category_mult.toFixed(2) + '</td></tr>' +
        '<tr><th>Breakout: ' + (r.breakout_mult > 1 ? 'young and growing fast' : 'no') +
        '</th><td class="num">× ' + r.breakout_mult.toFixed(2) + '</td></tr>' +
        '<tr><th>Implied value</th><td class="num"><strong>' + moneyFull(eff.value) + '</strong></td></tr>' +
        '</tbody></table>' +
        '<h3>Farm plan</h3><ol>';
      for (var s = 0; s < r.farm_steps.length; s++) html += '<li>' + esc(r.farm_steps[s]) + '</li>';
      html += '</ol><p class="sub">Farming costs gas and time; an airdrop may never come.</p></div>';
      dlg.innerHTML = html;
      view.open = slug;
      saveHash();
      if (!dlg.open) dlg.showModal();
      el('detail-close').addEventListener('click', function () { dlg.close(); });
      return;
    }

    var live = null;
    for (var j = 0; j < DATA.live.length; j++) {
      if (DATA.live[j].slug === slug) { live = DATA.live[j]; break; }
    }
    if (!live) return;
    var ratio = live.tvl_usd > 0 ? (live.mcap_usd / live.tvl_usd).toFixed(2) + '×' : '—';
    var liveChains = live.chains.length > 3
      ? live.chains.slice(0, 3).join(', ') + ' and ' + (live.chains.length - 3) + ' more'
      : live.chains.join(', ');
    dlg.innerHTML = '<button class="close" id="detail-close" aria-label="Close">×</button><div class="inner">' +
      '<h2>' + esc(live.name) + '</h2>' +
      '<p class="sub">' + esc(live.slug) + ' · ' + esc(live.category) + ' · ' + esc(liveChains) + ' · live token</p>' +
      '<div class="big">' + moneyFull(live.mcap_usd) + '</div>' +
      '<p class="sub">Live market cap from the snapshot — set aside as a market benchmark, not a pre-token farm target.</p>' +
      '<h3>Snapshot figures</h3><table><tbody>' +
      '<tr><th>Market cap</th><td class="num">' + moneyFull(live.mcap_usd) + '</td></tr>' +
      '<tr><th>TVL</th><td class="num">' + moneyFull(live.tvl_usd) + '</td></tr>' +
      '<tr><th>Market cap / TVL</th><td class="num">' + ratio + '</td></tr>' +
      '<tr><th>7d TVL change</th><td class="num">' + pct(live.change_7d) + '</td></tr>' +
      '<tr><th>Chains</th><td class="num">' + live.chains.length + '</td></tr>' +
      '</tbody></table></div>';
    view.open = slug;
    saveHash();
    if (!dlg.open) dlg.showModal();
    el('detail-close').addEventListener('click', function () { dlg.close(); });
  }

  function loadHash() {
    var params = new URLSearchParams(location.hash.slice(1));
    view.query = params.get('q') || '';
    view.category = params.get('category') || '';
    view.chain = params.get('chain') || '';
    view.watchlistOnly = params.get('watchlist') === '1';
    view.breakoutOnly = params.get('breakout') === '1';
    view.tab = params.get('tab') === 'live' ? 'live' : 'pre';
    view.open = params.get('p') || null;
  }
  function saveHash() {
    var params = new URLSearchParams();
    if (view.query) params.set('q', view.query);
    if (view.category) params.set('category', view.category);
    if (view.chain) params.set('chain', view.chain);
    if (view.watchlistOnly) params.set('watchlist', '1');
    if (view.breakoutOnly) params.set('breakout', '1');
    if (view.tab === 'live') params.set('tab', 'live');
    if (view.open) params.set('p', view.open);
    var hash = params.toString();
    try { history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search); } catch (_e) {}
  }

  function start() {
    var onWatchlist = DATA.rows.filter(function (r) { return r.on_watchlist; }).length;
    var breakouts = DATA.rows.filter(function (r) { return r.breakout_mult > 1; }).length;
    el('meta').textContent = 'Snapshot ' + DATA.snapshot_date + ' · model ' + DATA.model_version +
      ' · ' + DATA.rows.length + ' pre-token protocols';
    el('facts').innerHTML = '<b>' + onWatchlist + '</b> watchlist protocols covered · <b>' + DATA.rows.length +
      '</b> genuine pre-token protocols ranked · <b>' + breakouts + '</b> breakout signals · <b>' + DATA.live.length +
      '</b> live tokens set aside with market caps.';
    el('foot').textContent = 'Data: DefiLlama snapshot of ' + DATA.snapshot_date + ' (' + DATA.rows.length +
      ' pre-token protocols, ' + DATA.live.length +
      ' live tokens). Implied value is this radar\u2019s own claim, never a price and never a promise. A protocol is said to record no token, never to have none.';

    var categories = [];
    var chains = [];
    var seenCat = {};
    var seenChain = {};
    var everything = DATA.rows.concat(DATA.live);
    for (var i = 0; i < everything.length; i++) {
      if (!seenCat[everything[i].category]) { seenCat[everything[i].category] = 1; categories.push(everything[i].category); }
      for (var j = 0; j < everything[i].chains.length; j++) {
        if (!seenChain[everything[i].chains[j]]) { seenChain[everything[i].chains[j]] = 1; chains.push(everything[i].chains[j]); }
      }
    }
    categories.sort();
    chains.sort();
    for (var c = 0; c < categories.length; c++) {
      var opt = document.createElement('option');
      opt.value = categories[c];
      opt.textContent = categories[c];
      el('category').appendChild(opt);
    }
    for (var h = 0; h < chains.length; h++) {
      var opt2 = document.createElement('option');
      opt2.value = chains[h];
      opt2.textContent = chains[h];
      el('chain').appendChild(opt2);
    }

    loadHash();
    el('q').value = view.query;
    el('category').value = view.category;
    el('chain').value = view.chain;
    el('tab-pre').setAttribute('aria-selected', view.tab === 'pre' ? 'true' : 'false');
    el('tab-live').setAttribute('aria-selected', view.tab === 'live' ? 'true' : 'false');

    el('q').addEventListener('input', function () { view.query = this.value; saveHash(); paintBoard(); });
    el('category').addEventListener('change', function () { view.category = this.value; saveHash(); paintBoard(); });
    el('chain').addEventListener('change', function () { view.chain = this.value; saveHash(); paintBoard(); });
    el('pill-watchlist').addEventListener('click', function () {
      view.watchlistOnly = !view.watchlistOnly;
      saveHash();
      paintBoard();
    });
    el('pill-breakout').addEventListener('click', function () {
      view.breakoutOnly = !view.breakoutOnly;
      saveHash();
      paintBoard();
    });
    el('clear-filters').addEventListener('click', function () {
      view.query = '';
      view.category = '';
      view.chain = '';
      view.watchlistOnly = false;
      view.breakoutOnly = false;
      el('q').value = '';
      el('category').value = '';
      el('chain').value = '';
      saveHash();
      paintBoard();
    });

    function syncTabs() {
      el('tab-pre').setAttribute('aria-selected', view.tab === 'pre' ? 'true' : 'false');
      el('tab-live').setAttribute('aria-selected', view.tab === 'live' ? 'true' : 'false');
    }
    el('tab-pre').addEventListener('click', function () { view.tab = 'pre'; saveHash(); paintBoard(); syncTabs(); });
    el('tab-live').addEventListener('click', function () { view.tab = 'live'; saveHash(); paintBoard(); syncTabs(); });

    var heads = document.querySelectorAll('#board th');
    for (var k = 0; k < heads.length; k++) {
      heads[k].addEventListener('click', function () {
        var sortName = this.getAttribute('data-sort');
        var next = SORT_MAP[sortName] || sortName;
        if (view.key === next) view.dir = -view.dir;
        else { view.key = next; view.dir = (next === 'name' || next === 'category' || next === 'rank') ? 1 : -1; }
        paintBoard();
      });
    }
    el('sandbox-toggle').addEventListener('click', function () {
      lab.active = !lab.active;
      el('sandbox').hidden = !lab.active;
      this.setAttribute('aria-expanded', lab.active ? 'true' : 'false');
      this.textContent = lab.active ? 'Hide sandbox' : 'Sandbox';
      paintTop5();
      paintBoard();
    });
    el('base').addEventListener('input', function () {
      lab.base = parseFloat(this.value);
      el('base-val').textContent = lab.base.toFixed(2);
      paintTop5();
      paintBoard();
    });
    el('growth').addEventListener('input', function () {
      lab.growth = parseFloat(this.value);
      el('growth-val').textContent = lab.growth.toFixed(2);
      paintTop5();
      paintBoard();
    });
    el('sandbox-reset').addEventListener('click', function () {
      lab.base = DATA.model.base_multiple;
      lab.growth = DATA.model.growth_weight;
      el('base').value = lab.base;
      el('growth').value = lab.growth;
      el('base-val').textContent = lab.base.toFixed(2);
      el('growth-val').textContent = lab.growth.toFixed(2);
      paintTop5();
      paintBoard();
    });
    el('base-val').textContent = lab.base.toFixed(2);
    el('growth-val').textContent = lab.growth.toFixed(2);
    var dlg = el('detail');
    dlg.addEventListener('close', function () {
      if (view.open) { view.open = null; saveHash(); }
    });
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) dlg.close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== el('q') && !dlg.open) {
        e.preventDefault();
        el('q').focus();
      }
    });

    paintTop5();
    paintBoard();
    if (view.open) showDetail(view.open, view.tab);
  }
  start();
})();
