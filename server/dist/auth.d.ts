import { Response, NextFunction } from 'express';
import type { AuthRequest } from './types';
declare const ACCESS_TOKEN_SECRET: string;
interface TokenUser {
    id: number;
    email: string;
    role: string;
}
declare function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void;
declare function generateAccessToken(user: TokenUser): string;
interface RegisterResult {
    id: number;
    email: string;
    role: string;
    verification_token: string;
}
declare function registerUser(email: string, password: string): Promise<RegisterResult>;
interface LoginResult {
    token: string;
    user: TokenUser;
    is_verified: number;
}
declare function loginUser(email: string, password: string): Promise<LoginResult>;
declare function verifyEmail(token: string): Promise<string>;
declare function resendVerification(email: string): Promise<string>;
interface GoogleLoginResult {
    token: string;
    user: TokenUser;
}
declare function verifyGoogleToken(token: string): Promise<GoogleLoginResult>;
interface UserListItem {
    id: number;
    email: string;
    role: string;
    is_verified: number;
    is_blocked: number;
    created_at: string;
}
declare function getUsers(): Promise<UserListItem[]>;
declare function deleteUser(id: number): Promise<{
    deleted: number;
}>;
declare function toggleUserBlock(id: number, blocked: boolean): Promise<{
    changes: number;
}>;
declare function isSetupComplete(): Promise<boolean>;
export { authenticateToken, registerUser, loginUser, verifyEmail, resendVerification, verifyGoogleToken, ACCESS_TOKEN_SECRET, generateAccessToken, getUsers, deleteUser, toggleUserBlock, isSetupComplete };
//# sourceMappingURL=auth.d.ts.map