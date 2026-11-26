import React from 'react';
import classNames from 'classnames';
import {
    buildRiskPlan,
    computeStats,
    deriveSignal,
    LEVEL_ORDER,
    MarketStats,
    overUnder,
    Signal,
} from './engine';
import { FeedStatus, SymbolInfo, TickFeed } from './tick-service';
import './tick-analysis.scss';

const WINDOWS = [100, 250, 500, 1000];
const STALE_MS = 10_000;
const RISK_KEY = 'tick_analysis_risk_v1';

type Row = { symbol: string; name: string; stats: MarketStats; signal: Signal; stale: boolean };

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

const loadRisk = () => {
    try {
        return { balance: 100, risk: 1, loss: 5, target: 5, ...JSON.parse(localStorage.getItem(RISK_KEY) || '{}') };
    } catch {
        return { balance: 100, risk: 1, loss: 5, target: 5 };
    }
};

const TickAnalysis = () => {
    const feed = React.useRef<TickFeed | null>(null);
    const [status, setStatus] = React.useState<FeedStatus>('connecting');
    const [symbols, setSymbols] = React.useState<SymbolInfo[]>([]);
    const [, force] = React.useReducer((x: number) => x + 1, 0);
    const [window_size, setWindowSize] = React.useState(500);
    const [selected, setSelected] = React.useState<string>('');
    const [barrier, setBarrier] = React.useState(4);
    const [risk, setRisk] = React.useState(loadRisk);

    // Throttle renders to ~4/s regardless of how many symbols tick.
    React.useEffect(() => {
        let dirty = false;
        const f = new TickFeed({
            onStatus: setStatus,
            onSymbols: setSymbols,
            onUpdate: () => {
                dirty = true;
            },
        });
        feed.current = f;
        f.connect();
        const timer = setInterval(() => {
            if (dirty) {
                dirty = false;
                force();
            } else {
                force(); // keeps stale detection fresh
            }
        }, 250);
        return () => {
            clearInterval(timer);
            f.dispose();
        };
    }, []);

    React.useEffect(() => {
        try {
            localStorage.setItem(RISK_KEY, JSON.stringify(risk));
        } catch {
            /* storage unavailable */
        }
    }, [risk]);

    const now = Date.now();
    const rows: Row[] = symbols
        .map(s => {
            const b = feed.current?.buffers.get(s.symbol);
            if (!b || !b.digits.length) return null;
            const stats = computeStats(b.digits.slice(-window_size), b.ticks.slice(-window_size).map(t => t.quote));
            return { ...s, stats, signal: deriveSignal(stats), stale: now - b.last_update > STALE_MS };
        })
        .filter(Boolean)
        .sort((a, b) => LEVEL_ORDER[b!.signal.level] - LEVEL_ORDER[a!.signal.level] || b!.signal.score - a!.signal.score) as Row[];

    const current = rows.find(r => r.symbol === selected) || rows[0];
    const ou = current ? overUnder(current.stats, barrier) : null;
    const plan = buildRiskPlan(risk.balance, risk.risk, risk.loss, risk.target);

    return (
        <div className='tick-analysis'>
            <div className='tick-analysis__bar'>
                <span className={classNames('tick-analysis__status', `tick-analysis__status--${status}`)}>
                    {status === 'live' ? 'Live' : status === 'closed' ? 'Closed' : 'Connecting…'}
                </span>
                <label>
                    Window
                    <select value={window_size} onChange={e => setWindowSize(Number(e.target.value))}>
                        {WINDOWS.map(w => (
                            <option key={w} value={w}>
                                {w} ticks
                            </option>
                        ))}
                    </select>
                </label>
                <span className='tick-analysis__note'>
                    Synthetic indices are RNG-driven. Signals flag statistical deviations in the sample, not guaranteed
                    outcomes.
                </span>
            </div>

            <div className='tick-analysis__grid'>
                <section className='tick-analysis__panel'>
                    <h3>Market signals</h3>
                    <table className='tick-analysis__table'>
                        <thead>
                            <tr>
                                <th>Market</th>
                                <th>Signal</th>
                                <th>Deviation</th>
                                <th>Ticks</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && (
                                <tr>
                                    <td colSpan={4}>Waiting for ticks…</td>
                                </tr>
                            )}
                            {rows.map(r => (
                                <tr
                                    key={r.symbol}
                                    className={classNames({
                                        'is-selected': r.symbol === current?.symbol,
                                        'is-stale': r.stale,
                                    })}
                                    onClick={() => setSelected(r.symbol)}
                                >
                                    <td>{r.name}</td>
                                    <td>
                                        <span
                                            className={classNames(
                                                'tick-analysis__badge',
                                                `tick-analysis__badge--${r.signal.level.replace(' ', '-').toLowerCase()}`
                                            )}
                                        >
                                            {r.signal.level}
                                        </span>
                                    </td>
                                    <td>{r.signal.label}</td>
                                    <td>{r.stats.n}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>

                {current && ou && (
                    <section className='tick-analysis__panel'>
                        <h3>
                            {current.name} {current.stale && <small>(stale)</small>}
                        </h3>
                        <p className='tick-analysis__detail'>{current.signal.detail}</p>

                        <div className='tick-analysis__digits'>
                            {current.stats.digits.map(d => (
                                <div key={d.digit} className='tick-analysis__digit'>
                                    <div className='tick-analysis__digit-bar'>
                                        <div
                                            className={classNames({
                                                hot: d.digit === current.stats.hottest,
                                                cold: d.digit === current.stats.coldest,
                                            })}
                                            style={{ height: `${Math.min(100, d.pct * 400)}%` }}
                                            title={`95% CI ${pct(d.ci_low)}–${pct(d.ci_high)}, z=${d.z.toFixed(2)}`}
                                        />
                                    </div>
                                    <strong>{d.digit}</strong>
                                    <span>{pct(d.pct)}</span>
                                </div>
                            ))}
                        </div>

                        <div className='tick-analysis__stats'>
                            <div>
                                Even / Odd
                                <b>
                                    {pct(current.stats.even_pct)} / {pct(current.stats.odd_pct)}
                                </b>
                            </div>
                            <div>
                                Rise / Fall
                                <b>
                                    {pct(current.stats.rise_pct)} / {pct(current.stats.fall_pct)}
                                </b>
                            </div>
                            <div>
                                Current streak
                                <b>
                                    {current.stats.current_streak.length}× digit {current.stats.current_streak.digit}
                                </b>
                            </div>
                            <div>
                                Longest streak
                                <b>
                                    {current.stats.longest_streak.length}× digit {current.stats.longest_streak.digit}
                                </b>
                            </div>
                        </div>

                        <div className='tick-analysis__ou'>
                            <label>
                                Barrier
                                <select value={barrier} onChange={e => setBarrier(Number(e.target.value))}>
                                    {[1, 2, 3, 4, 5, 6, 7, 8].map(b => (
                                        <option key={b} value={b}>
                                            {b}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <span>
                                Over {barrier}: {pct(ou.over_pct)} (exp {pct(ou.exp_over, 0)}, z={ou.over_z.toFixed(2)})
                            </span>
                            <span>
                                Under {barrier}: {pct(ou.under_pct)} (exp {pct(ou.exp_under, 0)}, z=
                                {ou.under_z.toFixed(2)})
                            </span>
                        </div>

                        <div className='tick-analysis__strip'>
                            {current.stats.last_digits.map((d, i) => (
                                <span key={i}>{d}</span>
                            ))}
                        </div>
                    </section>
                )}

                <section className='tick-analysis__panel'>
                    <h3>Risk plan</h3>
                    <div className='tick-analysis__risk'>
                        {(
                            [
                                ['balance', 'Balance'],
                                ['risk', 'Risk per trade (%)'],
                                ['loss', 'Daily loss limit (%)'],
                                ['target', 'Daily target (%)'],
                            ] as const
                        ).map(([k, label]) => (
                            <label key={k}>
                                {label}
                                <input
                                    type='number'
                                    min={0}
                                    step='any'
                                    value={risk[k]}
                                    onChange={e => setRisk({ ...risk, [k]: Number(e.target.value) })}
                                />
                            </label>
                        ))}
                    </div>
                    <ul className='tick-analysis__plan'>
                        <li>Stake per trade: <b>{plan.stake.toFixed(2)}</b></li>
                        <li>Stop for the day at loss: <b>{plan.daily_loss_limit.toFixed(2)}</b></li>
                        <li>Stop for the day at profit: <b>{plan.daily_target.toFixed(2)}</b></li>
                        <li>Pause after <b>{Math.min(plan.max_consecutive_losses, 5)}</b> consecutive losses</li>
                        <li>Never raise the stake after a loss (no martingale).</li>
                    </ul>
                </section>
            </div>
        </div>
    );
};

export default TickAnalysis;
