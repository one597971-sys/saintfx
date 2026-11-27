/**
 * Display-currency (USD <-> KSh) support.
 *
 * This is a DISPLAY-ONLY conversion: Deriv accounts settle in their own currency and every
 * trade, stake input and API call keeps using that currency. Only amounts that are shown to the
 * user and whose account currency is USD are converted when the "KES" display mode is on.
 *
 * Rate source: ExchangeRate-API's keyless "Open Access" endpoint (updates once per day,
 * attribution link required, so we refresh at most every 12h). The user can override the rate
 * manually (e.g. with the rate their payment provider gives them) and switch back to live.
 */

export type DisplayMode = 'USD' | 'KES';
export type RateSource = 'manual' | 'live' | 'cached' | 'fallback';
export type FetchStatus = 'idle' | 'loading' | 'error';

export interface DisplayCurrencyState {
    mode: DisplayMode;
    /** Rate typed in by the user (KSh per 1 USD). Takes priority when set. */
    manualRate: number | null;
    /** Last rate fetched from the API. */
    liveRate: number | null;
    /** Epoch ms of the last successful fetch. */
    liveUpdatedAt: number | null;
    fetchStatus: FetchStatus;
}

export const RATE_API_URL = 'https://open.er-api.com/v6/latest/USD';
export const ATTRIBUTION_URL = 'https://www.exchangerate-api.com';
export const FALLBACK_RATE = 129; // roughly the mid-market rate; only used if nothing else is known
export const MIN_RATE = 20;
export const MAX_RATE = 1000;
export const LIVE_FRESH_MS = 12 * 60 * 60 * 1000; // the API only updates once per day
export const REFRESH_CHECK_MS = 60 * 60 * 1000; // re-check hourly, fetch only if stale
export const FETCH_TIMEOUT_MS = 8000;
export const STORAGE_KEY = 'display_currency_v1';

/* ------------------------------------------------------------------ pure helpers */

export const isValidRate = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= MIN_RATE && n <= MAX_RATE;

/** Extracts the KES rate from an ExchangeRate-API response; null if the payload is not trustworthy. */
export const parseApiRate = (json: unknown): number | null => {
    const data = json as { result?: string; base_code?: string; rates?: Record<string, unknown> } | null;
    if (!data || data.result !== 'success' || (data.base_code && data.base_code !== 'USD')) return null;
    const kes = data.rates?.KES;
    return isValidRate(kes) ? kes : null;
};

export const getEffectiveRate = (s: DisplayCurrencyState): number => s.manualRate ?? s.liveRate ?? FALLBACK_RATE;

export const getRateSource = (s: DisplayCurrencyState, now = Date.now()): RateSource => {
    if (s.manualRate !== null) return 'manual';
    if (s.liveRate === null) return 'fallback';
    return s.liveUpdatedAt !== null && now - s.liveUpdatedAt < LIVE_FRESH_MS ? 'live' : 'cached';
};

/** Only USD amounts are converted, and only when the KES display mode is active. */
export const shouldConvert = (currency: string | undefined, mode: DisplayMode): boolean =>
    mode === 'KES' && (currency ?? '').toUpperCase() === 'USD';

export const usdToKes = (usd: number, rate: number): number => usd * rate;
export const kesToUsd = (kes: number, rate: number): number => (rate > 0 ? kes / rate : 0);

/** Parses amounts that may already be formatted with thousands separators ("1,234.50"). */
export const parseAmount = (value: string | number | undefined | null): number => {
    if (typeof value === 'number') return value;
    if (value === undefined || value === null) return NaN;
    return Number(String(value).replace(/,/g, '').trim());
};

export const formatKes = (amount: number): string =>
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

export const KES_LABEL = 'KSh';

export interface DisplayAmount {
    value: number;
    currency: string; // ISO-like code of what is displayed
    label: string; // short label to show next to the number
    converted: boolean;
}

export const toDisplayAmount = (
    amount: number,
    currency: string,
    state: Pick<DisplayCurrencyState, 'mode' | 'manualRate' | 'liveRate'>,
    defaultLabel: string = currency
): DisplayAmount => {
    if (shouldConvert(currency, state.mode)) {
        const rate = state.manualRate ?? state.liveRate ?? FALLBACK_RATE;
        return { value: usdToKes(amount, rate), currency: 'KES', label: KES_LABEL, converted: true };
    }
    return { value: amount, currency, label: defaultLabel, converted: false };
};

/**
 * Balance text for the header/account dropdown. Unconverted balances keep their original
 * formatted string so nothing changes while the USD mode is selected.
 */
export const formatBalanceLabel = (
    balance: string | number,
    currency: string,
    defaultLabel: string,
    state: Pick<DisplayCurrencyState, 'mode' | 'manualRate' | 'liveRate'>
): string => {
    if (!shouldConvert(currency, state.mode)) return `${balance} ${defaultLabel}`;
    const n = parseAmount(balance);
    if (!Number.isFinite(n)) return `${balance} ${defaultLabel}`;
    const d = toDisplayAmount(n, currency, state, defaultLabel);
    return `${formatKes(d.value)} ${d.label}`;
};

/* ------------------------------------------------------------------ store */

type Listener = () => void;

const defaultState = (): DisplayCurrencyState => ({
    mode: 'USD',
    manualRate: null,
    liveRate: null,
    liveUpdatedAt: null,
    fetchStatus: 'idle',
});

const readStorage = (): DisplayCurrencyState => {
    const base = defaultState();
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        if (!raw) return base;
        const p = JSON.parse(raw) as Partial<DisplayCurrencyState>;
        return {
            ...base,
            mode: p.mode === 'KES' ? 'KES' : 'USD',
            manualRate: isValidRate(p.manualRate) ? p.manualRate : null,
            liveRate: isValidRate(p.liveRate) ? p.liveRate : null,
            liveUpdatedAt: typeof p.liveUpdatedAt === 'number' ? p.liveUpdatedAt : null,
        };
    } catch {
        return base;
    }
};

const writeStorage = (s: DisplayCurrencyState) => {
    try {
        if (typeof localStorage === 'undefined') return;
        const { mode, manualRate, liveRate, liveUpdatedAt } = s;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, manualRate, liveRate, liveUpdatedAt }));
    } catch {
        /* storage unavailable (private mode, quota): keep working in memory */
    }
};

let state: DisplayCurrencyState = readStorage();
const listeners = new Set<Listener>();
let started = false;
let inflight: Promise<void> | null = null;

const setState = (patch: Partial<DisplayCurrencyState>, persist = true) => {
    state = { ...state, ...patch };
    if (persist) writeStorage(state);
    listeners.forEach(l => l());
};

export const getDisplayCurrencyState = (): DisplayCurrencyState => state;

export const subscribeDisplayCurrency = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export const setDisplayMode = (mode: DisplayMode) => {
    if (mode !== state.mode) setState({ mode });
};

/** Pass null to go back to the live rate. Returns false when the value is not an acceptable rate. */
export const setManualRate = (rate: number | null): boolean => {
    if (rate === null) {
        setState({ manualRate: null });
        return true;
    }
    if (!isValidRate(rate)) return false;
    setState({ manualRate: rate });
    return true;
};

/** Fetches the live USD->KES rate. Safe to call repeatedly: skips while fresh or already in flight. */
export const refreshLiveRate = (opts: { force?: boolean } = {}): Promise<void> => {
    const fresh =
        state.liveRate !== null && state.liveUpdatedAt !== null && Date.now() - state.liveUpdatedAt < LIVE_FRESH_MS;
    if ((fresh && !opts.force) || typeof fetch === 'undefined') return Promise.resolve();
    if (inflight) return inflight;

    setState({ fetchStatus: 'loading' }, false);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);

    inflight = fetch(RATE_API_URL, { signal: controller?.signal })
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(json => {
            const rate = parseApiRate(json);
            if (rate === null) throw new Error('Unexpected rate response');
            setState({ liveRate: rate, liveUpdatedAt: Date.now(), fetchStatus: 'idle' });
        })
        .catch(() => {
            // Keep whatever rate we already have (cached / manual / fallback) and flag the failure.
            setState({ fetchStatus: 'error' }, false);
        })
        .finally(() => {
            clearTimeout(timer);
            inflight = null;
        });
    return inflight;
};

/** Starts the background refresh once (idempotent). */
export const startDisplayCurrency = () => {
    if (started) return;
    started = true;
    void refreshLiveRate();
    if (typeof setInterval !== 'undefined') setInterval(() => void refreshLiveRate(), REFRESH_CHECK_MS);
};

/** Test helper: reset the in-memory store. */
export const __resetDisplayCurrencyForTests = (next?: Partial<DisplayCurrencyState>) => {
    state = { ...defaultState(), ...next };
    started = false;
    inflight = null;
    listeners.clear();
};
