const express = require("express");
const router = express.Router();
const dns = require("dns").promises;
const axios = require("axios");
const { authenticateToken } = require("../middleware/auth");
const { pool } = require("../config/db");
const { v4: uuidv4 } = require("uuid");

require('dotenv').config();
secretKey = process.env.JWT_SECRET_KEY;

router.post("/validate-domain", authenticateToken, async (req, res, next) => {
  const { userID, organizationID, projectID, domain } = req.body;

  if (!domain) {
    return res.status(400).json({ message: "Domain is required" });
  }

  const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  const fqdnRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  if (!(hostnameRegex.test(domain) || fqdnRegex.test(domain))) {
    return res.status(400).json({ message: "Invalid domain format" });
  }

  try {
    const result = {
      domain,
      isAccessible: false,
      statusCode: null,
      dnsRecords: [],
      checkedAt: new Date().toISOString()
    };

    try {
      const a = await dns.resolve4(domain);
      if (a.length) result.dnsRecords.push({ type: "A", values: a });

      const c = await dns.resolveCname(domain);
      if (c.length) result.dnsRecords.push({ type: "CNAME", values: c });

      const m = await dns.resolveMx(domain);
      if (m.length) {
        result.dnsRecords.push({
          type: "MX",
          values: m.map(r => `${r.priority} ${r.exchange}`)
        });
      }
    } catch (e) {}

    try {
      const r = await axios.head(`https://${domain}`, { timeout: 5000, validateStatus: null });
      result.isAccessible = true;
      result.statusCode = r.status;
    } catch {
      try {
        const r2 = await axios.head(`http://${domain}`, { timeout: 5000, validateStatus: null });
        result.isAccessible = true;
        result.statusCode = r2.status;
      } catch (e2) {}
    }

    const domainID = uuidv4();

    await pool.query(
        `DELETE FROM domains
            WHERE orgid = $1
            AND username = $2
            AND project_id = $3
            AND domain_name = $4`,
        [organizationID, userID, projectID, domain]
    );

    await pool.query(
    `INSERT INTO domains (
            orgid,
            username,
            domain_id,
            domain_name,
            project_id,
            created_by,
            created_at,
            updated_at,
            is_accessible,
            dns_records,
            checked_at,
            is_primary,
            redirect_target
    ) VALUES (
        $1, $2, $3, $4,
        $5, $6, NOW(), NOW(),
        $7, $8, $9,
        $10, $11
    )`,
    [
        organizationID,
        userID,
        domainID,
        domain,
        projectID,
        userID,
        result.isAccessible,
        result.statusCode,
        JSON.stringify(result.dnsRecords),
        result.checkedAt,
        false,
        null
    ]
    );

    res.status(200).json(result);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ message: `Failed to validate domain: ${err.message}` });
    }
    next(err);
  }
});

module.exports = router;
