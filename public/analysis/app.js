(function () {
    'use strict';
    var C = window.AnalysisConfig, E = window.AnalysisEngine;
    var $ = function (id) { return document.getElementById(id); };

    var state = { ws: null, reqId: 0, subId: null, digits: [], pip: 2, price: null, lastEpoch: 0,
                  loaded: false, retries: 0, timer: null, reconnect: null, renderQueued: false };

    function fill(sel, items, fmt, def) {
        items.forEach(function (it) { var o = document.createElement('option'); o.value = it.v; o.textContent = it.t; sel.appendChild(o); });
        sel.value = def;
    }
    fill($('market'), C.markets.map(function (m) { return { v: m.id, t: m.name }; }), null, 'R_100');
    fill($('history'), C.historySizes.map(function (n) { return { v: n, t: n + ' ticks' }; }), null, 1000);
    fill($('window'), C.windowSizes.map(function (n) { return { v: n, t: n + ' ticks' }; }), null, 1000);
    fill($('barrier'), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return { v: n, t: String(n) }; }), null, 4);

    function setStatus(kind, text) { var s = $('status'); s.className = 'status ' + kind; s.querySelector('b').textContent = text; }
    function showError(text) { var b = $('banner'); b.hidden = !text; b.textContent = text || ''; }
    function send(obj) { if (state.ws && state.ws.readyState === 1) { state.ws.send(JSON.stringify(obj)); return true; } return false; }

    function inferPip(prices) {
        var m = 0; prices.forEach(function (p) { var s = String(p), i = s.indexOf('.'); if (i >= 0) m = Math.max(m, s.length - i - 1); });
        return m;
    }

    function connect() {
        clearTimeout(state.reconnect);
        setStatus('busy', 'Connecting…');
        var ws;
        try { ws = new WebSocket(C.wsUrl); } catch (e) { return scheduleReconnect(); }
        state.ws = ws;
        ws.onopen = function () { state.retries = 0; fetchHistory(); };
        ws.onmessage = onMessage;
        ws.onerror = function () { /* onclose follows */ };
        ws.onclose = function () {
            if (state.ws !== ws) return;
            state.subId = null;
            clearTimeout(state.timer);
            scheduleReconnect();
        };
    }

    function scheduleReconnect() {
        state.retries++;
        if (state.retries > 6) { setStatus('err', 'Disconnected'); showError('Could not reach Deriv. Check your connection, then press “Fetch history”.'); return; }
        var delay = Math.min(1000 * Math.pow(2, state.retries - 1), 15000);
        setStatus('busy', 'Reconnecting…');
        state.reconnect = setTimeout(connect, delay);
    }

    function fetchHistory() {
        if (!state.ws || state.ws.readyState !== 1) { state.retries = 0; return connect(); }
        if (state.subId) { send({ forget: state.subId }); state.subId = null; }
        state.reqId++;
        state.loaded = false;
        state.digits = [];
        var count = Math.min(Number($('history').value), C.maxTicksPerRequest);
        showError('');
        setStatus('busy', 'Loading ' + count + ' ticks…');
        $('refetch').disabled = true;
        render();
        send({ ticks_history: $('market').value, adjust_start_time: 1, count: count, end: 'latest', style: 'ticks', subscribe: 1, req_id: state.reqId });
        clearTimeout(state.timer);
        state.timer = setTimeout(function () {
            if (!state.loaded) { $('refetch').disabled = false; setStatus('err', 'No response'); showError('Deriv did not respond in time. Press “Fetch history” to retry.'); }
        }, 20000);
    }

    function onMessage(ev) {
        var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.error) {
            if (msg.req_id && msg.req_id !== state.reqId) return;
            clearTimeout(state.timer); $('refetch').disabled = false;
            setStatus('err', 'Error'); showError(msg.error.message || 'Request failed (' + (msg.error.code || 'unknown') + ').');
            return;
        }
        var h = E.parseHistory(msg);
        if (h) {
            if (msg.req_id !== state.reqId) { if (msg.subscription && msg.subscription.id) send({ forget: msg.subscription.id }); return; }
            clearTimeout(state.timer);
            state.pip = h.pipSize != null ? h.pipSize : inferPip(h.prices);
            state.digits = E.digitsFromPrices(h.prices, state.pip);
            state.price = h.prices.length ? h.prices[h.prices.length - 1] : null;
            state.lastEpoch = h.times.length ? h.times[h.times.length - 1] : 0;
            state.subId = msg.subscription && msg.subscription.id || null;
            state.loaded = true;
            $('refetch').disabled = false;
            if (!state.digits.length) { setStatus('err', 'No data'); showError('No ticks returned for this market.'); }
            else setStatus('live', 'Live');
            return queueRender();
        }
        var t = E.parseTick(msg);
        if (t && state.loaded && state.subId && t.subscriptionId === state.subId) {
            if (t.epoch && t.epoch < state.lastEpoch) return;
            var pip = t.pipSize != null ? t.pipSize : state.pip;
            var d = E.lastDigit(t.price, pip);
            if (d === null) return;
            state.digits.push(d);
            var cap = C.maxTicksPerRequest;
            if (state.digits.length > cap + 500) state.digits = state.digits.slice(-cap);
            state.price = t.price; state.lastEpoch = t.epoch || state.lastEpoch; state.pip = pip;
            queueRender(true);
        }
    }

    function queueRender(isNew) {
        state.isNew = !!isNew;
        if (state.renderQueued) return;
        state.renderQueued = true;
        requestAnimationFrame(function () { state.renderQueued = false; render(); });
    }

    var pct = function (x) { return x.toFixed(1) + '%'; };
    var cap = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : '–'; };

    function render() {
        var n = Number($('window').value), barrier = Number($('barrier').value), has = state.digits.length > 0;
        var dist = E.distribution(state.digits, n), eo = E.evenOdd(state.digits, n), ou = E.overUnder(state.digits, barrier, n);

        $('s-total').textContent = has ? state.digits.length : '–';
        $('s-price').textContent = state.price != null ? Number(state.price).toFixed(state.pip) : '–';
        $('s-last').textContent = dist.latest != null ? dist.latest : '–';
        $('s-hot').textContent = dist.hottest != null ? dist.hottest + ' (' + pct(dist.pct[dist.hottest]) + ')' : '–';
        $('s-cold').textContent = dist.coldest != null ? dist.coldest + ' (' + pct(dist.pct[dist.coldest]) + ')' : '–';
        $('dist-n').textContent = has ? '· last ' + dist.total + ' ticks' : '';

        var bars = $('bars'); bars.innerHTML = '';
        if (!has) { bars.className = 'empty'; bars.textContent = state.loaded ? 'No data.' : 'Loading…'; }
        else {
            bars.className = 'bars';
            var max = Math.max.apply(null, dist.pct) || 1;
            for (var i = 0; i < 10; i++) {
                var col = document.createElement('div');
                col.className = 'bar-col' + (i === dist.hottest ? ' hot' : '') + (i === dist.coldest ? ' cold' : '') + (i === dist.latest ? ' last' : '');
                col.innerHTML = '<span class="bar-pct">' + pct(dist.pct[i]) + '</span><div class="bar-fill" style="height:' + Math.max(1, (dist.pct[i] / max) * 150) + 'px"></div><span class="bar-lbl">' + i + '</span>';
                bars.appendChild(col);
            }
        }

        $('eo-even').style.width = eo.evenPct + '%'; $('eo-odd').style.width = eo.oddPct + '%';
        $('eo-even-n').textContent = has ? eo.even : '–'; $('eo-odd-n').textContent = has ? eo.odd : '–';
        $('eo-even-p').textContent = has ? pct(eo.evenPct) : ''; $('eo-odd-p').textContent = has ? pct(eo.oddPct) : '';
        $('eo-cur').textContent = has ? cap(eo.currentStreak.type) + ' × ' + eo.currentStreak.length : '–';
        $('eo-me').textContent = has ? eo.maxEvenStreak : '–'; $('eo-mo').textContent = has ? eo.maxOddStreak : '–';

        $('ou-title').textContent = 'barrier ' + barrier + ' · over: digit > ' + barrier + ', under: digit < ' + barrier;
        $('ou-under').style.width = ou.underPct + '%'; $('ou-eq').style.width = ou.equalPct + '%'; $('ou-over').style.width = ou.overPct + '%';
        $('ou-under-n').textContent = has ? ou.under : '–'; $('ou-eq-n').textContent = has ? ou.equal : '–'; $('ou-over-n').textContent = has ? ou.over : '–';
        $('ou-under-p').textContent = has ? pct(ou.underPct) : ''; $('ou-eq-p').textContent = has ? pct(ou.equalPct) : ''; $('ou-over-p').textContent = has ? pct(ou.overPct) : '';
        $('ou-exp').textContent = 'Under ' + ou.theoreticalUnderPct + '% · Equal 10% · Over ' + ou.theoreticalOverPct + '%';
        $('ou-cur').textContent = has && ou.currentStreak.type ? cap(ou.currentStreak.type) + ' × ' + ou.currentStreak.length : '–';
        $('ou-max').textContent = has ? ou.maxOverStreak + ' / ' + ou.maxUnderStreak : '–';

        var feed = $('feed'); feed.innerHTML = '';
        var last = state.digits.slice(-C.feedLength);
        if (!last.length) { feed.innerHTML = '<div class="empty">Waiting for ticks…</div>'; }
        last.forEach(function (d, idx) {
            var s = document.createElement('span');
            s.className = 'dg ' + (d % 2 === 0 ? 'e' : 'o') + (state.isNew && idx === last.length - 1 ? ' new' : '');
            s.textContent = d; feed.appendChild(s);
        });
    }

    $('market').addEventListener('change', fetchHistory);
    $('history').addEventListener('change', fetchHistory);
    $('refetch').addEventListener('click', function () { state.retries = 0; fetchHistory(); });
    $('window').addEventListener('change', render);
    $('barrier').addEventListener('change', render);
    window.addEventListener('beforeunload', function () { if (state.subId) send({ forget: state.subId }); if (state.ws) state.ws.close(); });

    render();
    connect();
})();
