const express = require('express');
const fetch   = require('node-fetch');          
const { pool } = require('../config/db');
const router   = express.Router();

router.post('/metrics', async (req, res) => {
  try {
    const { domain, visitorId, url, metrics, userAgent } = req.body;
    const sessionId   = typeof visitorId === 'string' && visitorId.trim()
                      ? visitorId
                      : 'unknown-session';
    const pv          = 1;
    const loadTimeMs  = typeof metrics.loadTimeMs === 'number' ? metrics.loadTimeMs : 0;
    const lcpMs       = typeof metrics.lcpMs     === 'number' ? metrics.lcpMs      : 0;
    const bounce      = typeof metrics.bounce    === 'boolean'? metrics.bounce    : false;
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim()
             || req.connection.remoteAddress
             || null;

    const apiKey = process.env.IPGEO_API_KEY;
    let latitude = null,
        longitude = null,
        city      = null,
        region    = null,
        country   = null;

    if (ip && apiKey) {
      try {
        const geoRes = await fetch(
          `https://api.ipgeolocation.io/ipgeo?apiKey=${apiKey}&ip=${ip}`
        );
        const geoJson = await geoRes.json();
        latitude  = geoJson.latitude  ? parseFloat(geoJson.latitude)  : null;
        longitude = geoJson.longitude ? parseFloat(geoJson.longitude) : null;
        city      = geoJson.city       || null;
        region    = geoJson.state_prov || null;
        country   = geoJson.country_name || null;
      } catch (error) {}
    }

    const insertText = `
      INSERT INTO metrics_events
        (domain, session_id, url, pageviews,
         load_time_ms, lcp_ms, bounce,
         ip_address, user_agent,
         latitude, longitude, city, region, country)
      VALUES
        ($1,$2,$3,$4,
         $5,$6,$7,
         $8,$9,
         $10,$11,$12,$13,$14)
      RETURNING event_time
    `;
    const insertValues = [
      domain,
      sessionId,
      url,
      pv,
      loadTimeMs,
      lcpMs,
      bounce,
      ip,
      userAgent,
      latitude,
      longitude,
      city,
      region,
      country
    ];
    const { rows } = await pool.query(insertText, insertValues);
    const eventTime = rows[0].event_time;

    const day = eventTime.toISOString().split('T')[0];
    const aggText = `
      WITH agg AS (
        SELECT
          COUNT(*) AS pageviews,
          COUNT(DISTINCT session_id) AS unique_visitors,
          SUM((bounce::int))::float / COUNT(*) AS bounce_rate,
          AVG(load_time_ms) AS avg_load_time,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY lcp_ms) AS p75_lcp
        FROM metrics_events
        WHERE domain = $1
          AND event_time >= $2::date
          AND event_time <  ($2::date + INTERVAL '1 day')
      )
      INSERT INTO metrics_daily
        (domain, day, pageviews, unique_visitors, bounce_rate, avg_load_time, p75_lcp)
      SELECT
        $1,
        $2,
        agg.pageviews,
        agg.unique_visitors,
        agg.bounce_rate,
        agg.avg_load_time,
        agg.p75_lcp
      FROM agg
      ON CONFLICT (domain, day)
      DO UPDATE SET
        pageviews       = EXCLUDED.pageviews,
        unique_visitors = EXCLUDED.unique_visitors,
        bounce_rate     = EXCLUDED.bounce_rate,
        avg_load_time   = EXCLUDED.avg_load_time,
        p75_lcp         = EXCLUDED.p75_lcp;
    `;
    await pool.query(aggText, [domain, day]);

    res.sendStatus(204);
  } catch (error) {
    res.status(500).json({ error: 'Failed to record metrics.' });
  }
});

module.exports = router;
