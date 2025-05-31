const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const twilio = require("twilio");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { smtpHost, smtpPort, smtpUser, smtpPassword, emailTransporter, fromEmail } = require("../config/smtp");
const { s3Client, storage, upload, PutObjectCommand } = require("../config/s3");
const { authenticateToken } = require("../middleware/auth");
const { rateLimiter, authRateLimitExceededHandler } = require("../middleware/rateLimiter");

require("dotenv").config();
secretKey = process.env.JWT_SECRET_KEY;
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;


const router = express.Router();

router.post("/user-authentication", rateLimiter(10, 20, authRateLimitExceededHandler), async (req, res, next) => {
    const { username, password } = req.body;

    req.on("close", () => {
        return;
    });

    try {
        const loginQuery = `
            SELECT 
                u.username, 
                u.salt, 
                u.hashed_password, 
                u.orgid, 
                u.verified, 
                u.twofaenabled, 
                u.phone,
                u.email,
                u.loginnotisenabled,
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
        const { verified, twofaenabled, phone, email, loginnotisenabled, username: userID, orgid: orgID, isadmin } = userData;
        if (!verified) {
            return res.status(401).json({ message: "Email not verified. Please verify your account." });
        }

        const { salt, hashed_password } = userData;
        const hashedPasswordToCheck = hashPassword(password, salt);
        if (hashedPasswordToCheck !== hashed_password) {
            const error = new Error("Invalid login credentials.");
            error.status = 401;
            return next(error);
        }

        if (twofaenabled) {
            const loginCode = Math.floor(100000 + Math.random() * 900000).toString();
            const expirationTimestamp = new Date(Date.now() + 5 * 60 * 1000).toISOString();
            const insertUserCodeQuery = `
                INSERT INTO users_tokens (username, token, expiration) 
                VALUES ($1, $2, $3)
                ON CONFLICT (username) DO UPDATE 
                  SET token = EXCLUDED.token, expiration = EXCLUDED.expiration
                ;
            `;
            await pool.query(insertUserCodeQuery, [userID, loginCode, new Date(expirationTimestamp)]);

            // const rawDigits = phone.replace(/\D/g, "");
            // const e164Phone = rawDigits.startsWith("1") ? `+${rawDigits}` : `+1${rawDigits}`;
            // await twilioClient.messages.create({
            //     body: `Your login verification code is: ${loginCode}`,
            //     from: twilioPhoneNumber,
            //     to: e164Phone
            // });

            return res.status(200).json({ requires2fa: true });
        }

        let ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        let locationData = { status: "fail" };
        if (ip !== "::1" && !ip.startsWith("127.")) {
            try {
                const locationResponse = await axios.get(`http://ip-api.com/json/${ip}`);
                locationData = locationResponse.data;
            } catch {
                locationData = { status: "fail" };
            }
        }

        if (loginnotisenabled && locationData.status === "success") {
            const previousLoginQuery = `
                SELECT city, region, country
                FROM signin_logs
                WHERE username = $1
                ORDER BY signin_timestamp DESC
                LIMIT 1
                ;
            `;
            const previousResult = await pool.query(previousLoginQuery, [userID]);
            if (previousResult.rows.length > 0) {
                const { city: prevCity, region: prevRegion, country: prevCountry } = previousResult.rows[0];
                if (prevCountry && locationData.country && prevCountry !== locationData.country) {
                    const mailOptions = {
                        from: fromEmail,
                        to: email,
                        subject: "Unusual Login Detected",
                        text: `We noticed a login to your account from a new location:\n\n` +
                              `Current location: ${locationData.city}, ${locationData.region}, ${locationData.country}\n` +
                              `Previous location: ${prevCity}, ${prevRegion}, ${prevCountry}\n\n` +
                              `If this was not you, please secure your account immediately.\n\n– The Stack Forge Team`
                    };
                    await emailTransporter.sendMail(mailOptions);
                }
            }
        }

        const token = jwt.sign(
            {
                userid: userID,
                orgid: orgID,
                isadmin: isadmin,
                permissions: { twofaenabled },
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

        const signinTimestamp = new Date().toISOString();
        const insertLoginTimestampQuery = `
            INSERT INTO signin_logs (orgid, username, signin_timestamp, ip_address, city, region, country, zip, lat, lon, timezone) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ;
        `;
        await pool.query(insertLoginTimestampQuery, [
            orgID,
            userID,
            signinTimestamp,
            ip,
            locationData.city || null,
            locationData.region || null,
            locationData.country || null,
            locationData.zip || null,
            locationData.lat || null,
            locationData.lon || null,
            locationData.timezone || null
        ]);

        return res.status(200).json({
            token,
            userid: userID,
            orgid: orgID,
            isadmin,
            twofaenabled: false
        });
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        }
        next(error);
    }
});

router.post("/user-authentication-verify", rateLimiter(10, 20, authRateLimitExceededHandler), async (req, res, next) => {
    const { username, code } = req.body;

    req.on("close", () => {
        return;
    });

    try {
        const verifyTokenQuery = `
            SELECT token, expiration 
            FROM users_tokens 
            WHERE username = $1
            ;
        `;
        const tokenInfo = await pool.query(verifyTokenQuery, [username]);

        if (tokenInfo.rows.length === 0) {
            return res.status(400).json({ message: "No verification code found. Please login again." });
        }

        const { token: savedToken, expiration } = tokenInfo.rows[0];
        const now = new Date();
        if (savedToken !== code || now > new Date(expiration)) {
            return res.status(400).json({ message: "Invalid or expired verification code." });
        }

        const userQuery = `
            SELECT u.username, u.orgid,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM admins a WHERE a.username = u.username
                   ) THEN true ELSE false END AS isadmin,
                   u.twofaenabled
            FROM users u
            WHERE u.username = $1
            ;
        `;
        const userResult = await pool.query(userQuery, [username]);
        if (userResult.rows.length === 0) {
            return res.status(400).json({ message: "User not found." });
        }

        const { orgid: orgID, isadmin, twofaenabled } = userResult.rows[0];

        const jwtToken = jwt.sign(
            {
                userid: username,
                orgid: orgID,
                isadmin: isadmin,
                permissions: { twofaenabled },
                exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
            },
            secretKey,
            { algorithm: "HS256" }
        );

        const deleteTokenQuery = `
            DELETE FROM users_tokens 
            WHERE username = $1
            ;
        `;
        await pool.query(deleteTokenQuery, [username]);

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
            orgID, username, signinTimestamp, ip, locationData.city, locationData.region,
            locationData.country, locationData.zip, locationData.lat, locationData.lon, locationData.timezone
        ]);

        return res.status(200).json({
            token: jwtToken,
            userid: username,
            orgid: orgID,
            isadmin,
            twofaenabled
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
                u.twofaenabled,
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

        const { salt, hashed_password, username: userID, orgid: orgID, twofaenabled, isadmin } = userData;
        if (hashPassword(password, salt) !== hashed_password) {
            return res.status(401).json({ message: "Invalid login credentials." });
        }

        const token = jwt.sign(
            {
                userid: userID,
                orgid: orgID,
                isadmin,
                permissions: { twofaenabled },
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
        const verifyAuthenticationCodeQuery = `
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

        const verificationToken = crypto.randomBytes(16).toString("hex");

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
        await s3Client.send(new PutObjectCommand(uploadParams));
        const imageUrl = `https://${uploadParams.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${uploadParams.Key}`;

        const userCreationQuery = `
            INSERT INTO users (
                first_name, last_name, username, email, phone, hashed_password, salt, image, verification_token, verified, created_at,
                twofaenabled, loginnotisenabled, exportnotisenabled, datashareenabled
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(),
                FALSE, FALSE, FALSE, FALSE
            );
        `;
        const userCreationValues = [
            capitalizedFirstName,
            capitalizedLastName,
            username,
            email,
            phone,
            hashedPassword,
            salt,
            imageUrl,
            verificationToken,
            false
        ];
        await pool.query(userCreationQuery, userCreationValues);

        const verificationLink = `${process.env.VERIFICATION_URL}/verify-email?token=${verificationToken}`;
        const mailOptions = {
            from: fromEmail,
            to: email,
            subject: "Please verify your email",
            text: `Hi ${capitalizedFirstName},\n\nThank you for registering. Please verify your email by clicking the link below:\n\n${verificationLink}\n\nIf you did not request this, you can ignore this email.\n\n– The Stack Forge Team`
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
    const rawToken = req.query.token;
    if (!rawToken) {
        return res.status(400).json({ message: "Verification token missing." });
    }
    const token = rawToken.trim();

    try {
        const updateResult = await pool.query(
            `
                UPDATE users
                SET verified = TRUE,
                   verification_token = NULL
                WHERE verification_token = $1
                RETURNING username
            `,
            [token]
        );

        if (updateResult.rowCount === 0) {
            return res.status(400).json({ message: "Invalid or expired verification token." });
        }

        return res.status(200).json({ message: "Email verified successfully." });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        }
        next(error);
    }
});


router.post("/resend-verification-email", async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ message: "Email is required to resend verification." });
    }

    try {
        const findUser = await pool.query(
            `
                SELECT first_name, verification_token, verified 
                FROM users 
                WHERE email = $1
            `,
            [email]
        );
        if (!findUser.rows.length) {
            return res.status(404).json({ message: "No user found with that email." });
        }
        const { first_name, verification_token, verified } = findUser.rows[0];
        if (verified) {
            return res.status(400).json({ message: "Email is already verified; no need to resend." });
        }

        const verificationLink = `${process.env.VERIFICATION_URL}/verify-email?token=${verification_token}`;
        await emailTransporter.sendMail({
            from:    fromEmail,
            to:      email,
            subject: "Your verification email",
            text:    `Hi ${first_name},\n\nHere is your verification link again:\n\n${verificationLink}\n\n– The Stack Forge Team`
        });

        return res.status(200).json({ message: "Verification email resent successfully." });
    } catch (error) {
        return res.status(500).json({ message: "Unable to resend verification email." });
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
