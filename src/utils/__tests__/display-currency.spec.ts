import {
    __resetDisplayCurrencyForTests,
    FALLBACK_RATE,
    formatBalanceLabel,
    formatKes,
    getDisplayCurrencyState,
    getEffectiveRate,
    getRateSource,
    isValidRate,
    kesToUsd,
    parseAmount,
    parseApiRate,
    refreshLiveRate,
    setDisplayMode,
    setManualRate,
    shouldConvert,
    STORAGE_KEY,
    toDisplayAmount,
    usdToKes,
} from '../display-currency';

describe('display-currency helpers', () => {
    it('validates rates', () => {
        expect(isValidRate(129.5)).toBe(true);
        [0, -1, NaN, Infinity, 5, 5000, '129', null].forEach(v => expect(isValidRate(v)).toBe(false));
    });

    it('parses only trustworthy API payloads', () => {
        expect(parseApiRate({ result: 'success', base_code: 'USD', rates: { KES: 129.2 } })).toBe(129.2);
        expect(parseApiRate({ result: 'error' })).toBeNull();
        expect(parseApiRate({ result: 'success', base_code: 'EUR', rates: { KES: 129 } })).toBeNull();
        expect(parseApiRate({ result: 'success', rates: { KES: 'x' } })).toBeNull();
        expect(parseApiRate(null)).toBeNull();
    });

    it('converts both directions and only USD in KES mode', () => {
        expect(usdToKes(10, 129)).toBe(1290);
        expect(kesToUsd(1290, 129)).toBe(10);
        expect(shouldConvert('USD', 'KES')).toBe(true);
        expect(shouldConvert('usd', 'KES')).toBe(true);
        expect(shouldConvert('USD', 'USD')).toBe(false);
        expect(shouldConvert('BTC', 'KES')).toBe(false);
        expect(shouldConvert(undefined, 'KES')).toBe(false);
    });

    it('formats and parses amounts', () => {
        expect(formatKes(1290)).toBe('1,290.00');
        expect(parseAmount('1,234.50')).toBe(1234.5);
        expect(Number.isNaN(parseAmount(undefined))).toBe(true);
    });

    it('labels balances, leaving USD mode untouched', () => {
        const kes = { mode: 'KES' as const, manualRate: null, liveRate: 130 };
        const usd = { ...kes, mode: 'USD' as const };
        expect(formatBalanceLabel('10,000.00', 'USD', 'USD', usd)).toBe('10,000.00 USD');
        expect(formatBalanceLabel('10,000.00', 'USD', 'USD', kes)).toBe('1,300,000.00 KSh');
        expect(formatBalanceLabel('0.5', 'BTC', 'BTC', kes)).toBe('0.5 BTC');
        expect(toDisplayAmount(2, 'USD', { ...kes, manualRate: 100 }).value).toBe(200);
    });
});

describe('display-currency store', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
        localStorage.clear();
    });

    it('prefers manual over live over fallback and reports the source', () => {
        __resetDisplayCurrencyForTests();
        expect(getEffectiveRate(getDisplayCurrencyState())).toBe(FALLBACK_RATE);
        expect(getRateSource(getDisplayCurrencyState())).toBe('fallback');
        __resetDisplayCurrencyForTests({ liveRate: 130, liveUpdatedAt: Date.now() });
        expect(getRateSource(getDisplayCurrencyState())).toBe('live');
        expect(setManualRate(125)).toBe(true);
        expect(getEffectiveRate(getDisplayCurrencyState())).toBe(125);
        expect(setManualRate(3)).toBe(false);
        expect(setManualRate(null)).toBe(true);
        expect(getEffectiveRate(getDisplayCurrencyState())).toBe(130);
    });

    it('persists the mode and fetches a live rate', async () => {
        __resetDisplayCurrencyForTests();
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ result: 'success', base_code: 'USD', rates: { KES: 128.7 } }),
        }) as unknown as typeof fetch;
        setDisplayMode('KES');
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).mode).toBe('KES');
        await refreshLiveRate();
        expect(getDisplayCurrencyState().liveRate).toBe(128.7);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        await refreshLiveRate(); // fresh -> skipped
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('keeps the previous rate when the fetch fails', async () => {
        __resetDisplayCurrencyForTests({ liveRate: 129, liveUpdatedAt: 1 });
        globalThis.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
        await refreshLiveRate();
        expect(getDisplayCurrencyState().liveRate).toBe(129);
        expect(getDisplayCurrencyState().fetchStatus).toBe('error');
        expect(getRateSource(getDisplayCurrencyState())).toBe('cached');
    });
});
