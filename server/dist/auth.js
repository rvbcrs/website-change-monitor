"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCESS_TOKEN_SECRET = void 0;
exports.authenticateToken = authenticateToken;
exports.registerUser = registerUser;
exports.loginUser = loginUser;
exports.verifyEmail = verifyEmail;
exports.resendVerification = resendVerification;
exports.verifyGoogleToken = verifyGoogleToken;
exports.generateAccessToken = generateAccessToken;
exports.getUsers = getUsers;
exports.deleteUser = deleteUser;
exports.toggleUserBlock = toggleUserBlock;
exports.isSetupComplete = isSetupComplete;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const google_auth_library_1 = require("google-auth-library");
const db_1 = __importDefault(require("./db"));
const notifications_1 = require("./notifications");
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'your_super_secret_jwt_key_change_this_in_prod';
exports.ACCESS_TOKEN_SECRET = ACCESS_TOKEN_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new google_auth_library_1.OAuth2Client(GOOGLE_CLIENT_ID);
// Middleware to Authenticate Token
function authenticateToken(req, res, next) {
    console.log(`[Auth] Checking token for ${req.url}`);
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        res.sendStatus(401);
        return;
    }
    jsonwebtoken_1.default.verify(token, ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            res.sendStatus(403);
            return;
        }
        const payload = decoded;
        req.user = { userId: payload.id, role: payload.role };
        next();
    });
}
function generateAccessToken(user) {
    return jsonwebtoken_1.default.sign(user, ACCESS_TOKEN_SECRET, { expiresIn: '7d' });
}
function generateVerificationToken() {
    return crypto_1.default.randomBytes(32).toString('hex');
}
function registerUser(email, password) {
    return new Promise((resolve, reject) => {
        db_1.default.serialize(() => {
            db_1.default.get("SELECT count(*) as count FROM users", [], async (err, row) => {
                if (err)
                    return reject(err);
                let role = 'user';
                if (row.count === 0) {
                    role = 'admin';
                }
                try {
                    const hashedPassword = await bcrypt_1.default.hash(password, 10);
                    const verificationToken = generateVerificationToken();
                    db_1.default.run(`INSERT INTO users (email, password_hash, role, verification_token, is_verified) VALUES (?, ?, ?, ?, 0)`, [email, hashedPassword, role, verificationToken], function (err) {
                        if (err) {
                            if (err.message.includes('UNIQUE constraint failed')) {
                                reject(new Error('Email already exists'));
                            }
                            else {
                                reject(err);
                            }
                        }
                        else {
                            const verificationLink = `${process.env.APP_URL || 'http://localhost:5173'}/verify?token=${verificationToken}`;
                            const subject = "Verify your DeltaWatch account";
                            const message = `Welcome to DeltaWatch! Please verify your email by clicking the link below:\n\n${verificationLink}`;
                            const htmlMessage = `
                                    <h2>Welcome to DeltaWatch!</h2>
                                    <p>Please verify your email by clicking the link below:</p>
                                    <p><a href="${verificationLink}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
                                    <p>Or copy this link: ${verificationLink}</p>
                                `;
                            (0, notifications_1.sendNotification)(subject, message, htmlMessage);
                            resolve({ id: this.lastID, email, role, verification_token: verificationToken });
                        }
                    });
                }
                catch (e) {
                    reject(e);
                }
            });
        });
    });
}
function loginUser(email, password) {
    return new Promise((resolve, reject) => {
        db_1.default.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
            if (err)
                return reject(err);
            if (!user)
                return reject(new Error('User not found'));
            if (await bcrypt_1.default.compare(password, user.password_hash)) {
                if (user.is_blocked)
                    return reject(new Error('Account blocked'));
                const tokenUser = { id: user.id, email: user.email, role: user.role };
                const accessToken = generateAccessToken(tokenUser);
                resolve({ token: accessToken, user: tokenUser, is_verified: user.is_verified });
            }
            else {
                reject(new Error('Invalid password'));
            }
        });
    });
}
function verifyEmail(token) {
    return new Promise((resolve, reject) => {
        db_1.default.get("SELECT * FROM users WHERE verification_token = ?", [token], (err, user) => {
            if (err)
                return reject(err);
            if (!user)
                return reject(new Error('Invalid token'));
            db_1.default.run("UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?", [user.id], (err) => {
                if (err)
                    reject(err);
                else
                    resolve(user.email);
            });
        });
    });
}
function resendVerification(email) {
    return new Promise((resolve, reject) => {
        db_1.default.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
            if (err)
                return reject(err);
            if (!user)
                return reject(new Error('User not found'));
            if (user.is_verified)
                return resolve('already_verified');
            if (user.is_blocked)
                return reject(new Error('Account blocked'));
            const newToken = generateVerificationToken();
            db_1.default.run("UPDATE users SET verification_token = ? WHERE id = ?", [newToken, user.id], (err) => {
                if (err)
                    return reject(err);
                const verificationLink = `${process.env.APP_URL || 'http://localhost:5173'}/verify?token=${newToken}`;
                const subject = "Verify your DeltaWatch account (Resend)";
                const message = `Please verify your email: ${verificationLink}`;
                (0, notifications_1.sendNotification)(subject, message);
                resolve('sent');
            });
        });
    });
}
function verifyGoogleToken(token) {
    return new Promise(async (resolve, reject) => {
        try {
            const ticket = await googleClient.verifyIdToken({
                idToken: token,
                audience: GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            const { email, email_verified } = payload;
            if (!email_verified || !email) {
                return reject(new Error('Google email not verified'));
            }
            db_1.default.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
                if (err)
                    return reject(err);
                if (user) {
                    if (user.is_blocked)
                        return reject(new Error('Account blocked'));
                    const tokenUser = { id: user.id, email: user.email, role: user.role };
                    const accessToken = generateAccessToken(tokenUser);
                    if (!user.is_verified) {
                        db_1.default.run("UPDATE users SET is_verified = 1 WHERE id = ?", [user.id]);
                    }
                    resolve({ token: accessToken, user: tokenUser });
                }
                else {
                    db_1.default.get("SELECT count(*) as count FROM users", [], async (err, row) => {
                        let role = 'user';
                        if (!err && row.count === 0)
                            role = 'admin';
                        const randomPassword = crypto_1.default.randomBytes(16).toString('hex');
                        const hashedPassword = await bcrypt_1.default.hash(randomPassword, 10);
                        db_1.default.run(`INSERT INTO users (email, password_hash, role, is_verified) VALUES (?, ?, ?, 1)`, [email, hashedPassword, role], function (err) {
                            if (err)
                                return reject(err);
                            const newUser = { id: this.lastID, email, role: role };
                            const accessToken = generateAccessToken(newUser);
                            resolve({ token: accessToken, user: newUser });
                        });
                    });
                }
            });
        }
        catch (e) {
            reject(e);
        }
    });
}
function getUsers() {
    return new Promise((resolve, reject) => {
        db_1.default.all("SELECT id, email, role, is_verified, is_blocked, created_at FROM users ORDER BY created_at DESC", [], (err, rows) => {
            if (err)
                reject(err);
            else
                resolve(rows);
        });
    });
}
function deleteUser(id) {
    return new Promise((resolve, reject) => {
        db_1.default.run("DELETE FROM users WHERE id = ?", [id], function (err) {
            if (err)
                reject(err);
            else
                resolve({ deleted: this.changes });
        });
    });
}
function toggleUserBlock(id, blocked) {
    return new Promise((resolve, reject) => {
        db_1.default.run("UPDATE users SET is_blocked = ? WHERE id = ?", [blocked ? 1 : 0, id], function (err) {
            if (err)
                reject(err);
            else
                resolve({ changes: this.changes });
        });
    });
}
function isSetupComplete() {
    return new Promise((resolve) => {
        db_1.default.get("SELECT count(*) as count FROM users WHERE role = 'admin'", [], (err, row) => {
            if (err)
                resolve(false);
            else
                resolve(row.count > 0);
        });
    });
}
//# sourceMappingURL=auth.js.map