import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
    DisplayAmount,
    DisplayCurrencyState,
    formatBalanceLabel,
    getDisplayCurrencyState,
    getEffectiveRate,
    getRateSource,
    refreshLiveRate,
    setDisplayMode,
    setManualRate,
    startDisplayCurrency,
    subscribeDisplayCurrency,
    toDisplayAmount,
} from '@/utils/display-currency';

/**
 * Shared USD <-> KSh display preference. Any component that shows a money amount can call
 * `toDisplay(amount, accountCurrency)` and render the result; the choice, the rate and the
 * live-rate refresh are shared app-wide and persisted in localStorage.
 */
export const useDisplayCurrency = () => {
    const state: DisplayCurrencyState = useSyncExternalStore(
        subscribeDisplayCurrency,
        getDisplayCurrencyState,
        getDisplayCurrencyState
    );

    useEffect(() => {
        startDisplayCurrency();
    }, []);

    const toDisplay = useCallback(
        (amount: number, currency: string, defaultLabel?: string): DisplayAmount =>
            toDisplayAmount(amount, currency, state, defaultLabel),
        [state]
    );

    const balanceLabel = useCallback(
        (balance: string | number, currency: string, defaultLabel: string) =>
            formatBalanceLabel(balance, currency, defaultLabel, state),
        [state]
    );

    return {
        state,
        mode: state.mode,
        rate: getEffectiveRate(state),
        rateSource: getRateSource(state),
        setMode: setDisplayMode,
        setManualRate,
        refresh: () => refreshLiveRate({ force: true }),
        toDisplay,
        balanceLabel,
    };
};

export default useDisplayCurrency;
