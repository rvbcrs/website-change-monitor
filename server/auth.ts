import jwt, { JwtPayload } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { Request, Response, NextFunction } from 'express';
import db from './db';
import { sendNotification } from './notifications';
import type { User, AuthRequest } from './types';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'your_super_secret_jwt_key_change_this_in_prod';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

interface TokenUser {
    id: number;
    email: string;
    role: string;
}

interface CountRow {
    count: number;
}

// Middleware to Authenticate Token
function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void {
    console.log(`[Auth] Checking token for ${req.url}`);
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        res.sendStatus(401);
        return;
    }

    jwt.verify(token, ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            res.sendStatus(403);
            return;
        }
        const payload = decoded as JwtPayload;
        req.user = { userId: payload.id as number, role: payload.role as string };
        next();
    });
}

function generateAccessToken(user: TokenUser): string {
    return jwt.sign(user, ACCESS_TOKEN_SECRET, { expiresIn: '7d' });
}

function generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

interface RegisterResult {
    id: number;
    email: string;
    role: string;
    verification_token: string;
}

function registerUser(email: string, password: string): Promise<RegisterResult> {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.get("SELECT count(*) as count FROM users", [], async (err: Error | null, row: CountRow) => {
                if (err) return reject(err);

                let role = 'user';
                if (row.count === 0) {
                    role = 'admin';
                }

                try {
                    const hashedPassword = await bcrypt.hash(password, 10);
                    const verificationToken = generateVerificationToken();

                    db.run(
                        `INSERT INTO users (email, password_hash, role, verification_token, is_verified) VALUES (?, ?, ?, ?, 0)`,
                        [email, hashedPassword, role, verificationToken],
                        function (this: { lastID: number }, err: Error | null) {
                            if (err) {
                                if (err.message.includes('UNIQUE constraint failed')) {
                                    reject(new Error('Email already exists'));
                                } else {
                                    reject(err);
                                }
                            } else {
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

interface LoginResult {
    token: string;
    user: TokenUser;
    is_verified: number;
}

function loginUser(email: string, password: string): Promise<LoginResult> {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE email = ?", [email], async (err: Error | null, user: User | undefined) => {
            if (err) return reject(err);
            if (!user) return reject(new Error('User not found'));

            if (await bcrypt.compare(password, user.password_hash)) {
                if (user.is_blocked) return reject(new Error('Account blocked'));
                const tokenUser = { id: user.id, email: user.email, role: user.role };
                const accessToken = generateAccessToken(tokenUser);
                resolve({ token: accessToken, user: tokenUser, is_verified: user.is_verified });
            } else {
                reject(new Error('Invalid password'));
            }
        });
    });
}

function verifyEmail(token: string): Promise<string> {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE verification_token = ?", [token], (err: Error | null, user: User | undefined) => {
            if (err) return reject(err);
            if (!user) return reject(new Error('Invalid token'));

            db.run("UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?", [user.id], (err: Error | null) => {
                if (err) reject(err);
                else resolve(user.email);
            });
        });
    });
}

function resendVerification(email: string): Promise<string> {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE email = ?", [email], (err: Error | null, user: User | undefined) => {
            if (err) return reject(err);
            if (!user) return reject(new Error('User not found'));
            if (user.is_verified) return resolve('already_verified');
            if (user.is_blocked) return reject(new Error('Account blocked'));

            const newToken = generateVerificationToken();
            db.run("UPDATE users SET verification_token = ? WHERE id = ?", [newToken, user.id], (err: Error | null) => {
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

interface GoogleLoginResult {
    token: string;
    user: TokenUser;
}

function verifyGoogleToken(token: string): Promise<GoogleLoginResult> {
    return new Promise(async (resolve, reject) => {
        try {
            const ticket = await googleClient.verifyIdToken({
                idToken: token,
                audience: GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload() as TokenPayload;
            const { email, email_verified } = payload;

            if (!email_verified || !email) {
                return reject(new Error('Google email not verified'));
            }

            db.get("SELECT * FROM users WHERE email = ?", [email], async (err: Error | null, user: User | undefined) => {
                if (err) return reject(err);

                if (user) {
                    if (user.is_blocked) return reject(new Error('Account blocked'));
                    const tokenUser = { id: user.id, email: user.email, role: user.role };
                    const accessToken = generateAccessToken(tokenUser);

                    if (!user.is_verified) {
                        db.run("UPDATE users SET is_verified = 1 WHERE id = ?", [user.id]);
                    }

                    resolve({ token: accessToken, user: tokenUser });
                } else {
                    db.get("SELECT count(*) as count FROM users", [], async (err: Error | null, row: CountRow) => {
                        let role = 'user';
                        if (!err && row.count === 0) role = 'admin';

                        const randomPassword = crypto.randomBytes(16).toString('hex');
                        const hashedPassword = await bcrypt.hash(randomPassword, 10);

                        db.run(
                            `INSERT INTO users (email, password_hash, role, is_verified) VALUES (?, ?, ?, 1)`,
                            [email, hashedPassword, role],
                            function (this: { lastID: number }, err: Error | null) {
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

interface UserListItem {
    id: number;
    email: string;
    role: string;
    is_verified: number;
    is_blocked: number;
    created_at: string;
}

function getUsers(): Promise<UserListItem[]> {
    return new Promise((resolve, reject) => {
        db.all("SELECT id, email, role, is_verified, is_blocked, created_at FROM users ORDER BY created_at DESC", [], (err: Error | null, rows: UserListItem[]) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function deleteUser(id: number): Promise<{ deleted: number }> {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM users WHERE id = ?", [id], function (this: { changes: number }, err: Error | null) {
            if (err) reject(err);
            else resolve({ deleted: this.changes });
        });
    });
}

function toggleUserBlock(id: number, blocked: boolean): Promise<{ changes: number }> {
    return new Promise((resolve, reject) => {
        db.run("UPDATE users SET is_blocked = ? WHERE id = ?", [blocked ? 1 : 0, id], function (this: { changes: number }, err: Error | null) {
            if (err) reject(err);
            else resolve({ changes: this.changes });
        });
    });
}

function isSetupComplete(): Promise<boolean> {
    return new Promise((resolve) => {
        db.get("SELECT count(*) as count FROM users WHERE role = 'admin'", [], (err: Error | null, row: CountRow) => {
            if (err) resolve(false);
            else resolve(row.count > 0);
        });
    });
}

export {
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
