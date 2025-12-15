import fs from 'fs';
import FormData from 'form-data';
import nodemailer from 'nodemailer';
import https from 'https';
import db from './db';
import type { Settings } from './types';

interface SendNotificationOptions {
    type?: 'email' | 'push' | 'webhook';
}

function sendRequest(url: string, method: string, headers: Record<string, string | number>, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: headers
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => data += chunk);
            res.on('end', () => {
                console.log(`[${method}] ${url} - Status: ${res.statusCode}`);
                console.log(`Response: ${data}`);
                if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`Request failed with status ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (e: Error) => {
            console.error(`Request Error: ${e.message}`);
            reject(e);
        });
        if (body) req.write(body);
        req.end();
    });
}

function getSettings(): Promise<Settings> {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM settings WHERE id = 1", (err: Error | null, row: Settings | undefined) => {
            if (err) reject(err);
            else resolve(row || {} as Settings);
        });
    });
}

async function sendNotification(
    subject: string, 
    message: string, 
    htmlMessage: string | null = null, 
    diff: string | SendNotificationOptions | null = null, 
    imagePath: string | null = null
): Promise<void> {
    let options: SendNotificationOptions = {};
    // Handle overload: if diff is an object and not null, treat as options
    if (diff && typeof diff === 'object') {
        options = diff;
        diff = null;
    }

    try {
        const settings = await getSettings();

        const promises: Promise<void>[] = [];

        // Check explicit type filter or default to all enabled
        const targetType = options.type;

        if (settings.email_enabled && (!targetType || targetType === 'email')) {
            promises.push(sendEmail(settings, subject, message, htmlMessage));
        }

        if (settings.push_enabled && (!targetType || targetType === 'push')) {
            promises.push(sendPush(settings, message, diff as string | null, imagePath));
        }

        if (settings.webhook_enabled && (!targetType || targetType === 'webhook')) {
            promises.push(sendWebhook(settings, subject, message, diff as string | null));
        }

        await Promise.allSettled(promises);

    } catch (error) {
        console.error("Notification Error:", error);
    }
}

async function sendEmail(settings: Settings, subject: string, text: string, html: string | null = null): Promise<void> {
    console.log(`Sending Email: ${subject}`);
    try {
        const transporter = nodemailer.createTransport({
            host: settings.email_host,
            port: settings.email_port,
            secure: settings.email_secure === 1,
            auth: {
                user: settings.email_user,
                pass: settings.email_pass
            }
        });

        await transporter.sendMail({
            from: settings.email_from || settings.email_user,
            to: settings.email_to,
            subject: subject,
            text: text,
            html: html || text.replace(/\n/g, '<br>')
        });
        console.log("Email sent successfully");
    } catch (e) {
        console.error("Failed to send email:", e);
        throw e;
    }
}

async function sendPush(settings: Settings, message: string, diff: string | null = null, imagePath: string | null = null): Promise<void> {
    console.log(`Sending Push: ${settings.push_type}`);
    try {
        if (settings.push_type === 'pushover') {
            const form = new FormData();
            form.append('token', settings.push_key1 || '');
            form.append('user', settings.push_key2 || '');

            let finalMessage = message;
            // Only append text diff if NO image is provided
            if (diff && !imagePath) {
                finalMessage += "\n\n<pre>" + diff + "</pre>";
            }
            form.append('message', finalMessage);
            form.append('html', '1');

            if (imagePath && fs.existsSync(imagePath)) {
                console.log(`Attaching image to Pushover: ${imagePath}`);
                form.append('attachment', fs.createReadStream(imagePath));
            }

            await new Promise<void>((resolve, reject) => {
                form.submit('https://api.pushover.net/1/messages.json', (err, res) => {
                    if (err) {
                        console.error('Pushover Submit Error:', err);
                        reject(err);
                        return;
                    }
                    if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300) {
                        res.resume();
                        resolve();
                    } else {
                        res.resume();
                        reject(new Error(`Pushover API returned status ${res.statusCode}`));
                    }
                });
            });

        } else if (settings.push_type === 'telegram') {
            const botToken = settings.push_key1;
            const chatId = settings.push_key2;
            const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

            let finalMessage = message;
            if (diff) {
                finalMessage += "\n\n<pre>" + diff + "</pre>";
            }

            const body = JSON.stringify({
                chat_id: chatId,
                text: finalMessage,
                parse_mode: 'HTML'
            });

            await sendRequest(url, 'POST', {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }, body);
        }
    } catch (e) {
        console.error("Failed to send push:", e);
        throw e;
    }
}

async function sendWebhook(settings: Settings, subject: string, message: string, diff: string | null = null): Promise<void> {
    if (!settings.webhook_url) return;
    console.log(`Sending Webhook: ${settings.webhook_url}`);

    const payload = {
        title: subject,
        message: message,
        diff: diff,
        timestamp: new Date().toISOString(),
        monitor: subject.replace('Change Detected: ', '').replace('Downtime Alert: ', '')
    };

    const body = JSON.stringify(payload);

    try {
        await sendRequest(settings.webhook_url, 'POST', {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        }, body);
        console.log("Webhook sent successfully");
    } catch (e) {
        console.error("Failed to send webhook:", e);
        // Don't throw, just log. Webhooks might be flaky.
    }
}

export { sendNotification };
