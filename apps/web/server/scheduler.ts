import cron from 'node-cron';
import { chromium } from 'playwright-extra';
import type { BrowserContext, Page, Browser } from 'playwright-core';
import stealth from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import * as Diff from 'diff';
import { cleanValue } from '@deltawatch/shared';
import { PNG } from 'pngjs';
import pLimit from 'p-limit';
import db from './db';
import { sendNotification } from './notifications';
import { summarizeChange, summarizeVisualChange, findSelector } from './ai';
import { logError, logWarn, logInfo } from './logger';
import type { Monitor, Settings, Keyword } from './types';

chromium.use(stealth());

// Helper to resolve public folder path (works in both dev and Docker/production)
const getPublicPath = (...subpaths: string[]): string => {
    const directPath = path.join(__dirname, 'public', ...subpaths);
    if (fs.existsSync(directPath)) return directPath;
    return path.join(__dirname, '..', 'public', ...subpaths);
};

interface LaunchOptions {
    headless: boolean;
    proxy?: {
        server: string;
        username?: string;
        password?: string;
    };
}

interface ScenarioStep {
    action: string;
    selector?: string;
    value?: string;
}

interface NotifyConfig {
    method?: string;
    threshold?: string;
}

interface ProxySettings {
    server?: string;
    username?: string;
    password?: string;
    auth?: string;
}

const INTERVAL_MINUTES: Record<string, number> = {
    '1m': 1,
    '5m': 5,
    '30m': 30,
    '1h': 60,
    '8h': 480,
    '24h': 1440,
    '1w': 10080
};

// Failure tracking constants
const MAX_CONSECUTIVE_FAILURES = 5;  // After 5 failures, put monitor in cooldown
const BASE_COOLDOWN_MINUTES = 60;    // Base cooldown: 60 minutes after max failures
const MAX_COOLDOWN_MINUTES = 480;    // Max cooldown: 8 hours
const OVERALL_CHECK_TIMEOUT = 45000; // 45 seconds max per monitor check (reduced from 60s)
const CONCURRENT_CHECK_LIMIT = 2;    // Max 2 monitors checking at same time

// Concurrency limiter for sequential processing
const checkLimit = pLimit(CONCURRENT_CHECK_LIMIT);

// Track scheduler health
let lastSuccessfulCheck = Date.now();
let schedulerErrors = 0;

export function getSchedulerHealth() {
    return {
        lastSuccessfulCheck,
        schedulerErrors,
        healthy: (Date.now() - lastSuccessfulCheck) < 5 * 60 * 1000 // Healthy if checked in last 5 mins
    };
}

/**
 * Retry wrapper with exponential backoff for network operations
 */
async function withRetry<T>(
    fn: () => Promise<T>,
    options: {
        maxRetries?: number;
        baseDelay?: number;
        monitorId?: number;
        operation?: string;
    } = {}
): Promise<T> {
    const { maxRetries = 3, baseDelay = 1000, monitorId, operation = 'operation' } = options;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            const isRetryable = 
                error.message?.includes('net::') ||
                error.message?.includes('timeout') ||
                error.message?.includes('ECONNREFUSED') ||
                error.message?.includes('ECONNRESET') ||
                error.message?.includes('ETIMEDOUT') ||
                error.message?.includes('Navigation failed');
            
            if (!isRetryable || attempt === maxRetries) {
                logError('scheduler', `${operation} failed after ${attempt} attempt(s): ${error.message}`, error.stack, monitorId);
                throw error;
            }
            
            const delay = baseDelay * Math.pow(2, attempt - 1);
            logWarn('scheduler', `${operation} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms: ${error.message}`, monitorId);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw new Error('Max retries exceeded');
}

async function checkMonitors(): Promise<void> {
    console.log('Running monitor check...');
    db.all("SELECT * FROM monitors WHERE active = 1", [], async (err: Error | null, monitors: Monitor[]) => {
        if (err) {
            logError('scheduler', `Database error fetching monitors: ${err.message}`);
            return;
        }

        const now = new Date();
        const dueMonitors = monitors.filter(m => {
            // Check if monitor is in cooldown due to consecutive failures
            const consecutiveFailures = (m as any).consecutive_failures || 0;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && m.last_check) {
                // Exponential backoff: double cooldown for each failure above threshold
                const failureMultiplier = Math.min(Math.pow(2, consecutiveFailures - MAX_CONSECUTIVE_FAILURES), MAX_COOLDOWN_MINUTES / BASE_COOLDOWN_MINUTES);
                const actualCooldown = Math.min(BASE_COOLDOWN_MINUTES * failureMultiplier, MAX_COOLDOWN_MINUTES);
                const cooldownEnd = new Date(new Date(m.last_check).getTime() + actualCooldown * 60000);
                if (now < cooldownEnd) {
                    const minsRemaining = Math.ceil((cooldownEnd.getTime() - now.getTime()) / 60000);
                    console.log(`[${m.name || m.id}] Skipping - in cooldown (${consecutiveFailures} failures, ${minsRemaining}m remaining)`);
                    return false;
                }
                // Cooldown expired, try again
                console.log(`[${m.name || m.id}] Cooldown expired after ${actualCooldown}m, retrying...`);
            }
            
            // Check if it's time for the next check
            if (!m.last_check) return true;
            const lastCheck = new Date(m.last_check);
            const intervalMins = INTERVAL_MINUTES[m.interval] || 60;
            const nextCheck = new Date(lastCheck.getTime() + intervalMins * 60000);
            return now >= nextCheck;
        });

        console.log(`Found ${dueMonitors.length} monitors due for check.`);

        if (dueMonitors.length === 0) return;

        // Use browser pool for efficient resource management
        const { acquireBrowser } = await import('./browserPool');
        
        let pooledContext: { context: BrowserContext; release: () => Promise<void> } | null = null;
        
        try {
            pooledContext = await acquireBrowser();
            
            // Process monitors with concurrency limit to prevent event loop blocking
            const checkPromises = dueMonitors.map(monitor => 
                checkLimit(async () => {
                    // Yield to event loop between checks
                    await new Promise(resolve => setImmediate(resolve));
                    
                    // Wrap each check in an overall timeout to prevent indefinite blocking
                    try {
                        await Promise.race([
                            checkSingleMonitor(monitor, pooledContext!.context),
                            new Promise<void>((_, reject) => 
                                setTimeout(() => reject(new Error('Overall check timeout exceeded')), OVERALL_CHECK_TIMEOUT)
                            )
                        ]);
                        lastSuccessfulCheck = Date.now();
                    } catch (timeoutErr: any) {
                        console.error(`[${monitor.name || monitor.id}] ${timeoutErr.message}`);
                        schedulerErrors++;
                        // Increment failure count for timeout
                        db.run("UPDATE monitors SET consecutive_failures = consecutive_failures + 1, last_check = ? WHERE id = ?", 
                            [new Date().toISOString(), monitor.id]);
                    }
                })
            );
            
            // Wait for all checks to complete (still respecting concurrency limit)
            await Promise.all(checkPromises);
            
        } catch (e: any) {
            logError('scheduler', `Browser pool error: ${e.message}`, e.stack);
            schedulerErrors++;
        } finally {
            if (pooledContext) {
                try {
                    await pooledContext.release();
                } catch (releaseErr) {
                    // Ignore release errors - browser may already be closed
                }
            }
        }
    });
}

async function checkSingleMonitor(monitor: Monitor, context: BrowserContext | null = null): Promise<void> {
    const monitorName = monitor.name || `Monitor ${monitor.id}`;
    console.log(`[${monitorName}] Checking: ${monitor.url}`);

    let pooledContext: { context: BrowserContext; release: () => Promise<void> } | null = null;
    let page: Page | undefined;
    
    // Acquire browser from pool if not provided
    if (!context) {
        try {
            const { acquireBrowser } = await import('./browserPool');
            pooledContext = await acquireBrowser();
            context = pooledContext.context;
        } catch (e: any) {
            console.error("Browser Pool Error:", e.message);
            db.run(`INSERT INTO check_history (monitor_id, status, response_time, created_at, value) VALUES (?, ?, ?, ?, ?)`, [monitor.id, 'error', 0, new Date().toISOString(), `Browser Error: ${e.message}`]);
            return;
        }
    }

    let httpStatus: number | null = null;
    let screenshotPath: string = '';
    
    try {
        page = await context.newPage();

        let response;
        response = await withRetry(
            async () => {
                try {
                    const resp = await page!.goto(monitor.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    await page!.waitForTimeout(2000);
                    try {
                        await page!.waitForLoadState('networkidle', { timeout: 5000 });
                    } catch (e) {
                        // networkidle is optional, ignore failure
                    }
                    return resp;
                } catch (e) {
                    console.log(`[${monitorName}] domcontentloaded failed, trying commit (least strict)`);
                    const resp = await page!.goto(monitor.url, { waitUntil: 'commit', timeout: 20000 });
                    await page!.waitForTimeout(5000); // Wait longer for hydration if we only got commit
                    return resp;
                }
            },
            { 
                maxRetries: 2, 
                baseDelay: 1000, 
                monitorId: monitor.id, 
                operation: `Navigation to ${monitor.url}` 
            }
        );
        httpStatus = response ? response.status() : null;
        const pageTitle = await page.title();

        try {
            await page.waitForSelector('div[class*="fixed"][class*="inset-0"]', { state: 'detached', timeout: 10000 });
        } catch (waitErr) {
            // Loader wait timeout or not found
        }

        // Scenario Execution
        if (monitor.scenario_config) {
            try {
                const scenario = typeof monitor.scenario_config === 'string' ? JSON.parse(monitor.scenario_config) : monitor.scenario_config;
                await executeScenario(page, scenario);
            } catch (jsonErr) {
                console.error("Error parsing/executing scenario_config:", jsonErr);
            }
        }

        // Wait for selector
        if (monitor.selector && monitor.type === 'text') {
            try {
                await page.waitForSelector(monitor.selector, { state: 'visible', timeout: 5000 });
            } catch (e) {
                try {
                    await page.waitForSelector(monitor.selector, { state: 'attached', timeout: 3000 });
                    await page.evaluate((sel: string) => {
                        const el = document.querySelector(sel);
                        if (el) {
                            el.scrollIntoView({ behavior: 'instant', block: 'center' });
                        }
                    }, monitor.selector);
                    await page.waitForTimeout(1000);
                } catch (e2) {
                    console.log(`[${monitorName}] Element not found: ${monitor.selector}. Attempting Self-Healing...`);

                    // Check browser/page health before attempting self-healing
                    try {
                        if (page.isClosed()) {
                            console.log(`[${monitorName}] Page closed, skipping self-healing`);
                            throw new Error('Page closed during check');
                        }
                        
                        const htmlSnapshot = await Promise.race([
                            page.evaluate(() => {
                                const clone = document.body.cloneNode(true) as HTMLElement;
                                const toRemove = clone.querySelectorAll('script, style, svg, noscript, iframe, link, meta');
                                toRemove.forEach(el => el.remove());
                                return clone.outerHTML;
                            }),
                            new Promise<string>((_, reject) => 
                                setTimeout(() => reject(new Error('HTML snapshot timeout')), 10000)
                            )
                        ]);

                        const newSelector = await findSelector(htmlSnapshot, monitor.selector, monitor.last_value || '', monitor.ai_prompt || null);

                        if (newSelector) {
                            console.log(`[${monitorName}] 🩹 AI Healed Selector: "${newSelector}"`);

                            // Check page still alive
                            if (page.isClosed()) {
                                console.log(`[${monitorName}] Page closed during healing, aborting`);
                                throw new Error('Page closed during healing');
                            }
                            
                            const verified = await page.$(newSelector);
                            if (verified) {
                                console.log(`[${monitorName}] Verified new selector works. Updating DB...`);

                                db.run(`UPDATE monitors SET selector = ?, last_healed = ? WHERE id = ?`, [newSelector, new Date().toISOString(), monitor.id]);

                                monitor.selector = newSelector;

                                await page.waitForSelector(monitor.selector, { state: 'attached', timeout: 5000 });

                                sendNotification(
                                    `🩹 Monitor Repaired: ${monitorName}`,
                                    `The selector was broken but AI fixed it.\nOld: ${monitor.selector}\nNew: ${newSelector}`,
                                    null, null, null
                                );
                            } else {
                                console.log(`[${monitorName}] AI suggested "${newSelector}" but it was not found on page.`);
                            }
                        }
                    } catch (healErr: any) {
                        // Check if it's a browser/page closed error - don't log as full error
                        if (healErr.message?.includes('closed') || healErr.message?.includes('Target')) {
                            console.log(`[${monitorName}] Self-Healing skipped: browser/page closed`);
                        } else {
                            console.error(`[${monitorName}] Self-Healing Failed:`, healErr.message);
                        }
                    }
                }
            }
        }

        // Remove overlays
        await page.evaluate(() => {
            const overlays = document.querySelectorAll('div[class*="fixed"][class*="inset-0"], div[style*="position: fixed"][style*="mk-upper-overlay"]');
            overlays.forEach(overlay => {
                const style = window.getComputedStyle(overlay);
                if (parseInt(style.zIndex) > 10 || overlay.className.includes('z-50')) {
                    overlay.remove();
                }
            });
            const root = document.getElementById('root');
            if (root && root.firstElementChild && root.firstElementChild.classList.contains('fixed') && root.firstElementChild.classList.contains('inset-0')) {
                root.firstElementChild.remove();
            }
        });

        await page.waitForTimeout(3000);

        // Extract content
        let text: string | null = null;
        if (monitor.selector) {
            for (let attempt = 1; attempt <= 3; attempt++) {
                text = await page.evaluate((selector: string) => {
                    try {
                        const el = document.querySelector(selector);
                        return el ? (el as HTMLElement).innerText : null;
                    } catch (e) { return null; }
                }, monitor.selector);

                if (text) {
                    text = cleanValue(text);
                }

                if (text && text.trim().length > 0) break;
                if (attempt === 3) break;

                console.log(`[${monitorName}] Attempt ${attempt}: Text empty, retrying in 2s...`);
                await page.waitForTimeout(2000);
            }

            if (text === null) {
                console.warn(`[${monitorName}] Element not found after 3 attempts`);
            } else {
                const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;
                console.log(`[${monitorName}] Extracted value (${text.length} chars): "${preview}"`);
            }
        }

        const nowStr = new Date().toISOString();
        let changed = false;
        let status = 'unchanged';

        screenshotPath = getPublicPath('screenshots', `monitor-${monitor.id}-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        let visualChange = false;
        let diffFilename: string | null = null;
        let aiSummary: string | null = null;

        // AI-Only Visual Detection
        if (monitor.ai_only_visual && monitor.type === 'visual') {
            console.log(`[${monitorName}] Using AI-only visual detection`);
            if (monitor.last_screenshot && fs.existsSync(monitor.last_screenshot)) {
                const aiPrompt = monitor.ai_prompt || null;
                aiSummary = await summarizeVisualChange(monitor.last_screenshot, screenshotPath, aiPrompt);

                if (aiSummary && !aiSummary.toLowerCase().includes('no significant') && !aiSummary.startsWith('⚠️')) {
                    visualChange = true;
                    console.log(`[${monitorName}] AI detected visual change`);

                    try {
                        const { default: pixelmatch } = await import('pixelmatch');
                        const img1 = PNG.sync.read(fs.readFileSync(monitor.last_screenshot));
                        const img2 = PNG.sync.read(fs.readFileSync(screenshotPath));
                        const { width, height } = img1;
                        const diff = new PNG({ width, height });
                        pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
                        diffFilename = `diff-${monitor.id}-${Date.now()}.png`;
                        const diffPath = getPublicPath('screenshots', diffFilename);
                        fs.writeFileSync(diffPath, PNG.sync.write(diff));
                    } catch (e) {
                        // Diff image generation failed
                    }
                }
            }
        } else if (monitor.last_screenshot && fs.existsSync(monitor.last_screenshot)) {
            // Standard pixel-diff
            try {
                const { default: pixelmatch } = await import('pixelmatch');
                const img1 = PNG.sync.read(fs.readFileSync(monitor.last_screenshot));
                const img2 = PNG.sync.read(fs.readFileSync(screenshotPath));
                const { width, height } = img1;
                const diff = new PNG({ width, height });

                const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
                if (numDiffPixels > 0) {
                    visualChange = true;
                    diffFilename = `diff-${monitor.id}-${Date.now()}.png`;
                    const diffPath = getPublicPath('screenshots', diffFilename);
                    fs.writeFileSync(diffPath, PNG.sync.write(diff));
                }
            } catch (e: any) {
                console.error(`[${monitorName}] Error comparing screenshots:`, e);
            }
        }

        // AI-Only Text Detection
        let textChange = text !== monitor.last_value;
        if (monitor.ai_only_visual && monitor.type !== 'visual' && textChange && monitor.last_value) {
            console.log(`[${monitorName}] Using AI-only text detection`);
            const aiPrompt = monitor.ai_prompt || null;
            aiSummary = await summarizeChange(monitor.last_value, text);

            if (aiSummary && (aiSummary.toLowerCase().includes('no significant') ||
                aiSummary.toLowerCase().includes('no meaningful') ||
                aiSummary.toLowerCase().includes('no notable') ||
                aiSummary.toLowerCase().includes('remain the same') ||
                aiSummary.toLowerCase().includes('unchanged'))) {
                console.log(`[${monitorName}] AI determined no significant text change`);
                textChange = false;
            } else if (aiSummary && !aiSummary.startsWith('⚠️')) {
                console.log(`[${monitorName}] AI detected meaningful text change`);
            }
        }

        if (textChange || visualChange) {
            let changeMsg = "";
            if (textChange) changeMsg += "Text Content Changed. ";
            if (visualChange) changeMsg += "Visual Appearance Changed. ";

            const isFirstRun = !monitor.last_check;

            if (!isFirstRun) {
                changed = true;
                status = 'changed';

                console.log(`[${monitorName}] Change detected`);

                let diffHtml = '';
                let diffText = '';

                if (text !== monitor.last_value) {
                    const diffResult = Diff.diffWordsWithSpace(monitor.last_value || '', text || '');

                    diffHtml = '<div style="font-family: monospace; background: #f6f8fa; padding: 10px; border-radius: 5px; border: 1px solid #eaecef; white-space: pre-wrap; line-height: 1.5;">';

                    diffResult.forEach(part => {
                        const isChange = part.added || part.removed;
                        
                        // Heuristic: If it's context (unchanged) and very long, truncate the middle
                        let value = part.value;
                        if (!isChange && value.length > 200) {
                            value = value.substring(0, 80) + ' ... ' + value.substring(value.length - 80);
                        }

                        const color = part.added ? '#e6ffec' :
                            part.removed ? '#ffebe9' : 'transparent';
                        const textColor = part.added ? '#1a7f37' :
                            part.removed ? '#cf222e' : '#57606a';
                        const fontWeight = isChange ? 'bold' : 'normal';
                        const textDecoration = part.removed ? 'line-through' : 'none';

                        diffHtml += `<span style="background-color: ${color}; color: ${textColor}; font-weight: ${fontWeight}; text-decoration: ${textDecoration};">${value}</span>`;

                        // Accumulate plaintext diff
                        if (isChange) {
                            const prefix = part.added ? '+ ' : '- ';
                            // Simplify plaintext diff for words - maybe just show the words?
                            // Or keep the line-based text diff for push notifications?
                            // Let's keep it simple: push notifications get a simplified summary
                             if (part.added) diffText += `+ ${part.value} `;
                             if (part.removed) diffText += `- ${part.value} `;
                        }
                    });
                    diffHtml += '</div>';
                }

                const identifier = monitor.name || pageTitle || `Monitor ${monitor.id}`;
                let finalChangeMsg = changeMsg;
                const aiPrompt = monitor.ai_prompt || null;

                if (monitor.type === 'visual') {
                    if (monitor.last_screenshot && fs.existsSync(monitor.last_screenshot) && fs.existsSync(screenshotPath)) {
                        aiSummary = await summarizeVisualChange(monitor.last_screenshot, screenshotPath, aiPrompt);
                    }
                } else {
                    aiSummary = await summarizeChange(monitor.last_value || null, text);
                }

                console.log(`AI Summary Result: '${aiSummary}'`);

                let aiSummaryHtml = '';
                if (aiSummary) {
                    finalChangeMsg += `\n\n🤖 AI Summary: ${aiSummary}`;
                    aiSummaryHtml = `
                        <div style="border: 2px solid #8B5CF6; border-radius: 8px; padding: 16px; margin: 16px 0; background-color: #F5F3FF; color: #4C1D95; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
                            <div style="font-weight: bold; margin-bottom: 8px; font-size: 1.1em; display: flex; align-items: center;">
                                <span style="font-size: 1.4em; margin-right: 8px;">🤖</span> AI Summary
                            </div>
                            <div style="line-height: 1.6;">${aiSummary.replace(/\n/g, '<br>')}</div>
                        </div>
                    `;
                }

                const subject = `DW: ${identifier}`;
                const message = `Change detected for ${identifier}.\n\n${changeMsg}${aiSummary ? `\n\n🤖 AI Summary: ${aiSummary}` : ''}\n\nURL: ${monitor.url}`;

                const htmlMessage = `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #1a1a1a; padding-bottom: 10px; border-bottom: 1px solid #eaecef;">DW: ${identifier}</h2>
                        
                        <p style="margin: 15px 0;"><strong>URL:</strong> <a href="${monitor.url}" style="color: #0969da; text-decoration: none;">${monitor.url}</a></p>
                        
                        ${aiSummaryHtml}
                        
                        <p style="color: #444; margin: 15px 0;"><strong>Detection:</strong> ${changeMsg}</p>
                        
                        ${diffHtml ? `
                            <h3 style="margin-top: 20px; color: #1a1a1a;">Text Changes:</h3>
                            ${diffHtml}
                        ` : ''}
                        
                        <p style="margin-top: 30px; color: #666; font-size: 12px; border-top: 1px solid #eaecef; padding-top: 10px;">Sent by DeltaWatch</p>
                    </div>
                `;

                let diffImagePath: string | null = null;
                const renderSettings = await new Promise<Settings>((resolve) => 
                    db.get("SELECT * FROM settings WHERE id = 1", (err: Error | null, row: Settings) => resolve(row || {} as Settings))
                );

                console.log(`Render Debug: Enabled=${renderSettings.push_enabled}, Type=${renderSettings.push_type}, HasDiffHTML=${!!diffHtml}, HasContext=${!!context}`);

                if (renderSettings.push_enabled && renderSettings.push_type === 'pushover' && diffHtml && context) {
                    try {
                        const renderPage = await context.newPage();
                        const htmlContent = `
                            <html>
                            <body style="background-color: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; padding: 20px;">
                                <h3 style="color: #fff; border-bottom: 1px solid #30363d; padding-bottom: 10px;">${identifier}</h3>
                                <div style="font-family: monospace; white-space: pre-wrap; font-size: 12px;">${diffHtml}</div>
                            </body>
                            </html>
                        `;
                        
                        await renderPage.setContent(htmlContent);

                        const boundingBox = await renderPage.evaluate(() => {
                            const body = document.body;
                            return { height: body.scrollHeight };
                        });
                        await renderPage.setViewportSize({ width: 600, height: Math.ceil(boundingBox.height) + 50 });

                        const filename = `diff_render_${monitor.id}_${Date.now()}.png`;
                        diffImagePath = getPublicPath('screenshots', filename);

                        await renderPage.screenshot({ path: diffImagePath });
                        await renderPage.close();
                        console.log("Generated diff image:", diffImagePath);
                    } catch (err) {
                        console.error("Failed to render diff image:", err);
                    }
                }

                // Smart Notification Logic
                let shouldNotify = true;
                if (monitor.notify_config) {
                    try {
                        const config: NotifyConfig = typeof monitor.notify_config === 'string'
                            ? JSON.parse(monitor.notify_config)
                            : monitor.notify_config;
                        const currentText = (text || '').toLowerCase();
                        const method = config.method || 'all';
                        const threshold = (config.threshold || '').toLowerCase();

                        if (method === 'contains' && threshold) {
                            shouldNotify = currentText.includes(threshold);
                            console.log(`Rule Check (Contains): includes "${threshold}" ? ${shouldNotify}`);
                        } else if (method === 'not_contains' && threshold) {
                            shouldNotify = !currentText.includes(threshold);
                            console.log(`Rule Check (Not Contains): !includes "${threshold}" ? ${shouldNotify}`);
                        } else if (method === 'value_lt' && threshold) {
                            const numVal = parseFloat(text || '');
                            const numThreshold = parseFloat(threshold);
                            shouldNotify = !isNaN(numVal) && !isNaN(numThreshold) && numVal < numThreshold;
                            console.log(`Rule Check (Value <): ${numVal} < ${numThreshold} ? ${shouldNotify}`);
                        } else if (method === 'value_gt' && threshold) {
                            const numVal = parseFloat(text || '');
                            const numThreshold = parseFloat(threshold);
                            shouldNotify = !isNaN(numVal) && !isNaN(numThreshold) && numVal > numThreshold;
                            console.log(`Rule Check (Value >): ${numVal} > ${numThreshold} ? ${shouldNotify}`);
                        } else if (method === 'ai_focus') {
                            if (aiSummary && monitor.ai_prompt) {
                                const summaryLower = aiSummary.toLowerCase();
                                shouldNotify = !summaryLower.includes('no significant') &&
                                    !summaryLower.includes('no meaningful') &&
                                    !summaryLower.includes('unchanged') &&
                                    !summaryLower.startsWith('⚠️');
                                console.log(`Rule Check (AI Focus): AI relevant to "${monitor.ai_prompt}" ? ${shouldNotify}`);
                            } else if (!aiSummary) {
                                shouldNotify = true;
                            }
                        }
                    } catch (e) {
                        console.error("Error parsing notify_config:", e);
                    }
                }

                if (shouldNotify) {
                    sendNotification(subject, message, htmlMessage, diffText, diffImagePath);
                } else {
                    console.log(`[${monitorName}] Notification suppressed by rule`);
                }
            } else {
                console.log(`[${monitorName}] First run - Saving initial value without alert.`);
                // First run: save initial value but don't mark as 'changed' to avoid badge increment
                status = 'unchanged';
            }

            db.run(
                `INSERT INTO check_history (monitor_id, status, value, created_at, screenshot_path, prev_screenshot_path, diff_screenshot_path, ai_summary, http_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [monitor.id, status, text, nowStr, screenshotPath, monitor.last_screenshot, diffFilename ? getPublicPath('screenshots', diffFilename) : null, aiSummary, httpStatus],
                (err: Error | null) => {
                    if (err) console.error("DB Insert Error (History):", err.message);
                    else console.log(`[${monitorName}] History saved to DB`);
                }
            );
        } else {
            console.log(`[${monitorName}] No change`);
            db.run(
                `INSERT INTO check_history (monitor_id, status, value, created_at, http_status) VALUES (?, ?, ?, ?, ?)`,
                [monitor.id, status, text, nowStr, httpStatus]
            );
        }

        // Keyword Alert Detection
        if (monitor.keywords) {
            try {
                const keywords: Keyword[] = JSON.parse(monitor.keywords);
                const contentLower = (text || '').toLowerCase();
                const lastValueLower = (monitor.last_value || '').toLowerCase();

                for (const kw of keywords) {
                    if (!kw.text) continue;
                    const keywordLower = kw.text.toLowerCase();
                    const foundNow = contentLower.includes(keywordLower);
                    const foundBefore = lastValueLower.includes(keywordLower);

                    const mode = kw.mode || 'appears';
                    let shouldAlert = false;
                    let alertMessage = '';

                    if (mode === 'appears' && foundNow && !foundBefore) {
                        shouldAlert = true;
                        alertMessage = `Keyword "${kw.text}" appeared`;
                    } else if (mode === 'disappears' && !foundNow && foundBefore) {
                        shouldAlert = true;
                        alertMessage = `Keyword "${kw.text}" disappeared`;
                    } else if (mode === 'any') {
                        if (foundNow && !foundBefore) {
                            shouldAlert = true;
                            alertMessage = `Keyword "${kw.text}" appeared`;
                        } else if (!foundNow && foundBefore) {
                            shouldAlert = true;
                            alertMessage = `Keyword "${kw.text}" disappeared`;
                        }
                    }

                    if (shouldAlert) {
                        console.log(`[${monitorName}] Keyword Alert: ${alertMessage}`);
                        const identifier = monitor.name || monitor.url;
                        const subject = `🔑 Keyword Alert: ${identifier}`;
                        const message = `${alertMessage}\n\nMonitor: ${identifier}\nURL: ${monitor.url}`;
                        const htmlMessage = `
                            <h2>🔑 Keyword Alert</h2>
                            <p><strong>Monitor:</strong> ${identifier}</p>
                            <p><strong>URL:</strong> <a href="${monitor.url}">${monitor.url}</a></p>
                            <p><strong>Alert:</strong> ${alertMessage}</p>
                            <p><small>Sent by DeltaWatch</small></p>
                        `;
                        sendNotification(subject, message, htmlMessage, null, null);
                    }
                }
            } catch (e) {
                console.error('Error processing keywords:', e);
            }
        }

        // Uptime/Downtime Alert
        if (httpStatus && httpStatus >= 400) {
            console.log(`[${monitorName}] Downtime detected: HTTP ${httpStatus}`);
            const identifier = monitor.name || monitor.url;
            const subject = `🔴 Downtime Alert: ${identifier}`;
            const message = `HTTP ${httpStatus} Error\n\nMonitor: ${identifier}\nURL: ${monitor.url}\nStatus Code: ${httpStatus}`;
            const htmlMessage = `
                <h2>🔴 Downtime Alert</h2>
                <p><strong>Monitor:</strong> ${identifier}</p>
                <p><strong>URL:</strong> <a href="${monitor.url}">${monitor.url}</a></p>
                <p><strong>HTTP Status:</strong> ${httpStatus}</p>
                <p><small>Sent by DeltaWatch</small></p>
            `;
            sendNotification(subject, message, htmlMessage, null, null);
        }

        // Cleanup old screenshot
        if (monitor.last_screenshot && fs.existsSync(monitor.last_screenshot)) {
            try {
                fs.unlinkSync(monitor.last_screenshot);
            } catch (err) {
                console.error("Error deleting old screenshot:", err);
            }
        }

        if (changed) {
            if (monitor.type === 'visual') {
                db.run(
                    `UPDATE monitors SET last_check = ?, last_value = ?, last_screenshot = ?, last_change = ?, unread_count = unread_count + 1, consecutive_failures = 0 WHERE id = ?`,
                    [nowStr, text, screenshotPath, nowStr, monitor.id],
                    (err: Error | null) => { if (err) console.error("Update Error:", err); }
                );
            } else {
                db.run(
                    `UPDATE monitors SET last_check = ?, last_value = ?, last_change = ?, unread_count = unread_count + 1, consecutive_failures = 0 WHERE id = ?`,
                    [nowStr, text, nowStr, monitor.id],
                    (err: Error | null) => { if (err) console.error("Update Error:", err); }
                );
                fs.unlink(screenshotPath, (delErr) => { if (delErr) console.error("Error deleting unused screenshot:", delErr) });
            }
        } else {
            // No change detected (or first run)
            if (monitor.type === 'visual') {
                db.run(
                    `UPDATE monitors SET last_check = ?, last_screenshot = ?, last_value = ?, consecutive_failures = 0 WHERE id = ?`,
                    [nowStr, screenshotPath, text, monitor.id],
                    (err: Error | null) => { if (err) console.error("Update Error:", err); }
                );
            } else {
                // For text monitors, always update last_value (needed for first run baseline)
                db.run(
                    `UPDATE monitors SET last_check = ?, last_value = ?, consecutive_failures = 0 WHERE id = ?`,
                    [nowStr, text, monitor.id],
                    (err: Error | null) => { if (err) console.error("Update Error:", err); }
                );
                fs.unlink(screenshotPath, (delErr) => { if (delErr) console.error("Error deleting unused screenshot:", delErr) });
            }
        }

    } catch (error: any) {
        console.error(`[${monitorName}] Error:`, error.message);
        db.run(`INSERT INTO check_history (monitor_id, status, response_time, created_at, value) VALUES (?, ?, ?, ?, ?)`, [monitor.id, 'error', 0, new Date().toISOString(), error.message]);
        // Increment consecutive failures on error
        db.run(`UPDATE monitors SET consecutive_failures = consecutive_failures + 1, last_check = ? WHERE id = ?`, [new Date().toISOString(), monitor.id]);
    } finally {
        if (page) await page.close();
        if (pooledContext) await pooledContext.release();
    }
}

async function executeScenario(page: Page, scenario: ScenarioStep[]): Promise<void> {
    if (Array.isArray(scenario) && scenario.length > 0) {
        console.log(`Executing scenario with ${scenario.length} steps.`);
        for (const step of scenario) {
            console.log(`- Step: ${step.action} ${step.selector || ''} ${step.value || ''}`);
            try {
                switch (step.action) {
                    case 'wait':
                        await page.waitForTimeout(parseInt(step.value || '1000') || 1000);
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
                    case 'scroll':
                        await page.evaluate((y: number) => window.scrollBy(0, y), parseInt(step.value || '500') || 500);
                        break;
                    case 'key':
                        if (step.value) {
                            await page.keyboard.press(step.value);
                        }
                        break;
                }
            } catch (stepErr: any) {
                console.error(`Error in scenario step ${step.action}:`, stepErr.message);
            }
        }
        console.log('Scenario execution completed.');
    }
}

async function previewScenario(url: string, scenarioConfig: string | ScenarioStep[] | null, proxySettings: ProxySettings | null = null): Promise<string | null> {
    console.log(`Previewing scenario for ${url}`);

    const launchOptions: LaunchOptions = { headless: true };
    if (proxySettings && proxySettings.server) {
        launchOptions.proxy = { server: proxySettings.server };
        if (proxySettings.username && proxySettings.password) {
            launchOptions.proxy.username = proxySettings.username;
            launchOptions.proxy.password = proxySettings.password;
        } else if (proxySettings.auth) {
            const [username, password] = proxySettings.auth.split(':');
            launchOptions.proxy.username = username;
            launchOptions.proxy.password = password;
        }
    }

    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext();
    const page = await context.newPage();
    let screenshotFilename: string | null = null;

    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        try {
            await page.waitForSelector('div[class*="fixed"][class*="inset-0"]', { state: 'detached', timeout: 5000 });
        } catch (e) { }

        if (scenarioConfig) {
            const scenario = typeof scenarioConfig === 'string' ? JSON.parse(scenarioConfig) : scenarioConfig;
            await executeScenario(page, scenario);
        }

        await page.waitForTimeout(1000);

        const filename = `preview-${Date.now()}.png`;
        const filepath = getPublicPath('screenshots', filename);
        await page.screenshot({ path: filepath, fullPage: true });
        screenshotFilename = filename;

    } catch (e) {
        console.error("Preview Error:", e);
        throw e;
    } finally {
        await browser.close();
    }

    return screenshotFilename;
}

async function cleanupScreenshots() {
    console.log('Running daily screenshot cleanup...');
    const screenshotsDir = getPublicPath('screenshots');
    const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const now = Date.now();

    try {
        if (!fs.existsSync(screenshotsDir)) return;

        const files = fs.readdirSync(screenshotsDir);
        let deletedCount = 0;

        for (const file of files) {
            if (file === '.keep') continue;
            
            const filePath = path.join(screenshotsDir, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > MAX_AGE_MS) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            } catch (err: any) {
                console.error(`Error processing file ${file} for cleanup:`, err.message);
            }
        }
        console.log(`Cleanup complete. Deleted ${deletedCount} old screenshots.`);
    } catch (error: any) {
        console.error('Error during screenshot cleanup:', error.message);
    }
}

function startScheduler(): void {
    let isCheckRunning = false;

    // Run every minute
    cron.schedule('* * * * *', async () => {
        if (isCheckRunning) {
            console.log('Skipping monitor check: previous run still active');
            return;
        }

        isCheckRunning = true;
        try {
            await checkMonitors();
        } finally {
            isCheckRunning = false;
        }
    });
    
    // Run cleanup every day at midnight
    cron.schedule('0 0 * * *', () => {
        cleanupScreenshots();
    });

    console.log('Scheduler started.');
}

export { startScheduler, checkSingleMonitor, previewScenario, executeScenario };
