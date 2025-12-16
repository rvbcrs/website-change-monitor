"use strict";
/**
 * Environment validation and configuration
 * Validates required environment variables at startup
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnv = validateEnv;
exports.enforceEnv = enforceEnv;
/**
 * Validate environment variables and return configuration
 */
function validateEnv() {
    const errors = [];
    const warnings = [];
    // DATA_DIR - required in production
    const dataDir = process.env.DATA_DIR;
    if (!dataDir && process.env.NODE_ENV === 'production') {
        errors.push('DATA_DIR is required in production mode');
    }
    // PORT - optional, defaults to 3000
    const port = parseInt(process.env.PORT || '3000', 10);
    if (isNaN(port) || port < 1 || port > 65535) {
        errors.push('PORT must be a valid port number (1-65535)');
    }
    // NODE_ENV - optional, defaults to development
    const nodeEnv = (process.env.NODE_ENV || 'development');
    if (!['development', 'production', 'test'].includes(nodeEnv)) {
        warnings.push(`NODE_ENV "${nodeEnv}" is not recognized, using "development"`);
    }
    // ACCESS_TOKEN_SECRET - required for auth
    if (!process.env.ACCESS_TOKEN_SECRET) {
        warnings.push('ACCESS_TOKEN_SECRET not set - using insecure default. Set this in production!');
    }
    // GOOGLE_CLIENT_ID - optional, but required for Google OAuth
    if (!process.env.GOOGLE_CLIENT_ID) {
        warnings.push('GOOGLE_CLIENT_ID not set - Google OAuth will be disabled');
    }
    // APP_URL - optional, but required for email verification links
    if (!process.env.APP_URL) {
        warnings.push('APP_URL not set - email verification links may not work correctly');
    }
    const config = {
        DATA_DIR: dataDir || './data',
        PORT: port,
        NODE_ENV: nodeEnv,
        ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET,
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        APP_URL: process.env.APP_URL,
    };
    return {
        valid: errors.length === 0,
        config,
        warnings,
        errors,
    };
}
/**
 * Log validation results and exit if invalid
 */
function enforceEnv() {
    const result = validateEnv();
    // Log warnings
    result.warnings.forEach(warning => {
        console.warn(`⚠️  ENV WARNING: ${warning}`);
    });
    // Log errors and exit if invalid
    if (!result.valid) {
        result.errors.forEach(error => {
            console.error(`❌ ENV ERROR: ${error}`);
        });
        console.error('\n❌ Environment validation failed. Exiting...');
        process.exit(1);
    }
    console.log('✅ Environment validation passed');
    return result.config;
}
//# sourceMappingURL=env.js.map