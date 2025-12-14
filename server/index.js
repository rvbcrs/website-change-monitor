const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Global Request Logger
app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    next();
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is reachable' });
});

// Serve static files (like the selector script)
app.use('/static', express.static(path.join(__dirname, 'public')));

const db = require('./db');
const auth = require('./auth');
const { summarizeChange, getModels, analyzePage } = require('./ai');

// Analytics Endpoint (Moved here to have access to auth/db)
app.get('/api/stats', auth.authenticateToken, (req, res) => {
    console.log('[API] Stats requested by user:', req.user.id);
    const userId = req.user.id;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const queries = {
        totalMonitors: new Promise((resolve, reject) => {
            db.get("SELECT COUNT(*) as count FROM monitors WHERE user_id = ?", [userId], (err, row) => {
                if (err) reject(err); else resolve(row.count);
            });
        }),
        activeMonitors: new Promise((resolve, reject) => {
            db.get("SELECT COUNT(*) as count FROM monitors WHERE user_id = ? AND active = 1", [userId], (err, row) => {
                if (err) reject(err); else resolve(row.count);
            });
        }),
        stats24h: new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_checks,
                    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
                    SUM(CASE WHEN status = 'changed' THEN 1 ELSE 0 END) as changes
                FROM check_history 
                JOIN monitors ON check_history.monitor_id = monitors.id
                WHERE monitors.user_id = ? AND check_history.created_at > ?
            `, [userId, oneDayAgo], (err, row) => {
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

let globalBrowser = null;
const sessionContexts = new Map(); // sessionId -> { context, lastAccess }

// Cleanup interval (every minute)
setInterval(async () => {
    const now = Date.now();
    for (const [id, session] of sessionContexts.entries()) {
        if (now - session.lastAccess > 10 * 60 * 1000) { // 10 min timeout
            console.log(`[Proxy] Cleaning up stale session ${id}`);
            try { await session.context.close(); } catch (e) { }
            sessionContexts.delete(id);
        }
    }
}, 60000);

// Serve static files (like the selector script)
app.use('/static', express.static(path.join(__dirname, 'public')));



app.get('/status', (req, res) => {
    db.all("SELECT id, name, url, active, last_check, last_change, type, tags FROM monitors WHERE active = 1 ORDER BY name ASC", [], async (err, monitors) => {
        if (err) {
            res.status(500).json({ "error": err.message });
            return;
        }

        // Fetch latest status/history for each to determine "UP/DOWN" roughly
        const statusData = await Promise.all(monitors.map(async (m) => {
            return new Promise((resolve) => {
                // Get the very last check
                db.get("SELECT status, http_status, created_at FROM check_history WHERE monitor_id = ? ORDER BY created_at DESC LIMIT 1", [m.id], (err, row) => {
                    resolve({
                        id: m.id,
                        name: m.name || m.url, // Fallback to URL if no name
                        url: m.url,
                        last_check: m.last_check,
                        last_change: m.last_change,
                        status: row ? row.status : 'unknown', // 'changed', 'unchanged', 'error'
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

app.get('/monitors/:id', (req, res) => {
    db.get('SELECT * FROM monitors WHERE id = ?', [req.params.id], (err, row) => {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }
        res.json({
            "message": "success",
            "data": row
        })
    });
});

// Delete history item
app.delete('/monitors/:id/history/:historyId', (req, res) => {
    const { id, historyId } = req.params;
    console.log(`Received DELETE request for monitor ${id}, history ${historyId}`);
    db.run("DELETE FROM check_history WHERE id = ? AND monitor_id = ?", [historyId, id], function (err) {
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

app.delete('/monitors/:id', (req, res) => {
    db.run(
        'DELETE FROM monitors WHERE id = ?',
        req.params.id,
        function (err, result) {
            if (err) {
                res.status(400).json({ "error": res.message })
                return;
            }
            res.json({ "message": "deleted", changes: this.changes })
        });
});

// Update monitor tags
app.patch('/monitors/:id/tags', (req, res) => {
    const { tags } = req.body; // Array of tag strings
    const tagsJson = JSON.stringify(tags || []);
    db.run(
        'UPDATE monitors SET tags = ? WHERE id = ?',
        [tagsJson, req.params.id],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, tags: tags || [] });
        }
    );
});

// Update monitor keywords
app.patch('/monitors/:id/keywords', (req, res) => {
    const { keywords } = req.body; // Array of {text: string, mode: 'appears'|'disappears'|'any'}
    const keywordsJson = JSON.stringify(keywords || []);
    db.run(
        'UPDATE monitors SET keywords = ? WHERE id = ?',
        [keywordsJson, req.params.id],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, keywords: keywords || [] });
        }
    );
});

app.post('/monitors/:id/check', (req, res) => {
    const { id } = req.params;
    console.log(`[API] Received Manual Check Request for Monitor ${id}`);
    db.get('SELECT * FROM monitors WHERE id = ?', [id], async (err, monitor) => {
        if (err || !monitor) {
            return res.status(404).json({ error: 'Monitor not found' });
        }
        try {
            await checkSingleMonitor(monitor);
            res.json({ message: 'Check completed' });
        } catch (e) {
            console.error("Check Error:", e);
            res.status(500).json({ error: e.message });
        }
    });
});

// Mark monitor as read (reset unread count)
app.post('/monitors/:id/read', (req, res) => {
    const id = req.params.id;
    db.run("UPDATE monitors SET unread_count = 0 WHERE id = ?", [id], function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: "Monitor marked as read" });
    });
});

// Export monitor history as JSON
app.get('/monitors/:id/export/json', (req, res) => {
    const id = req.params.id;
    db.get("SELECT * FROM monitors WHERE id = ?", [id], (err, monitor) => {
        if (err || !monitor) {
            return res.status(404).json({ error: 'Monitor not found' });
        }
        db.all(
            "SELECT id, status, created_at, value, ai_summary FROM check_history WHERE monitor_id = ? ORDER BY created_at DESC",
            [id],
            (err, history) => {
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
app.get('/monitors/:id/export/csv', (req, res) => {
    const id = req.params.id;
    db.get("SELECT * FROM monitors WHERE id = ?", [id], (err, monitor) => {
        if (err || !monitor) {
            return res.status(404).json({ error: 'Monitor not found' });
        }
        db.all(
            "SELECT id, status, created_at, value, ai_summary FROM check_history WHERE monitor_id = ? ORDER BY created_at DESC",
            [id],
            (err, history) => {
                if (err) return res.status(500).json({ error: err.message });

                // Build CSV
                const escapeCSV = (str) => {
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

// Endpoint for previewing scenario
app.post('/preview-scenario', async (req, res) => {
    const { url, scenario, proxy_enabled } = req.body;

    try {
        // Fetch settings for proxy
        const settings = await new Promise((resolve) => db.get("SELECT * FROM settings WHERE id = 1", (err, row) => resolve(row || {})));

        let proxySettings = null;
        if (settings.proxy_enabled && settings.proxy_server) {
            proxySettings = {
                server: settings.proxy_server,
                auth: settings.proxy_auth
            };
        }

        const screenshot = await previewScenario(url, scenario, proxySettings);
        res.json({ message: 'success', screenshot: screenshot });
    } catch (e) {
        console.error("Preview scenario error:", e);
        res.status(500).json({ error: e.message });
    }
});




app.get('/proxy', async (req, res) => {
    const { url, session_id } = req.query;

    if (!url) {
        return res.status(400).send('Missing URL parameter');
    }

    try {
        // Helper to launch persistent context
        const launchBrowser = async () => {
            console.log("[Server] Launching Persistent Browser Profile...");
            const userDataDir = path.join(__dirname, 'chrome_user_data');
            if (!fs.existsSync(userDataDir)) {
                try { fs.mkdirSync(userDataDir); } catch (e) { }
            }

            const ctx = await chromium.launchPersistentContext(userDataDir, {
                headless: true, // Invisible
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

        // Check if browser is still alive, relaunch if needed
        if (!globalBrowser) {
            globalBrowser = await launchBrowser();
        } else {
            // Test if context is still connected by trying to get pages
            try {
                globalBrowser.pages(); // Throws if closed
            } catch (e) {
                console.log("[Server] Browser context was closed, relaunching...");
                globalBrowser = await launchBrowser();
            }
        }

        // Use the global persistent context
        const context = globalBrowser;

        // Session tracking (logical only now)
        if (session_id) {
            if (!sessionContexts.has(session_id)) {
                console.log(`[Proxy] New logical session ${session_id} on persistent profile`);
                sessionContexts.set(session_id, { context, lastAccess: Date.now() });
            } else {
                console.log(`[Proxy] Continuing session ${session_id}`);
                sessionContexts.get(session_id).lastAccess = Date.now();
            }
        }

        const page = await context.newPage();

        // Debug Logging
        page.on('console', msg => {
            if (msg.type() === 'error' || msg.type() === 'warning') {
                console.log(`[Browser ${msg.type().toUpperCase()}] ${msg.text()}`);
            }
        });
        page.on('requestfailed', request => {
            // Filter out junk
            if (request.url().includes('google') || request.url().includes('doubleclick')) return;
            console.log(`[Browser Network Error] ${request.url()} : ${request.failure()?.errorText}`);
        });

        // Navigate to the target URL
        // Using 'networkidle' is better for SPAs with loaders, but might timeout on chatty sites.
        // We'll try networkidle first, falling back to domcontentloaded if needed? 
        // Or just use networkidle with a reasonable timeout.
        try {
            // 'domcontentloaded' is fast.
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Smart Wait: Try to wait for the full-screen loader to disappear.
            // Heuristic: Looking for a fixed overlay that covers the screen.
            try {
                // Wait up to 10s for any fixed inset-0 overlay to DETACH (be removed/hidden).
                // This targets the specific loader structure we saw: <div class="fixed inset-0 ...">
                // If it doesn't exist or doesn't detach, we proceed (timeout).
                await page.waitForSelector('div[class*="fixed"][class*="inset-0"]', { state: 'detached', timeout: 10000 });
            } catch (waitErr) {
                console.log("Loader wait timeout or not found, proceeding...");
            }

            // Aggressive Cleanup: Remove any high z-index overlays that might block the view
            /* 
            try {
                await page.evaluate(() => {
                    const clean = () => {
                        console.log("Running aggressive overlay cleanup...");
                        const elements = document.querySelectorAll('body > div, body > section, body > aside');
                        elements.forEach(el => {
                            const style = window.getComputedStyle(el);
                            if ((style.position === 'fixed' || style.position === 'absolute') && parseInt(style.zIndex, 10) > 50) {
                                // Check if it covers the center
                                const rect = el.getBoundingClientRect();
                                const centerX = window.innerWidth / 2;
                                const centerY = window.innerHeight / 2;
                                if (rect.left <= centerX && rect.right >= centerX && rect.top <= centerY && rect.bottom >= centerY) {
                                    // Make sure it's not the breadcrumbs or our selector UI (which shouldn't be loaded yet/or has specific class)
                                    if (!el.classList.contains('wachet-breadcrumbs')) {
                                        console.log('Removing blocking overlay:', el);
                                        el.remove();
                                    }
                                }
                            }
                        });
                        // Also target specific common spinner classes
                        const spinners = document.querySelectorAll('[class*="spinner"], [class*="loader"], [class*="loading"], [id*="onetrust"], [class*="overlay"]');
                        spinners.forEach(el => {
                            const style = window.getComputedStyle(el);
                            if (style.position === 'fixed' || parseInt(style.zIndex, 10) > 50) {
                                el.remove();
                            }
                        });

                        // Force unlock scrolling in case the site locked it for the modal
                        document.documentElement.style.setProperty('overflow', 'auto', 'important');
                        document.body.style.setProperty('overflow', 'auto', 'important');
                        document.documentElement.style.setProperty('position', 'static', 'important');
                        document.body.style.setProperty('position', 'static', 'important');
                    };
                    clean();
                    setTimeout(clean, 500); // Check again lightly
                });
            } catch (e) {
                console.log("Cleanup warning:", e.message);
            }
            */

            // Just a small safety buffer for animations to finish
            await page.waitForTimeout(1000);

        } catch (e) {
            console.log("Navigation error (likely timeout), proceeding:", e.message);
        }

        // Base tag injection to fix relative links
        // We'll also inject our custom script.
        const selectorScript = fs.readFileSync(path.join(__dirname, 'public', 'selector.js'), 'utf8');

        // Helper to inject scripts
        const injectScripts = async () => {
            await page.evaluate((scriptContent) => {
                // Create script element
                const script = document.createElement('script');
                script.textContent = scriptContent;
                document.body.appendChild(script);

                // Add base tag if not present
                if (!document.querySelector('base')) {
                    const base = document.createElement('base');
                    base.href = window.location.href;
                    document.head.prepend(base);
                }

                // Force viewport for responsiveness
                const existingViewport = document.querySelector('meta[name="viewport"]');
                if (existingViewport) existingViewport.remove();

                const meta = document.createElement('meta');
                meta.name = 'viewport';
                meta.content = 'width=device-width, initial-scale=1.0';
                document.head.prepend(meta);

                // Force full height to prevent cutoff inside the iframe
                const style = document.createElement('style');
                style.innerHTML = 'html, body { min-height: 100%; width: 100%; margin: 0; padding: 0; overflow: auto !important; position: static !important; }';
                document.head.appendChild(style);

                // NOTE: We used to strip scripts here to ensure a static snapshot.
                // However, users need scripts to interact with cookie banners etc.
                // We now rely on iframe sandbox to prevent navigation/malicious actions.
                // 
                // PREVIOUSLY REMOVED: All other script tags.

                // PREVIOUSLY REMOVED: Known overlays. 
                // We now let the user manually close them via "Interact Mode".

                // Specific fallback for the user's site structure found in debug
                /*
                const root = document.getElementById('root');
                if (root && root.firstElementChild && root.firstElementChild.classList.contains('fixed') && root.firstElementChild.classList.contains('inset-0')) {
                    root.firstElementChild.remove();
                }
                */

            }, selectorScript);
        };

        try {
            await injectScripts();
        } catch (e) {
            if (e.message.includes('Execution context was destroyed')) {
                console.log("Navigation detected during injection, waiting and retrying...");
                try {
                    await page.waitForLoadState('domcontentloaded');
                    await injectScripts();
                } catch (retryErr) {
                    console.error("Retry failed:", retryErr.message);
                }
            } else {
                throw e;
            }
        }

        let content = await page.content();

        // Cleanup handled by session manager


        // Security headers might prevent iframe usage?
        // We might need to strip X-Frame-Options if we were proxying the raw request, 
        // but since we are sending HTML content, it's mostly fine locally.
        // However, fetching resources (images/css) from the original domain might run into CORS or hotlinking protection.
        // For now, let's see how much breaks.

        res.send(content);

    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).send('Error fetching page: ' + error.message);
    }
});

const { startScheduler, checkSingleMonitor, previewScenario, executeScenario } = require('./scheduler');
const { sendNotification } = require('./notifications');

// Server-Side Scenario Execution Endpoint (VISIBLE + Persistent Profile)
app.post('/run-scenario-live', async (req, res) => {
    const { url, scenario } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'Missing URL' });
    }

    console.log(`[RunScenarioLive] Starting VISIBLE execution on ${url}`);

    let visibleContext = null;
    try {
        // Close existing headless browser to release UserData lock
        if (globalBrowser) {
            console.log(`[RunScenarioLive] Closing headless browser to use persistent profile...`);
            try { await globalBrowser.close(); } catch (e) { }
            globalBrowser = null;
        }

        // Launch persistent context with VISIBLE mode (shares cookies!)
        const userDataDir = path.join(__dirname, 'chrome_user_data');
        if (!fs.existsSync(userDataDir)) {
            try { fs.mkdirSync(userDataDir); } catch (e) { }
        }

        visibleContext = await chromium.launchPersistentContext(userDataDir, {
            headless: false, // VISIBLE!
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

        // Navigate to URL
        console.log(`[RunScenarioLive] Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for loader to disappear
        try {
            await page.waitForSelector('div[class*="fixed"][class*="inset-0"]', { state: 'detached', timeout: 5000 });
        } catch (e) { /* Proceed */ }

        // Small pause so user sees the loaded page
        await page.waitForTimeout(1000);

        // Execute scenario steps ONE BY ONE with pauses
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
                } catch (stepErr) {
                    console.error(`[RunScenarioLive] Step failed: ${stepErr.message}`);
                }
                // Brief pause between steps so user can follow
                await page.waitForTimeout(500);
            }
        }

        // Wait for final page state to settle (login redirect etc)
        console.log(`[RunScenarioLive] Waiting for page to settle...`);
        await page.waitForTimeout(3000);

        // Take screenshot
        const filename = `live-run-${Date.now()}.png`;
        const filepath = path.join(__dirname, 'public', 'screenshots', filename);
        await page.screenshot({ path: filepath, fullPage: true });

        // Keep browser open for 5 seconds so user can inspect result
        console.log(`[RunScenarioLive] Done! Browser stays open for 5s...`);
        await page.waitForTimeout(5000);

        // Close visible context (releases lock, next /proxy will relaunch headless)
        await visibleContext.close();
        visibleContext = null;

        console.log(`[RunScenarioLive] Completed. Screenshot: ${filename}`);
        res.json({ success: true, screenshot: filename });

    } catch (error) {
        console.error('[RunScenarioLive] Error:', error);
        if (visibleContext) {
            try { await visibleContext.close(); } catch (e) { }
        }
        res.status(500).json({ error: error.message });
    }
});

// Get all monitors (Scoped to User)
app.get('/monitors', auth.authenticateToken, (req, res) => {
    const { tag } = req.query;
    let sql = "SELECT * FROM monitors WHERE user_id = ?";
    let params = [req.user.id];

    if (tag) {
        sql += " AND (tags LIKE ? OR tags LIKE ? OR tags LIKE ?)";
        params.push(`%"${tag}"%`, `%, "${tag}"%`, `%"${tag}",%`); // JSON array matching is tricky in SQLite text
        // Improved JSON tag search or simple text search?
        // Using a simpler TEXT match for now as implemented before
        sql = "SELECT * FROM monitors WHERE user_id = ? AND tags LIKE ?";
        params = [req.user.id, `%"${tag}"%`];
    }

    // Also support getting ALL if admin? No, stick to tenancy.
    // Wait, users might have 0 monitors initially.

    db.all(sql, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        // Attach history to each monitor (limit 50 recent?)
        // This is expensive N+1.
        // Optimally we'd do a join or fetch history separately.
        // Current implementation fetches without history?
        // Checking previous implementation...
        // Previous fetch was: "SELECT * FROM monitors" -> then map to attach history

        const monitors = rows;
        let pending = monitors.length;
        if (pending === 0) return res.json({ message: "success", data: [] });

        monitors.forEach(monitor => {
            db.all("SELECT * FROM check_history WHERE monitor_id = ? ORDER BY created_at DESC LIMIT 50", [monitor.id], (err, history) => {
                if (err) {
                    monitor.history = [];
                } else {
                    monitor.history = history;
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
app.post('/monitors', auth.authenticateToken, (req, res) => {
    // ... existing validation ...
    const { url, selector, interval, type, name, notify_config, ai_prompt, tags, keywords, ai_only_visual } = req.body;
    const userId = req.user.id;

    db.run(
        `INSERT INTO monitors (user_id, url, selector, interval, type, name, notify_config, ai_prompt, tags, keywords, ai_only_visual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, url, selector, interval || '30m', type || 'text', name, JSON.stringify(notify_config), ai_prompt, JSON.stringify(tags), JSON.stringify(keywords), ai_only_visual ? 1 : 0],
        function (err) {
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
app.put('/monitors/:id', auth.authenticateToken, (req, res) => {
    const { selector, interval, type, name, active, notify_config, ai_prompt, scenario_config, tags, keywords, ai_only_visual } = req.body;
    db.run(
        `UPDATE monitors SET selector = COALESCE(?, selector), interval = COALESCE(?, interval), type = COALESCE(?, type), name = COALESCE(?, name), active = COALESCE(?, active), notify_config = COALESCE(?, notify_config), ai_prompt = COALESCE(?, ai_prompt), scenario_config = COALESCE(?, scenario_config), tags = COALESCE(?, tags), keywords = COALESCE(?, keywords), ai_only_visual = COALESCE(?, ai_only_visual) WHERE id = ? AND user_id = ?`,
        [selector, interval, type, name, active, notify_config ? JSON.stringify(notify_config) : null, ai_prompt, scenario_config, tags ? JSON.stringify(tags) : null, keywords ? JSON.stringify(keywords) : null, ai_only_visual, req.params.id, req.user.id],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: "Monitor updated" });
        }
    );
});

// Delete a monitor
app.delete('/monitors/:id', auth.authenticateToken, (req, res) => {
    // Check ownership first or just DELETE WHERE
    db.run("DELETE FROM check_history WHERE monitor_id IN (SELECT id FROM monitors WHERE id = ? AND user_id = ?)", [req.params.id, req.user.id], function (err) {
        if (!err) {
            db.run("DELETE FROM monitors WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], function (err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                res.json({ message: "Monitor deleted" });
            });
        }
    });
});

// Email Verification
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await auth.registerUser(email, password);
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await auth.loginUser(email, password);
        res.json(result);
    } catch (e) {
        res.status(401).json({ error: e.message });
    }
});

app.post('/api/auth/verify', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    try {
        const email = await auth.verifyEmail(token);
        res.json({ message: 'Email verified successfully', email });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/api/auth/resend-verification', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const result = await auth.resendVerification(email);
        if (result === 'already_verified') {
            res.status(400).json({ error: 'Email already verified' });
        } else {
            res.json({ message: 'Verification email sent' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Check setup status
app.get('/api/auth/setup-status', async (req, res) => {
    const isComplete = await auth.isSetupComplete();
    res.json({ needs_setup: !isComplete });
});

// Admin Middleware
const requireAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Access denied: Admin only' });
    }
};

// Admin: Get Users
app.get('/api/admin/users', auth.authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await auth.getUsers();
        res.json({ message: 'success', data: users });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin: Delete User
app.delete('/api/admin/users/:id', auth.authenticateToken, requireAdmin, (req, res) => {
    auth.deleteUser(req.params.id)
        .then(result => res.json({ message: 'success', data: result }))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.put('/api/admin/users/:id/block', auth.authenticateToken, requireAdmin, (req, res) => {
    const { blocked } = req.body;
    auth.toggleUserBlock(req.params.id, blocked)
        .then(result => res.json({ message: 'success', data: result }))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/auth/google', async (req, res) => {
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

// Trigger a manual check
app.post('/monitors/:id/check', auth.authenticateToken, async (req, res) => {
    // Verify ownership
    db.get("SELECT * FROM monitors WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], async (err, monitor) => {
        if (err || !monitor) return res.status(404).json({ error: "Monitor not found" });

        try {
            await checkSingleMonitor(monitor);
            res.json({ message: "Check initiated" });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});



// Settings (Protected - Maybe Admin only? For now allow all users to read/update global?)
// Assuming Multi-User means Users manage THEIR monitors, but System Config is ADMIN.
// But we didn't implement Admin role check middleware yet.
// Let's just protect it so only logged in users can see it.
app.get('/settings', auth.authenticateToken, (req, res) => {
    db.get("SELECT * FROM settings WHERE id = 1", [], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: "success", data: row });
    });
});

app.put('/settings', auth.authenticateToken, (req, res) => {
    // Allow update
    const {
        email_enabled, email_host, email_port, email_secure, email_user, email_pass, email_to,
        push_enabled, push_type, push_key1, push_key2,
        ai_enabled, ai_provider, ai_api_key, ai_model, ai_base_url,
        proxy_enabled, proxy_server, proxy_auth,
        webhook_enabled, webhook_url
    } = req.body;

    db.run(
        `UPDATE settings SET 
        email_enabled = ?, email_host = ?, email_port = ?, email_secure = ?, email_user = ?, email_pass = ?, email_to = ?,
        push_enabled = ?, push_type = ?, push_key1 = ?, push_key2 = ?,
        ai_enabled = ?, ai_provider = ?, ai_api_key = ?, ai_model = ?, ai_base_url = ?,
        proxy_enabled = ?, proxy_server = ?, proxy_auth = ?,
        webhook_enabled = ?, webhook_url = ?
        WHERE id = 1`,
        [
            email_enabled, email_host, email_port, email_secure, email_user, email_pass, email_to,
            push_enabled, push_type, push_key1, push_key2,
            ai_enabled, ai_provider, ai_api_key, ai_model, ai_base_url,
            proxy_enabled, proxy_server, proxy_auth,
            webhook_enabled, webhook_url
        ],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: "Settings updated" });
        }
    );
});

// Test notification endpoint
// Test notification endpoint
app.post('/test-notification', async (req, res) => {
    const { sendNotification } = require('./notifications');
    const { type } = req.body; // 'email' or 'push' or undefined
    try {
        await sendNotification(
            'Test Notification',
            'This is a test notification from your Website Change Monitor.',
            '<h2>Test Notification</h2><p>This is a <strong>HTML</strong> test notification from your <a href="#">Website Change Monitor</a>.</p>',
            { type } // Pass options object
        );
        res.json({ message: 'success' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Export/Import (Protected)
app.get('/api/export', auth.authenticateToken, (req, res) => {
    db.all("SELECT * FROM monitors WHERE user_id = ?", [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="monitors.json"');
        res.send(JSON.stringify(rows, null, 2));
    });
});

app.post('/api/import', auth.authenticateToken, (req, res) => {
    const monitors = req.body;
    if (!Array.isArray(monitors)) {
        return res.status(400).json({ error: 'Invalid data format. Expected an array of monitors.' });
    }

    let importedCount = 0;
    let errorCount = 0;
    const userId = req.user.id;

    const insertMonitor = (monitor) => {
        return new Promise((resolve) => {
            const { url, selector, selector_text, interval, type, name } = monitor;
            // Check if exists based on URL and Selector AND User
            db.get("SELECT id FROM monitors WHERE url = ? AND selector = ? AND user_id = ?", [url, selector, userId], (err, row) => {
                if (err) {
                    errorCount++;
                    resolve();
                } else if (row) {
                    // Already exists, skip
                    resolve();
                } else {
                    db.run(
                        "INSERT INTO monitors (user_id, url, selector, selector_text, interval, type, name) VALUES (?,?,?,?,?,?,?)",
                        [userId, url, selector, selector_text, interval, type || 'text', name || ''],
                        (err) => {
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

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../client/dist')));




// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get(/.*/, (req, res) => {
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
