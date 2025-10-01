# APS Model Publisher

## Overview
APS Model Publisher automates the publication of Autodesk Platform Services (APS) / Autodesk Construction Cloud models. The backend exposes REST APIs for Autodesk OAuth, data browsing, and scheduled publication jobs, while the React frontend provides a dashboard to manage authentication, hubs, projects, and publishing runs.【F:backend/src/server.js†L4-L91】【F:frontend/src/App.jsx†L1-L20】

## Key Features
- **Autodesk OAuth integration** – Initiate and finalize three-legged Autodesk OAuth flows, persist user profiles, and expose a `/me` endpoint secured with JWT tokens.【F:backend/src/routes/auth.routes.js†L33-L136】
- **APS data browsing** – Authenticated users can list hubs, projects, top folders, and folder contents pulled from APS Data Management APIs.【F:backend/src/routes/aps.routes.js†L1-L73】【F:frontend/src/services/api.js†L27-L42】
- **Publish job management** – Create, list, update, delete, and trigger publish jobs with cron expressions, time zones, lineage URNs, and notification settings, protected by lightweight rate limiting.【F:backend/src/routes/publish.routes.js†L1-L176】
- **Scheduler with crash safety** – Node-cron based scheduler prevents overlapping runs, handles graceful startup/shutdown, and records run history for each job.【F:backend/src/services/scheduler.service.js†L1-L140】
- **Real publish execution pipeline** – Optional feature flag enables actual APS publish commands with regional detection, retries, and logging controls.【F:backend/src/services/apsPublish.service.js†L1-L200】
- **Structured logging** – Winston logger outputs JSON logs with daily rotation and console output in development.【F:backend/src/config/logger.js†L1-L67】

## Repository Structure
```
├── backend/   # Express + Sequelize API server, APS integrations, scheduler【F:backend/package.json†L1-L42】
└── frontend/  # React (Vite) single-page app for authentication and job management【F:frontend/package.json†L1-L21】
```

## Prerequisites
- Node.js 20 LTS (or newer) for both backend and frontend.
- PostgreSQL 13+ with a database accessible to the backend.
- Autodesk Platform Services app credentials (client ID/secret) and redirect URI.

## Backend Environment Variables
Create a `backend/.env` file (or equivalent secrets store) with the following values:

| Variable | Description |
| --- | --- |
| `PORT` | HTTP port for the Express server (defaults to `3000`).【F:backend/src/server.js†L60-L73】 |
| `CORS_ORIGIN` | Allowed origin for the frontend (defaults to `http://localhost:3001`).【F:backend/src/server.js†L24-L31】 |
| `APS_CLIENT_ID`, `APS_CLIENT_SECRET`, `APS_CALLBACK_URL`, `APS_SCOPES` | Autodesk three-legged OAuth credentials and scopes.【F:backend/src/config/aps.config.js†L5-L33】 |
| `APS_TWO_LEGGED_SCOPES` | Optional space-separated scopes for service-to-service tokens.【F:backend/src/services/apsAuth.service.js†L12-L18】 |
| `JWT_SECRET`, `JWT_EXPIRE` | Secret and lifetime for application JWT tokens.【F:backend/src/routes/auth.routes.js†L99-L119】 |
| `DATABASE_URL` | Full PostgreSQL connection URL (overrides discrete DB settings).【F:backend/src/config/database.js†L9-L33】 |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_DIALECT`, `DB_SSL`, `DB_LOGGING`, `DB_SYNC_ALTER` | Individual Sequelize connection settings when `DATABASE_URL` is not used.【F:backend/src/config/database.js†L34-L89】 |
| `LOG_DIR`, `LOG_LEVEL`, `NODE_ENV` | Logging destination, verbosity, and environment mode.【F:backend/src/config/logger.js†L26-L59】 |
| `ENABLE_REAL_PUBLISH`, `PUBLISH_COMMAND`, `PUBLISH_ITEM_TIMEOUT_MS`, `PUBLISH_MAX_RETRIES`, `PUBLISH_RETRY_BASE_MS` | Tune publish execution behavior; leave disabled for dry-run development.【F:backend/src/services/apsPublish.service.js†L11-L33】 |
| `WEBHOOK_CALLBACK_URL`, `WEBHOOK_SECRET` | Optional callbacks for APS webhooks.【F:backend/src/config/aps.config.js†L34-L52】 |

## Frontend Environment Variables
Create `frontend/.env` (or `.env.local`) to point the UI to the backend:

```
VITE_API_URL=http://localhost:3000
```
This value controls the axios base URL used by the frontend API client.【F:frontend/src/services/api.js†L1-L25】

## Local Development
1. **Install dependencies**
   ```bash
   cd backend
   npm install
   cd ../frontend
   npm install
   ```
2. **Run the backend**
   ```bash
   cd backend
   npm run dev
   ```
   The dev script launches `nodemon` against `src/server.js` for hot reloads.【F:backend/package.json†L5-L9】
3. **Run the frontend**
   ```bash
   cd frontend
   npm run dev
   ```
   Vite serves the React SPA on port 3001 by default.【F:frontend/package.json†L6-L19】
4. Open `http://localhost:3001` in your browser, initiate Autodesk login, and manage publish jobs via the dashboard.

## Database Notes
The backend automatically authenticates to PostgreSQL and synchronizes Sequelize models on startup; enable `DB_SYNC_ALTER=false` in production to prevent schema alterations at runtime.【F:backend/src/server.js†L62-L89】【F:backend/src/config/database.js†L57-L89】

## Production Deployment Tips
- Run `npm run build` in `frontend/` to produce a static build for hosting.【F:frontend/package.json†L6-L19】
- Start the backend with `npm start` in a managed process manager or container environment.【F:backend/package.json†L5-L9】
- Configure `ENABLE_REAL_PUBLISH=true` only when APS publish commands should be executed against production data.【F:backend/src/services/apsPublish.service.js†L11-L33】
- Mount a persistent volume for the `logs/` directory to retain rotated log files.【F:backend/src/config/logger.js†L26-L59】

## Testing
No automated tests are currently defined; the default `npm test` script in the backend is a placeholder.【F:backend/package.json†L6-L10】
