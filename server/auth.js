const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('./db');
const { sendNotification } = require('./notifications');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'your_super_secret_jwt_key_change_this_in_prod';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Middleware to Authenticate Token
function authenticateToken(req, res, next) {
    console.log(`[Auth] Checking token for ${req.url}`);
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

function generateAccessToken(user) {
    // user object should contain id, email, role
    return jwt.sign(user, ACCESS_TOKEN_SECRET, { expiresIn: '7d' }); // Long lived for extension convenience? Or standard 15m?
    // For this app, 7d is fine for now.
}

// Helper to generate verification token
function generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Register User
function registerUser(email, password) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // First check if any users exist to determine role
            db.get("SELECT count(*) as count FROM users", [], async (err, row) => {
                if (err) return reject(err);

                // If no users, this is the first user -> Admin
                // If users exist, standard role -> User
                // But wait, user requested to DISABLE registration after setup.
                // So if count > 0, we should maybe reject unless invited?
                // For now, let's stick to the plan: First user = Admin. Subsequent = User (or Disabled).
                // Let's implement: First = Admin. Others = User (for now), but we will add a setting to disable open registration later.

                let role = 'user';
                if (row.count === 0) {
                    role = 'admin';
                }

                // Check if registration is allowed (naive check for now, later via settings)
                // For now allow all, but first is admin.

                try {
                    const hashedPassword = await bcrypt.hash(password, 10);
                    const verificationToken = generateVerificationToken();

                    db.run(
                        `INSERT INTO users (email, password_hash, role, verification_token, is_verified) VALUES (?, ?, ?, ?, 0)`,
                        [email, hashedPassword, role, verificationToken],
                        function (err) {
                            if (err) {
                                if (err.message.includes('UNIQUE constraint failed')) {
                                    reject(new Error('Email already exists'));
                                } else {
                                    reject(err);
                                }
                            } else {
                                // Send verification email
                                const verificationLink = `${process.env.APP_URL || 'http://localhost:5173'}/verify?token=${verificationToken}`;
                                const subject = "Verify your DeltaWatch account";
                                const message = `Welcome to DeltaWatch! Please verify your email by clicking the link below:\n\n${verificationLink}`;
                                const htmlMessage = `
                                    <h2>Welcome to DeltaWatch!</h2>
                                    <p>Please verify your email by clicking the link below:</p>
                                    <p><a href="${verificationLink}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
                                    <p>Or copy this link: ${verificationLink}</p>
                                `;
                                sendNotification(subject, message, htmlMessage);
                                resolve({ id: this.lastID, email, role, verification_token: verificationToken });
                            }
                        }
                    );
                } catch (e) {
                    reject(e);
                }
            });
        });
    });
}

// Login User
function loginUser(email, password) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
            if (err) return reject(err);
            if (!user) return reject(new Error('User not found'));

            if (await bcrypt.compare(password, user.password_hash)) {
                if (user.is_blocked) return reject(new Error('Account blocked'));
                // Return user info and token
                const tokenUser = { id: user.id, email: user.email, role: user.role };
                const accessToken = generateAccessToken(tokenUser);
                resolve({ token: accessToken, user: tokenUser, is_verified: user.is_verified });
            } else {
                reject(new Error('Invalid password'));
            }
        });
    });
}

// Verify Email
function verifyEmail(token) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE verification_token = ?", [token], (err, user) => {
            if (err) return reject(err);
            if (!user) return reject(new Error('Invalid token'));

            db.run("UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?", [user.id], (err) => {
                if (err) reject(err);
                else resolve(user.email);
            });
        });
    });
}

// Resend Verification
function resendVerification(email) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
            if (err) return reject(err);
            if (!user) return reject(new Error('User not found'));
            if (user.is_verified) return resolve('already_verified');
            if (user.is_blocked) return reject(new Error('Account blocked'));

            const newToken = generateVerificationToken();
            db.run("UPDATE users SET verification_token = ? WHERE id = ?", [newToken, user.id], (err) => {
                if (err) return reject(err);

                const verificationLink = `${process.env.APP_URL || 'http://localhost:5173'}/verify?token=${newToken}`;
                const subject = "Verify your DeltaWatch account (Resend)";
                const message = `Please verify your email: ${verificationLink}`;

                sendNotification(subject, message);
                resolve('sent');
            });
        });
    });
}

// Verify Google Token (Updated for Admin First Logic)
function verifyGoogleToken(token) {
    return new Promise(async (resolve, reject) => {
        try {
            const ticket = await googleClient.verifyIdToken({
                idToken: token,
                audience: GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            const { email, email_verified } = payload;

            if (!email_verified) {
                return reject(new Error('Google email not verified'));
            }

            // Check if user exists
            db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
                if (err) return reject(err);

                if (user) {
                    if (user.is_blocked) return reject(new Error('Account blocked'));
                    // User exists, login
                    const tokenUser = { id: user.id, email: user.email, role: user.role };
                    const accessToken = generateAccessToken(tokenUser);

                    if (!user.is_verified) {
                        db.run("UPDATE users SET is_verified = 1 WHERE id = ?", [user.id]);
                        user.is_verified = 1;
                    }

                    resolve({ token: accessToken, user: tokenUser });
                } else {
                    // User does not exist, create 
                    // Check count for role assignment
                    db.get("SELECT count(*) as count FROM users", [], async (err, row) => {
                        let role = 'user';
                        if (!err && row.count === 0) role = 'admin';

                        const randomPassword = crypto.randomBytes(16).toString('hex');
                        const hashedPassword = await bcrypt.hash(randomPassword, 10);

                        db.run(
                            `INSERT INTO users (email, password_hash, role, is_verified) VALUES (?, ?, ?, 1)`,
                            [email, hashedPassword, role],
                            function (err) {
                                if (err) return reject(err);

                                const newUser = { id: this.lastID, email, role: role };
                                const accessToken = generateAccessToken(newUser);
                                resolve({ token: accessToken, user: newUser });
                            }
                        );
                    });
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

// Admin: Get All Users
function getUsers() {
    return new Promise((resolve, reject) => {
        db.all("SELECT id, email, role, is_verified, is_blocked, created_at FROM users ORDER BY created_at DESC", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Admin: Delete User
function deleteUser(id) {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM users WHERE id = ?", [id], function (err) {
            if (err) reject(err);
            else resolve({ deleted: this.changes });
        });
    });
}

// Admin: Toggle Block Status
function toggleUserBlock(id, blocked) {
    return new Promise((resolve, reject) => {
        db.run("UPDATE users SET is_blocked = ? WHERE id = ?", [blocked ? 1 : 0, id], function (err) {
            if (err) reject(err);
            else resolve({ changes: this.changes });
        });
    });
}

// Check Setup Status (Is there an admin?)
function isSetupComplete() {
    return new Promise((resolve) => {
        db.get("SELECT count(*) as count FROM users WHERE role = 'admin'", [], (err, row) => {
            if (err) resolve(false);
            else resolve(row.count > 0);
        });
    });
}

module.exports = {
    authenticateToken,
    registerUser,
    loginUser,
    verifyEmail,
    resendVerification,
    verifyGoogleToken,
    ACCESS_TOKEN_SECRET,
    generateAccessToken,
    getUsers,
    deleteUser,
    toggleUserBlock,
    isSetupComplete
};
