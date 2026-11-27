/* Pure analysis engine: no DOM, no network. Works in browsers and Node. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.AnalysisEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** Last digit of a price using the symbol's pip size (e.g. 1234.50, pip 2 -> 0). */
    function lastDigit(price, pipSize) {
        var p = Number(price);
        if (!isFinite(p)) return null;
        var s = p.toFixed(Math.max(0, pipSize | 0));
        var d = s.charCodeAt(s.length - 1) - 48;
        return d >= 0 && d <= 9 ? d : null;
    }

    function digitsFromPrices(prices, pipSize) {
        var out = [];
        for (var i = 0; i < prices.length; i++) {
            var d = lastDigit(prices[i], pipSize);
            if (d !== null) out.push(d);
        }
        return out;
    }

    /** Analyse the most recent `n` digits (oldest -> newest order in, last element is newest). */
    function distribution(digits, n) {
        var w = n > 0 ? digits.slice(-n) : digits.slice();
        var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        w.forEach(function (d) { counts[d]++; });
        var total = w.length;
        var pct = counts.map(function (c) { return total ? (c / total) * 100 : 0; });
        var hot = 0, cold = 0;
        for (var i = 1; i < 10; i++) {
            if (counts[i] > counts[hot]) hot = i;
            if (counts[i] < counts[cold]) cold = i;
        }
        return { total: total, counts: counts, pct: pct, hottest: total ? hot : null, coldest: total ? cold : null,
                 latest: total ? w[total - 1] : null };
    }

    /** Even/odd counts, percentages, current streak and longest streaks. */
    function evenOdd(digits, n) {
        var w = n > 0 ? digits.slice(-n) : digits.slice();
        var even = 0, odd = 0, maxEven = 0, maxOdd = 0, run = 0, runType = null;
        w.forEach(function (d) {
            var t = d % 2 === 0 ? 'even' : 'odd';
            if (t === 'even') even++; else odd++;
            if (t === runType) run++; else { runType = t; run = 1; }
            if (t === 'even' && run > maxEven) maxEven = run;
            if (t === 'odd' && run > maxOdd) maxOdd = run;
        });
        var total = w.length;
        return {
            total: total, even: even, odd: odd,
            evenPct: total ? (even / total) * 100 : 0, oddPct: total ? (odd / total) * 100 : 0,
            currentStreak: { type: runType, length: total ? run : 0 },
            maxEvenStreak: maxEven, maxOddStreak: maxOdd
        };
    }

    /** Deriv definitions: Over wins if last digit > barrier, Under wins if last digit < barrier. Equal is a loss for both. */
    function overUnder(digits, barrier, n) {
        var w = n > 0 ? digits.slice(-n) : digits.slice();
        var over = 0, under = 0, equal = 0, runOver = 0, runUnder = 0, maxOver = 0, maxUnder = 0;
        var cur = { type: null, length: 0 };
        w.forEach(function (d) {
            var t = d > barrier ? 'over' : d < barrier ? 'under' : 'equal';
            if (t === 'over') { over++; runOver++; runUnder = 0; if (runOver > maxOver) maxOver = runOver; }
            else if (t === 'under') { under++; runUnder++; runOver = 0; if (runUnder > maxUnder) maxUnder = runUnder; }
            else { equal++; runOver = 0; runUnder = 0; }
            if (t === cur.type) cur.length++; else cur = { type: t, length: 1 };
        });
        var total = w.length;
        var pct = function (x) { return total ? (x / total) * 100 : 0; };
        // Theoretical probabilities for a uniform digit.
        return {
            total: total, barrier: barrier, over: over, under: under, equal: equal,
            overPct: pct(over), underPct: pct(under), equalPct: pct(equal),
            theoreticalOverPct: (9 - barrier) * 10, theoreticalUnderPct: barrier * 10,
            currentStreak: cur, maxOverStreak: maxOver, maxUnderStreak: maxUnder
        };
    }

    /** Percentage points deviation of observed vs expected, to flag bias without overstating it. */
    function bias(observedPct, expectedPct) { return observedPct - expectedPct; }

    /** Accepts Deriv ticks_history payloads (history.prices / history.times) and tick messages. */
    function parseHistory(msg) {
        var h = msg && msg.history;
        if (!h || !Array.isArray(h.prices)) return null;
        return {
            prices: h.prices.map(Number),
            times: (h.times || []).map(Number),
            pipSize: msg.pip_size != null ? Number(msg.pip_size) : null
        };
    }

    function parseTick(msg) {
        var t = msg && msg.tick;
        if (!t) return null;
        var price = t.quote != null ? t.quote : t.price;
        if (price == null) return null;
        return {
            price: Number(price), epoch: Number(t.epoch),
            symbol: t.symbol || t.underlying_symbol || null,
            pipSize: t.pip_size != null ? Number(t.pip_size) : null,
            subscriptionId: msg.subscription && msg.subscription.id
        };
    }

    return { lastDigit: lastDigit, digitsFromPrices: digitsFromPrices, distribution: distribution,
             evenOdd: evenOdd, overUnder: overUnder, bias: bias, parseHistory: parseHistory, parseTick: parseTick };
});
