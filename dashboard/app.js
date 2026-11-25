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
  var view = { query: '', category: '', chain: '', tab: 'pre', key: 'value', dir: -1, open: null };
  var lab = { active: true, base: DATA.model.base_multiple, growth: DATA.model.growth_weight };

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
    if (r.breakout_mult > 1) {
      return 'Young and growing fast — the early signal.';
    }
    if (r.chain_mult >= 1.2) {
      return 'Pre-token TVL across ' + r.chains.length + ' chains.';
    }
    if (r.age_days !== null && r.age_days >= 900) {
      return 'Running ' + r.age_days + ' days with no token.';
    }
    if ((r.change_7d || 0) > 10) {
      return 'TVL up ' + pct(r.change_7d) + ' in 7 days.';
    }
    return 'Pre-token TVL of ' + moneyShort(r.tvl_usd) + '.';
  }

  function visibleRows() {
    var source = view.tab === 'live' ? DATA.live : DATA.rows;
    var list = [];
    for (var i = 0; i < source.length; i++) {
      var r = source[i];
      var value = view.tab === 'live' ? r.mcap_usd : (lab.active ? recompute(r).value : r.implied_value_usd);
      list.push({
        rank: view.tab === 'live' ? i + 1 : r.rank,
        name: r.name,
        slug: r.slug,
        category: r.category,
        tvl: r.tvl_usd,
        change: r.change_7d,
        age: view.tab === 'live' ? null : r.age_days,
        chainsN: r.chains.length,
        value: value,
        starred: view.tab === 'live' ? false : !!r.on_watchlist,
        source: r,
        kind: view.tab,
      });
    }
    if (view.query) {
      var q = view.query.toLowerCase();
      list = list.filter(function (v) {
        return v.name.toLowerCase().indexOf(q) >= 0 || v.slug.toLowerCase().indexOf(q) >= 0;
      });
    }
    if (view.category) list = list.filter(function (v) { return v.category === view.category; });
    if (view.chain) {
      list = list.filter(function (v) { return v.source.chains.indexOf(view.chain) >= 0; });
    }
    if (lab.active && view.tab === 'pre') {
      list.sort(function (a, b) { return b.value - a.value; });
      list.forEach(function (v, i) { v.rank = i + 1; });
    } else {
      var key = view.key;
      list.sort(function (a, b) {
        var av = a[key];
        var bv = b[key];
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'string') return av.localeCompare(bv) * view.dir;
        return (av - bv) * view.dir;
      });
    }
    return list;
  }

  function paintTop5() {
    var box = el('top5');
    var top = DATA.rows.slice(0, 5);
    var html = "";
    for (var i = 0, n = top.length; i < n; i++) {
      var r = top[i];
      var value = lab.active ? recompute(r).value : r.implied_value_usd;
      html += '<article class="card" data-slug="' + esc(r.slug) + '"><div class="place">#' + (i + 1) +
        (r.on_watchlist ? ' · watchlist' : '') + '</div>' +
        '<div class="name">' + esc(r.name) + '</div><div class="value">' + moneyShort(value) + '</div>' +
        '<div class="why">' + esc(oneLineWhy(r)) + '</div></article>';
    }
    box.innerHTML = html;
    var cards = box.querySelectorAll('.card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', function () { showDetail(this.getAttribute('data-slug')); });
    }
  }

  function paintBoard() {
    var rows = visibleRows();
    var peak = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].value > peak) peak = rows[i].value;
    var html = "";
    for (var k = 0; k < rows.length; k++) {
      var v = rows[k];
      var change = v.change === null
        ? '<span>—</span>'
        : '<span class="' + (v.change >= 0 ? 'up' : 'down') + '">' + pct(v.change) + '</span>';
      var bar = peak > 0
        ? '<span class="bar" style="width:' + Math.max(2, Math.round((v.value / peak) * 90)) + 'px"></span>'
        : '';
      html += '<tr data-slug="' + esc(v.slug) + '" data-kind="' + v.kind + '"><td>' + v.rank + '</td>' +
        '<td>' + esc(v.name) + (v.starred ? ' <span class="star" title="On the watchlist">★</span>' : '') +
        '<br><span class="slug">' + esc(v.slug) + '</span></td>' +
        '<td>' + esc(v.category) + '</td><td class="num">' + moneyShort(v.tvl) + '</td><td class="num">' + change + '</td>' +
        '<td class="num">' + ageLabel(v.age) + '</td><td class="num">' + v.chainsN + '</td>' +
        '<td class="num">' + bar + moneyShort(v.value) + '</td></tr>';
    }
    el('rows').innerHTML = html || '<tr><td colspan="8">Nothing matches these filters.</td></tr>';
    var trs = el('rows').querySelectorAll('tr[data-slug]');
    for (var m = 0; m < trs.length; m++) {
      trs[m].addEventListener('click', function () { showDetail(this.getAttribute('data-slug')); });
    }
    var total = view.tab === 'live' ? DATA.live.length : DATA.rows.length;
    var note = rows.length + ' of ' + total +
      (view.tab === 'live' ? ' live-token protocols' : ' pre-token protocols') + '.';
    if (lab.active && view.tab === 'pre') {
      note += ' Sandbox: base ' + lab.base.toFixed(2) + ', growth weight ' + lab.growth.toFixed(2) + ' — this page only.';
    }
    el('count').textContent = note;
    var heads = document.querySelectorAll('#board th');
    for (var h = 0; h < heads.length; h++) {
      var sortName = heads[h].getAttribute('data-sort');
      heads[h].textContent = heads[h].textContent.replace(/ [▲▼]$/, '');
      if (sortName === view.key) heads[h].textContent += view.dir === -1 ? ' ▼' : ' ▲';
    }
    var lastHead = heads[heads.length - 1];
    lastHead.textContent = (view.tab === 'live' ? 'Market cap' : 'Implied value') +
      (view.key === 'value' ? (view.dir === -1 ? ' ▼' : ' ▲') : '');
  }

  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) { r = DATA.rows[i]; break; }
    }
    if (!r) return;
    var eff = lab.active
      ? recompute(r)
      : {
          value: r.implied_value_usd,
          growthMult: r.growth_mult,
          maturityMult: r.maturity_mult,
          chainMult: r.chain_mult,
          growthPct: r.growth_pct,
        };
    var chainText = r.chains.length > 2
      ? r.chains.slice(0, 2).join(', ') + ' and ' + (r.chains.length - 2) + ' more'
      : r.chains.join(', ');
    var base = lab.active ? lab.base : DATA.model.base_multiple;
    var dlg = el('detail');
    var html = '<button class="close" id="detail-close" aria-label="Close">×</button><div class="inner">' +
      '<h2>' + esc(r.name) + (r.on_watchlist ? ' <span class="star">★</span>' : '') + '</h2>' +
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
  }

  function loadHash() {
    var params = new URLSearchParams(location.hash.slice(1));
    view.query = params.get('q') || '';
    view.category = params.get('category') || '';
    view.chain = params.get('chain') || '';
    view.tab = params.get('tab') === 'live' ? 'live' : 'pre';
    view.open = params.get('p') || null;
  }
  function saveHash() {
    var params = new URLSearchParams();
    if (view.query) params.set('q', view.query);
    if (view.category) params.set('category', view.category);
    if (view.chain) params.set('chain', view.chain);
    if (view.tab === 'live') params.set('tab', 'live');
    if (view.open) params.set('p', view.open);
    var hash = params.toString();
    history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search);
  }

  function start() {
    var onWatchlist = DATA.rows.filter(function (r) { return r.on_watchlist; }).length;
    el('meta').textContent = 'Snapshot ' + DATA.snapshot_date + ' · model ' + DATA.model_version +
      ' · ' + DATA.rows.length + ' pre-token protocols';
    el('facts').innerHTML = '<b>' + onWatchlist + '</b> watchlist protocols covered · <b>' + DATA.rows.length +
      '</b> genuine pre-token protocols ranked · <b>' + DATA.live.length +
      '</b> live tokens set aside with market caps · implied value from the snapshot\u2019s own figures, never a hand-kept list.';
    el('foot').textContent = 'Data: DefiLlama snapshot of ' + DATA.snapshot_date + ' (' + DATA.rows.length +
      ' pre-token protocols, ' + DATA.live.length +
      '). Implied value is this radar\u2019s own claim, never a price and never a promise. A protocol is said to record no token, never to have none.';

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
        var map = {
          rank: 'rank', name: 'name', category: 'category', tvl_usd: 'tvl',
          change_7d: 'change', age_days: 'age', chains: 'chainsN', implied_value_usd: 'value',
        };
        var next = map[sortName] || sortName;
        if (view.key === next) view.dir = -view.dir;
        else { view.key = next; view.dir = next === 'name' || next === 'category' ? 1 : -1; }
        paintBoard();
      });
    }
    el('sandbox-toggle').addEventListener('click', function () {
      lab.active = !lab.active;
      el('sandbox').hidden = !lab.active;
      this.setAttribute('aria-expanded', lab.active ? 'true' : 'false');
      this.textContent = lab.active ? 'Close model sandbox' : 'Model sandbox';
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
    el('detail').addEventListener('close', function () {
      if (view.open) { view.open = null; saveHash(); }
    });

    paintTop5();
    paintBoard();
    if (view.open) showDetail(view.open);
  }
  start();
})();
