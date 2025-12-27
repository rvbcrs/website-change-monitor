// Server-side shared types for DeltaWatch

export interface User {
    id: number;
    email: string;
    password_hash: string;
    role: 'user' | 'admin';
    is_verified: number;
    is_blocked: number;
    verification_token?: string;
    created_at: string;
}

export interface Monitor {
    id: number;
    user_id: number;
    url: string;
    selector: string;
    selector_text?: string;
    interval: string;
    last_check?: string;
    last_value?: string;
    last_change?: string;
    last_screenshot?: string;
    last_healed?: string;
    type: 'text' | 'visual';
    name?: string;
    active: number;
    notify_config?: string;
    ai_prompt?: string;
    ai_only_visual?: number;
    suggested_selector?: string;
    scenario_config?: string;
    unread_count: number;
    tags?: string;
    keywords?: string;
    retry_count?: number;
    retry_delay?: number;
    group_id?: number;
    sort_order?: number;
    consecutive_failures: number;
    created_at: string;
}

export interface Group {
    id: number;
    user_id: number;
    name: string;
    color: string;
    icon: string;
    sort_order: number;
    created_at: string;
}

export interface CheckHistory {
    id: number;
    monitor_id: number;
    status: 'unchanged' | 'changed' | 'error';
    value?: string;
    response_time?: number;
    http_status?: number;
    screenshot_path?: string;
    prev_screenshot_path?: string;
    diff_screenshot_path?: string;
    ai_summary?: string;
    created_at: string;
}

export interface Settings {
    id: number;
    email_enabled: number;
    email_host?: string;
    email_port?: number;
    email_secure: number;
    email_user?: string;
    email_pass?: string;
    email_to?: string;
    email_from?: string;
    push_enabled: number;
    push_type?: 'pushover' | 'telegram';
    push_key1?: string;
    push_key2?: string;
    ai_enabled: number;
    ai_provider?: 'openai' | 'ollama';
    ai_api_key?: string;
    ai_model?: string;
    ai_base_url?: string;
    proxy_enabled: number;
    proxy_server?: string;
    proxy_auth?: string;
    webhook_enabled: number;
    webhook_url?: string;
    app_url?: string;
    created_at: string;
}

export interface NotifyConfig {
    email: boolean;
    push: boolean;
}

export interface Keyword {
    text: string;
    mode: 'appears' | 'disappears' | 'any';
}

export interface ScenarioStep {
    action: string;
    selector?: string;
    value?: string;
}

// API request/response types
export interface MonitorCreateRequest {
    url: string;
    selector: string;
    selector_text?: string;
    interval: string;
    type?: 'text' | 'visual';
    name?: string;
    notify_config?: string;
    ai_prompt?: string;
    scenario_config?: string;
}

export interface MonitorUpdateRequest {
    active?: boolean;
    name?: string;
    selector?: string;
    selector_text?: string;
    interval?: string;
    type?: 'text' | 'visual';
    notify_config?: string;
    ai_prompt?: string;
    ai_only_visual?: boolean;
    scenario_config?: string;
    retry_count?: number;
    retry_delay?: number;
}

// Express request extension
import { Request } from 'express';

export interface AuthRequest extends Request {
    user?: {
        userId: number;
        role: string;
    };
}
