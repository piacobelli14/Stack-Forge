const express = require('express');
const fetch   = require('node-fetch');  
const { v4: uuidv4 } = require('uuid');         
const { pool } = require('../config/db');
const router   = express.Router();
const { authenticateToken } = require('../middleware/auth');

router.post('/auth/check', async (req, res) => {
  try {
    const { domain } = req.body;
    const visitorId = req.cookies.sf_visitor_id || req.headers['x-visitor-id'];

    const domainResult = await pool.query(
      `
        SELECT
         deployment_protection,
         deployment_authentication,
         orgid
        FROM domains
        WHERE domain_name = $1
      `,
      [domain.split('.')[0]]
    );

    if (domainResult.rows.length === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    const {
      deployment_protection,
      deployment_authentication,
      orgid
    } = domainResult.rows[0];

    if (!deployment_protection && !deployment_authentication) {
      return res.json({
        protected: false,
        deployment_authentication: false,
        isAuthenticated: true,
        isProjectAuthenticated: true,
        projectUrl: domain
      });
    }

    let isAuthenticated = true;
    let isProjectAuthenticated = true;
    let authenticationRequired = false;

    if (deployment_protection) {
      const userResult = await pool.query(
        `
          SELECT orgid
          FROM users
          WHERE github_id = $1 OR github_username = $1
        `,
        [visitorId]
      );

      if (
        userResult.rows.length === 0 ||
        userResult.rows[0].orgid !== orgid
      ) {
        const signinResult = await pool.query(
          `SELECT orgid
           FROM signin_logs
           WHERE orgid = $1
             AND signin_timestamp > NOW() - INTERVAL '1 hour'
           LIMIT 1`,
          [orgid]
        );

        if (signinResult.rows.length === 0) {
          isAuthenticated = false;
          authenticationRequired = true;
        }
      }
    }

    if (deployment_authentication) {
      const projectSignin = await pool.query(
        `SELECT project_url
         FROM project_signin_logs
         WHERE orgid = $1
           AND username = $2
           AND project_url = $3
           AND signin_timestamp >= CURRENT_DATE - INTERVAL '1 day'
         LIMIT 1`,
        [orgid, visitorId, domain]
      );

      if (projectSignin.rows.length === 0) {
        isProjectAuthenticated = false;
        authenticationRequired = true;
      }
    }

    if (authenticationRequired) {
      return res.status(403).json({
        protected: deployment_protection,
        deployment_authentication,
        isAuthenticated,
        isProjectAuthenticated,
        projectUrl: domain
      });
    }

    return res.json({
      protected: deployment_protection,
      deployment_authentication,
      isAuthenticated: true,
      isProjectAuthenticated: true,
      projectUrl: domain
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/metrics', async (req, res) => {
  try {
    const { domain, visitorId, url, metrics, userAgent } = req.body;

    const sessionId = typeof visitorId === 'string' && visitorId.trim() ? visitorId : 'unknown-session';

    const pv = 1;
    const loadTimeMs = typeof metrics.loadTimeMs === 'number' ? metrics.loadTimeMs : 0;
    const lcpMs = typeof metrics.lcpMs === 'number' ? metrics.lcpMs : 0;
    const bounce = typeof metrics.bounce === 'boolean' ? metrics.bounce : false;
    const edgeRequests = Array.isArray(metrics.edgeRequests) ? metrics.edgeRequests : [];
    const suffix = '.stackforgeengine.com';
    const shortDomain = domain.endsWith(suffix) ? domain.slice(0, -suffix.length) : domain;
    const domainResult = await pool.query(
      `
        SELECT username, orgid
        FROM domains
        WHERE domain_name = $1
      `,
      [shortDomain]
    );
    const username = domainResult.rows[0]?.username || null;
    const orgid    = domainResult.rows[0]?.orgid    || null;

    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.connection.remoteAddress || null;

    const apiKey = process.env.IPGEO_API_KEY;
    let latitude = null, longitude = null, city = null, region = null, country = null;
    if (ip && apiKey) {
      try {
        const geoRes  = await fetch(`https://api.ipgeolocation.io/ipgeo?apiKey=${apiKey}&ip=${ip}`);
        const geoJson = await geoRes.json();
        latitude  = geoJson.latitude  ? parseFloat(geoJson.latitude)  : null;
        longitude = geoJson.longitude ? parseFloat(geoJson.longitude) : null;
        city      = geoJson.city      || null;
        region    = geoJson.state_prov|| null;
        country   = geoJson.country_name || null;
      } catch (error) {}
    }

    const insertText = `
      INSERT INTO metrics_events
        (domain, session_id, url, pageviews,
         load_time_ms, lcp_ms, bounce,
         ip_address, user_agent,
         latitude, longitude, city, region, country,
         username, orgid)
      VALUES
        ($1,$2,$3,$4,
         $5,$6,$7,
         $8,$9,
         $10,$11,$12,$13,$14,
         $15,$16)
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
      country,
      username,
      orgid
    ];
    const { rows } = await pool.query(insertText, insertValues);
    const eventTime = rows[0].event_time;

    if (edgeRequests.length > 0) {
      const edgeInsertText = `
        INSERT INTO metrics_edge_requests
          (domain, visitor_id, page_url, request_url, method,
           status, duration, type,
           timing_dns, timing_connect, timing_response,
           username, orgid, event_time)
        VALUES
          ($1,$2,$3,$4,$5,
           $6,$7,$8,
           $9,$10,$11,
           $12,$13,NOW())
      `;
      for (const er of edgeRequests) {
        await pool.query(edgeInsertText, [
          domain,
          sessionId,
          url,
          typeof er.url === 'string'   ? er.url   : '',
          typeof er.method === 'string'
            ? er.method.toUpperCase().slice(0, 10)
            : 'GET',
          typeof er.status === 'number' ? er.status : 0,
          typeof er.duration === 'number'
            ? Math.round(er.duration)
            : 0,
          typeof er.type === 'string'
            ? er.type.slice(0, 50)
            : 'unknown',
          er.timing?.dns ? Math.round(er.timing.dns) : 0,
          er.timing?.connect ? Math.round(er.timing.connect) : 0,
          er.timing?.response ? Math.round(er.timing.response) : 0,
          username,
          orgid
        ]);
      }
    }

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
        (domain, day, pageviews, unique_visitors,
         bounce_rate, avg_load_time, p75_lcp,
         username, orgid)
      SELECT
        $1, $2,
        agg.pageviews,
        agg.unique_visitors,
        agg.bounce_rate,
        agg.avg_load_time,
        agg.p75_lcp,
        $3, $4
      FROM agg
      ON CONFLICT (domain, day)
      DO UPDATE SET
        pageviews = EXCLUDED.pageviews,
        unique_visitors = EXCLUDED.unique_visitors,
        bounce_rate = EXCLUDED.bounce_rate,
        avg_load_time = EXCLUDED.avg_load_time,
        p75_lcp = EXCLUDED.p75_lcp,
        username = EXCLUDED.username,
        orgid = EXCLUDED.orgid;
    `;
    await pool.query(aggText, [domain, day, username, orgid]);

    res.sendStatus(204);
  } catch (error) {
    res.status(500).json({ error: 'Failed to record metrics.' });
  }
});

router.post('/get-activity-data', authenticateToken, async (req, res, next) => {
  const { userID, organizationID, search = '' } = req.body;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const useUserFilter = !organizationID || organizationID === userID;
  const orgFilterField = useUserFilter ? 'username' : 'orgid';
  const filterValue = useUserFilter ? userID : organizationID;

  req.on('close', () => {
    return;
  });

  try {
    const activityLogQuery = `
      SELECT activity_timestamp, activity_description, user_image
      FROM (
        -- Project creation
        SELECT 
          (p.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You created the project \"', p.name, '\".') AS activity_description,
          u.image AS user_image
        FROM projects p
        LEFT JOIN users u
          ON p.username = u.username
          AND p.orgid   = u.orgid
        WHERE p.created_at IS NOT NULL
          AND p.created_at >= $3
          AND p.${orgFilterField} = $1
          ${ userID ? 'AND p.username = $2' : '' }
          AND CONCAT('You created the project \"', p.name, '\".') ILIKE $4

        UNION ALL

        -- Domain/Subdomain creation
        SELECT 
          (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You added the domain \"', d.domain_name, '\".') AS activity_description,
          u.image AS user_image
        FROM domains d
        LEFT JOIN users u
          ON d.username = u.username
          AND d.orgid   = u.orgid
        WHERE d.created_at IS NOT NULL
          AND d.created_at >= $3
          AND d.${orgFilterField} = $1
          ${ userID ? 'AND d.username = $2' : '' }
          AND CONCAT('You added the domain \"', d.domain_name, '\".') ILIKE $4

        UNION ALL

        -- Domain updates
        SELECT 
          (d.updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You updated the domain \"', d.domain_name, '\".') AS activity_description,
          u.image AS user_image
        FROM domains d
        LEFT JOIN users u
          ON d.username = u.username
          AND d.orgid   = u.orgid
        WHERE d.updated_at IS NOT NULL
          AND d.updated_at != d.created_at
          AND d.updated_at >= $3
          AND d.${orgFilterField} = $1
          ${ userID ? 'AND d.username = $2' : '' }
          AND CONCAT('You updated the domain \"', d.domain_name, '\".') ILIKE $4

        UNION ALL

        -- Deployment creation
        SELECT 
          (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You created the deployment \"', d.deployment_id, '\" for the project \"', p.name, '\".') AS activity_description,
          u.image AS user_image
        FROM deployments d
        JOIN projects p
          ON d.project_id = p.project_id
        LEFT JOIN users u
          ON d.username = u.username
          AND d.orgid   = u.orgid
        WHERE d.created_at IS NOT NULL
          AND d.created_at >= $3
          AND d.${orgFilterField} = $1
          ${ userID ? 'AND d.username = $2' : '' }
          AND CONCAT('You created the deployment \"', d.deployment_id, '\" for the project \"', p.name, '\".') ILIKE $4

        UNION ALL

        -- Deployment updates
        SELECT 
          (d.updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You updated the deployment \"', d.deployment_id, '\" for the project \"', p.name, '\".') AS activity_description,
          u.image AS user_image
        FROM deployments d
        JOIN projects p
          ON d.project_id = p.project_id
        LEFT JOIN users u
          ON d.username = u.username
          AND d.orgid   = u.orgid
        WHERE d.updated_at IS NOT NULL
          AND d.updated_at != d.created_at
          AND d.updated_at >= $3
          AND d.${orgFilterField} = $1
          ${ userID ? 'AND d.username = $2' : '' }
          AND CONCAT('You updated the deployment \"', d.deployment_id, '\" for the project \"', p.name, '\".') ILIKE $4

        UNION ALL

        -- Deployment actions (from deployment_logs)
        SELECT 
          (dl.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You performed the action \"', dl.action, '\" on the project \"', dl.project_name, '\".') AS activity_description,
          u.image AS user_image
        FROM deployment_logs dl
        LEFT JOIN users u
          ON dl.username = u.username
          AND dl.orgid   = u.orgid
        WHERE dl.timestamp IS NOT NULL
          AND dl.timestamp >= $3
          AND dl.${orgFilterField} = $1
          ${ userID ? 'AND dl.username = $2' : '' }
          AND CONCAT('You performed the action \"', dl.action, '\" on the project \"', dl.project_name, '\".') ILIKE $4

        UNION ALL

        -- Permission changes
        SELECT 
          (pl.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT(
            'You changed the permission \"', pl.permission,
            '\" from \"', pl.old_value,
            '\" to \"', pl.new_value,
            '\" for the user \"', pl.username, '\".'
          ) AS activity_description,
          u.image AS user_image
        FROM permission_logs pl
        LEFT JOIN users u
          ON pl.changed_by = u.username
          AND pl.orgid     = u.orgid
        WHERE pl.timestamp IS NOT NULL
          AND pl.timestamp >= $3
          AND pl.${orgFilterField} = $1
          ${ userID ? 'AND pl.changed_by = $2' : '' }
          AND CONCAT(
            'You changed the permission \"', pl.permission,
            '\" from \"', pl.old_value,
            '\" to \"', pl.new_value,
            '\" for the user \"', pl.username, '\".'
          ) ILIKE $4

        UNION ALL

        -- User account creation
        SELECT 
          (u.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT('You created the user account \"', u.username, '\".') AS activity_description,
          u.image AS user_image
        FROM users u
        WHERE u.created_at IS NOT NULL
          AND u.created_at >= $3
          AND u.${orgFilterField} = $1
          ${ userID ? 'AND u.username = $2' : '' }
          AND CONCAT('You created the user account \"', u.username, '\".') ILIKE $4

        UNION ALL

        -- Access request submissions
        SELECT 
          (ar.request_timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT(
            'You submitted an access request with the status \"', ar.request_status,
            '\" for the organization \"', ar.request_orgid, '\".'
          ) AS activity_description,
          u.image AS user_image
        FROM access_requests ar
        LEFT JOIN users u
          ON ar.request_username = u.username
          AND ar.request_orgid   = u.orgid
        WHERE ar.request_timestamp IS NOT NULL
          AND ar.request_timestamp >= $3
          AND ar.request_${orgFilterField} = $1
          ${ userID ? 'AND ar.request_username = $2' : '' }
          AND CONCAT(
            'You submitted an access request with the status \"', ar.request_status,
            '\" for the organization \"', ar.request_orgid, '\".'
          ) ILIKE $4

        UNION ALL

        -- Data export actions
        SELECT 
          (el.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago' AS activity_timestamp,
          CONCAT(
            'You exported the dataset \"', el.dataset,
            '\" as the file type \"', el.file_type, '\".'
          ) AS activity_description,
          u.image AS user_image
        FROM export_logs el
        LEFT JOIN users u
          ON el.username = u.username
          AND el.orgid   = u.orgid
        WHERE el.timestamp IS NOT NULL
          AND el.timestamp >= $3
          AND el.${orgFilterField} = $1
          ${ userID ? 'AND el.username = $2' : '' }
          AND CONCAT(
            'You exported the dataset \"', el.dataset,
            '\" as the file type \"', el.file_type, '\".'
          ) ILIKE $4
      ) AS activity_log
      WHERE activity_description IS NOT NULL
      ORDER BY activity_timestamp DESC
    `;

    const queryParams = userID
      ? [filterValue, userID, thirtyDaysAgo, `%${search}%`]
      : [filterValue, thirtyDaysAgo, `%${search}%`];

    const activityLogInfo = await pool.query(activityLogQuery, queryParams);

    if (!activityLogInfo.rows || activityLogInfo.rows.length === 0) {
      return res.status(200).json({
        message: 'Activity data retrieved successfully.',
        data: [],
      });
    }

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
      return res.status(500).json({
        message: 'Error connecting to the database. Please try again later.'
      });
    }
    next(error);
  }
});
router.post('/get-aggregate-metrics', authenticateToken, async (req, res, next) => {
  const { userID, organizationID, domain, startDate, endDate, groupBy = 'day' } = req.body;
  const useUserFilter = !organizationID || organizationID === userID;
  const orgFilterField = useUserFilter ? 'username' : 'orgid';
  const filterValue = useUserFilter ? userID : organizationID;

  req.on('close', () => {
    return;
  });

  try {
    if (!domain) {
      return res.status(400).json({ message: 'Error: domain is required.' });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required.' });
    }

    if (!['day', 'week', 'month'].includes(groupBy)) {
      return res.status(400).json({ message: 'groupBy must be "day", "week", or "month".' });
    }

    const start = new Date(startDate);
    const end   = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid date format for startDate or endDate.' });
    }

    if (start > end) {
      return res.status(400).json({ message: 'startDate must be before endDate.' });
    }

    const sixDaysMs  = 6 * 24 * 60 * 60 * 1000;
    const dateDiffMs = end.getTime() - start.getTime();
    if (dateDiffMs !== sixDaysMs) {
      return res.status(400).json({
        message: 'The date range must be exactly 7 days (endDate - startDate = 6 days).'
      });
    }

    const dateRange = [];
    let cur = new Date(start);
    while (cur <= end) {
      dateRange.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }

    let dateTrunc = 'day';
    if (groupBy === 'week')  dateTrunc = 'week';
    if (groupBy === 'month') dateTrunc = 'month';

    const metricsQuery = `
      SELECT
        DATE_TRUNC($1, md.day) AS period,
        SUM(md.pageviews) AS total_pageviews,
        SUM(md.unique_visitors) AS total_unique_visitors,
        AVG(md.bounce_rate) AS avg_bounce_rate,
        AVG(md.avg_load_time) AS avg_load_time,
        AVG(md.p75_lcp) AS avg_p75_lcp,
        COALESCE(SUM(er.count), 0) AS total_edge_requests,
        COALESCE(AVG(er.avg_duration), 0) AS avg_edge_duration
      FROM metrics_daily md
      LEFT JOIN (
        SELECT
          DATE_TRUNC($1, event_time) AS period,
          domain,
          COUNT(*) AS count,
          AVG(duration) AS avg_duration
        FROM metrics_edge_requests mer
        WHERE mer.event_time >= $2
          AND mer.event_time <= $3
          AND mer.${orgFilterField} = $4
        GROUP BY DATE_TRUNC($1, event_time), mer.domain
      ) er
        ON DATE_TRUNC($1, md.day) = er.period
       AND (md.domain = er.domain OR er.domain IS NULL)
      WHERE md.day >= $2
        AND md.day <= $3
        AND md.${orgFilterField} = $4
      GROUP BY DATE_TRUNC($1, md.day)
      ORDER BY period ASC
    `;
    const aggregateParams = [dateTrunc, start, end, filterValue];
    const metricsResult = await pool.query(metricsQuery, aggregateParams);

    const metricsInfo = metricsResult.rows.map(r => ({
      period:          r.period.toISOString().split('T')[0],
      pageviews:       parseInt(r.total_pageviews || 0, 10),
      uniqueVisitors:  parseInt(r.total_unique_visitors || 0, 10),
      bounceRate:      parseFloat((Number(r.avg_bounce_rate) || 0).toFixed(2)),
      avgLoadTime:     parseFloat((Number(r.avg_load_time) || 0).toFixed(2)),
      p75Lcp:          parseFloat((Number(r.avg_p75_lcp) || 0).toFixed(2)),
      edgeRequests:    parseInt(r.total_edge_requests || 0, 10),
      avgEdgeDuration: parseFloat((Number(r.avg_edge_duration) || 0).toFixed(2))
    }));

    const individualQuery = `
      SELECT
        md.day AS period,
        md.pageviews,
        md.unique_visitors,
        md.bounce_rate
      FROM metrics_daily md
      WHERE md.day >= $1
        AND md.day <= $2
        AND md.${orgFilterField} = $3
      ORDER BY md.day ASC
    `;
    const individualParams = [start, end, filterValue];
    const individualResult = await pool.query(individualQuery, individualParams);
    const individualRows = individualResult.rows;

    const edgeQuery = `
      SELECT
        DATE_TRUNC('day', event_time) AS period,
        COUNT(*) AS edge_requests
      FROM metrics_edge_requests mer
      WHERE mer.event_time >= $1
        AND mer.event_time <= $2
        AND mer.${orgFilterField} = $3
      GROUP BY DATE_TRUNC('day', event_time)
      ORDER BY period ASC
    `;
    const edgeResult = await pool.query(edgeQuery, individualParams);
    const edgeRows = edgeResult.rows;

    const pageViewsData = dateRange.map(d => {
      const e = individualRows.find(r => r.period.toISOString().split('T')[0] === d);
      return { date: d, value: e ? parseInt(e.pageviews || 0, 10) : 0 };
    });

    const uniqueVisitorsData = dateRange.map(d => {
      const e = individualRows.find(r => r.period.toISOString().split('T')[0] === d);
      return { date: d, value: e ? parseInt(e.unique_visitors || 0, 10) : 0 };
    });

    const bounceRateData = dateRange.map(d => {
      const e = individualRows.find(r => r.period.toISOString().split('T')[0] === d);
      return { date: d, value: e ? parseFloat((e.bounce_rate || 0).toFixed(2)) : 0 };
    });

    const edgeRequestsData = dateRange.map(d => {
      const e = edgeRows.find(r => r.period.toISOString().split('T')[0] === d);
      return { date: d, value: e ? parseInt(e.edge_requests || 0, 10) : 0 };
    });

    const individualMetrics = {
      pageViews: pageViewsData,
      uniqueVisitors: uniqueVisitorsData,
      bounceRate: bounceRateData,
      edgeRequests: edgeRequestsData
    };

    const hasData = metricsInfo.length > 0 ||
      pageViewsData.some(e => e.value > 0) ||
      uniqueVisitorsData.some(e => e.value > 0) ||
      bounceRateData.some(e => e.value > 0) ||
      edgeRequestsData.some(e => e.value > 0);

    if (!hasData && domain !== 'all_domains') {
      return res.status(404).json({
        message: `No metrics found for the domain ${domain} in the specified date range.`,
        data: [],
        individualMetrics: {
          pageViews: [], uniqueVisitors: [], bounceRate: [], edgeRequests: []
        }
      });
    }

    return res.status(200).json({
      message: hasData ? 'Aggregate and individual metrics retrieved successfully.'  : 'No metrics found for the specified criteria.',
      data: metricsInfo,
      individualMetrics
    });

  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Error retrieving aggregate metrics.',
        error: error.message
      });
    }
    next(error);
  }
});

module.exports = router;







