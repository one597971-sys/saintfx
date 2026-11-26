import { isProduction, WS_SERVERS } from '@/components/shared/utils/config/config';
import { lastDigit, Tick } from './engine';

export interface SymbolInfo {
    symbol: string;
    name: string;
}

export interface SymbolBuffer {
    pip_size: number;
    ticks: Tick[];
    digits: number[];
    last_update: number; // Date.now() of last accepted tick
}

export type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

interface Handlers {
    onStatus: (s: FeedStatus) => void;
    onSymbols: (symbols: SymbolInfo[]) => void;
    onUpdate: (symbol: string) => void;
}

const MAX_BUFFER = 1000;
const PING_MS = 25_000;
const MAX_BACKOFF = 15_000;

/**
 * Public (unauthenticated) tick feed: reconnect with backoff, dynamic symbol
 * discovery, de-duplication by epoch and automatic resubscription.
 */
export class TickFeed {
    buffers = new Map<string, SymbolBuffer>();
    private ws: WebSocket | null = null;
    private attempts = 0;
    private reconnect_timer: ReturnType<typeof setTimeout> | null = null;
    private ping_timer: ReturnType<typeof setInterval> | null = null;
    private symbols: SymbolInfo[] = [];
    private disposed = false;

    constructor(private handlers: Handlers) {}

    private url() {
        return isProduction() ? WS_SERVERS.PRODUCTION : WS_SERVERS.STAGING;
    }

    connect() {
        if (this.disposed) return;
        this.handlers.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');
        const ws = new WebSocket(this.url());
        this.ws = ws;

        ws.onopen = () => {
            this.attempts = 0;
            this.send({ active_symbols: 'brief', product_type: 'basic' });
            this.ping_timer = setInterval(() => this.send({ ping: 1 }), PING_MS);
        };
        ws.onmessage = ev => {
            try {
                this.handle(JSON.parse(ev.data));
            } catch {
                /* ignore malformed frame */
            }
        };
        ws.onclose = () => {
            if (this.ping_timer) clearInterval(this.ping_timer);
            if (this.disposed) return;
            this.handlers.onStatus('reconnecting');
            const delay = Math.min(MAX_BACKOFF, 1000 * 2 ** this.attempts++);
            this.reconnect_timer = setTimeout(() => this.connect(), delay);
        };
        ws.onerror = () => ws.close();
    }

    private send(payload: object) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
    }

    private subscribe(symbol: string) {
        this.send({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: MAX_BUFFER,
            end: 'latest',
            style: 'ticks',
            subscribe: 1,
        });
    }

    private buffer(symbol: string, pip_size: number): SymbolBuffer {
        let b = this.buffers.get(symbol);
        if (!b) {
            b = { pip_size, ticks: [], digits: [], last_update: 0 };
            this.buffers.set(symbol, b);
        }
        b.pip_size = pip_size || b.pip_size;
        return b;
    }

    private push(symbol: string, pip_size: number, epoch: number, quote: number) {
        const b = this.buffer(symbol, pip_size);
        const last = b.ticks[b.ticks.length - 1];
        if (last && epoch <= last.epoch) return; // duplicate / out of order
        b.ticks.push({ epoch, quote });
        b.digits.push(lastDigit(quote, b.pip_size));
        if (b.ticks.length > MAX_BUFFER) {
            b.ticks.shift();
            b.digits.shift();
        }
        b.last_update = Date.now();
    }

    private handle(msg: any) {
        if (msg.error) return;
        switch (msg.msg_type) {
            case 'active_symbols': {
                const list: SymbolInfo[] = (msg.active_symbols || [])
                    .filter((s: any) => s.market === 'synthetic_index')
                    .map((s: any) => ({ symbol: s.symbol, name: s.display_name }));
                this.symbols = list;
                this.handlers.onSymbols(list);
                this.handlers.onStatus('live');
                // Stagger subscriptions to stay clear of rate limits.
                list.forEach((s, i) => setTimeout(() => this.subscribe(s.symbol), i * 120));
                break;
            }
            case 'history': {
                const symbol = msg.echo_req?.ticks_history;
                const prices: number[] = msg.history?.prices || [];
                const times: number[] = msg.history?.times || [];
                if (!symbol) break;
                const pip = Number(msg.pip_size ?? 2);
                this.buffers.delete(symbol); // history replaces stale buffer after reconnect
                prices.forEach((p, i) => this.push(symbol, pip, times[i], Number(p)));
                this.handlers.onUpdate(symbol);
                break;
            }
            case 'tick': {
                const t = msg.tick;
                if (!t) break;
                this.push(t.symbol, Number(t.pip_size ?? 2), t.epoch, Number(t.quote));
                this.handlers.onUpdate(t.symbol);
                break;
            }
        }
    }

    dispose() {
        this.disposed = true;
        if (this.reconnect_timer) clearTimeout(this.reconnect_timer);
        if (this.ping_timer) clearInterval(this.ping_timer);
        this.ws?.close();
        this.handlers.onStatus('closed');
    }
}
