const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");   
const path = require("path");
const { pool } = require("../config/db");
const { smtpHost, smtpPort, smtpUser, smtpPassword, emailTransporter, fromEmail } = require("../config/smtp");
const { s3Client, storage, upload, PutObjectCommand } = require("../config/s3");
const { authenticateToken } = require("../middleware/auth");
const { rateLimiter, authRateLimitExceededHandler } = require("../middleware/rateLimiter");

require("dotenv").config();
secretKey = process.env.JWT_SECRET_KEY;

const router = express.Router();

router.post("/user-authentication", rateLimiter(10, 20, authRateLimitExceededHandler), async (req, res, next) => {
    const { username, password } = req.body;
    
    req.on("close", () => {
        return;
    });

    try {
        const loginQuery = `
            SELECT u.username, u.salt, u.hashed_password, u.orgid, u.verified, u.twofaenabled, u.multifaenabled,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM admins a WHERE a.username = u.username
                   ) THEN true ELSE false END AS isadmin
            FROM users u
            WHERE u.username = $1 OR u.email = $1
            ;
        `;
        const info = await pool.query(loginQuery, [username]);

        if (info.rows.length === 0) {
            return res.status(401).json({ message: "Invalid login credentials." });
        }

        const userData = info.rows[0];
        const { verified } = userData;
        if (!verified) {
            return res.status(401).json({ message: "Email not verified. Please verify your account." });
        }

        const { salt, hashed_password, username: userID, orgid: orgID, twofaenabled, multifaenabled, isadmin } = userData;
        const hashedPasswordToCheck = hashPassword(password, salt);
        if (hashedPasswordToCheck !== hashed_password) {
            const error = new Error("Invalid login credentials.");
            error.status = 401;
            return next(error);
        }

        const token = jwt.sign(
            {
                userid: userID,
                orgid: orgID,
                isadmin: isadmin,
                permissions: { twofaenabled, multifaenabled },
                exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
            },
            secretKey,
            { algorithm: "HS256" }
        );

        const visitorId = uuidv4();
        res.cookie("sf_visitor_id", visitorId, {
            domain: ".stackforgeengine.com",
            path: "/",
            httpOnly: false,
            secure: true,
            sameSite: "None",
            maxAge: 365 * 24 * 60 * 60 * 1000
        });

        const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        const locationResponse = await axios.get(`http://ip-api.com/json/${ip}`);
        const locationData = locationResponse.data;

        const signinTimestamp = new Date().toISOString();
        const insertLoginTimestampQuery = `
            INSERT INTO signin_logs (orgid, username, signin_timestamp, ip_address, city, region, country, zip, lat, lon, timezone) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ;
        `;
        await pool.query(insertLoginTimestampQuery, [
            orgID, userID, signinTimestamp, ip, locationData.city, locationData.region,
            locationData.country, locationData.zip, locationData.lat, locationData.lon, locationData.timezone
        ]);

        return res.status(200).json({
            token, userid: userID, orgid: orgID, isadmin,
            twofaenabled, multifaenabled
        });
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        }
        next(error);
    }
});

router.post("/projects-user-authentication", rateLimiter(10, 20, authRateLimitExceededHandler), async (req, res, next) => {
    const { username, password, returnUrl, projectUrl } = req.body;

    req.on("close", () => {
    return;
    });

    try {
    const loginQuery = `
        SELECT u.username, u.salt, u.hashed_password, u.orgid, u.verified,
                u.twofaenabled, u.multifaenabled,
                CASE WHEN EXISTS (
                SELECT 1 FROM admins a WHERE a.username = u.username
                ) THEN true ELSE false END AS isadmin
        FROM users u
        WHERE u.username = $1 OR u.email = $1
    `;
    const info = await pool.query(loginQuery, [username]);

    if (info.rows.length === 0) {
        return res.status(401).json({ message: "Invalid login credentials." });
    }

    const userData = info.rows[0];
    if (!userData.verified) {
        return res.status(401).json({ message: "Email not verified. Please verify your account." });
    }

    const { salt, hashed_password, username: userID, orgid: orgID, twofaenabled, multifaenabled, isadmin } = userData;
    if (hashPassword(password, salt) !== hashed_password) {
        return res.status(401).json({ message: "Invalid login credentials." });
    }

    const token = jwt.sign(
        {
        userid: userID,
        orgid: orgID,
        isadmin,
        permissions: { twofaenabled, multifaenabled },
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
        },
        secretKey,
        { algorithm: "HS256" }
    );

    const visitorId = uuidv4();
    res.cookie("sf_visitor_id", visitorId, {
        domain: ".stackforgeengine.com",
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "None",
        maxAge: 365 * 24 * 60 * 60 * 1000
    });

    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const locationResponse = await axios.get(`http://ip-api.com/json/${ip}`);
    const loc = locationResponse.data;
    const signinTimestamp = new Date().toISOString();

    if (projectUrl) {
        await pool.query(
        `INSERT INTO project_signin_logs
            (orgid, username, project_url, signin_timestamp, ip_address,
            city, region, country, zip, lat, lon, timezone)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [orgID, userID, projectUrl, signinTimestamp, ip, loc.city, loc.region,
            loc.country, loc.zip, loc.lat, loc.lon, loc.timezone]
        );

        res.cookie("sf_signed_into_project", projectUrl, {
            domain: ".stackforgeengine.com",
            path: "/",
            httpOnly: false,
            secure: true,
            sameSite: "None",
            maxAge: 60 * 60 * 1000  
        });
    }

    return res.status(200).json({
        token,
        userid: userID,
        orgid: orgID,
        isadmin,
        twofaenabled,
        multifaenabled,
        returnUrl
    });
    } catch (error) {
    if (!res.headersSent) {
        res.status(500).json({ message: "Error connecting to the database. Please try again later." });
    }
    next(error);
    }
});
  
router.post("/send-admin-auth-code", rateLimiter(10, 15, authRateLimitExceededHandler), async (req, res, next) => {
    const { email } = req.body;

    req.on("close", () => {
        return;
    });

    try {
        const authenticationCodeQuery = "SELECT email, username FROM admins WHERE email = $1";
        const authenticationCodeInfo = await pool.query(authenticationCodeQuery, [email]);

        if (authenticationCodeInfo.rows.length === 0) {
            return res.status(401).json({ message: "Email not found." });
        }

        const { username } = authenticationCodeInfo.rows[0];
        const loginCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expirationTimestamp = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        const insertAuthenticationCodeQuery = `
            INSERT INTO admin_tokens (username, email, token, expiration) 
            VALUES ($1, $2, $3, $4)
            ;
        `;
        await pool.query(insertAuthenticationCodeQuery, [username, email, loginCode, new Date(expirationTimestamp)]);

        const mailOptions = {
            from: smtpUser,
            to: email,
            subject: "Login Code",
            text: `Your login code is: ${loginCode}. \n\nPlease enter this code to log in.\n\n -The Stack Forge Team`
        };

        await emailTransporter.sendMail(mailOptions);

        return res.status(200).json({ message: "Login code sent." });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        }
    }
});

router.post("/verify-admin-auth-code", rateLimiter(10, 15, authRateLimitExceededHandler), async (req, res, next) => {
    const { email, code } = req.body;

    req.on("close", () => {
        return;
    });

    try {
        const verifyAuthenticationCodeQuery =  `
            SELECT email, username 
            FROM admin_tokens WHERE email = $1 AND token = $2 AND expiration > NOW()
            ;
        `;
        const verifyAuthenticationCodeInfo = await pool.query(verifyAuthenticationCodeQuery, [email, code]);

        if (verifyAuthenticationCodeInfo.rows.length === 0) {
            return res.status(400).json({ message: "Invalid or expired login code." });
        }

        const { username: userID } = verifyAuthenticationCodeInfo.rows[0];
        const jwtToken = jwt.sign({ userID }, secretKey, { expiresIn: "24h" });

        const deleteCodeQuery = `
            DELETE FROM admin_tokens 
            WHERE email = $1 AND token = $2
            ;
        `;
        await pool.query(deleteCodeQuery, [email, code]);

        return res.status(200).json({ token: jwtToken, userid: userID });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        }
    }
});

router.post("/reset-password", rateLimiter(10, 3, authRateLimitExceededHandler), async (req, res, next) => {
    const { email } = req.body;

    req.on("close", () => {
        return;
    });
    try {
        const resetVerificationQuery = `
            SELECT email, username 
            FROM users 
            WHERE email = $1
            ;
        `;
        const resetVerificationInfo = await pool.query(resetVerificationQuery, [email]);

        if (resetVerificationInfo.rows.length === 0) {
            return res.status(401).json({ message: "Email not found." });
        }
        const { username } = resetVerificationInfo.rows[0];
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expirationTimestamp = new Date(Date.now() + 3 * 60 * 1000).toISOString();

        const mailOptions = {
            from: fromEmail,
            to: email,
            subject: "Password Reset Code",
            text: `Your password reset code is: ${resetCode}. \n\nPlease enter this code when prompted so that you can reset your password.\n\n -The Stack Forge Team`
        };

        await emailTransporter.sendMail(mailOptions);
        return res.status(200).json({
            message: "Password reset code sent.",
            data: {
                resetCode,
                resetExpiration: expirationTimestamp
            }
        });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        }
        next(error);
    }
});

router.post("/change-password", rateLimiter(10, 3, authRateLimitExceededHandler), async (req, res, next) => {
    const { newPassword, email } = req.body;

    req.on("close", () => {
        return;
    });

    try {
        const { salt, hashedPassword } = generateSaltedPassword(newPassword);
        const updatePasswordQuery = `
            UPDATE users 
            SET hashed_password = $1, salt = $2 
            WHERE email = $3
            ;
        `;
        await pool.query(updatePasswordQuery, [hashedPassword, salt, email]);

        return res.status(200).json({});
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        }
        next(error);
    }
});

router.post("/validate-new-user-info", rateLimiter(10, 15, authRateLimitExceededHandler), async (req, res, next) => {
    const { email, username } = req.body;

    req.on("close", () => {
        return;
    });

    try {
        const infoVerificationQuery = `
            SELECT username, email 
            FROM users
            ;
        `;
        const infoVerificationInfo = await pool.query(infoVerificationQuery);

        if (infoVerificationInfo.error) {
            return res.status(500).json({ message: "Unable to validate user info. Please try again." });
        }

        const rows = infoVerificationInfo.rows;
        if (!rows || !Array.isArray(rows)) {
            return res.status(200).json({ message: "No user info found." });
        }

        let emailInUse = false;
        let usernameInUse = false;

        for (const row of rows) {
            if (row.email === email) {
                emailInUse = true;
            }
            if (row.username === username) {
                usernameInUse = true;
            }
        }
        if (emailInUse) {
            return res.status(401).json({ message: "That email is already in use. Please select another." });
        } else if (usernameInUse) {
            return res.status(401).json({ message: "That username is taken. Please select another." });
        }
        return res.status(200).json({ message: "User info validated successfully." });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        }
        next(error);
    }
});

router.post("/create-user", rateLimiter(10, 15, authRateLimitExceededHandler), async (req, res, next) => {
    const { firstName, lastName, username, email, password, phone, image } = req.body;

    if (!firstName || !lastName || !username || !email || !password || !phone || !image) {
        return res.status(401).json({ message: "Unable to verify registration info. Please try again later." });
    }

    req.on("close", () => {
        return;
    });

    try {
        const capitalizedFirstName = capitalizeFirstLetter(firstName);
        const capitalizedLastName = capitalizeFirstLetter(lastName);
        const { salt, hashedPassword } = generateSaltedPassword(password);

        const verificationToken = crypto.randomBytes(32).toString("hex");

        const matches = image.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ message: "Invalid image format. Please upload a valid image." });
        }

        const mimeType = matches[1];
        const imageBuffer = Buffer.from(matches[2], "base64");
        const extension = mimeType.split("/")[1];
        const imageName = `${crypto.randomBytes(16).toString("hex")}.${extension}`;

        const uploadParams = {
            Bucket: process.env.S3_IMAGE_BUCKET_NAME,
            Key: `uploads/${imageName}`,
            Body: imageBuffer,
            ContentType: mimeType
        };
        const data = await s3Client.send(new PutObjectCommand(uploadParams));
        const imageUrl = `https://${uploadParams.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${uploadParams.Key}`;

        const userCreationQuery = `
            INSERT INTO users (
                first_name, last_name, username, email, phone, hashed_password, salt, image, verification_token, verified, created_at,
                twofaenabled, multifaenabled, loginnotisenabled, exportnotisenabled, datashareenabled,
                showpersonalemail, showpersonalphone, showteamid, showteamemail, showteamphone, showteamadminstatus, showteamrole
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(),
                FALSE, FALSE, FALSE, FALSE, FALSE,
                TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
            );
        `;
        const userCreationValues = [
            capitalizedFirstName,
            capitalizedLastName,
            username.toString(),
            email.toString(),
            phone.toString(),
            hashedPassword.toString(),
            salt.toString(),
            imageUrl,
            verificationToken,
            false
        ];
        const userCreationInfo = await pool.query(userCreationQuery, userCreationValues);

        if (userCreationInfo.error) {
            return res.status(500).json({ message: "Unable to create new user. Please try again later." });
        }

        const verificationLink = `${process.env.VERIFICATION_URL}/verify-email?token=${verificationToken}`;
        const mailOptions = {
            from:    fromEmail,
            to:      email,
            subject: "Please verify your email",
            text:    `Hi ${capitalizedFirstName},\n\nThank you for registering. Please verify your email by clicking the link below:\n\n${verificationLink}\n\nIf you did not request this, you can ignore this email.\n\n– The Stack Forge Team`
        };
        await emailTransporter.sendMail(mailOptions);

        return res.status(200).json({ message: "User created successfully. Verification email sent." });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        }
        next(error);
    }
});

router.get("/verify-email", async (req, res, next) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).json({ message: "Verification token missing." });
    }

    try {
        const findQuery = `
            SELECT username
              FROM users
             WHERE verification_token = $1
        `;
        const findResult = await pool.query(findQuery, [token]);

        if (findResult.rows.length === 0) {
            return res.status(400).json({ message: "Invalid or expired verification token." });
        }

        const { username } = findResult.rows[0];
        const updateQuery = `
            UPDATE users
            SET verified = TRUE, verification_token = NULL
            WHERE username = $1
        `;
        await pool.query(updateQuery, [username]);

        return res.status(200).json({ message: "Email verified successfully." });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error." });
    }
});

router.get("/connect-github", async (req, res, next) => {
    const { token, userID } = req.query;
    if (!token || !userID) {
        return res.status(400).send("Missing token or userID.");
    }
    try {
        const payload = jwt.verify(token, secretKey);
        if (payload.userid !== userID) {
            return res.status(401).send("Invalid token for this user.");
        }
    } catch (error) {
        return res.status(401).send("Invalid token.");
    }
    const clientID = process.env.GITHUB_CLIENT_ID;
    const redirectUri = process.env.GITHUB_REDIRECT_URI;
    const state = Buffer.from(JSON.stringify({ token, userID })).toString("base64");
    const scope = "repo,user";
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scope)}`;
    res.redirect(githubAuthUrl);
});

router.get("/github-success", async (req, res, next) => {
    const { code, state } = req.query;
    if (!code || !state) {
        return res.status(400).send("Missing code or state.");
    }

    let decoded;
    try {
        decoded = JSON.parse(Buffer.from(state, "base64").toString("ascii"));
    } catch (error) {
        return res.status(400).send("Invalid state parameter");
    }
    const { token, userID } = decoded;

    try {
        const payload = jwt.verify(token, secretKey);
        if (payload.userid !== userID) {
            return res.status(401).send("Invalid token.");
        }
    } catch (error) {
        return res.status(401).send("Invalid token.");
    }

    const clientID = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const redirectUri = process.env.GITHUB_REDIRECT_URI;

    try {
        const params = new URLSearchParams();
        params.append("client_id", clientID);
        params.append("client_secret", clientSecret);
        params.append("code", code);
        params.append("redirect_uri", redirectUri);
        params.append("state", state);

        const tokenResponse = await axios.post(
            "https://github.com/login/oauth/access_token",
            params.toString(),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Accept: "application/json",
                },
            }
        );

        if (tokenResponse.data.error) {
            return res.status(400).send(`GitHub OAuth error: ${tokenResponse.data.error_description || tokenResponse.data.error}`);
        }

        const githubAccessToken = tokenResponse.data.access_token;
        if (!githubAccessToken) {
            return res.status(400).send("GitHub access token not received.");
        }

        const githubUserResponse = await axios.get("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${githubAccessToken}`,
                Accept: "application/json",
            },
        });
        const { id: github_id, login: github_username, avatar_url: github_avatar_url } = githubUserResponse.data;

        const updateQuery = `
            UPDATE users
            SET github_id = $1,
                github_username = $2,
                github_access_token = $3,
                github_avatar_url = $4
            WHERE username = $5;
        `;
        const result = await pool.query(updateQuery, [
            github_id,
            github_username,
            githubAccessToken,
            github_avatar_url,
            userID,
        ]);

        if (result.rowCount === 0) {
            return res.status(400).send("Failed to update user information in the database.");
        }

        return res.sendFile(path.resolve(__dirname, "../public", "github.html"));
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: "Error connecting to GitHub or database. Please try again later." });
        }
        next(error);
    }
});

function capitalizeFirstLetter(word) {
    if (!word) return word;
    return word[0].toUpperCase() + word.slice(1);
}

function hashPassword(enteredPassword, storedSalt) {
    if (!enteredPassword || !storedSalt) {
        return null;
    }
    const saltedPasswordToCheck = storedSalt + enteredPassword;
    const hash = crypto.createHash("sha256");
    const hashedPassword = hash.update(saltedPasswordToCheck).digest("hex");
    return hashedPassword;
}

function generateSaltedPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const saltedPassword = salt + password;
    const hash = crypto.createHash("sha256");
    const hashedPassword = hash.update(saltedPassword).digest("hex");
    return { salt, hashedPassword };
}

module.exports = router;
