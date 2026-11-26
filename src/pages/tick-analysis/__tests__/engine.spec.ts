import {
    buildRiskPlan,
    computeStats,
    deriveSignal,
    lastDigit,
    overUnder,
    wilson,
    zScore,
} from '../engine';

describe('tick analysis engine', () => {
    it('extracts last digit respecting pip size (keeps trailing zeros)', () => {
        expect(lastDigit(1234.5, 2)).toBe(0);
        expect(lastDigit(1234.57, 2)).toBe(7);
        expect(lastDigit(99, 0)).toBe(9);
    });

    it('z-score is 0 at expectation and grows with deviation', () => {
        expect(zScore(0.1, 0.1, 500)).toBe(0);
        expect(zScore(0.15, 0.1, 500)).toBeGreaterThan(3);
        expect(zScore(0.5, 0.5, 0)).toBe(0);
    });

    it('wilson interval contains the observed proportion and stays in [0,1]', () => {
        const [lo, hi] = wilson(10, 100);
        expect(lo).toBeLessThan(0.1);
        expect(hi).toBeGreaterThan(0.1);
        expect(wilson(0, 0)).toEqual([0, 0]);
        expect(wilson(100, 100)[1]).toBeLessThanOrEqual(1);
    });

    it('computes counts, streaks and even/odd', () => {
        const digits = [1, 1, 1, 2, 3, 3];
        const quotes = [1, 2, 3, 2, 2, 5];
        const s = computeStats(digits, quotes);
        expect(s.n).toBe(6);
        expect(s.digits[1].count).toBe(3);
        expect(s.longest_streak).toEqual({ digit: 1, length: 3 });
        expect(s.current_streak).toEqual({ digit: 3, length: 2 });
        expect(s.even_pct).toBeCloseTo(1 / 6);
        expect(s.rise_pct).toBeCloseTo(3 / 4);
    });

    it('needs a minimum sample before signalling', () => {
        const s = computeStats([1, 2, 3], [1, 2, 3]);
        expect(deriveSignal(s).level).toBe('NO SIGNAL');
    });

    it('flags a heavily skewed window as STRONG', () => {
        const digits = Array.from({ length: 500 }, (_, i) => (i % 3 === 0 ? 7 : i % 10));
        const s = computeStats(digits, digits);
        expect(deriveSignal(s).level).toBe('STRONG');
    });

    it('does not flag a uniform window', () => {
        const digits = Array.from({ length: 500 }, (_, i) => i % 10);
        const s = computeStats(digits, digits);
        expect(deriveSignal(s).level).toBe('NO SIGNAL');
    });

    it('over/under uses uniform expectations', () => {
        const digits = Array.from({ length: 1000 }, (_, i) => i % 10);
        const o = overUnder(computeStats(digits, digits), 4);
        expect(o.over_pct).toBeCloseTo(0.5);
        expect(o.under_pct).toBeCloseTo(0.4);
        expect(o.over_z).toBeCloseTo(0);
    });

    it('risk plan enforces min stake and loss-streak cap', () => {
        const p = buildRiskPlan(100, 1, 5, 5);
        expect(p.stake).toBe(1);
        expect(p.daily_loss_limit).toBe(5);
        expect(p.max_consecutive_losses).toBe(5);
        expect(buildRiskPlan(10, 1, 5, 5).stake).toBe(0.35);
    });
});
