# HeyPhil App

Project management and productivity tools for Chad's team.

## Current Apps

- **Origination Board** - Kanban board for managing origination meeting projects, synced to Google Sheets
- **Org Charts** - Interactive organizational charts with drag-and-drop editing

## Setup

### 1. Install Dependencies

```bash
npm run setup
```

### 2. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create OAuth 2.0 Client ID (or use existing)
3. Add authorized redirect URIs:
   - `http://localhost:3002/auth/google/callback` (dev)
   - `https://api.heyphil.bot/auth/google/callback` (production)
4. Add scopes:
   - `profile`
   - `email`
   - `https://www.googleapis.com/auth/spreadsheets`

### 3. Google Sheets Setup

1. Create a new Google Sheet
2. Create the following sheets/tabs:

**Board** (Origination Board data):
- Headers: `Title | Description | Column | Owner | Notes | Card ID | Deal Value | Date Created | Project Type`

**Backend** (People photos and colors):
- Headers: `Person | Photo URL | Color | (blank) | Project Type | Type Color`

**Actions** (Action items):
- Headers: `Card ID | Card Title | Text | Completed On | Completed By`

**Log** (Activity log):
- Headers: `Timestamp | Card Title | Action | User | Details | Card ID`

**OrgCharts** (Org chart metadata):
- Headers: `ID | Name | Owner | Created At | Updated At | Node Count`

**OrgChartNodes** (Org chart nodes):
- Headers: `Chart ID | Node ID | Title | Name | Department | Email | Phone | Parent ID | X | Y`

3. Copy the Sheet ID from the URL
4. Share the sheet with the Google account you'll use to log in

### 4. Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required variables:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET` (generate with: `openssl rand -base64 32`)
- `ORIGINATION_SHEET_ID`

### 5. Run Locally

```bash
npm run dev
```

- Backend: http://localhost:3002
- Frontend: http://localhost:3000

## Deployment

### Backend (Railway)

1. Connect GitHub repo to Railway
2. Set environment variables in Railway dashboard
3. Deploy

### Frontend (Cloudflare Pages)

1. Connect GitHub repo to Cloudflare Pages
2. Build settings:
   - Build command: `cd client && npm install && npm run build`
   - Build output: `client/build`
3. Deploy

## Team Members

- Chad (chad@philo.ventures)
- Greg
- Scott

## Architecture

```
┌─────────────────┐
│  heyphil.bot    │  ← Frontend (Cloudflare Pages)
│  (React)        │
└────────┬────────┘
         │
         │ HTTPS
         ↓
┌─────────────────┐
│ api.heyphil.bot │  ← Backend (Railway)
│  (Express)      │
└────────┬────────┘
         │
         ├─→ Google OAuth
         │
         └─→ Google Sheets API
             (Origination Board data)
```

## Kanban Columns

1. **Backlog** - Projects not started
2. **In Progress** - Active work
3. **Review** - Awaiting review/approval
4. **Done** - Completed projects
