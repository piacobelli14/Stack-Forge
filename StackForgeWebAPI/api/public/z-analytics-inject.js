(function(){
  // generate or read a single cookie on .stackforgeengine.com
  function getVisitorId(){
    const m = document.cookie.match(/(?:^|; )sf_visitor_id=([^;]+)/);
    if(m) return m[1];
    const id = crypto.randomUUID();
    document.cookie =
      `sf_visitor_id=${id};` +
      `path=/;domain=.stackforgeengine.com;SameSite=None;Secure`;
    return id;
  }
  const visitorId = getVisitorId();

  async function checkAuth() {
    try {
      const response = await fetch('http://localhost:3000/auth/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Visitor-Id': visitorId
        },
        keepalive: true,
        body: JSON.stringify({
          domain: location.hostname
        })
      });

      const data = await response.json();

      if (response.status === 403 || (data.protected && !data.isAuthenticated)) {
        const loginUrl = `http://localhost:5173/login?return=${encodeURIComponent(window.location.href)}`;
        window.location.href = loginUrl;
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  checkAuth().then(isAuthorized => {
    if (!isAuthorized) return;

    let engaged = false;
    const markEngaged = () => { engaged = true; };
    try {
      new PerformanceObserver((list) => {
        if (list.getEntries().length) markEngaged();
      }).observe({ type: 'first-input', buffered: true });
    } catch (_) {}
    window.addEventListener('click',   markEngaged, { once: true });
    window.addEventListener('keydown', markEngaged, { once: true });
    window.addEventListener('scroll',  markEngaged, { once: true });

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
    } catch (_) {}

    const userAgent = navigator.userAgent;

    const MAX_REQUESTS = 50;
    let edgeRequests = [];

    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
      const start = performance.now();
      let method = (init && init.method) || 'GET';
      let url = typeof input === 'string' ? input : input.url;
      try {
        const response = await originalFetch(input, init);
        const duration = Math.round(performance.now() - start);
        if (edgeRequests.length < MAX_REQUESTS && isEdgeRequest(url)) {
          edgeRequests.push({
            url,
            method,
            status: response.status,
            duration,
            type: 'fetch',
            timing: { response: duration }
          });
        }
        return response;
      } catch (e) {
        if (edgeRequests.length < MAX_REQUESTS && isEdgeRequest(url)) {
          edgeRequests.push({
            url,
            method,
            status: 0,
            duration: Math.round(performance.now() - start),
            type: 'fetch',
            timing: { response: 0 }
          });
        }
        throw e;
      }
    };

    const isEdgeRequest = (url) => {
      const edgeDomains = [
        'cdn.',
        'cloudflare.com',
        'fastly.net',
        'akamai.net',
        'edge.'
      ];
      try {
        const parsedUrl = new URL(url);
        return edgeDomains.some(domain => parsedUrl.hostname.includes(domain)) ||
               parsedUrl.hostname !== location.hostname;
      } catch {
        return false;
      }
    };

    try {
      new PerformanceObserver((list) => {
        list.getEntries().forEach(entry => {
          if (entry.entryType === 'resource' &&
              entry.initiatorType !== 'navigation' &&
              edgeRequests.length < MAX_REQUESTS &&
              isEdgeRequest(entry.name)) {
            edgeRequests.push({
              url: entry.name,
              method: 'GET',
              status: entry.responseStatus || 0,
              duration: Math.round(entry.duration),
              type: entry.initiatorType,
              timing: {
                dns: Math.round(entry.domainLookupEnd - entry.domainLookupStart),
                connect: Math.round(entry.connectEnd - entry.connectStart),
                response: Math.round(entry.responseEnd - entry.responseStart)
              }
            });
          }
        });
      }).observe({ type: 'resource', buffered: true });
    } catch (error) {}

    if (!('PerformanceObserver' in window)) {
      const checkResources = () => {
        performance.getEntriesByType('resource').forEach(entry => {
          if (entry.initiatorType !== 'navigation' &&
              edgeRequests.length < MAX_REQUESTS &&
              isEdgeRequest(entry.name)) {
            edgeRequests.push({
              url: entry.name,
              method: 'GET',
              status: 0,
              duration: Math.round(entry.duration),
              type: entry.initiatorType || 'unknown',
              timing: {
                dns: Math.round(entry.domainLookupEnd - entry.domainLookupStart),
                connect: Math.round(entry.connectEnd - entry.connectStart),
                response: Math.round(entry.responseEnd - entry.responseStart)
              }
            });
          }
        });
      };
      setInterval(checkResources, 1000);
    }

    const THRESHOLD_MS = 5000;
    const sendMetrics = () => {
      const timeSpent = performance.now() - startTime;
      const isBounce = !engaged && timeSpent < THRESHOLD_MS;

      fetch('http://localhost:3000/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          domain: location.hostname,
          visitorId,
          url: location.pathname + location.search,
          metrics: {
            loadTimeMs: Math.round(loadTimeMs),
            lcpMs: Math.round(lcpMs),
            bounce: isBounce,
            edgeRequests: edgeRequests
          },
          userAgent
        })
      }).catch(() => {});
    };

    window.addEventListener('beforeunload', sendMetrics);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') sendMetrics();
    });
  });
})();
