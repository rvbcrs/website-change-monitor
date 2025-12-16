/**
 * Environment validation and configuration
 * Validates required environment variables at startup
 */
interface EnvConfig {
    DATA_DIR: string;
    PORT: number;
    NODE_ENV: 'development' | 'production' | 'test';
    ACCESS_TOKEN_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    APP_URL?: string;
}
interface ValidationResult {
    valid: boolean;
    config: EnvConfig;
    warnings: string[];
    errors: string[];
}
/**
 * Validate environment variables and return configuration
 */
export declare function validateEnv(): ValidationResult;
/**
 * Log validation results and exit if invalid
 */
export declare function enforceEnv(): EnvConfig;
export {};
//# sourceMappingURL=env.d.ts.map