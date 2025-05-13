(function () {
    let visitorId = localStorage.getItem('sf_visitor_id');
    if (!visitorId) {
        visitorId = crypto.randomUUID();
        localStorage.setItem('sf_visitor_id', visitorId);
    }

    let engaged = false;
    const markEngaged = () => { engaged = true; };
    try {
        new PerformanceObserver((list) => {
            if (list.getEntries().length) markEngaged();
        }).observe({ type: 'first-input', buffered: true });
    } catch (_) { }
    window.addEventListener('click', markEngaged, { once: true });
    window.addEventListener('keydown', markEngaged, { once: true });
    window.addEventListener('scroll', markEngaged, { once: true });

    const startTime = performance.now();
    let loadTimeMs = 0, lcpMs = 0;
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) loadTimeMs = nav.loadEventEnd - nav.startTime;
    try {
        new PerformanceObserver((list) => {
            list.getEntries().forEach(e => {
                const val = e.renderTime || e.loadTime;
                if (typeof val === 'number') {
                    lcpMs = Math.max(lcpMs, val);
                }
            });
        }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_) { }

    const userAgent = navigator.userAgent;
    const THRESHOLD_MS = 5000;
    const sendMetrics = () => {
        const timeSpent = performance.now() - startTime;
        const isBounce = !engaged && timeSpent < THRESHOLD_MS;

        fetch('http://localhost:3000/metrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                domain: location.hostname,
                visitorId,
                url: location.pathname + location.search,
                metrics: {
                    loadTimeMs: Math.round(loadTimeMs),
                    lcpMs: Math.round(lcpMs),
                    bounce: isBounce
                },
                userAgent
            }),
            keepalive: true
        }).catch(() => { });
    };

    window.addEventListener('beforeunload', sendMetrics);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') sendMetrics();
    });
})();