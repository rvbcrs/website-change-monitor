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

// Serve static files (like the selector script)
app.use('/static', express.static(path.join(__dirname, 'public')));

const db = require('./db');
const { summarizeChange, getModels, analyzePage } = require('./ai');

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

app.get('/monitors', (req, res) => {
    db.all("SELECT * FROM monitors ORDER BY created_at DESC", [], async (err, monitors) => {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }

        // Fetch history for each monitor
        const monitorsWithHistory = await Promise.all(monitors.map(async (monitor) => {
            return new Promise((resolve, reject) => {
                db.all(
                    "SELECT id, status, created_at, value, screenshot_path, prev_screenshot_path, diff_screenshot_path, ai_summary, http_status FROM check_history WHERE monitor_id = ? ORDER BY created_at DESC LIMIT 20",
                    [monitor.id],
                    (err, history) => {
                        if (err) resolve({ ...monitor, history: [] }); // Fail gracefully
                        else resolve({ ...monitor, history: history.reverse() }); // Reverse to show oldest -> newest
                    }
                );
            });
        }));

        res.json({
            "message": "success",
            "data": monitorsWithHistory
        })
    });
});

app.post('/monitors', (req, res) => {
    const { url, selector, selector_text, interval, type, name, notify_config } = req.body;
    if (!url || !interval) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    // For visual type, selector might be empty or default
    const finalSelector = selector || (type === 'visual' ? 'body' : '');

    if (type !== 'visual' && !finalSelector) {
        return res.status(400).json({ error: 'Missing selector for text monitor' });
    }

    const sql = 'INSERT INTO monitors (url, selector, selector_text, interval, type, name, notify_config, ai_prompt, ai_only_visual) VALUES (?,?,?,?,?,?,?,?,?)';
    const params = [url, finalSelector, selector_text, interval, type || 'text', name || '', notify_config ? JSON.stringify(notify_config) : null, req.body.ai_prompt || null, req.body.ai_only_visual || 0];

    db.run(sql, params, function (err, result) {
        if (err) {
            res.status(400).json({ "error": err.message })
            return;
        }
        const newMonitorId = this.lastID;

        // Trigger initial check asynchronously
        db.get('SELECT * FROM monitors WHERE id = ?', [newMonitorId], async (err, monitor) => {
            if (!err && monitor) {
                console.log(`[Auto-Check] Triggering initial check for new monitor ${newMonitorId}`);
                try {
                    await checkSingleMonitor(monitor);
                } catch (e) {
                    console.error(`[Auto-Check] Initial check failed:`, e.message);
                }
            }
        });

        res.json({
            "message": "success",
            "data": { id: newMonitorId, ...req.body },
            "id": newMonitorId
        })
    });
});

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

app.put('/monitors/:id', (req, res) => {
    const { url, selector, selector_text, interval, last_value, type, name, notify_config, ai_prompt, ai_only_visual } = req.body;
    db.run(
        `UPDATE monitors set 
           url = COALESCE(?, url), 
           selector = COALESCE(?, selector), 
           selector_text = COALESCE(?, selector_text), 
           interval = COALESCE(?, interval),
           last_value = COALESCE(?, last_value),
           type = COALESCE(?, type),
           name = COALESCE(?, name),
           notify_config = COALESCE(?, notify_config),
           ai_prompt = COALESCE(?, ai_prompt),
           ai_only_visual = COALESCE(?, ai_only_visual)
           WHERE id = ?`,
        [url, selector, selector_text, interval, last_value, type, name, notify_config ? JSON.stringify(notify_config) : null, ai_prompt, ai_only_visual, req.params.id],
        function (err, result) {
            if (err) {
                res.status(400).json({ "error": res.message })
                return;
            }
            res.json({
                message: "success",
                data: req.body,
                changes: this.changes
            })
        });
});

app.patch('/monitors/:id/status', (req, res) => {
    const { active } = req.body;
    db.run(
        'UPDATE monitors SET active = ? WHERE id = ?',
        [active ? 1 : 0, req.params.id],
        function (err) {
            if (err) {
                res.status(400).json({ "error": err.message })
                return;
            }
            res.json({
                message: "success",
                changes: this.changes
            })
        });
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

// ... existing code ...
app.get('/settings', (req, res) => {
    db.get("SELECT * FROM settings WHERE id = 1", (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'success', data: row });
    });
});

// API to update settings
app.put('/settings', (req, res) => {
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
        (err) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'success' });
        }
    );
});

// Test notification endpoint
app.post('/test-notification', async (req, res) => {
    const { sendNotification } = require('./notifications');
    try {
        await sendNotification(
            'Test Notification',
            'This is a test notification from your Website Change Monitor.',
            '<h2>Test Notification</h2><p>This is a <strong>HTML</strong> test notification from your <a href="#">Website Change Monitor</a>.</p>'
        );
        res.json({ message: 'success' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Export monitors
app.get('/data/export', (req, res) => {
    db.all("SELECT * FROM monitors", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="monitors.json"');
        res.send(JSON.stringify(rows, null, 2));
    });
});

app.post('/api/models', async (req, res) => {
    const { provider, apiKey, baseUrl } = req.body;
    try {
        const models = await getModels(provider, apiKey, baseUrl);
        res.json({ message: 'success', data: models });
    } catch (e) {
        console.error("Model fetch error:", e);
        res.status(500).json({ error: e.message });
    }
});

// Include analyzePage logic endpoint
app.post('/api/ai/analyze-page', async (req, res) => {
    const { url, prompt, html } = req.body;
    console.log(`[AI Analyze] Request for ${url}`);

    try {
        let pageHtml = html;

        if (!pageHtml) {
            // Re-use logic to fetch if no HTML provided
            const settings = await new Promise((resolve) => db.get("SELECT * FROM settings WHERE id = 1", (err, row) => resolve(row || {})));

            let proxySettings = null;
            if (settings.proxy_enabled && settings.proxy_server) {
                proxySettings = {
                    server: settings.proxy_server,
                    auth: settings.proxy_auth
                };
            }

            const browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                proxy: proxySettings
            });

            const page = await browser.newPage();
            if (proxySettings && proxySettings.auth) {
                await page.authenticate({
                    username: proxySettings.auth.split(':')[0],
                    password: proxySettings.auth.split(':')[1]
                });
            }

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000); // Wait for dynamic content

            pageHtml = await page.content();
            await browser.close();
        } else {
            console.log("[AI Analyze] Using provided HTML content (Extension mode)");
        }

        // Call AI
        const result = await analyzePage(pageHtml, url, prompt);

        if (!result) {
            return res.status(500).json({ error: "AI could not identify content" });
        }

        res.json({ message: "success", data: result });

    } catch (e) {
        console.error("AI Analyze Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// Import monitors
app.post('/data/import', (req, res) => {
    const monitors = req.body;
    if (!Array.isArray(monitors)) {
        return res.status(400).json({ error: 'Invalid data format. Expected an array of monitors.' });
    }

    let importedCount = 0;
    let errorCount = 0;

    const insertMonitor = (monitor) => {
        return new Promise((resolve) => {
            const { url, selector, selector_text, interval, type, name } = monitor;
            // Check if exists based on URL and Selector combination
            db.get("SELECT id FROM monitors WHERE url = ? AND selector = ?", [url, selector], (err, row) => {
                if (err) {
                    errorCount++;
                    resolve();
                } else if (row) {
                    // Already exists, skip
                    resolve();
                } else {
                    db.run(
                        "INSERT INTO monitors (url, selector, selector_text, interval, type, name) VALUES (?,?,?,?,?,?)",
                        [url, selector, selector_text, interval, type || 'text', name || ''],
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
    // Check if we are in development mode (where dist might not exist)
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
