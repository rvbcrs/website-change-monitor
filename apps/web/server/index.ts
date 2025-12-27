import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { chromium } from 'playwright-extra';
import type { BrowserContext, ConsoleMessage, Request as PlaywrightRequest } from 'playwright-core';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import db from './db';
import * as auth from './auth';
import { summarizeChange, getModels, analyzePage } from './ai';
import { startScheduler, checkSingleMonitor, previewScenario, executeScenario } from './scheduler';
import { sendNotification } from './notifications';
import { logError, logWarn, logInfo, getLogs, cleanupLogs, clearAllLogs, deleteLog } from './logger';
import { enforceEnv } from './env';
import type { Monitor, Settings, CheckHistory, AuthRequest } from './types';

// Validate environment at startup
const envConfig = enforceEnv();

chromium.use(stealth());

const app = express();
const PORT = envConfig.PORT;

// Trust reverse proxy (nginx, Cloudflare, etc.)
// This is required for express-rate-limit to work correctly behind a proxy
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Helper to resolve public folder path (works in both dev and Docker/production)
// In dev: __dirname is the source folder, public is at ./public
// In Docker: __dirname is dist/, public is at ../public
const getPublicPath = (...subpaths: string[]): string => {
    // Try direct path first (dev mode)
    const directPath = path.join(__dirname, 'public', ...subpaths);
    if (fs.existsSync(directPath)) return directPath;
    // Try parent path (Docker/production mode)
    return path.join(__dirname, '..', 'public', ...subpaths);
};

// Helper to get user label for logging: "email (ID: X)"
const getUserLabel = (userId: number | undefined): Promise<string> => {
    return new Promise((resolve) => {
        if (!userId) {
            resolve('unknown');
            return;
        }
        db.get('SELECT email FROM users WHERE id = ?', [userId], (err: Error | null, row: any) => {
            if (err || !row) {
                resolve(`User ${userId}`);
            } else {
                resolve(`${row.email} (ID: ${userId})`);
            }
        });
    });
};

// Rate Limiting
import rateLimit from 'express-rate-limit';

const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 login attempts per minute
    message: { error: 'Too many login attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const checkLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 manual checks per minute
    message: { error: 'Too many check requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply general rate limit to all API routes
app.use('/api/', generalLimiter);

// Apply stricter limit to auth routes
app.use('/auth/', authLimiter);
app.use('/api/auth/', authLimiter);

// Scalar API Documentation
import { apiReference } from '@scalar/express-api-reference';
const openApiSpec = JSON.parse(fs.readFileSync(path.join(__dirname, 'openapi.json'), 'utf-8'));

app.use('/api/docs', apiReference({
    spec: {
        content: openApiSpec,
    },
    theme: 'deepSpace',
    layout: 'modern',
}));

// Serve OpenAPI spec as JSON
app.get('/api/openapi.json', (req: Request, res: Response) => {
    res.json(openApiSpec);
});

// Global Request Logger
app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    next();
});

// Extended Health Check
app.get('/api/health', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const { getPoolStats } = await import('./browserPool');
    
    const checks: {
        server: string;
        database: string;
        browser: string;
        browserPool: { total: number; inUse: number; available: number };
        uptime: number;
        memory: NodeJS.MemoryUsage;
        timestamp: string;
        responseTime?: number;
    } = {
        server: 'ok',
        database: 'unknown',
        browser: 'unknown',
        browserPool: getPoolStats(),
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    };

    // Check database connectivity
    try {
        await new Promise<void>((resolve, reject) => {
            db.get('SELECT 1', (err: Error | null) => {
                if (err) reject(err);
                else resolve();
            });
        });
        checks.database = 'ok';
    } catch (e: any) {
        checks.database = 'error';
        logError('api', `Health check database failed: ${e.message}`);
    }

    // Check browser availability (quick test)
    try {
        const browser = await chromium.launch({ headless: true });
        await browser.close();
        checks.browser = 'ok';
    } catch (e: any) {
        checks.browser = 'error';
        logError('browser', `Health check browser failed: ${e.message}`);
    }

    checks.responseTime = Date.now() - startTime;
    const allOk = checks.database === 'ok' && checks.browser === 'ok';
    res.status(allOk ? 200 : 503).json(checks);
});

// Deep Health Check - includes scheduler and browser pool health
// Use this endpoint for Docker/Kubernetes liveness probes
app.get('/api/health/deep', async (req: Request, res: Response) => {
    const { getPoolStats, forceResetPool } = await import('./browserPool');
    const { getSchedulerHealth } = await import('./scheduler');
    
    const poolStats = getPoolStats();
    const schedulerHealth = getSchedulerHealth();
    
    const checks = {
        timestamp: new Date().toISOString(),
        server: 'ok',
        database: 'unknown' as string,
        scheduler: {
            healthy: schedulerHealth.healthy,
            lastSuccessfulCheck: new Date(schedulerHealth.lastSuccessfulCheck).toISOString(),
            errors: schedulerHealth.schedulerErrors
        },
        browserPool: {
            ...poolStats,
            status: poolStats.healthy ? 'ok' : 'degraded'
        }
    };

    // Check database connectivity
    try {
        await new Promise<void>((resolve, reject) => {
            db.get('SELECT 1', (err: Error | null) => {
                if (err) reject(err);
                else resolve();
            });
        });
        checks.database = 'ok';
    } catch (e: any) {
        checks.database = 'error';
    }

    // Determine overall health
    const isHealthy = 
        checks.database === 'ok' && 
        schedulerHealth.healthy && 
        poolStats.healthy;
    
    // If browser pool is unhealthy, try to recover
    if (!poolStats.healthy) {
        logWarn('api', 'Health check detected unhealthy browser pool, attempting recovery...');
        try {
            await forceResetPool();
        } catch (e) {
            // Recovery failed, but we'll report the status
        }
    }

    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        ...checks
    });
});

// AI Analyze Page endpoint (for browser extension and Editor auto-detect)
app.post('/api/ai/analyze-page', auth.authenticateToken, async (req: AuthRequest, res: Response) => {
    const { url, html, prompt } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    try {
        let htmlContent = html;
        
        // If HTML is not provided, fetch it server-side using Playwright
        if (!htmlContent) {
            console.log('[AI Analyze] Fetching HTML server-side for:', url);
            
            const browser = await chromium.launch({ 
                headless: true,
                args: ['--disable-blink-features=AutomationControlled']
            });
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
            const page = await context.newPage();
            
            try {
                // Use load event (don't wait for networkidle - it times out on YouTube embeds)
                await page.goto(url, { waitUntil: 'load', timeout: 30000 });
                
                // Wait for common price/content selectors to appear
                try {
                    await page.waitForSelector('[class*="price"], [class*="Price"], .product, .price, [data-price]', { 
                        timeout: 5000 
                    });
                } catch (e) {
                    // Selector not found, continue anyway
                }
                
                // Additional wait for any JS rendering
                await page.waitForTimeout(3000);
                htmlContent = await page.content();
                console.log('[AI Analyze] HTML captured, length:', htmlContent.length);
            } catch (e: any) {
                console.log('[AI Analyze] Navigation error:', e.message);
                try {
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await page.waitForTimeout(5000);
                    htmlContent = await page.content();
                } catch (e2: any) {
                    console.log('[AI Analyze] Fallback also failed:', e2.message);
                    htmlContent = '';
                }
            } finally {
                await browser.close();
            }
        }
        
        const result = await analyzePage(url, htmlContent, prompt);
        res.json({ message: 'success', data: result });
    } catch (e: any) {
        console.error('AI Analyze Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// AI Models endpoint
app.get('/api/ai/models', auth.authenticateToken, async (req: AuthRequest, res: Response) => {
    const { provider, apiKey, baseUrl } = req.query;
    
    try {
        const models = await getModels(
            provider as string || 'openai',
            apiKey as string | undefined,
            baseUrl as string | undefined
        );
        res.json({ message: 'success', data: models });
    } catch (e: any) {
        console.error('AI Models Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Serve static files
app.use('/static', express.static(getPublicPath()));

interface StatsRow {
    total_checks: number;
    errors: number;
    changes: number;
}

interface CountRow {
    count: number;
}

interface StatusHistoryRow {
    status: string;
    http_status: number | null;
    created_at: string;
}

interface SessionData {
    context: BrowserContext;
    lastAccess: number;
}

let globalBrowser: BrowserContext | null = null;
const sessionContexts = new Map<string, SessionData>();

// Cleanup interval
setInterval(async () => {
    const now = Date.now();
    for (const [id, session] of sessionContexts.entries()) {
        if (now - session.lastAccess > 10 * 60 * 1000) {
            console.log(`[Proxy] Cleaning up stale session ${id}`);
            try { await session.context.close(); } catch (e) { }
            sessionContexts.delete(id);
        }
    }
}, 60000);

// Analytics Endpoint
app.get('/api/stats', auth.authenticateToken, async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    const userLabel = await getUserLabel(userId);
    console.log(`[API] Stats requested by ${userLabel}`);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const queries = {
        totalMonitors: new Promise<number>((resolve, reject) => {
            db.get("SELECT COUNT(*) as count FROM monitors WHERE user_id = ?", [userId], (err: Error | null, row: CountRow) => {
                if (err) reject(err); else resolve(row.count);
            });
        }),
        activeMonitors: new Promise<number>((resolve, reject) => {
            db.get("SELECT COUNT(*) as count FROM monitors WHERE user_id = ? AND active = 1", [userId], (err: Error | null, row: CountRow) => {
                if (err) reject(err); else resolve(row.count);
            });
        }),
        stats24h: new Promise<StatsRow>((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_checks,
                    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
                    SUM(CASE WHEN status = 'changed' THEN 1 ELSE 0 END) as changes
                FROM check_history 
                JOIN monitors ON check_history.monitor_id = monitors.id
                WHERE monitors.user_id = ? AND check_history.created_at > ?
            `, [userId, oneDayAgo], (err: Error | null, row: StatsRow) => {
                if (err) reject(err); else resolve(row);
            });
        })
    };

    Promise.all([queries.totalMonitors, queries.activeMonitors, queries.stats24h])
        .then(([totalMonitors, activeMonitors, stats]) => {
            res.json({
                message: 'success',
                data: {
                    total_monitors: totalMonitors,
                    active_monitors: activeMonitors,
                    checks_24h: stats.total_checks || 0,
                    errors_24h: stats.errors || 0,
                    changes_24h: stats.changes || 0
                }
            });
        })
        .catch(err => {
            console.error("Stats Error:", err);
            res.status(500).json({ error: err.message });
        });
});

// Status endpoint (public)
app.get('/status', (req: Request, res: Response) => {
    db.all("SELECT id, name, url, active, last_check, last_change, type, tags FROM monitors WHERE active = 1 ORDER BY name ASC", [], async (err: Error | null, monitors: Monitor[]) => {
        if (err) {
            res.status(500).json({ "error": err.message });
            return;
        }

        const statusData = await Promise.all(monitors.map(async (m) => {
            return new Promise((resolve) => {
                db.get("SELECT status, http_status, created_at FROM check_history WHERE monitor_id = ? ORDER BY created_at DESC LIMIT 1", [m.id], (err: Error | null, row: StatusHistoryRow | undefined) => {
                    resolve({
                        id: m.id,
                        name: m.name || m.url,
                        url: m.url,
                        last_check: m.last_check,
                        last_change: m.last_change,
                        status: row ? row.status : 'unknown',
                        http_status: row ? row.http_status : null,
                        type: m.type,
                        tags: m.tags ? JSON.parse(m.tags) : []
                    });
                });
            });
        }));

        res.json({
            "message": "success",
            "data": statusData
        });
    });
});

// Get single monitor
app.get('/monitors/:id', (req: Request, res: Response) => {
    db.get('SELECT * FROM monitors WHERE id = ?', [req.params.id], (err: Error | null, row: Monitor | undefined) => {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }
        res.json({
            "message": "success",
            "data": row
        });
    });
});

// Delete history item
app.delete('/monitors/:id/history/:historyId', (req: Request, res: Response) => {
    const { id, historyId } = req.params;
    console.log(`Received DELETE request for monitor ${id}, history ${historyId}`);
    db.run("DELETE FROM check_history WHERE id = ? AND monitor_id = ?", [historyId, id], function (this: { changes: number }, err: Error | null) {
        if (err) {
            console.error("Delete error:", err);
            res.status(500).json({ error: err.message });
            return;
        }
        if (this.changes === 0) {
            console.warn(`No history item found with id ${historyId} for monitor ${id}`);
        }
        res.json({ message: "History item deleted", changes: this.changes });
    });
});

// Delete monitor (unprotected - legacy)
app.delete('/monitors/:id', (req: Request, res: Response) => {
    db.run(
        'DELETE FROM monitors WHERE id = ?',
        req.params.id,
        function (this: { changes: number }, err: Error | null) {
            if (err) {
                res.status(400).json({ "error": err.message });
                return;
            }
            res.json({ "message": "deleted", changes: this.changes });
        });
});

// Update monitor tags
app.patch('/monitors/:id/tags', (req: Request, res: Response) => {
    const { tags } = req.body;
    const tagsJson = JSON.stringify(tags || []);
    db.run(
        'UPDATE monitors SET tags = ? WHERE id = ?',
        [tagsJson, req.params.id],
        function (err: Error | null) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, tags: tags || [] });
        }
    );
});

// Update monitor keywords
app.patch('/monitors/:id/keywords', (req: Request, res: Response) => {
    const { keywords } = req.body;
    const keywordsJson = JSON.stringify(keywords || []);
    db.run(
        'UPDATE monitors SET keywords = ? WHERE id = ?',
        [keywordsJson, req.params.id],
        function (err: Error | null) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, keywords: keywords || [] });
        }
    );
});

// Manual check (unprotected - legacy)
app.post('/monitors/:id/check', (req: Request, res: Response) => {
    const { id } = req.params;
    console.log(`[API] Received Manual Check Request for Monitor ${id}`);
    db.get('SELECT * FROM monitors WHERE id = ?', [id], async (err: Error | null, monitor: Monitor | undefined) => {
        if (err || !monitor) {
            return res.status(404).json({ error: 'Monitor not found' });
        }
        try {
            await checkSingleMonitor(monitor);
            res.json({ message: 'Check completed' });
        } catch (e: any) {
            console.error("Check Error:", e);
            res.status(500).json({ error: e.message });
        }
    });
});

// Mark monitor as read
app.post('/monitors/:id/read', (req: Request, res: Response) => {
    const id = req.params.id;
    db.run("UPDATE monitors SET unread_count = 0 WHERE id = ?", [id], function (err: Error | null) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: "Monitor marked as read" });
    });
});

// Export monitor history as JSON
app.get('/monitors/:id/export/json', (req: Request, res: Response) => {
    const id = req.params.id;
    db.get("SELECT * FROM monitors WHERE id = ?", [id], (err: Error | null, monitor: Monitor | undefined) => {
        if (err || !monitor) {
            return res.status(404).json({ error: 'Monitor not found' });
        }
        db.all(
            "SELECT id, status, created_at, value, ai_summary FROM check_history WHERE monitor_id = ? ORDER BY created_at DESC",
            [id],
            (err: Error | null, history: CheckHistory[]) => {
                if (err) return res.status(500).json({ error: err.message });
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="monitor-${id}-export.json"`);
                res.json({
                    monitor: {
                        id: monitor.id,
                        name: monitor.name,
                        url: monitor.url,
                        type: monitor.type,
                        selector: monitor.selector,
                        interval: monitor.interval
                    },
                    history: history
                });
            }
        );
    });
});

// Export monitor history as CSV
app.get('/monitors/:id/export/csv', (req: Request, res: Response) => {
    const id = req.params.id;
    db.get("SELECT * FROM monitors WHERE id = ?", [id], (err: Error | null, monitor: Monitor | undefined) => {
        if (err || !monitor) {
            return res.status(404).json({ error: 'Monitor not found' });
        }
        db.all(
            "SELECT id, status, created_at, value, ai_summary FROM check_history WHERE monitor_id = ? ORDER BY created_at DESC",
            [id],
            (err: Error | null, history: CheckHistory[]) => {
                if (err) return res.status(500).json({ error: err.message });

                const escapeCSV = (str: string | null | undefined): string => {
                    if (!str) return '';
                    str = String(str);
                    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return '"' + str.replace(/"/g, '""') + '"';
                    }
                    return str;
                };

                let csv = 'Date,Status,Value,AI Summary\n';
                history.forEach(h => {
                    csv += `${escapeCSV(h.created_at)},${escapeCSV(h.status)},${escapeCSV(h.value)},${escapeCSV(h.ai_summary)}\n`;
                });

                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="monitor-${id}-export.csv"`);
                res.send(csv);
            }
        );
    });
});

// Preview scenario
app.post('/preview-scenario', async (req: Request, res: Response) => {
    const { url, scenario } = req.body;

    try {
        const settings = await new Promise<Settings>((resolve) => 
            db.get("SELECT * FROM settings WHERE id = 1", (err: Error | null, row: Settings) => resolve(row || {} as Settings))
        );

        let proxySettings = null;
        if (settings.proxy_enabled && settings.proxy_server) {
            proxySettings = {
                server: settings.proxy_server,
                auth: settings.proxy_auth
            };
        }

        const screenshot = await previewScenario(url, scenario, proxySettings);
        res.json({ message: 'success', screenshot: screenshot });
    } catch (e: any) {
        console.error("Preview scenario error:", e);
        res.status(500).json({ error: e.message });
    }
});

// Proxy endpoint
app.get('/proxy', async (req: Request, res: Response) => {
    const url = req.query.url as string | undefined;
    const session_id = req.query.session_id as string | undefined;

    if (!url) {
        return res.status(400).send('Missing URL parameter');
    }

    try {
        const launchBrowser = async (): Promise<BrowserContext> => {
            console.log("[Server] Launching Persistent Browser Profile...");
            const userDataDir = path.join(__dirname, 'chrome_user_data');
            if (!fs.existsSync(userDataDir)) {
                try { fs.mkdirSync(userDataDir); } catch (e) { }
            }

            const ctx = await chromium.launchPersistentContext(userDataDir, {
                headless: true,
                ignoreDefaultArgs: ['--enable-automation'],
                args: [
                    '--disable-gpu',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--mute-audio'
                ],
                viewport: { width: 1280, height: 800 },
                locale: 'nl-NL',
                timezoneId: 'Europe/Amsterdam',
                permissions: ['geolocation', 'notifications'],
                ignoreHTTPSErrors: true
            });

            await ctx.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });

            return ctx;
        };

        if (!globalBrowser) {
            globalBrowser = await launchBrowser();
        } else {
            try {
                globalBrowser.pages();
            } catch (e) {
                console.log("[Server] Browser context was closed, relaunching...");
                globalBrowser = await launchBrowser();
            }
        }

        const context = globalBrowser;

        if (session_id) {
            if (!sessionContexts.has(session_id)) {
                console.log(`[Proxy] New logical session ${session_id} on persistent profile`);
                sessionContexts.set(session_id, { context, lastAccess: Date.now() });
            } else {
                console.log(`[Proxy] Continuing session ${session_id}`);
                const session = sessionContexts.get(session_id)!;
                session.lastAccess = Date.now();
            }
        }

        const page = await context.newPage();

        page.on('console', (msg: ConsoleMessage) => {
            if (msg.type() === 'error' || msg.type() === 'warning') {
                console.log(`[Browser ${msg.type().toUpperCase()}] ${msg.text()}`);
            }
        });
        page.on('requestfailed', (request: PlaywrightRequest) => {
            if (request.url().includes('google') || request.url().includes('doubleclick')) return;
            console.log(`[Browser Network Error] ${request.url()} : ${request.failure()?.errorText}`);
        });

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            try {
                await page.waitForSelector('div[class*="fixed"][class*="inset-0"]', { state: 'detached', timeout: 10000 });
            } catch (waitErr) {
                console.log("Loader wait timeout or not found, proceeding...");
            }

            await page.waitForTimeout(1000);

            // Auto-dismiss cookie banners
            // First: Try to handle Sourcepoint/eBay consent iframes (used by Marktplaats, eBay, etc.)
            try {
                const consentFrame = page.frameLocator('iframe[title="SP Consent Message"], iframe[id^="sp_message_iframe_"]');
                const acceptButton = consentFrame.locator('button:has-text("Accepteren"), button:has-text("Accept"), button:has-text("Akkoord"), button[title="Accepteren"]');
                
                // Try clicking the accept button in the iframe with a short timeout
                await acceptButton.first().click({ timeout: 3000 });
                console.log('[Proxy] Dismissed Sourcepoint cookie banner in iframe');
                await page.waitForTimeout(500);
            } catch (e) {
                // Sourcepoint iframe not found or click failed, try generic selectors
                console.log('[Proxy] No Sourcepoint iframe found, trying generic selectors...');
                
                const cookieSelectors = [
                    'button[id*="accept"]',
                    'button[id*="Accept"]',
                    'button[class*="accept"]',
                    'button:has-text("Accepteren")',
                    'button:has-text("Akkoord")',
                    'button:has-text("Accept")',
                    '#gdpr-consent-accept-button',
                    'button[data-consent="accept"]',
                    'a:has-text("Doorgaan zonder")',
                ];

                for (const selector of cookieSelectors) {
                    try {
                        const button = await page.$(selector);
                        if (button) {
                            console.log(`[Proxy] Found cookie button: ${selector}`);
                            await button.click();
                            await page.waitForTimeout(500);
                            break;
                        }
                    } catch (err) {
                        // Selector didn't match or click failed, continue
                    }
                }
            }

            await page.waitForTimeout(500);

        } catch (e: any) {
            console.log("Navigation error (likely timeout), proceeding:", e.message);
        }

        const selectorScript = fs.readFileSync(getPublicPath('selector.js'), 'utf8');

        const injectScripts = async () => {
            await page.evaluate((scriptContent: string) => {
                const script = document.createElement('script');
                script.textContent = scriptContent;
                document.body.appendChild(script);

                if (!document.querySelector('base')) {
                    const base = document.createElement('base');
                    base.href = window.location.href;
                    document.head.prepend(base);
                }

                const existingViewport = document.querySelector('meta[name="viewport"]');
                if (existingViewport) existingViewport.remove();

                const meta = document.createElement('meta');
                meta.name = 'viewport';
                meta.content = 'width=device-width, initial-scale=1.0';
                document.head.prepend(meta);

                const style = document.createElement('style');
                style.innerHTML = 'html, body { min-height: 100%; width: 100%; margin: 0; padding: 0; overflow: auto !important; position: static !important; }';
                document.head.appendChild(style);
            }, selectorScript);
        };

        try {
            await injectScripts();
        } catch (e: any) {
            if (e.message.includes('Execution context was destroyed')) {
                console.log("Navigation detected during injection, waiting and retrying...");
                try {
                    await page.waitForLoadState('domcontentloaded');
                    await injectScripts();
                } catch (retryErr: any) {
                    console.error("Retry failed:", retryErr.message);
                }
            } else {
                throw e;
            }
        }

        const content = await page.content();
        
        // Set headers to allow iframe embedding
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.removeHeader('X-Frame-Options');
        res.setHeader('X-Frame-Options', 'ALLOWALL');
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        res.send(content);

    } catch (error: any) {
        console.error('Proxy Error:', error);
        res.status(500).send('Error fetching page: ' + error.message);
    }
});

// Server-Side Scenario Execution (VISIBLE)
app.post('/run-scenario-live', async (req: Request, res: Response) => {
    const { url, scenario } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'Missing URL' });
    }

    console.log(`[RunScenarioLive] Starting VISIBLE execution on ${url}`);

    let visibleContext: BrowserContext | null = null;
    try {
        if (globalBrowser) {
            console.log(`[RunScenarioLive] Closing headless browser to use persistent profile...`);
            try { await globalBrowser.close(); } catch (e) { }
            globalBrowser = null;
        }

        const userDataDir = path.join(__dirname, 'chrome_user_data');
        if (!fs.existsSync(userDataDir)) {
            try { fs.mkdirSync(userDataDir); } catch (e) { }
        }

        visibleContext = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--disable-gpu',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--start-maximized'
            ],
            viewport: { width: 1280, height: 900 },
            locale: 'nl-NL',
            timezoneId: 'Europe/Amsterdam',
            ignoreHTTPSErrors: true
        });

        await visibleContext.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        const page = await visibleContext.newPage();

        console.log(`[RunScenarioLive] Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        try {
            await page.waitForSelector('div[class*="fixed"][class*="inset-0"]', { state: 'detached', timeout: 5000 });
        } catch (e) { }

        await page.waitForTimeout(1000);

        if (scenario && Array.isArray(scenario) && scenario.length > 0) {
            console.log(`[RunScenarioLive] Executing ${scenario.length} steps...`);
            for (const step of scenario) {
                console.log(`[RunScenarioLive] Step: ${step.action} ${step.selector || ''} ${step.value || ''}`);
                try {
                    switch (step.action) {
                        case 'wait':
                            await page.waitForTimeout(parseInt(step.value) || 1000);
                            break;
                        case 'click':
                            if (step.selector) {
                                await page.waitForSelector(step.selector, { state: 'visible', timeout: 5000 });
                                await page.click(step.selector);
                            }
                            break;
                        case 'type':
                            if (step.selector) {
                                await page.waitForSelector(step.selector, { state: 'visible', timeout: 5000 });
                                await page.fill(step.selector, step.value || '');
                            }
                            break;
                        case 'wait_selector':
                            if (step.selector) {
                                await page.waitForSelector(step.selector, { state: 'visible', timeout: 10000 });
                            }
                            break;
                    }
                } catch (stepErr: any) {
                    console.error(`[RunScenarioLive] Step failed: ${stepErr.message}`);
                }
                await page.waitForTimeout(500);
            }
        }

        console.log(`[RunScenarioLive] Waiting for page to settle...`);
        await page.waitForTimeout(3000);

        const filename = `live-run-${Date.now()}.png`;
        const filepath = getPublicPath('screenshots', filename);
        await page.screenshot({ path: filepath, fullPage: true });

        console.log(`[RunScenarioLive] Done! Browser stays open for 5s...`);
        await page.waitForTimeout(5000);

        await visibleContext.close();
        visibleContext = null;

        console.log(`[RunScenarioLive] Completed. Screenshot: ${filename}`);
        res.json({ success: true, screenshot: filename });

    } catch (error: any) {
        console.error('[RunScenarioLive] Error:', error);
        if (visibleContext) {
            try { await visibleContext.close(); } catch (e) { }
        }
        res.status(500).json({ error: error.message });
    }
});

// Get all monitors (Protected)
app.get('/monitors', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const { tag } = req.query;
    let sql = "SELECT * FROM monitors WHERE user_id = ? ORDER BY created_at DESC";
    let params: any[] = [req.user?.userId];

    if (tag) {
        sql = "SELECT * FROM monitors WHERE user_id = ? AND tags LIKE ? ORDER BY created_at DESC";
        params = [req.user?.userId, `%"${tag}"%`];
    }

    db.all(sql, params, (err: Error | null, rows: Monitor[]) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        const monitors = rows;
        let pending = monitors.length;
        if (pending === 0) return res.json({ message: "success", data: [] });

        monitors.forEach(monitor => {
            db.all("SELECT * FROM check_history WHERE monitor_id = ? ORDER BY created_at DESC LIMIT 50", [monitor.id], (err: Error | null, history: CheckHistory[]) => {
                if (err) {
                    (monitor as any).history = [];
                } else {
                    (monitor as any).history = history;
                }
                pending--;
                if (pending === 0) {
                    res.json({ message: "success", data: monitors });
                }
            });
        });
    });
});

// ==================== GROUPS API ====================

// Get all groups for user
app.get('/groups', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    db.all("SELECT * FROM groups WHERE user_id = ? ORDER BY sort_order ASC, name ASC", [userId], (err: Error | null, rows: any[]) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'success', data: rows || [] });
    });
});

// Create a group
app.post('/groups', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const { name, color, icon } = req.body;
    const userId = req.user?.userId;

    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }

    db.run(
        `INSERT INTO groups (user_id, name, color, icon) VALUES (?, ?, ?, ?)`,
        [userId, name, color || '#6366f1', icon || 'folder'],
        function (this: { lastID: number }, err: Error | null) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'success', data: { id: this.lastID, name, color, icon } });
        }
    );
});

// Update a group
app.put('/groups/:id', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const { name, color, icon, sort_order } = req.body;
    const userId = req.user?.userId;
    const groupId = req.params.id;

    db.run(
        `UPDATE groups SET name = COALESCE(?, name), color = COALESCE(?, color), icon = COALESCE(?, icon), sort_order = COALESCE(?, sort_order) WHERE id = ? AND user_id = ?`,
        [name, color, icon, sort_order, groupId, userId],
        function (err: Error | null) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Group updated' });
        }
    );
});

// Delete a group
app.delete('/groups/:id', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    const groupId = req.params.id;

    // First, unassign all monitors from this group
    db.run("UPDATE monitors SET group_id = NULL WHERE group_id = ? AND user_id = ?", [groupId, userId], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        // Then delete the group
        db.run("DELETE FROM groups WHERE id = ? AND user_id = ?", [groupId, userId], function (err: Error | null) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Group deleted' });
        });
    });
});

// Reorder monitors (drag & drop)
app.patch('/monitors/reorder', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const { items } = req.body; // Array of { id, sort_order, group_id? }
    const userId = req.user?.userId;

    if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Items array is required' });
    }

    const stmt = db.prepare("UPDATE monitors SET sort_order = ?, group_id = ? WHERE id = ? AND user_id = ?");
    
    let errors = 0;
    items.forEach((item: { id: number; sort_order: number; group_id?: number | null }) => {
        stmt.run(item.sort_order, item.group_id ?? null, item.id, userId, (err: Error | null) => {
            if (err) errors++;
        });
    });
    
    stmt.finalize((err) => {
        if (err || errors > 0) {
            res.status(500).json({ error: 'Some items failed to update' });
        } else {
            res.json({ message: 'Order updated' });
        }
    });
});

// ==================== MONITORS API ====================

// Add a new monitor
app.post('/monitors', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const { url, selector, selector_text, interval, type, name, notify_config, ai_prompt, tags, keywords, ai_only_visual, group_id } = req.body;
    const userId = req.user?.userId;

    db.run(
        `INSERT INTO monitors (user_id, url, selector, selector_text, interval, type, name, notify_config, ai_prompt, tags, keywords, ai_only_visual, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, url, selector, selector_text || '', interval || '30m', type || 'text', name, JSON.stringify(notify_config), ai_prompt, JSON.stringify(tags), JSON.stringify(keywords), ai_only_visual ? 1 : 0, group_id || null],
        function (this: { lastID: number }, err: Error | null) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({
                message: "Monitor added",
                data: { id: this.lastID, ...req.body }
            });
        }
    );
});

// Update a monitor
app.put('/monitors/:id', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const { url, selector, selector_text, interval, type, name, active, notify_config, ai_prompt, scenario_config, tags, keywords, ai_only_visual, retry_count, retry_delay } = req.body;
    db.run(
        `UPDATE monitors SET url = COALESCE(?, url), selector = COALESCE(?, selector), selector_text = COALESCE(?, selector_text), interval = COALESCE(?, interval), type = COALESCE(?, type), name = COALESCE(?, name), active = COALESCE(?, active), notify_config = COALESCE(?, notify_config), ai_prompt = COALESCE(?, ai_prompt), scenario_config = COALESCE(?, scenario_config), tags = COALESCE(?, tags), keywords = COALESCE(?, keywords), ai_only_visual = COALESCE(?, ai_only_visual), retry_count = COALESCE(?, retry_count), retry_delay = COALESCE(?, retry_delay) WHERE id = ? AND user_id = ?`,
        [url, selector, selector_text, interval, type, name, active, notify_config ? JSON.stringify(notify_config) : null, ai_prompt, scenario_config, tags ? JSON.stringify(tags) : null, keywords ? JSON.stringify(keywords) : null, ai_only_visual, retry_count, retry_delay, req.params.id, req.user?.userId],
        function (err: Error | null) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: "Monitor updated" });
        }
    );
});

// Accept Suggested Selector
app.post('/monitors/:id/suggestion/accept', auth.authenticateToken, async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    const monitorId = req.params.id;
    const userLabel = await getUserLabel(userId);
    console.log(`[Suggestion Accept] ${userLabel} accepting suggestion for monitor ${monitorId}`);

    db.get('SELECT suggested_selector FROM monitors WHERE id = ? AND user_id = ?', [monitorId, userId], (err: Error | null, row: any) => {
        if (err) {
            console.error('[Suggestion Accept] DB Error:', err.message);
            return res.status(500).json({ error: 'Database error', details: err.message });
        }
        if (!row) {
            console.warn(`[Suggestion Accept] Monitor ${monitorId} not found for ${userLabel}`);
            return res.status(404).json({ error: 'Monitor not found or access denied' });
        }
        if (!row.suggested_selector) {
            console.warn(`[Suggestion Accept] No suggestion for monitor ${monitorId}`);
            return res.status(400).json({ error: 'No suggestion to accept' });
        }

        console.log(`[Suggestion Accept] Applying selector: ${row.suggested_selector}`);
        db.run(
            `UPDATE monitors SET selector = suggested_selector, suggested_selector = NULL, last_healed = ? WHERE id = ?`,
            [new Date().toISOString(), monitorId],
            (updateErr) => {
                if (updateErr) {
                    console.error('[Suggestion Accept] Update Error:', updateErr.message);
                    return res.status(500).json({ error: 'Update failed', details: updateErr.message });
                }
                console.log(`[Suggestion Accept] Success for monitor ${monitorId}`);
                res.json({ message: 'Suggestion accepted', success: true });
            }
        );
    });
});

// Reject Suggested Selector
app.post('/monitors/:id/suggestion/reject', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    const monitorId = req.params.id;

    db.run(
        `UPDATE monitors SET suggested_selector = NULL WHERE id = ? AND user_id = ?`,
        [monitorId, userId],
        (updateErr) => {
            if (updateErr) return res.status(500).send(updateErr.message);
            res.json({ message: 'Suggestion rejected' });
        }
    );
});

// Admin: Reset all cooldowns
app.post('/api/admin/reset-cooldowns', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    
    // Check if user is admin and get their email
    db.get('SELECT role, email FROM users WHERE id = ?', [userId], (err: Error | null, user: any) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        // Reset all cooldowns
        db.run('UPDATE monitors SET consecutive_failures = 0', [], (updateErr: Error | null) => {
            if (updateErr) {
                console.error('[Admin] Reset cooldowns failed:', updateErr.message);
                return res.status(500).json({ error: 'Failed to reset cooldowns' });
            }
            
            console.log(`[Admin] ${user.email} (ID: ${userId}) reset all cooldowns`);
            res.json({ success: true, message: 'All cooldowns have been reset' });
        });
    });
});

// Test a selector against a URL
app.post('/api/test-selector', auth.authenticateToken, async (req: AuthRequest, res: Response) => {
    const { url, selector } = req.body;
    
    if (!url || !selector) {
        return res.status(400).json({ success: false, error: 'URL and selector are required' });
    }

    let release: (() => Promise<void>) | null = null;
    let page = null;
    try {
        const { acquireBrowser } = await import('./browserPool');
        const browser = await acquireBrowser();
        release = browser.release;
        page = await browser.context.newPage();
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1000);
        
        // Try to dismiss cookie banners first
        try {
            const consentFrame = page.frameLocator('iframe[title="SP Consent Message"], iframe[id^="sp_message_iframe_"]');
            const acceptButton = consentFrame.locator('button:has-text("Accepteren"), button:has-text("Accept"), button:has-text("Akkoord")');
            await acceptButton.first().click({ timeout: 2000 });
            await page.waitForTimeout(500);
        } catch (e) {
            // No consent iframe, try generic buttons
            const cookieSelectors = [
                'button[id*="accept"]',
                'button:has-text("Accepteren")',
                'button:has-text("Accept")',
                '#gdpr-consent-accept-button',
            ];
            for (const cookieSelector of cookieSelectors) {
                try {
                    const button = await page.$(cookieSelector);
                    if (button) {
                        await button.click();
                        await page.waitForTimeout(500);
                        break;
                    }
                } catch (err) { /* ignore */ }
            }
        }
        
        // Test the selector
        const elements = await page.$$(selector);
        const count = elements.length;
        
        if (count === 0) {
            await page.close();
            if (release) await release();
            return res.json({ success: false, error: 'No elements match this selector' });
        }
        
        // Get text content from first element
        const text = await elements[0].textContent() || '';
        const cleanedText = text.trim().substring(0, 500); // Limit preview length
        
        await page.close();
        if (release) await release();
        
        res.json({ 
            success: true, 
            count, 
            text: cleanedText 
        });
        
    } catch (e: any) {
        console.error('[test-selector] Error:', e.message);
        try {
            if (page) await page.close();
            if (release) await release();
        } catch (cleanupErr) { /* ignore */ }
        res.status(500).json({ success: false, error: e.message });
    }
});

// Delete a monitor (Protected)
app.delete('/monitors/:id', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    db.run("DELETE FROM check_history WHERE monitor_id IN (SELECT id FROM monitors WHERE id = ? AND user_id = ?)", [req.params.id, req.user?.userId], function (err: Error | null) {
        if (!err) {
            db.run("DELETE FROM monitors WHERE id = ? AND user_id = ?", [req.params.id, req.user?.userId], function (err: Error | null) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                res.json({ message: "Monitor deleted" });
            });
        }
    });
});

// Auth endpoints
app.post('/api/auth/register', async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;
        const result = await auth.registerUser(email, password);
        res.json(result);
    } catch (e: any) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
    console.log('[Auth] Login attempt for:', req.body?.email);
    try {
        const { email, password } = req.body;
        const result = await auth.loginUser(email, password);
        console.log('[Auth] Login successful for:', email);
        res.json(result);
    } catch (e: any) {
        console.log('[Auth] Login failed for:', req.body?.email, '- Reason:', e.message);
        res.status(401).json({ error: e.message });
    }
});

app.post('/api/auth/verify', async (req: Request, res: Response) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    try {
        const email = await auth.verifyEmail(token);
        res.json({ message: 'Email verified successfully', email });
    } catch (e: any) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/auth/resend-verification', async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const result = await auth.resendVerification(email);
        if (result === 'already_verified') {
            res.status(400).json({ error: 'Email already verified' });
        } else {
            res.json({ message: 'Verification email sent' });
        }
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/auth/setup-status', async (req: Request, res: Response) => {
    const isComplete = await auth.isSetupComplete();
    res.json({ needs_setup: !isComplete });
});

// Admin Middleware
const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Access denied: Admin only' });
    }
};

// Admin: Get Users
app.get('/api/admin/users', auth.authenticateToken, requireAdmin, async (req: Request, res: Response) => {
    try {
        const users = await auth.getUsers();
        res.json({ message: 'success', data: users });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Admin: Delete User
app.delete('/api/admin/users/:id', auth.authenticateToken, requireAdmin, (req: Request, res: Response) => {
    auth.deleteUser(parseInt(req.params.id))
        .then(result => res.json({ message: 'success', data: result }))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.put('/api/admin/users/:id/block', auth.authenticateToken, requireAdmin, (req: Request, res: Response) => {
    const { blocked } = req.body;
    auth.toggleUserBlock(parseInt(req.params.id), blocked)
        .then(result => res.json({ message: 'success', data: result }))
        .catch(err => res.status(500).json({ error: err.message }));
});

// Logs API (Admin only)
app.get('/api/admin/logs', auth.authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const level = req.query.level as 'error' | 'warn' | 'info' | undefined;
        const source = req.query.source as 'scheduler' | 'api' | 'browser' | 'auth' | 'notification' | undefined;
        const monitorId = req.query.monitor_id ? parseInt(req.query.monitor_id as string) : undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

        const result = await getLogs({ level, source, monitorId, limit, offset });
        res.json({ message: 'success', data: result });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/logs/:id', auth.authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const deleted = await deleteLog(parseInt(req.params.id));
        res.json({ message: deleted ? 'success' : 'not found' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/logs', auth.authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const daysOld = req.query.days_old ? parseInt(req.query.days_old as string) : undefined;
        let deleted: number;
        
        if (daysOld !== undefined) {
            deleted = await cleanupLogs(daysOld);
        } else {
            deleted = await clearAllLogs();
        }
        
        res.json({ message: 'success', deleted });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auth/google', async (req: Request, res: Response) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    try {
        const result = await auth.verifyGoogleToken(token);
        res.json(result);
    } catch (e) {
        console.error("Google Auth Error:", e);
        res.status(401).json({ error: 'Google authentication failed' });
    }
});

// Trigger a manual check (Protected)
app.post('/monitors/:id/check', auth.authenticateToken, checkLimiter, async (req: AuthRequest, res: Response) => {
    db.get("SELECT * FROM monitors WHERE id = ? AND user_id = ?", [req.params.id, req.user?.userId], async (err: Error | null, monitor: Monitor | undefined) => {
        if (err || !monitor) return res.status(404).json({ error: "Monitor not found" });

        try {
            await checkSingleMonitor(monitor);
            res.json({ message: "Check initiated" });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });
});

// Settings
app.get('/settings', auth.authenticateToken, (req: Request, res: Response) => {
    db.get("SELECT * FROM settings WHERE id = 1", [], (err: Error | null, row: Settings | undefined) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: "success", data: row });
    });
});

app.put('/settings', auth.authenticateToken, (req: Request, res: Response) => {
    const {
        email_enabled, email_host, email_port, email_secure, email_user, email_pass, email_to, email_from,
        push_enabled, push_type, push_key1, push_key2,
        ai_enabled, ai_provider, ai_api_key, ai_model, ai_base_url,
        proxy_enabled, proxy_server, proxy_auth,
        webhook_enabled, webhook_url
    } = req.body;

    db.run(
        `UPDATE settings SET 
        email_enabled = ?, email_host = ?, email_port = ?, email_secure = ?, email_user = ?, email_pass = ?, email_to = ?, email_from = ?,
        push_enabled = ?, push_type = ?, push_key1 = ?, push_key2 = ?,
        ai_enabled = ?, ai_provider = ?, ai_api_key = ?, ai_model = ?, ai_base_url = ?,
        proxy_enabled = ?, proxy_server = ?, proxy_auth = ?,
        webhook_enabled = ?, webhook_url = ?
        WHERE id = 1`,
        [
            email_enabled, email_host, email_port, email_secure, email_user, email_pass, email_to, email_from,
            push_enabled, push_type, push_key1, push_key2,
            ai_enabled, ai_provider, ai_api_key, ai_model, ai_base_url,
            proxy_enabled, proxy_server, proxy_auth,
            webhook_enabled, webhook_url
        ],
        function (err: Error | null) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: "Settings updated" });
        }
    );
});

// Test notification
app.post('/test-notification', auth.authenticateToken, async (req: Request, res: Response) => {
    const { type } = req.body;
    try {
        await sendNotification(
            'Test Notification',
            'This is a test notification from DeltaWatch.',
            '<h2>Test Notification</h2><p>This is an <strong>HTML</strong> test notification from <a href="#">DeltaWatch</a>.</p>',
            { type }
        );
        res.json({ message: 'success' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Export/Import
app.get('/api/export', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    db.all("SELECT * FROM monitors WHERE user_id = ?", [req.user?.userId], (err: Error | null, rows: Monitor[]) => {
        if (err) return res.status(500).json({ error: err.message });
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="monitors.json"');
        res.send(JSON.stringify(rows, null, 2));
    });
});

app.post('/api/import', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const monitors = req.body;
    if (!Array.isArray(monitors)) {
        return res.status(400).json({ error: 'Invalid data format. Expected an array of monitors.' });
    }

    let importedCount = 0;
    let errorCount = 0;
    const userId = req.user?.userId;

    interface ImportMonitor {
        url: string;
        selector: string;
        selector_text?: string;
        interval?: string;
        type?: string;
        name?: string;
    }

    const insertMonitor = (monitor: ImportMonitor): Promise<void> => {
        return new Promise((resolve) => {
            const { url, selector, selector_text, interval, type, name } = monitor;
            db.get("SELECT id FROM monitors WHERE url = ? AND selector = ? AND user_id = ?", [url, selector, userId], (err: Error | null, row: { id: number } | undefined) => {
                if (err) {
                    errorCount++;
                    resolve();
                } else if (row) {
                    resolve();
                } else {
                    db.run(
                        "INSERT INTO monitors (user_id, url, selector, selector_text, interval, type, name) VALUES (?,?,?,?,?,?,?)",
                        [userId, url, selector, selector_text, interval, type || 'text', name || ''],
                        (err: Error | null) => {
                            if (!err) importedCount++;
                            else errorCount++;
                            resolve();
                        }
                    );
                }
            });
        });
    };

    Promise.all(monitors.map(insertMonitor)).then(() => {
        res.json({ message: 'success', imported: importedCount, errors: errorCount });
    });
});

// Serve static files from React app
app.use(express.static(path.join(__dirname, '../client/dist')));

// Catchall handler
app.get(/.*/, (req: Request, res: Response) => {
    if (fs.existsSync(path.join(__dirname, '../client/dist/index.html'))) {
        res.sendFile(path.join(__dirname, '../client/dist/index.html'));
    } else {
        res.status(404).send('Client not built or in development mode. Use Vite dev server.');
    }
});

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startScheduler();
});

// Graceful Shutdown
async function gracefulShutdown(signal: string): Promise<void> {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    logInfo('api', `Graceful shutdown initiated by ${signal}`);
    
    // Stop accepting new connections
    server.close(() => {
        console.log('HTTP server closed');
    });
    
    // Shutdown browser pool
    try {
        const { shutdownPool } = await import('./browserPool');
        await shutdownPool();
        console.log('Browser pool shut down');
    } catch (e: any) {
        console.error('Error shutting down browser pool:', e.message);
    }
    
    // Close database connection
    try {
        await new Promise<void>((resolve, reject) => {
            db.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('Database connection closed');
    } catch (e: any) {
        console.error('Error closing database:', e.message);
    }
    
    console.log('Graceful shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
