/* API + market configuration, kept separate from UI logic. */
window.AnalysisConfig = {
    // Deriv public (no auth) options WebSocket.
    wsUrl: 'wss://api.derivws.com/trading/v1/options/ws/public',
    maxTicksPerRequest: 5000,
    markets: [
        { id: 'R_10', name: 'Volatility 10 Index' }, { id: 'R_25', name: 'Volatility 25 Index' },
        { id: 'R_50', name: 'Volatility 50 Index' }, { id: 'R_75', name: 'Volatility 75 Index' },
        { id: 'R_100', name: 'Volatility 100 Index' },
        { id: '1HZ10V', name: 'Volatility 10 (1s) Index' }, { id: '1HZ15V', name: 'Volatility 15 (1s) Index' },
        { id: '1HZ25V', name: 'Volatility 25 (1s) Index' }, { id: '1HZ30V', name: 'Volatility 30 (1s) Index' },
        { id: '1HZ50V', name: 'Volatility 50 (1s) Index' }, { id: '1HZ75V', name: 'Volatility 75 (1s) Index' },
        { id: '1HZ90V', name: 'Volatility 90 (1s) Index' }, { id: '1HZ100V', name: 'Volatility 100 (1s) Index' }
    ],
    historySizes: [100, 500, 1000, 2000, 5000],
    windowSizes: [50, 100, 200, 500, 1000, 5000],
    feedLength: 30
};
