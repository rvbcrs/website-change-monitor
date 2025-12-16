# DeltaWatch API Documentation

## Base URL
`http://localhost:3000`

## Authentication
Most endpoints require JWT authentication via Bearer token in the `Authorization` header.

```
Authorization: Bearer <token>
```

---

## Health & Status

### GET /api/health
Health check endpoint with system status.

**Response:**
```json
{
  "server": "ok",
  "database": "ok",
  "browser": "ok",
  "browserPool": { "total": 1, "inUse": 0, "available": 1 },
  "uptime": 3600,
  "memory": { "heapUsed": 50000000, "heapTotal": 100000000 },
  "timestamp": "2024-01-01T12:00:00.000Z",
  "responseTime": 150
}
```

### GET /status
Public status page data for all active monitors.

---

## Authentication

### POST /auth/register
Register a new user.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### POST /auth/login
Login and receive JWT token.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 1, "email": "user@example.com", "role": "admin" }
}
```

### POST /api/auth/google
Google OAuth login.

**Body:**
```json
{
  "token": "google-oauth-token"
}
```

### GET /auth/verify/:token
Verify email address.

---

## Monitors

### GET /api/monitors
Get all monitors for authenticated user.

**Query Params:**
- `tags` - Filter by tags (comma-separated)

### GET /monitors/:id
Get single monitor by ID.

### POST /monitors
Create new monitor.

**Body:**
```json
{
  "url": "https://example.com",
  "selector": "h1",
  "interval": "1h",
  "type": "text",
  "name": "My Monitor",
  "notify_config": { "method": "email" },
  "tags": "important,work",
  "keywords": "price,stock"
}
```

### PUT /api/monitors/:id
Update monitor.

### DELETE /api/monitors/:id
Delete monitor.

### POST /monitors/:id/check
Trigger manual check (rate limited: 10/min).

### PUT /api/monitors/:id/read
Mark monitor changes as read.

---

## Monitor History

### GET /monitors/:id/history
Get check history for a monitor.

**Query Params:**
- `limit` - Number of records (default: 50)
- `offset` - Pagination offset

### DELETE /monitors/:id/history/:historyId
Delete specific history entry.

---

## Settings

### GET /settings
Get application settings.

### PUT /settings
Update settings.

**Body:**
```json
{
  "email_enabled": true,
  "email_host": "smtp.example.com",
  "email_port": 587,
  "email_user": "user@example.com",
  "email_pass": "password",
  "email_to": "recipient@example.com",
  "email_from": "noreply@example.com",
  "push_enabled": true,
  "push_type": "pushover",
  "push_key1": "user-key",
  "push_key2": "api-key",
  "ai_enabled": true,
  "ai_provider": "openai",
  "ai_api_key": "sk-...",
  "ai_model": "gpt-4",
  "webhook_enabled": true,
  "webhook_url": "https://webhook.example.com"
}
```

---

## Notifications

### POST /test-notification
Send test notification (requires auth).

**Body:**
```json
{
  "type": "email"  // or "push"
}
```

---

## AI

### POST /api/ai/analyze-page
Analyze a page for auto-configuration.

**Body:**
```json
{
  "url": "https://example.com",
  "html": "<html>...</html>",  // optional
  "prompt": "Find the price"   // optional
}
```

### GET /api/ai/models
Get available AI models.

**Query Params:**
- `provider` - "openai" or "ollama"
- `apiKey` - API key
- `baseUrl` - Base URL (for Ollama)

---

## Admin (Admin only)

### GET /api/admin/users
List all users.

### DELETE /api/admin/users/:id
Delete user.

### PUT /api/admin/users/:id/block
Block/unblock user.

**Body:**
```json
{
  "blocked": true
}
```

### GET /api/admin/logs
Get error logs.

**Query Params:**
- `level` - "error", "warn", "info"
- `source` - "scheduler", "api", "browser", "auth", "notification"
- `monitor_id` - Filter by monitor
- `limit` - Number of records (default: 50)
- `offset` - Pagination offset

### DELETE /api/admin/logs/:id
Delete specific log.

### DELETE /api/admin/logs
Clear logs.

**Query Params:**
- `days_old` - Delete logs older than X days (optional, clears all if not set)

---

## Data Import/Export

### GET /data/export
Export all monitors as JSON.

### POST /data/import
Import monitors from JSON.

**Body:**
```json
{
  "monitors": [
    { "url": "...", "selector": "...", ... }
  ]
}
```

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/api/*` | 100 requests/minute |
| `/auth/*` | 5 requests/minute |
| `/monitors/:id/check` | 10 requests/minute |

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message description"
}
```

Common HTTP status codes:
- `400` - Bad request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not found
- `429` - Too many requests (rate limited)
- `500` - Internal server error
- `503` - Service unavailable (health check failed)
