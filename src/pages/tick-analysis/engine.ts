/**
 * Pure statistics engine for tick analysis. No I/O, fully unit-testable.
 *
 * IMPORTANT: Deriv synthetic indices are driven by a certified RNG. Digit
 * deviations measured here describe the sample window only; they are not a
 * proven predictive edge. Treat signals as "unusual" rather than "profitable".
 */

export type SignalLevel = 'STRONG' | 'MODERATE' | 'WEAK' | 'NO SIGNAL';

export interface Tick {
    epoch: number;
    quote: number;
}

export interface DigitStat {
    digit: number;
    count: number;
    pct: number;
    z: number;
    ci_low: number;
    ci_high: number;
}

export interface MarketStats {
    n: number;
    digits: DigitStat[];
    hottest: number;
    coldest: number;
    even_pct: number;
    odd_pct: number;
    even_odd_z: number;
    rise_pct: number;
    fall_pct: number;
    current_streak: { digit: number; length: number };
    longest_streak: { digit: number; length: number };
    last_digits: number[];
}

export interface Signal {
    level: SignalLevel;
    score: number;
    label: string;
    detail: string;
}

export const EXPECTED_DIGIT_P = 0.1;

export const lastDigit = (quote: number, pip_size: number): number => {
    const s = quote.toFixed(Math.max(0, pip_size));
    return Number(s[s.length - 1]);
};

/** z-score of an observed proportion against an expected one. */
export const zScore = (observed_p: number, expected_p: number, n: number): number => {
    if (n <= 0) return 0;
    const se = Math.sqrt((expected_p * (1 - expected_p)) / n);
    return se === 0 ? 0 : (observed_p - expected_p) / se;
};

/** Wilson score interval (95%). */
export const wilson = (successes: number, n: number, z = 1.96): [number, number] => {
    if (n === 0) return [0, 0];
    const p = successes / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = (p + z2 / (2 * n)) / denom;
    const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
    return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
};

export const computeStats = (digits: number[], quotes: number[]): MarketStats => {
    const n = digits.length;
    const counts = new Array<number>(10).fill(0);
    let cur = { digit: -1, length: 0 };
    let longest = { digit: -1, length: 0 };

    for (const d of digits) {
        counts[d]++;
        if (d === cur.digit) cur.length++;
        else cur = { digit: d, length: 1 };
        if (cur.length > longest.length) longest = { ...cur };
    }

    const stats: DigitStat[] = counts.map((count, digit) => {
        const pct = n ? count / n : 0;
        const [lo, hi] = wilson(count, n);
        return { digit, count, pct, z: zScore(pct, EXPECTED_DIGIT_P, n), ci_low: lo, ci_high: hi };
    });

    const even = counts.reduce((a, c, d) => (d % 2 === 0 ? a + c : a), 0);
    const even_p = n ? even / n : 0;

    let rises = 0;
    let falls = 0;
    for (let i = 1; i < quotes.length; i++) {
        if (quotes[i] > quotes[i - 1]) rises++;
        else if (quotes[i] < quotes[i - 1]) falls++;
    }
    const moves = rises + falls;

    const sorted = [...stats].sort((a, b) => b.count - a.count);

    return {
        n,
        digits: stats,
        hottest: n ? sorted[0].digit : -1,
        coldest: n ? sorted[9].digit : -1,
        even_pct: even_p,
        odd_pct: n ? 1 - even_p : 0,
        even_odd_z: zScore(even_p, 0.5, n),
        rise_pct: moves ? rises / moves : 0,
        fall_pct: moves ? falls / moves : 0,
        current_streak: cur.digit === -1 ? { digit: -1, length: 0 } : cur,
        longest_streak: longest,
        last_digits: digits.slice(-30),
    };
};

/** P(digit > barrier) and P(digit < barrier) in a uniform distribution. */
export const overUnder = (stats: MarketStats, barrier: number) => {
    const over = stats.digits.filter(d => d.digit > barrier).reduce((a, d) => a + d.count, 0);
    const under = stats.digits.filter(d => d.digit < barrier).reduce((a, d) => a + d.count, 0);
    const n = stats.n || 1;
    const exp_over = (9 - barrier) / 10;
    const exp_under = barrier / 10;
    return {
        over_pct: over / n,
        under_pct: under / n,
        over_z: exp_over > 0 && exp_over < 1 ? zScore(over / n, exp_over, stats.n) : 0,
        under_z: exp_under > 0 && exp_under < 1 ? zScore(under / n, exp_under, stats.n) : 0,
        exp_over,
        exp_under,
    };
};

export const MIN_SAMPLE = 100;

/**
 * Rank the most unusual deviation in the window. 30 hypotheses are tested
 * (10 digits x 2 directions, plus even/odd), so thresholds are deliberately
 * conservative to limit false positives from multiple comparisons.
 */
export const deriveSignal = (stats: MarketStats): Signal => {
    if (stats.n < MIN_SAMPLE) {
        return { level: 'NO SIGNAL', score: 0, label: 'Collecting data', detail: `${stats.n}/${MIN_SAMPLE} ticks` };
    }

    let best = { score: 0, label: '', detail: '' };
    for (const d of stats.digits) {
        const s = Math.abs(d.z);
        if (s > best.score) {
            best = {
                score: s,
                label: d.z > 0 ? `Digit ${d.digit} over-represented` : `Digit ${d.digit} under-represented`,
                detail: `${(d.pct * 100).toFixed(1)}% vs 10.0% expected (z=${d.z.toFixed(2)})`,
            };
        }
    }
    const eo = Math.abs(stats.even_odd_z);
    if (eo > best.score) {
        const even = stats.even_odd_z > 0;
        best = {
            score: eo,
            label: even ? 'Even-heavy' : 'Odd-heavy',
            detail: `${((even ? stats.even_pct : stats.odd_pct) * 100).toFixed(1)}% vs 50.0% (z=${stats.even_odd_z.toFixed(2)})`,
        };
    }

    const level: SignalLevel =
        best.score >= 3.5 ? 'STRONG' : best.score >= 3 ? 'MODERATE' : best.score >= 2.5 ? 'WEAK' : 'NO SIGNAL';
    return { level, ...best };
};

export const LEVEL_ORDER: Record<SignalLevel, number> = { STRONG: 3, MODERATE: 2, WEAK: 1, 'NO SIGNAL': 0 };

/** Fixed-fractional stake sizing with loss-streak and daily drawdown guards. */
export interface RiskPlan {
    stake: number;
    daily_loss_limit: number;
    daily_target: number;
    max_consecutive_losses: number;
}

export const buildRiskPlan = (
    balance: number,
    risk_pct: number,
    daily_loss_pct: number,
    daily_target_pct: number
): RiskPlan => {
    const b = Math.max(0, balance);
    const stake = Math.max(0.35, +(b * (risk_pct / 100)).toFixed(2)); // 0.35 = Deriv minimum stake
    const daily_loss_limit = +(b * (daily_loss_pct / 100)).toFixed(2);
    return {
        stake,
        daily_loss_limit,
        daily_target: +(b * (daily_target_pct / 100)).toFixed(2),
        max_consecutive_losses: Math.max(1, Math.floor(daily_loss_limit / stake)),
    };
};
