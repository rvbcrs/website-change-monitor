# DeltaWatch

A powerful monorepo for monitoring website changes, with support for text extraction, visual comparisons, automated notifications, and a native mobile app.

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![React Native](https://img.shields.io/badge/React_Native-20232A?style=flat&logo=react&logoColor=61DAFB)
![Expo](https://img.shields.io/badge/Expo-000020?style=flat&logo=expo&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat&logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=flat&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-F69220?style=flat&logo=pnpm&logoColor=white)

## Monorepo Structure

```
DeltaWatch/
├── apps/
│   ├── web/
│   │   ├── client/          # React web dashboard
│   │   └── server/          # Express API server
│   └── mobile/              # React Native (Expo) mobile app
├── packages/
│   └── shared/              # Shared TypeScript types & utilities
├── extension/               # Chrome browser extension
├── package.json             # Root workspace config
└── pnpm-workspace.yaml
```

## Features

### Monitor Types
- **Text Monitoring** - Extract and track text content using CSS selectors
- **Full Page Monitoring** - Track entire page content changes
- **Visual Monitoring** - Screenshot comparison with pixel-level diff detection

### Apps
- **Web Dashboard** - Full-featured React web application
- **Mobile App** - Native iOS/Android app with Expo
- **Browser Extension** - Create monitors directly from any webpage

### Notifications
- Email notifications (SMTP)
- Push notifications (Pushover, Gotify)
- Webhook integrations
- AI-powered change summaries (OpenAI)

### Additional Features
- **Scheduled Checks** - Configurable intervals (1m to 24h)
- **History Timeline** - Track all changes with diff visualization
- **Tags & Filtering** - Organize monitors with custom tags
- **Keyword Alerts** - Trigger notifications when specific keywords appear/disappear
- **Multi-user Support** - Admin and user roles with email verification
- **Swipe to Delete** - Mobile-friendly gesture controls

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Web Server** | Express 5, TypeScript, SQLite3 |
| **Web Client** | React 18, Vite, Tailwind CSS |
| **Mobile App** | React Native, Expo, Expo Router |
| **Shared Package** | TypeScript types & utilities |
| **Browser Automation** | Playwright |
| **Charts** | Recharts |
| **Auth** | JWT, bcrypt, Google OAuth |
| **Package Manager** | pnpm workspaces |

## Getting Started

### Prerequisites
- Node.js v20+ (required for Playwright)
- pnpm (`npm install -g pnpm`)

### Installation

```bash
# Clone the repository
git clone https://github.com/rvbcrs/DeltaWatch.git
cd DeltaWatch

# Install all dependencies
pnpm install

# Build the shared package
pnpm --filter @deltawatch/shared build

# Start web server + client
pnpm start
```

The web app will be available at:
- **Frontend**: http://localhost:5174
- **API**: http://localhost:3000

### Running the Mobile App

```bash
# Navigate to mobile app
cd apps/mobile

# Start Expo development server
npx expo start
```

Then scan the QR code with Expo Go (Android) or Camera app (iOS).

### Environment Variables

Create a `.env` file in `apps/web/server/`:

```env
# Required
JWT_SECRET=your-secret-key

# Email (optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=password
SMTP_FROM=noreply@example.com

# AI Summaries (optional)
OPENAI_API_KEY=sk-...

# Push Notifications (optional)
PUSHOVER_USER_KEY=...
PUSHOVER_APP_TOKEN=...
GOTIFY_URL=https://gotify.example.com
GOTIFY_TOKEN=...

# Proxy (optional)
PROXY_URL=http://user:pass@proxy:port
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t deltawatch .
docker run -p 3000:3000 -v ./data:/app/server/data deltawatch
```

## Packages

### @deltawatch/shared

Shared TypeScript code between web and mobile apps:

```typescript
// Types
import { Monitor, HistoryRecord, User, ApiResponse } from '@deltawatch/shared';

// Utilities
import { timeAgo, formatDate, cleanValue, getStatusColor } from '@deltawatch/shared';
```

## Browser Extension

The Chrome extension allows you to create monitors directly from any webpage:

1. Navigate to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `extension/` folder
4. Configure your server URL in the extension popup

## API Documentation

Interactive API documentation powered by [Scalar](https://scalar.com) is available at `/api/docs` when the server is running.

![Scalar](https://img.shields.io/badge/Scalar-API_Docs-blue?style=flat&logo=swagger&logoColor=white)

The documentation provides:
- **Interactive API Explorer** - Test endpoints directly in the browser
- **OpenAPI 3.0 Spec** - Available at `/api/openapi.json`
- **Request/Response Examples** - Complete schema documentation

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | User login |
| `POST` | `/api/auth/register` | User registration |
| `GET` | `/api/health` | Server health check |
| `GET` | `/monitors` | List all monitors |
| `POST` | `/monitors` | Create new monitor |
| `POST` | `/monitors/:id/check` | Trigger manual check |
| `DELETE` | `/monitors/:id` | Delete monitor |
| `DELETE` | `/monitors/:id/history/:hid` | Delete history record |

## Scripts

```bash
# Start web server + client
pnpm start

# Build shared package
pnpm --filter @deltawatch/shared build

# Start only the web server
pnpm --filter @deltawatch/web-server start

# Start only the web client
pnpm --filter @deltawatch/web-client dev

# Start mobile app
cd apps/mobile && npx expo start
```

## License

MIT
