"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNotification = sendNotification;
const fs_1 = __importDefault(require("fs"));
const form_data_1 = __importDefault(require("form-data"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const https_1 = __importDefault(require("https"));
const db_1 = __importDefault(require("./db"));
function sendRequest(url, method, headers, body) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: headers
        };
        const req = https_1.default.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                console.log(`[${method}] ${url} - Status: ${res.statusCode}`);
                console.log(`Response: ${data}`);
                if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300) {
                    resolve(data);
                }
                else {
                    reject(new Error(`Request failed with status ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', (e) => {
            console.error(`Request Error: ${e.message}`);
            reject(e);
        });
        if (body)
            req.write(body);
        req.end();
    });
}
function getSettings() {
    return new Promise((resolve, reject) => {
        db_1.default.get("SELECT * FROM settings WHERE id = 1", (err, row) => {
            if (err)
                reject(err);
            else
                resolve(row || {});
        });
    });
}
async function sendNotification(subject, message, htmlMessage = null, diff = null, imagePath = null) {
    let options = {};
    // Handle overload: if diff is an object and not null, treat as options
    if (diff && typeof diff === 'object') {
        options = diff;
        diff = null;
    }
    try {
        const settings = await getSettings();
        const promises = [];
        // Check explicit type filter or default to all enabled
        const targetType = options.type;
        if (settings.email_enabled && (!targetType || targetType === 'email')) {
            promises.push(sendEmail(settings, subject, message, htmlMessage));
        }
        if (settings.push_enabled && (!targetType || targetType === 'push')) {
            promises.push(sendPush(settings, message, diff, imagePath));
        }
        if (settings.webhook_enabled && (!targetType || targetType === 'webhook')) {
            promises.push(sendWebhook(settings, subject, message, diff));
        }
        await Promise.allSettled(promises);
    }
    catch (error) {
        console.error("Notification Error:", error);
    }
}
async function sendEmail(settings, subject, text, html = null) {
    console.log(`Sending Email: ${subject}`);
    try {
        const transporter = nodemailer_1.default.createTransport({
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
    }
    catch (e) {
        console.error("Failed to send email:", e);
        throw e;
    }
}
async function sendPush(settings, message, diff = null, imagePath = null) {
    console.log(`Sending Push: ${settings.push_type}`);
    try {
        if (settings.push_type === 'pushover') {
            const form = new form_data_1.default();
            form.append('token', settings.push_key1 || '');
            form.append('user', settings.push_key2 || '');
            let finalMessage = message;
            // Only append text diff if NO image is provided
            if (diff && !imagePath) {
                finalMessage += "\n\n<pre>" + diff + "</pre>";
            }
            form.append('message', finalMessage);
            form.append('html', '1');
            if (imagePath && fs_1.default.existsSync(imagePath)) {
                console.log(`Attaching image to Pushover: ${imagePath}`);
                form.append('attachment', fs_1.default.createReadStream(imagePath));
            }
            await new Promise((resolve, reject) => {
                form.submit('https://api.pushover.net/1/messages.json', (err, res) => {
                    if (err) {
                        console.error('Pushover Submit Error:', err);
                        reject(err);
                        return;
                    }
                    if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300) {
                        res.resume();
                        resolve();
                    }
                    else {
                        res.resume();
                        reject(new Error(`Pushover API returned status ${res.statusCode}`));
                    }
                });
            });
        }
        else if (settings.push_type === 'telegram') {
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
    }
    catch (e) {
        console.error("Failed to send push:", e);
        throw e;
    }
}
async function sendWebhook(settings, subject, message, diff = null) {
    if (!settings.webhook_url)
        return;
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
    }
    catch (e) {
        console.error("Failed to send webhook:", e);
        // Don't throw, just log. Webhooks might be flaky.
    }
}
//# sourceMappingURL=notifications.js.map