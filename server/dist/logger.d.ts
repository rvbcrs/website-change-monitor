type LogLevel = 'error' | 'warn' | 'info';
type LogSource = 'scheduler' | 'api' | 'browser' | 'auth' | 'notification';
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
export declare function logError(source: LogSource, message: string, stack?: string, monitorId?: number): void;
/**
 * Log a warning to the database and console
 */
export declare function logWarn(source: LogSource, message: string, monitorId?: number): void;
/**
 * Log info to the database and console
 */
export declare function logInfo(source: LogSource, message: string, monitorId?: number): void;
/**
 * Get logs with pagination and filtering
 */
export declare function getLogs(options?: {
    level?: LogLevel;
    source?: LogSource;
    monitorId?: number;
    limit?: number;
    offset?: number;
}): Promise<{
    logs: LogEntry[];
    total: number;
}>;
/**
 * Delete logs older than specified days
 */
export declare function cleanupLogs(daysOld?: number): Promise<number>;
/**
 * Delete all logs
 */
export declare function clearAllLogs(): Promise<number>;
/**
 * Delete a specific log entry
 */
export declare function deleteLog(id: number): Promise<boolean>;
export {};
//# sourceMappingURL=logger.d.ts.map