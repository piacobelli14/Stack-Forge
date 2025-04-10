const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { smtpHost, smtpPort, smtpUser, smtpPassword, emailTransporter } = require('../config/smtp');
const { s3Client, storage, upload, PutObjectCommand } = require('../config/s3');
const { authenticateToken } = require('../middleware/auth');


require('dotenv').config();
secretKey = process.env.JWT_SECRET_KEY;

const router = express.Router();

router.post('/user-info', authenticateToken, async (req, res, next) => {
    const { userID, organizationID } = req.body;

    req.on('close', () => {
        return;
    });

    try {
        const gatherUserInfoQuery = `
            SELECT 
                u.*, 
                COALESCE(o.orgname, '') AS orgname,
                COALESCE(o.orgemail, '') AS orgemail,
                COALESCE(o.orgphone, '') AS orgphone,
                COALESCE(o.orgdescription, '') AS orgdescription,
                COALESCE(o.orgimage, '') AS orgimage, 
                COALESCE(o.created_at) AS orgcreatedat
            FROM users u
            LEFT JOIN organizations o ON u.orgid = o.orgid
            WHERE u.username = $1 AND ((u.orgid = $2) OR ($2 IS NULL AND u.orgid IS NULL))
            ; 
        `;
        const gatherUserInfoInfo = await pool.query(gatherUserInfoQuery, [userID, organizationID]);

        if (gatherUserInfoInfo.error) {
            return res.status(500).json({ message: 'Unable to fetch user info at this time. Please try again later.' });
        }

        const formattedInfo = gatherUserInfoInfo.rows.map(row => ({
            username: userID,
            orgid: row.orgid,
            email: row.email,
            firstname: row.first_name,
            lastname: row.last_name,
            image: row.image,
            phone: row.phone,
            role: row.role,
            isadmin: row.is_admin,
            twofa: row.twofaenabled,
            multifa: row.multifaenabled,
            loginnotis: row.loginnotisenabled,
            exportnotis: row.exportnotisenabled,
            datashare: row.datashareenabled,
            organizationid: row.orgid || userID,
            organizationname: row.orgname,
            organizationemail: row.orgemail,
            organizationphone: row.orgphone,
            organizationdescription: row.orgdescription,
            organizationimage: row.orgimage,
            organizationcreated: row.orgcreatedat,
            showpersonalemail: row.showpersonalemail,
            showpersonalphone: row.showpersonalphone,
            showteamid: row.showteamid,
            showteamemail: row.showteamemail,
            showteamphone: row.showteamphone,
            showteamadminstatus: row.showteamadminstatus,
            showteamrole: row.showteamrole
        }));

        return res.status(200).json(formattedInfo);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/usage-info', authenticateToken, async (req, res, next) => {
    const { userID, organizationID } = req.body; 

    req.on('close', () => {
        return;
    });

    try {
        const personalUsagePerDayQuery = `
            WITH days AS (
                SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day')::date AS day
            )
            SELECT d.day, COALESCE(COUNT(a.timestamp), 0) AS usage_count
            FROM days d
            LEFT JOIN ide_edit_logs a 
            ON d.day = a.timestamp::date AND a.username = $1 AND a.orgid = $2
            GROUP BY d.day
            ORDER BY d.day ASC
            ;
        `;

        const usageLanguagesQuery = `
            SELECT a.language, COUNT(a.language) AS language_count
            FROM ide_edit_logs a
            WHERE a.timestamp >= CURRENT_DATE - INTERVAL '29 days'
              AND a.username = $1
              AND a.orgid = $2
            GROUP BY a.language
            ORDER BY language_count DESC
            ;
        `;

        const [personalUsagePerDay, usageLanguages] = await Promise.all([
            pool.query(personalUsagePerDayQuery, [userID, organizationID]),
            pool.query(usageLanguagesQuery, [userID, organizationID])
        ]);

        return res.status(200).json({  
            message: 'Admin signin summary data fetched successfully.', 
            personalUsageInfo: personalUsagePerDay.rows,
            usageLanguages: usageLanguages.rows
        });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/update-user-show-values', authenticateToken, async (req, res, next) => {
    let { userID, organizationID, showColumn, showColumnValue } = req.body; 

    req.on('close', () => {
        return;
    });

    try {
        const updateShowColumnsQuery = `
           UPDATE users
           SET ${showColumn} = $3
           WHERE username = $1 AND orgid = $2
           ; 
        `;

        await pool.query(updateShowColumnsQuery, [userID, organizationID, showColumnValue]);
        return res.status(200).json({ message: 'Successfully updated column value.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/edit-user-image', authenticateToken, async (req, res, next) => {
    const { userID, image } = req.body;

    req.on('close', () => {
        return;
    });

    if (!userID || !image) {
        return res.status(400).json({ message: 'User ID and image are required.' });
    }

    try {
        const matches = image.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ message: 'Invalid image format.' });
        }
        const mimeType = matches[1];
        const imageBuffer = Buffer.from(matches[2], 'base64');
        const extension = mimeType.split('/')[1];

        const imageName = `${crypto.randomBytes(16).toString('hex')}.${extension}`;

        const uploadParams = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: `uploads/${imageName}`,
            Body: imageBuffer,
            ContentType: mimeType,
        };

        const data = await s3Client.send(new PutObjectCommand(uploadParams));
        const imageUrl = `https://${uploadParams.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${uploadParams.Key}`;

        const updateImageQuery = `
            UPDATE users
            SET image = $1
            WHERE username = $2
            ;
        `;

        const updateImageInfo = await pool.query(updateImageQuery, [imageUrl, userID]);

        if (updateImageInfo.rowCount === 0) {
            return res.status(404).json({ message: 'User not found or image not updated.' });
        }

        return res.status(200).json({ message: 'User image updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/edit-team-image', authenticateToken, async (req, res, next) => {
    const { userID, organizationID, image } = req.body;

    req.on('close', () => {
        return;
    });

    if (!userID || !image) {
        return res.status(400).json({ message: 'User ID, Organization ID, and image are required.' });
    }

    try {
        const matches = image.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ message: 'Invalid image format.' });
        }
        const mimeType = matches[1];
        const imageBuffer = Buffer.from(matches[2], 'base64');
        const extension = mimeType.split('/')[1];

        const imageName = `${crypto.randomBytes(16).toString('hex')}.${extension}`;

        const uploadParams = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: `uploads/${imageName}`,
            Body: imageBuffer,
            ContentType: mimeType,
        };

        const data = await s3Client.send(new PutObjectCommand(uploadParams));
        const imageUrl = `https://${uploadParams.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${uploadParams.Key}`;

        const updateImageQuery = `
            UPDATE organizations
            SET orgimage = $1
            WHERE orgid = $2
            ;
        `;

        const updateImageInfo = await pool.query(updateImageQuery, [imageUrl, organizationID]);

        if (updateImageInfo.rowCount === 0) {
            return res.status(404).json({ message: 'Team not found or image not updated.' });
        }

        return res.status(200).json({ message: 'Team image updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/edit-user-first-name', authenticateToken, async (req, res, next) => {
    const { userID, firstName } = req.body;

    req.on('close', () => {
        return;
    });

    try {
        const updateFirstNameQuery = `
            UPDATE users
            SET first_name = $1
            WHERE username = $2
            ;
        `;

        const updateFirstNameInfo = await pool.query(updateFirstNameQuery, [firstName, userID]);

        if (updateFirstNameInfo.error) {
            return res.status(500).json({ message: 'Unable to update user info at this time. Please try again.' });
        }

        return res.status(200).json({ message: 'First name updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/edit-user-last-name', authenticateToken, async (req, res, next) => {
    const { userID, lastName } = req.body;

    req.on('close', () => {
        return;
    });


    try {
        const updateLastNameQuery = `
            UPDATE users
            SET last_name = $1
            WHERE username = $2
            ;
        `;

        const updateLastNameInfo = await pool.query(updateLastNameQuery, [lastName, userID]);

        if (updateLastNameInfo.error) {
            return res.status(500).json({ message: 'Unable to update user info at this time. Please try again.' });
        }

        return res.status(200).json({ message: 'Last name updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/edit-team-name', authenticateToken, async (req, res, next) => {
    const { userID, organizationID, orgName } = req.body;
    
    req.on('close', () => {
        return;
    });

    try {
        const updateFirstNameQuery = `
            UPDATE organizations
            SET orgname = $1
            WHERE orgid = $2
            ;
        `;

        const updateFirstNameInfo = await pool.query(updateFirstNameQuery, [orgName, organizationID]);

        if (updateFirstNameInfo.error) {
            return res.status(500).json({ message: 'Unable to update team info at this time. Please try again.' });
        }

        return res.status(200).json({ message: 'Team name updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/edit-user-email', authenticateToken, async (req, res, next) => {
    const { userID, email } = req.body;

    req.on('close', () => {
        return;
    });

    try {
        const updateEmailQuery = `
            UPDATE users
            SET email = $1
            WHERE username = $2
            ;
        `;

        const updateEmailInfo = await pool.query(updateEmailQuery, [email, userID]);
        if (updateEmailInfo.error) {
            return res.status(500).json({ message: 'Unable to update user info at this time. Please try again.' });
        }

        return res.status(200).json({ message: 'Email updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/edit-team-email', authenticateToken, async (req, res, next) => {
    const { userID, organizationID, orgEmail } = req.body;
    
    req.on('close', () => {
        return;
    });

    try {
        const updateFirstNameQuery = `
            UPDATE organizations
            SET orgemail = $1
            WHERE orgid = $2
            ;
        `;

        const updateFirstNameInfo = await pool.query(updateFirstNameQuery, [orgEmail, organizationID]);

        if (updateFirstNameInfo.error) {
            return res.status(500).json({ message: 'Unable to update team info at this time. Please try again.' });
        }

        return res.status(200).json({ message: 'Team name updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/edit-user-phone', authenticateToken, async (req, res, next) => {
    const { userID, phone } = req.body;

    req.on('close', () => {
        return;
    });

    try {
        const updatePhoneQuery = `
            UPDATE users
            SET phone = $1
            WHERE username = $2
            ;
        `;

        const updatePhoneInfo = await pool.query(updatePhoneQuery, [phone, userID]);
        if (updatePhoneInfo.error) {
            return res.status(500).json({ message: 'Unable to update user info at this time. Please try again.' });
        }

        return res.status(200).json({ message: 'Phone updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/edit-team-phone', authenticateToken, async (req, res, next) => {
    const { userID, organizationID, orgPhone } = req.body;
    
    req.on('close', () => {
        return;
    });

    try {
        const updateFirstNameQuery = `
            UPDATE organizations
            SET orgphone = $1
            WHERE orgid = $2
            ;
        `;

        const updateFirstNameInfo = await pool.query(updateFirstNameQuery, [orgPhone, organizationID]);

        if (updateFirstNameInfo.error) {
            return res.status(500).json({ message: 'Unable to update team info at this time. Please try again.' });
        }

        return res.status(200).json({ message: 'Team name updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/edit-user-role', authenticateToken, async (req, res, next) => {
    const { userID, role } = req.body;

    req.on('close', () => {
        return;
    });

    try {
        const updateRoleQuery = `
            UPDATE users
            SET role = $1
            WHERE username = $2
            ;
        `;

        const updateRoleInfo = await pool.query(updateRoleQuery, [role, userID]);
        if (updateRoleInfo.error) {
            return res.status(500).json({ message: 'Unable to update user info at this time. Please try again.' });
        }

        return res.status(200).json({ message: 'Role updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/delete-account', authenticateToken, async (req, res, next) => {
    const { userID } = req.body;

    req.on('close', () => {
        return;
    });

    try {
        const deleteAccountQuery = `
            DELETE FROM users 
            WHERE username = $1
            ;
        `;

        const deleteAccountInfo = await pool.query(deleteAccountQuery, [userID]);
        if (deleteAccountInfo.error) {
            return res.status(500).json({ message: 'Unable to update user info at this time. Please try again.' });
        }

        return res.status(200).json({ message: 'Role updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/delete-team', authenticateToken, async (req, res, next) => {
    const { userID, organizationID } = req.body;

    req.on('close', () => {
        return;
    });

    try {
        const deleteAccountQuery = `
            DELETE FROM organizations 
            WHERE orgid = $1;
        `;

        const updateIDQuery = `
            UPDATE users 
            SET orgid = NULL 
            WHERE orgid = $1;
        `;

        const deleteAccountInfo = await pool.query(deleteAccountQuery, [organizationID]);
        const updateIDInfo = await pool.query(updateIDQuery, [organizationID]);
        if (deleteAccountInfo.error || updateIDInfo.error) {
            return res.status(500).json({ message: 'Unable to update user info at this time. Please try again.' });
        }

        return res.status(200).json({ message: 'Team updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/join-team', authenticateToken, (req, res) => {
    const { userID, firstName, lastName, teamCode } = req.body;

    req.on('close', () => {
        return;
    });

    const isCodeValid = (teamCode, callback) => {
        const codeVerificationQuery = `
            SELECT orgname 
            FROM organizations 
            WHERE orgid = $1
            ;
        `;
        pool.query(codeVerificationQuery, [teamCode], (error, codeVerificationInfo) => {
            if (error) {
                return callback(error);
            }

            if (codeVerificationInfo.rows.length === 0) {
                callback(null, false);
            } else {
                callback(null, true);
            }
        });
    };

    /*
    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: false,
        auth: {
            user: smtpUser,
            pass: smtpPassword,
        },
    });

    const mailOptions = {
        from: smtpUser,
        subject: 'Access Request',
        text: `Hi!\n\n${firstName} ${lastName} (@${userID}) has requested access to your team.\n\nPlease review this notification in your dashboard and take appropriate action.\n\n-The Nightingale Team`,
    };
    */

    const requestAccess = () => {
        isCodeValid(teamCode, (error, isValid) => {
            if (error) {
                if (!res.headersSent) {
                    return res.status(500).json({ message: 'Unable to request team access at this time. Please try again.' });
                }
                return;
            }

            if (isValid) {
                const adminEmailQuery = `
                    SELECT email 
                    FROM users 
                    WHERE orgid = $1 AND is_admin = 'admin'
                    ;
                `;
                pool.query(adminEmailQuery, [teamCode], (error, adminEmailInfo) => {
                    if (error) {
                        if (!res.headersSent) {
                            return res.status(500).json({ message: 'Unable to request team access at this time. Please try again.' });
                        }
                        return;
                    }

                    const adminEmails = adminEmailInfo.rows.map((row) => row.email);

                    const checkActiveRequestQuery = `
                        SELECT * 
                        FROM access_requests 
                        WHERE request_username = $1 AND request_status = 'Current'
                        ;
                    `;

                    pool.query(checkActiveRequestQuery, [userID], (error, checkActiveRequestInfo) => {
                        if (error) {
                            if (!res.headersSent) {
                                return res.status(500).json({ message: 'Unable to request team access at this time. Please try again.' });
                            }
                            return;
                        }

                        if (checkActiveRequestInfo.rows.length > 0) {
                            const updateActiveRequestQuery = `
                                UPDATE access_requests
                                SET request_timestamp = NOW()
                                WHERE request_username = $1 AND request_orgid = $2 AND request_status = 'Current'
                                ;
                            `;

                            pool.query(updateActiveRequestQuery, [userID, teamCode], (error, info) => {
                                if (error) {
                                    if (!res.headersSent) {
                                        return res.status(500).json({ message: 'Unable to request team access at this time. Please try again.' });
                                    }
                                    return;
                                }

                                // sendEmailsToAdmins(adminEmails);
                                if (!res.headersSent) {
                                    return res.status(200).json({ message: 'Access request sent successfully.' });
                                }
                            });
                        } else {
                            const requestLogQuery = `
                                INSERT INTO access_requests 
                                (request_username, request_orgid, request_timestamp, request_status)
                                VALUES ($1, $2, NOW(), 'Current')
                                ;
                            `;

                            pool.query(requestLogQuery, [userID, teamCode], (error, requestLogInfo) => {
                                if (error) {
                                    if (!res.headersSent) {
                                        return res.status(500).json({ message: 'Unable to request team access at this time. Please try again.' });
                                    }
                                    return;
                                }

                                // sendEmailsToAdmins(adminEmails);
                                if (!res.headersSent) {
                                    return res.status(200).json({ message: 'Access request sent successfully.' });
                                }
                            });
                        }
                    });
                });
            } else {
                if (!res.headersSent) {
                    return res.status(401).json({ message: 'There are no teams associated with that code. Please try again or contact your admin to get the correct code.' });
                }
            }
        });
    };

    /*
    const sendEmailsToAdmins = (adminEmails) => {
        if (adminEmails.length === 0) {
            if (!res.headersSent) {
                return res.status(200).json({ message: 'Access request sent successfully, but no admins were notified.' });
            }
            return;
        }

        let emailsSent = 0;
        let emailErrors = [];

        adminEmails.forEach((email) => {
            mailOptions.to = email;

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    emailErrors.push({ email, error });
                }

                emailsSent++;
                if (emailsSent === adminEmails.length) {
                    if (emailErrors.length > 0) {
                        if (!res.headersSent) {
                            return res.status(500).json({ message: 'Access request sent, but there were errors sending notification emails.' });
                        }
                    } else {
                        if (!res.headersSent) {
                            return res.status(200).json({ message: 'Access request sent successfully.' });
                        }
                        next(error); 
                    }
                }
            });
        });
    };
    */

    requestAccess();
});

router.post('/create-team', authenticateToken, async (req, res, next) => {
    const { userID, teamName } = req.body;

    req.on('close', () => {
        return;
    });

    try {

        const generateRandomOrgId = () => {
            const orgId = Math.floor(100000 + Math.random() * 900000);
            return orgId;
        };

        const isOrgIdUnique = async (organizationID) => {
            const organizationidVerificationQuery = `
                SELECT COUNT(*) 
                FROM organizations 
                WHERE orgid = $1
                ;
            `;
            const organizationidVerificationInfo = await pool.query(organizationidVerificationQuery, [organizationID]);
            const isUnique = parseInt(organizationidVerificationInfo.rows[0].count) === 0;
            return isUnique;
        };

        const isTeamNameUnique = async (teamName) => {
            const teamNameVerificationQuery = `
                SELECT COUNT(*) 
                FROM organizations 
                WHERE orgname = $1
                ;
            `;
            const teamNameVerificationInfo = await pool.query(teamNameVerificationQuery, [teamName]);
            const isUnique = parseInt(teamNameVerificationInfo.rows[0].count) === 0;
            return isUnique;
        };

        const insertTeam = async (organizationID, userEmail) => {
            const teamCreationQuery = `
                INSERT INTO organizations
                (orgname, orgid, created_at)
                VALUES ($1, $2, NOW())
                ;
            `;
            await pool.query(teamCreationQuery, [teamName, organizationID]);

            const teamUpdateQuery = `
                UPDATE users
                SET orgid = $1, is_admin = 'admin'
                WHERE username = $2
                ;
            `;
            await pool.query(teamUpdateQuery, [organizationID, userID]);

            res.status(200).json({ message: 'Team created successfully.', orgid: organizationID });
        };

        const getUserEmail = async (userID) => {
            const userEmailQuery = `
                SELECT email 
                FROM users 
                WHERE username = $1
                ;
            `;
            const userEmailInfo = await pool.query(userEmailQuery, [userID]);
            if (userEmailInfo.rows.length > 0) {
                const email = userEmailInfo.rows[0].email;
                return email;
            } else {
                throw new Error('User email not found');
            }
        };

        let uniqueOrgId = generateRandomOrgId();

        const checkAndInsert = async () => {
            while (!(await isOrgIdUnique(uniqueOrgId))) {
                uniqueOrgId = generateRandomOrgId();
            }

            if (await isTeamNameUnique(teamName) && teamName !== '' && teamName !== null) {
                const userEmail = await getUserEmail(userID);
                await insertTeam(uniqueOrgId, userEmail);
            } else {
                if (!res.headersSent) {
                    res.status(401).json({ message: 'Unable to create team at this time. Please try again.' });
                }
            }
        };

        await checkAndInsert();
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});


module.exports = router;
