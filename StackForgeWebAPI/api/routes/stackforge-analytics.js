const express = require('express');
const fetch   = require('node-fetch');          
const { pool } = require('../config/db');
const router   = express.Router();
const { authenticateToken } = require('../middleware/auth');

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

router.post('/get-activity-data', authenticateToken, async (req, res, next) => {
  const { userID, organizationID, limit = 50, offset = 0 } = req.body;

  req.on('close', () => {
      return;
  });

  try {
    if (!organizationID) {
      return res.status(400).json({ message: 'organizationID is required' });
    }
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'limit must be between 1 and 100' });
    }
    if (isNaN(offset) || offset < 0) {
      return res.status(400).json({ message: 'offset must be a non-negative number' });
    }

    const activityLogQuery = `
      SELECT activity_timestamp, activity_description, user_image
      FROM (
        -- Project creation
        SELECT 
          (p.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You created the project \"', p.name, '\".') AS activity_description,
          u.image AS user_image
        FROM projects p
        LEFT JOIN users u ON p.username = u.username AND p.orgid = u.orgid
        WHERE p.created_at IS NOT NULL
          AND p.orgid = $1
          ${userID ? 'AND p.username = $2' : ''}

        UNION ALL

        -- Domain/Subdomain creation
        SELECT 
          (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You added the domain \"', d.domain_name, '\".') AS activity_description,
          u.image AS user_image
        FROM domains d
        LEFT JOIN users u ON d.username = u.username AND d.orgid = u.orgid
        WHERE d.created_at IS NOT NULL
          AND d.orgid = $1
          ${userID ? 'AND d.username = $2' : ''}

        UNION ALL

        -- Domain updates
        SELECT 
          (d.updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You updated the domain \"', d.domain_name, '\".') AS activity_description,
          u.image AS user_image
        FROM domains d
        LEFT JOIN users u ON d.username = u.username AND d.orgid = u.orgid
        WHERE d.updated_at IS NOT NULL
          AND d.updated_at != d.created_at
          AND d.orgid = $1
          ${userID ? 'AND d.username = $2' : ''}

        UNION ALL

        -- Deployment creation
        SELECT 
          (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You created the deployment \"', d.deployment_id, '\" for the project \"', p.name, '\".') AS activity_description,
          u.image AS user_image
        FROM deployments d
        JOIN projects p ON d.project_id = p.project_id
        LEFT JOIN users u ON d.username = u.username AND d.orgid = u.orgid
        WHERE d.created_at IS NOT NULL
          AND d.orgid = $1
          ${userID ? 'AND d.username = $2' : ''}

        UNION ALL

        -- Deployment updates
        SELECT 
          (d.updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You updated the deployment \"', d.deployment_id, '\" for the project \"', p.name, '\".') AS activity_description,
          u.image AS user_image
        FROM deployments d
        JOIN projects p ON d.project_id = p.project_id
        LEFT JOIN users u ON d.username = u.username AND d.orgid = u.orgid
        WHERE d.updated_at IS NOT NULL
          AND d.updated_at != d.created_at
          AND d.orgid = $1
          ${userID ? 'AND d.username = $2' : ''}

        UNION ALL

        -- Deployment actions (from deployment_logs)
        SELECT 
          (dl.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You performed the action \"', dl.action, '\" on the project \"', dl.project_name, '\".') AS activity_description,
          u.image AS user_image
        FROM deployment_logs dl
        LEFT JOIN users u ON dl.username = u.username AND dl.orgid = u.orgid
        WHERE dl.timestamp IS NOT NULL
          AND dl.orgid = $1
          ${userID ? 'AND dl.username = $2' : ''}

        UNION ALL

        -- Permission changes
        SELECT 
          (pl.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You changed the permission \"', pl.permission, '\" from \"', pl.old_value, '\" to \"', pl.new_value, '\" for the user \"', pl.username, '\".') AS activity_description,
          u.image AS user_image
        FROM permission_logs pl
        LEFT JOIN users u ON pl.changed_by = u.username AND pl.orgid = u.orgid
        WHERE pl.timestamp IS NOT NULL
          AND pl.orgid = $1
          ${userID ? 'AND pl.changed_by = $2' : ''}

        UNION ALL

        -- User account creation
        SELECT 
          (u.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You created the user account \"', u.username, '\".') AS activity_description,
          u.image AS user_image
        FROM users u
        WHERE u.created_at IS NOT NULL
          AND u.orgid = $1
          ${userID ? 'AND u.username = $2' : ''}

        UNION ALL

        -- Access request submissions
        SELECT 
          (ar.request_timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You submitted an access request with the status \"', ar.request_status, '\" for the organization \"', ar.request_orgid, '\".') AS activity_description,
          u.image AS user_image
        FROM access_requests ar
        LEFT JOIN users u ON ar.request_username = u.username AND ar.request_orgid = u.orgid
        WHERE ar.request_timestamp IS NOT NULL
          AND ar.request_orgid = $1
          ${userID ? 'AND ar.request_username = $2' : ''}

        UNION ALL

        -- Data export actions
        SELECT 
          (el.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You exported the dataset \"', el.dataset, '\" as the file type \"', el.file_type, '\".') AS activity_description,
          u.image AS user_image
        FROM export_logs el
        LEFT JOIN users u ON el.username = u.username AND el.orgid = u.orgid
        WHERE el.timestamp IS NOT NULL
          AND el.orgid = $1
          ${userID ? 'AND el.username = $2' : ''}
      ) AS activity_log
      WHERE activity_description IS NOT NULL
      ORDER BY activity_timestamp DESC
      LIMIT $3 OFFSET $4
    `;

    const queryParams = userID
      ? [organizationID, userID, limit, offset]
      : [organizationID, limit, offset];
    const activityLogInfo = await pool.query(activityLogQuery, queryParams);
    const activities = activityLogInfo.rows.map(row => ({
      timestamp: row.activity_timestamp.toISOString(), 
      description: row.activity_description,
      userImage: row.user_image || null,
    }));

    return res.status(200).json({
      message: 'Activity data retrieved successfully.',
      data: activities,
    });

  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
    }
    next(error);
  }
});


module.exports = router;
