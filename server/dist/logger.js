"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logError = logError;
exports.logWarn = logWarn;
exports.logInfo = logInfo;
exports.getLogs = getLogs;
exports.cleanupLogs = cleanupLogs;
exports.clearAllLogs = clearAllLogs;
exports.deleteLog = deleteLog;
const db_1 = __importDefault(require("./db"));
/**
 * Log an error to the database and console
 */
function logError(source, message, stack, monitorId) {
    db_1.default.run('INSERT INTO error_logs (level, source, message, stack, monitor_id) VALUES (?, ?, ?, ?, ?)', ['error', source, message, stack || null, monitorId || null], (err) => {
        if (err)
            console.error('[Logger] Failed to write log:', err.message);
    });
    console.error(`[${source.toUpperCase()}] ${message}`);
    if (stack)
        console.error(stack);
}
/**
 * Log a warning to the database and console
 */
function logWarn(source, message, monitorId) {
    db_1.default.run('INSERT INTO error_logs (level, source, message, monitor_id) VALUES (?, ?, ?, ?)', ['warn', source, message, monitorId || null], (err) => {
        if (err)
            console.error('[Logger] Failed to write log:', err.message);
    });
    console.warn(`[${source.toUpperCase()}] ${message}`);
}
/**
 * Log info to the database and console
 */
function logInfo(source, message, monitorId) {
    db_1.default.run('INSERT INTO error_logs (level, source, message, monitor_id) VALUES (?, ?, ?, ?)', ['info', source, message, monitorId || null], (err) => {
        if (err)
            console.error('[Logger] Failed to write log:', err.message);
    });
    console.log(`[${source.toUpperCase()}] ${message}`);
}
/**
 * Get logs with pagination and filtering
 */
function getLogs(options = {}) {
    const { level, source, monitorId, limit = 50, offset = 0 } = options;
    let whereClause = '1=1';
    const params = [];
    if (level) {
        whereClause += ' AND level = ?';
        params.push(level);
    }
    if (source) {
        whereClause += ' AND source = ?';
        params.push(source);
    }
    if (monitorId) {
        whereClause += ' AND monitor_id = ?';
        params.push(monitorId);
    }
    return new Promise((resolve, reject) => {
        db_1.default.get(`SELECT COUNT(*) as total FROM error_logs WHERE ${whereClause}`, params, (err, countRow) => {
            if (err)
                return reject(err);
            db_1.default.all(`SELECT * FROM error_logs WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset], (err, logs) => {
                if (err)
                    return reject(err);
                resolve({ logs, total: countRow.total });
            });
        });
    });
}
/**
 * Delete logs older than specified days
 */
function cleanupLogs(daysOld = 30) {
    return new Promise((resolve, reject) => {
        const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
        db_1.default.run('DELETE FROM error_logs WHERE created_at < ?', [cutoff], function (err) {
            if (err)
                return reject(err);
            resolve(this.changes);
        });
    });
}
/**
 * Delete all logs
 */
function clearAllLogs() {
    return new Promise((resolve, reject) => {
        db_1.default.run('DELETE FROM error_logs', function (err) {
            if (err)
                return reject(err);
            resolve(this.changes);
        });
    });
}
/**
 * Delete a specific log entry
 */
function deleteLog(id) {
    return new Promise((resolve, reject) => {
        db_1.default.run('DELETE FROM error_logs WHERE id = ?', [id], function (err) {
            if (err)
                return reject(err);
            resolve(this.changes > 0);
        });
    });
}
//# sourceMappingURL=logger.js.map