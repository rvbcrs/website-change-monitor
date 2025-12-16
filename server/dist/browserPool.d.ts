import type { BrowserContext } from 'playwright-core';
/**
 * Acquire a browser context from the pool
 */
export declare function acquireBrowser(): Promise<{
    context: BrowserContext;
    release: () => Promise<void>;
}>;
/**
 * Shutdown the browser pool
 */
export declare function shutdownPool(): Promise<void>;
/**
 * Get pool statistics
 */
export declare function getPoolStats(): {
    total: number;
    inUse: number;
    available: number;
};
//# sourceMappingURL=browserPool.d.ts.map