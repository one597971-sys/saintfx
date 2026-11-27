import { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import useDisplayCurrency from '@/hooks/useDisplayCurrency';
import { ATTRIBUTION_URL, formatKes, MAX_RATE, MIN_RATE } from '@/utils/display-currency';
import './currency-toggle.scss';

const SOURCE_TEXT = {
    manual: 'Your rate',
    live: 'Live rate',
    cached: 'Saved rate (offline)',
    fallback: 'Estimated rate',
} as const;

/**
 * Header switch between USD and KSh. The rate chip opens a small panel to see where the rate
 * comes from, type your own rate, or return to the live one. Display-only: trades and stakes
 * stay in the account currency.
 */
const CurrencyToggle = () => {
    const { mode, rate, rateSource, state, setMode, setManualRate, refresh } = useDisplayCurrency();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const openPanel = () => {
        setDraft(rate.toFixed(2));
        setError('');
        setOpen(o => !o);
    };

    const applyManual = () => {
        const n = Number(draft.replace(/,/g, ''));
        if (!setManualRate(n)) {
            setError(`Enter a rate between ${MIN_RATE} and ${MAX_RATE}.`);
            return;
        }
        setError('');
        setOpen(false);
    };

    const updated = state.liveUpdatedAt ? new Date(state.liveUpdatedAt).toLocaleString() : null;

    return (
        <div className='currency-toggle' ref={ref}>
            <div className='currency-toggle__switch' role='group' aria-label='Display currency'>
                {(['USD', 'KES'] as const).map(m => (
                    <button
                        key={m}
                        type='button'
                        className={classNames('currency-toggle__btn', { 'currency-toggle__btn--active': mode === m })}
                        aria-pressed={mode === m}
                        data-testid={`dt_currency_${m}`}
                        onClick={() => setMode(m)}
                    >
                        {m === 'KES' ? 'KSh' : 'USD'}
                    </button>
                ))}
            </div>
            <button
                type='button'
                className='currency-toggle__rate'
                aria-expanded={open}
                aria-label='Exchange rate settings'
                title='Exchange rate settings'
                onClick={openPanel}
            >
                1$ = {formatKes(rate)}
            </button>

            {open && (
                <div className='currency-toggle__panel' role='dialog' aria-label='Exchange rate'>
                    <p className='currency-toggle__title'>USD → KSh rate</p>
                    <p className='currency-toggle__meta'>
                        {SOURCE_TEXT[rateSource]}
                        {state.fetchStatus === 'loading' && ' · updating…'}
                        {state.fetchStatus === 'error' && ' · could not refresh'}
                        {updated && rateSource !== 'manual' ? ` · ${updated}` : ''}
                    </p>
                    <label className='currency-toggle__field'>
                        <span>1 USD =</span>
                        <input
                            inputMode='decimal'
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && applyManual()}
                            aria-label='KSh per 1 USD'
                        />
                        <span>KSh</span>
                    </label>
                    {error && <p className='currency-toggle__error'>{error}</p>}
                    <div className='currency-toggle__actions'>
                        <button type='button' onClick={applyManual}>
                            Use my rate
                        </button>
                        <button
                            type='button'
                            onClick={() => {
                                setManualRate(null);
                                void refresh();
                                setOpen(false);
                            }}
                        >
                            Use live rate
                        </button>
                    </div>
                    <p className='currency-toggle__note'>
                        Display only. Your account, stakes and trades stay in their own currency.
                    </p>
                    <a className='currency-toggle__attr' href={ATTRIBUTION_URL} target='_blank' rel='noreferrer'>
                        Rates By Exchange Rate
                    </a>
                </div>
            )}
        </div>
    );
};

export default CurrencyToggle;
