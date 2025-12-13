const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'monitors.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the monitors database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS monitors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            selector TEXT NOT NULL,
            selector_text TEXT,
            interval TEXT NOT NULL,
            last_check DATETIME,
            last_value TEXT,
            last_change DATETIME,
            last_screenshot TEXT,
            type TEXT DEFAULT 'text',
            name TEXT,
            active BOOLEAN DEFAULT 1,
            notify_config TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error("Error creating monitors table:", err);
        });

        // Migration: Add active column if it doesn't exist
        db.all("PRAGMA table_info(monitors)", (err, rows) => {
            if (!err) {
                const hasActive = rows.some(r => r.name === 'active');
                if (!hasActive) {
                    console.log('Migrating: Adding active column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN active BOOLEAN DEFAULT 1");
                }
                const hasScreenshot = rows.some(r => r.name === 'last_screenshot');
                if (!hasScreenshot) {
                    console.log('Migrating: Adding last_screenshot column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN last_screenshot TEXT");
                }
                const hasType = rows.some(r => r.name === 'type');
                if (!hasType) {
                    console.log('Migrating: Adding type column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN type TEXT DEFAULT 'text'");
                }
                const hasName = rows.some(r => r.name === 'name');
                if (!hasName) {
                    console.log('Migrating: Adding name column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN name TEXT");
                }
                const hasNotifyConfig = rows.some(r => r.name === 'notify_config');
                if (!hasNotifyConfig) {
                    console.log('Migrating: Adding notify_config column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN notify_config TEXT");
                }
                const hasAiPrompt = rows.some(r => r.name === 'ai_prompt');
                if (!hasAiPrompt) {
                    console.log('Migrating: Adding ai_prompt column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN ai_prompt TEXT");
                }
                const hasScenarioConfig = rows.some(r => r.name === 'scenario_config');
                if (!hasScenarioConfig) {
                    console.log('Migrating: Adding scenario_config column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN scenario_config TEXT");
                }
                const hasUnreadCount = rows.some(r => r.name === 'unread_count');
                if (!hasUnreadCount) {
                    console.log('Migrating: Adding unread_count column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN unread_count INTEGER DEFAULT 0");
                }
                const hasTags = rows.some(r => r.name === 'tags');
                if (!hasTags) {
                    console.log('Migrating: Adding tags column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN tags TEXT");
                }
                const hasKeywords = rows.some(r => r.name === 'keywords');
                if (!hasKeywords) {
                    console.log('Migrating: Adding keywords column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN keywords TEXT");
                }
                const hasAiOnlyVisual = rows.some(r => r.name === 'ai_only_visual');
                if (!hasAiOnlyVisual) {
                    console.log('Migrating: Adding ai_only_visual column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN ai_only_visual INTEGER DEFAULT 0");
                }
                const hasLastHealed = rows.some(r => r.name === 'last_healed');
                if (!hasLastHealed) {
                    console.log('Migrating: Adding last_healed column to monitors table...');
                    db.run("ALTER TABLE monitors ADD COLUMN last_healed DATETIME");
                }
            } else {
                console.error("Error checking table info:", err);
            }
        });

        // Migration: Add screenshot columns to check_history
        db.all("PRAGMA table_info(check_history)", (err, rows) => {
            if (!err) {
                const hasScreenshot = rows.some(r => r.name === 'screenshot_path');
                if (!hasScreenshot) {
                    console.log('Migrating: Adding screenshot columns to check_history...');
                    db.run("ALTER TABLE check_history ADD COLUMN screenshot_path TEXT");
                    db.run("ALTER TABLE check_history ADD COLUMN prev_screenshot_path TEXT");
                    db.run("ALTER TABLE check_history ADD COLUMN diff_screenshot_path TEXT");
                }
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            email_enabled BOOLEAN DEFAULT 0,
            email_host TEXT,
            email_port INTEGER,
            email_secure BOOLEAN DEFAULT 0,
            email_user TEXT,
            email_pass TEXT,
            email_to TEXT,
            
            push_enabled BOOLEAN DEFAULT 0,
            push_type TEXT,
            push_key1 TEXT,
            push_key2 TEXT,

            ai_enabled BOOLEAN DEFAULT 0,
            ai_provider TEXT,
            ai_api_key TEXT,
            ai_model TEXT,
            ai_base_url TEXT,

            proxy_enabled BOOLEAN DEFAULT 0,
            proxy_server TEXT,
            proxy_auth TEXT,
            
            webhook_enabled BOOLEAN DEFAULT 0,
            webhook_url TEXT,
            
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error("Error creating settings table:", err);
        });

        db.run(`CREATE TABLE IF NOT EXISTS check_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            monitor_id INTEGER,
            status TEXT, -- 'unchanged', 'changed', 'error'
            response_time INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            screenshot_path TEXT,
            prev_screenshot_path TEXT,
            diff_screenshot_path TEXT,
            value TEXT,
            ai_summary TEXT,
            FOREIGN KEY(monitor_id) REFERENCES monitors(id)
        )`, (err) => {
            if (err) console.error("Error creating check_history table:", err);
        });

        // Insert default row if not exists
        db.run(`INSERT OR IGNORE INTO settings (id, email_enabled, push_enabled) VALUES (1, 0, 0)`, (err) => {
            if (err) console.error("Error inserting default settings:", err);
        });
        // Migration: Add value column to check_history if it doesn't exist
        db.all("PRAGMA table_info(check_history)", (err, rows) => {
            if (!err) {
                const hasValue = rows.some(r => r.name === 'value');
                if (!hasValue) {
                    console.log('Migrating: Adding value column to check_history table...');
                    db.run("ALTER TABLE check_history ADD COLUMN value TEXT");
                }
                const hasAiSummary = rows.some(r => r.name === 'ai_summary');
                if (!hasAiSummary) {
                    console.log('Migrating: Adding ai_summary column to check_history table...');
                    db.run("ALTER TABLE check_history ADD COLUMN ai_summary TEXT");
                }
                const hasHttpStatus = rows.some(r => r.name === 'http_status');
                if (!hasHttpStatus) {
                    console.log('Migrating: Adding http_status column to check_history table...');
                    db.run("ALTER TABLE check_history ADD COLUMN http_status INTEGER");
                }
            } else {
                console.error("Error checking check_history table info:", err);
            }
        });

        // Migration: Add AI and Proxy columns to settings
        db.all("PRAGMA table_info(settings)", (err, rows) => {
            if (!err) {
                const hasAi = rows.some(r => r.name === 'ai_enabled');
                if (!hasAi) {
                    console.log('Migrating: Adding AI columns to settings table...');
                    db.run("ALTER TABLE settings ADD COLUMN ai_enabled BOOLEAN DEFAULT 0");
                    db.run("ALTER TABLE settings ADD COLUMN ai_provider TEXT");
                    db.run("ALTER TABLE settings ADD COLUMN ai_api_key TEXT");
                    db.run("ALTER TABLE settings ADD COLUMN ai_model TEXT");
                    db.run("ALTER TABLE settings ADD COLUMN ai_base_url TEXT");
                }
                const hasProxy = rows.some(r => r.name === 'proxy_enabled');
                if (!hasProxy) {
                    console.log('Migrating: Adding Proxy columns to settings table...');
                    db.run("ALTER TABLE settings ADD COLUMN proxy_enabled BOOLEAN DEFAULT 0");
                    db.run("ALTER TABLE settings ADD COLUMN proxy_server TEXT");
                    db.run("ALTER TABLE settings ADD COLUMN proxy_auth TEXT");
                }
            } else {
                console.error("Error checking settings table info:", err);
            }
        });

        // Migration: Add Webhook columns to settings
        db.all("PRAGMA table_info(settings)", (err, rows) => {
            if (!err) {
                const hasWebhook = rows.some(r => r.name === 'webhook_enabled');
                if (!hasWebhook) {
                    console.log('Migrating: Adding Webhook columns to settings table...');
                    db.run("ALTER TABLE settings ADD COLUMN webhook_enabled BOOLEAN DEFAULT 0");
                    db.run("ALTER TABLE settings ADD COLUMN webhook_url TEXT");
                }
            } else {
                console.error("Error checking settings table info:", err);
            }
        });
    });
}

module.exports = db;
