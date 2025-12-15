import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { chromium } from 'playwright-extra';
import type { BrowserContext } from 'playwright-core';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import db from './db';
import * as auth from './auth';
import { summarizeChange, getModels, analyzePage } from './ai';
import { startScheduler, checkSingleMonitor, previewScenario, executeScenario } from './scheduler';
import { sendNotification } from './notifications';
import type { Monitor, Settings, CheckHistory, AuthRequest } from './types';

chromium.use(stealth());

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Global Request Logger
app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    next();
});

// Health Check
app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', message: 'Server is reachable' });
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
app.use('/static', express.static(path.join(__dirname, 'public')));

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
app.get('/api/stats', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    console.log('[API] Stats requested by user:', req.user?.userId);
    const userId = req.user?.userId;
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

        page.on('console', msg => {
            if (msg.type() === 'error' || msg.type() === 'warning') {
                console.log(`[Browser ${msg.type().toUpperCase()}] ${msg.text()}`);
            }
        });
        page.on('requestfailed', request => {
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

        } catch (e: any) {
            console.log("Navigation error (likely timeout), proceeding:", e.message);
        }

        const selectorScript = fs.readFileSync(path.join(__dirname, 'public', 'selector.js'), 'utf8');

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
        const filepath = path.join(__dirname, 'public', 'screenshots', filename);
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

// Add a new monitor
app.post('/monitors', auth.authenticateToken, (req: AuthRequest, res: Response) => {
    const { url, selector, selector_text, interval, type, name, notify_config, ai_prompt, tags, keywords, ai_only_visual } = req.body;
    const userId = req.user?.userId;

    db.run(
        `INSERT INTO monitors (user_id, url, selector, selector_text, interval, type, name, notify_config, ai_prompt, tags, keywords, ai_only_visual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, url, selector, selector_text || '', interval || '30m', type || 'text', name, JSON.stringify(notify_config), ai_prompt, JSON.stringify(tags), JSON.stringify(keywords), ai_only_visual ? 1 : 0],
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
    const { selector, selector_text, interval, type, name, active, notify_config, ai_prompt, scenario_config, tags, keywords, ai_only_visual } = req.body;
    db.run(
        `UPDATE monitors SET selector = COALESCE(?, selector), selector_text = COALESCE(?, selector_text), interval = COALESCE(?, interval), type = COALESCE(?, type), name = COALESCE(?, name), active = COALESCE(?, active), notify_config = COALESCE(?, notify_config), ai_prompt = COALESCE(?, ai_prompt), scenario_config = COALESCE(?, scenario_config), tags = COALESCE(?, tags), keywords = COALESCE(?, keywords), ai_only_visual = COALESCE(?, ai_only_visual) WHERE id = ? AND user_id = ?`,
        [selector, selector_text, interval, type, name, active, notify_config ? JSON.stringify(notify_config) : null, ai_prompt, scenario_config, tags ? JSON.stringify(tags) : null, keywords ? JSON.stringify(keywords) : null, ai_only_visual, req.params.id, req.user?.userId],
        function (err: Error | null) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: "Monitor updated" });
        }
    );
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
    try {
        const { email, password } = req.body;
        const result = await auth.loginUser(email, password);
        res.json(result);
    } catch (e: any) {
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
app.post('/monitors/:id/check', auth.authenticateToken, async (req: AuthRequest, res: Response) => {
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startScheduler();
});
