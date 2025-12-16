import type { BrowserContext, Page } from 'playwright-core';
import type { Monitor } from './types';
interface ScenarioStep {
    action: string;
    selector?: string;
    value?: string;
}
interface ProxySettings {
    server?: string;
    username?: string;
    password?: string;
    auth?: string;
}
declare function checkSingleMonitor(monitor: Monitor, context?: BrowserContext | null): Promise<void>;
declare function executeScenario(page: Page, scenario: ScenarioStep[]): Promise<void>;
declare function previewScenario(url: string, scenarioConfig: string | ScenarioStep[] | null, proxySettings?: ProxySettings | null): Promise<string | null>;
declare function startScheduler(): void;
export { startScheduler, checkSingleMonitor, previewScenario, executeScenario };
//# sourceMappingURL=scheduler.d.ts.map