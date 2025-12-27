import db from './db';

type LogLevel = 'error' | 'warn' | 'info';
type LogSource = 'scheduler' | 'api' | 'browser' | 'auth' | 'notification' | 'watchdog';

interface LogEntry {
    id: number;
    level: LogLevel;
    source: LogSource;
    message: string;
    stack: string | null;
    monitor_id: number | null;
    created_at: string;
}

/**
 * Log an error to the database and console
 */
export function logError(
    source: LogSource, 
    message: string, 
    stack?: string, 
    monitorId?: number
): void {
    db.run(
        'INSERT INTO error_logs (level, source, message, stack, monitor_id) VALUES (?, ?, ?, ?, ?)',
        ['error', source, message, stack || null, monitorId || null],
        (err) => {
            if (err) console.error('[Logger] Failed to write log:', err.message);
        }
    );
    console.error(`[${source.toUpperCase()}] ${message}`);
    if (stack) console.error(stack);
}

/**
 * Log a warning to the database and console
 */
export function logWarn(
    source: LogSource, 
    message: string, 
    monitorId?: number
): void {
    db.run(
        'INSERT INTO error_logs (level, source, message, monitor_id) VALUES (?, ?, ?, ?)',
        ['warn', source, message, monitorId || null],
        (err) => {
            if (err) console.error('[Logger] Failed to write log:', err.message);
        }
    );
    console.warn(`[${source.toUpperCase()}] ${message}`);
}

/**
 * Log info to the database and console
 */
export function logInfo(
    source: LogSource, 
    message: string, 
    monitorId?: number
): void {
    db.run(
        'INSERT INTO error_logs (level, source, message, monitor_id) VALUES (?, ?, ?, ?)',
        ['info', source, message, monitorId || null],
        (err) => {
            if (err) console.error('[Logger] Failed to write log:', err.message);
        }
    );
    console.log(`[${source.toUpperCase()}] ${message}`);
}

/**
 * Get logs with pagination and filtering
 */
export function getLogs(
    options: {
        level?: LogLevel;
        source?: LogSource;
        monitorId?: number;
        limit?: number;
        offset?: number;
    } = {}
): Promise<{ logs: LogEntry[]; total: number }> {
    const { level, source, monitorId, limit = 50, offset = 0 } = options;
    
    let whereClause = '1=1';
    const params: (string | number)[] = [];
    
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
        db.get(
            `SELECT COUNT(*) as total FROM error_logs WHERE ${whereClause}`,
            params,
            (err: Error | null, countRow: { total: number }) => {
                if (err) return reject(err);
                
                db.all(
                    `SELECT * FROM error_logs WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
                    [...params, limit, offset],
                    (err: Error | null, logs: LogEntry[]) => {
                        if (err) return reject(err);
                        resolve({ logs, total: countRow.total });
                    }
                );
            }
        );
    });
}

/**
 * Delete logs older than specified days
 */
export function cleanupLogs(daysOld: number = 30): Promise<number> {
    return new Promise((resolve, reject) => {
        const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
        db.run(
            'DELETE FROM error_logs WHERE created_at < ?',
            [cutoff],
            function(this: { changes: number }, err: Error | null) {
                if (err) return reject(err);
                resolve(this.changes);
            }
        );
    });
}

/**
 * Delete all logs
 */
export function clearAllLogs(): Promise<number> {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM error_logs', function(this: { changes: number }, err: Error | null) {
            if (err) return reject(err);
            resolve(this.changes);
        });
    });
}

/**
 * Delete a specific log entry
 */
export function deleteLog(id: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
        db.run(
            'DELETE FROM error_logs WHERE id = ?',
            [id],
            function(this: { changes: number }, err: Error | null) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            }
        );
    });
}
