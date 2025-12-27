/**
 * History record representing a single check result
 */
export interface HistoryRecord {
    id: number;
    monitor_id?: number;
    status: 'unchanged' | 'changed' | 'error';
    value?: string;
    created_at: string;
    screenshot_path?: string;
    prev_screenshot_path?: string;
    diff_screenshot_path?: string;
    ai_summary?: string;
    http_status?: number;
}
/**
 * Monitor configuration and state
 */
export interface Monitor {
    id: number;
    user_id?: number;
    url: string;
    selector: string;
    selector_text?: string;
    interval: string;
    type: 'text' | 'visual';
    name?: string;
    active: boolean;
    last_check?: string;
    last_change?: string;
    last_value?: string;
    last_screenshot?: string;
    notify_config?: string;
    ai_prompt?: string;
    scenario_config?: string;
    tags?: string;
    keywords?: string;
    ai_only_visual?: boolean;
    created_at?: string;
    history?: HistoryRecord[];
    unread_count?: number;
    suggested_selector?: string;
}
/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
    message: 'success' | 'error';
    data?: T;
    error?: string;
}
/**
 * User information
 */
export interface User {
    id: number;
    email: string;
    role: 'admin' | 'user';
}
/**
 * Authentication response
 */
export interface AuthResponse {
    token: string;
    user: User;
}
/**
 * Health check response
 */
export interface HealthResponse {
    server: string;
    database: string;
    browser: string;
}
//# sourceMappingURL=index.d.ts.map