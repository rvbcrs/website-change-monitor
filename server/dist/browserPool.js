"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireBrowser = acquireBrowser;
exports.shutdownPool = shutdownPool;
exports.getPoolStats = getPoolStats;
const playwright_extra_1 = require("playwright-extra");
const puppeteer_extra_plugin_stealth_1 = __importDefault(require("puppeteer-extra-plugin-stealth"));
const logger_1 = require("./logger");
const db_1 = __importDefault(require("./db"));
playwright_extra_1.chromium.use((0, puppeteer_extra_plugin_stealth_1.default)());
const MAX_BROWSERS = 3;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes - recycle browsers
let browserPool = [];
let isShuttingDown = false;
/**
 * Get launch options including proxy settings
 */
async function getLaunchOptions() {
    const settings = await new Promise((resolve) => db_1.default.get("SELECT * FROM settings WHERE id = 1", (err, row) => resolve(row || {})));
    const launchOptions = { headless: true };
    if (settings.proxy_enabled && settings.proxy_server) {
        launchOptions.proxy = { server: settings.proxy_server };
        if (settings.proxy_auth) {
            const [username, password] = settings.proxy_auth.split(':');
            launchOptions.proxy.username = username;
            launchOptions.proxy.password = password;
        }
        (0, logger_1.logInfo)('browser', `Browser pool using proxy: ${settings.proxy_server}`);
    }
    return launchOptions;
}
/**
 * Create a new browser instance
 */
async function createBrowser() {
    const launchOptions = await getLaunchOptions();
    const browser = await playwright_extra_1.chromium.launch(launchOptions);
    const pooledBrowser = {
        browser,
        inUse: false,
        lastUsed: Date.now(),
        createdAt: Date.now()
    };
    // Handle unexpected browser close
    browser.on('disconnected', () => {
        const index = browserPool.findIndex(pb => pb.browser === browser);
        if (index !== -1) {
            browserPool.splice(index, 1);
            (0, logger_1.logWarn)('browser', 'Browser instance disconnected unexpectedly, removed from pool');
        }
    });
    (0, logger_1.logInfo)('browser', `Created new browser instance (pool size: ${browserPool.length + 1})`);
    return pooledBrowser;
}
/**
 * Acquire a browser context from the pool
 */
async function acquireBrowser() {
    if (isShuttingDown) {
        throw new Error('Browser pool is shutting down');
    }
    // Find an available browser that's not too old
    let pooledBrowser = browserPool.find(pb => !pb.inUse && (Date.now() - pb.createdAt) < MAX_AGE_MS);
    // If no available browser, create a new one if we have room
    if (!pooledBrowser) {
        if (browserPool.length < MAX_BROWSERS) {
            pooledBrowser = await createBrowser();
            browserPool.push(pooledBrowser);
        }
        else {
            // Wait for a browser to become available
            (0, logger_1.logWarn)('browser', 'All browsers in use, waiting for availability...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            return acquireBrowser(); // Retry
        }
    }
    pooledBrowser.inUse = true;
    pooledBrowser.lastUsed = Date.now();
    const context = await pooledBrowser.browser.newContext();
    const release = async () => {
        try {
            await context.close();
        }
        catch (e) {
            // Context might already be closed
        }
        pooledBrowser.inUse = false;
        pooledBrowser.lastUsed = Date.now();
    };
    return { context, release };
}
/**
 * Clean up idle browsers
 */
async function cleanupIdleBrowsers() {
    const now = Date.now();
    for (let i = browserPool.length - 1; i >= 0; i--) {
        const pb = browserPool[i];
        // Skip if in use
        if (pb.inUse)
            continue;
        // Close if idle too long or too old
        const isIdle = (now - pb.lastUsed) > IDLE_TIMEOUT_MS;
        const isTooOld = (now - pb.createdAt) > MAX_AGE_MS;
        if ((isIdle || isTooOld) && browserPool.length > 1) {
            try {
                await pb.browser.close();
                browserPool.splice(i, 1);
                (0, logger_1.logInfo)('browser', `Closed idle browser (${isIdle ? 'idle timeout' : 'max age'}), pool size: ${browserPool.length}`);
            }
            catch (e) {
                (0, logger_1.logWarn)('browser', `Failed to close browser: ${e.message}`);
                browserPool.splice(i, 1);
            }
        }
    }
}
/**
 * Shutdown the browser pool
 */
async function shutdownPool() {
    isShuttingDown = true;
    (0, logger_1.logInfo)('browser', 'Shutting down browser pool...');
    // Wait for all browsers to be released
    let waitAttempts = 0;
    while (browserPool.some(pb => pb.inUse) && waitAttempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitAttempts++;
    }
    // Close all browsers
    for (const pb of browserPool) {
        try {
            await pb.browser.close();
        }
        catch (e) {
            // Ignore close errors during shutdown
        }
    }
    browserPool = [];
    (0, logger_1.logInfo)('browser', 'Browser pool shut down complete');
}
/**
 * Get pool statistics
 */
function getPoolStats() {
    return {
        total: browserPool.length,
        inUse: browserPool.filter(pb => pb.inUse).length,
        available: browserPool.filter(pb => !pb.inUse).length
    };
}
// Start cleanup interval
setInterval(cleanupIdleBrowsers, 60000);
// Handle process exit
process.on('SIGINT', async () => {
    await shutdownPool();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await shutdownPool();
    process.exit(0);
});
//# sourceMappingURL=browserPool.js.map