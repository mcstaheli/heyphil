# HeyPhil App - Project Context

## What This Is
Personal project management and productivity tool with multiple apps:
- **Origination Board**: Kanban-style deal pipeline with 11 stages
- Email Triage: (planned)

## Stack
- **Client**: React app (port 3000)
- **Server**: Node.js/Express API (port 3002)
- **Database**: Google Sheets integration
- **Auth**: Google OAuth

## Current Work
- Just added two new stages to Origination Board:
  - Assets (blue, after IC - Close)
  - IC - Assets (gray, after Assets)

## Key Files
- `/client/src/App.js` - Main React app with Origination Board component
- `/server/index.js` - API server with auth and board endpoints
- `/server/origination-data.js` - Google Sheets integration

## Deployment
**⚠️ WE WORK ON PRODUCTION - NOT LOCALHOST**
- Production site: https://heyphil.bot
- Changes need to be deployed after editing code

## Deploy Process
**Railway auto-deploys from GitHub**

```bash
# After making code changes:
cd /Users/philo/clawd/heyphil-app

# 1. Build the client
cd client && npm run build

# 2. Commit and push (Railway auto-deploys)
cd ..
git add -A
git commit -m "Description of changes"
git push

# 3. Wait ~2-3 minutes for Railway to deploy
# 4. Check https://heyphil.bot
```

**GitHub repo:** https://github.com/mcstaheli/heyphil.git
**Deployment:** Railway (connected to main branch)

## Local Testing (rarely used)
- Frontend dev: http://localhost:3000
- Backend dev: http://localhost:3002

## Notes
- Server uses Google Sheets as database (originationData.getBoard(), etc.)
- **Always deploy after code changes**
- Check https://heyphil.bot after deployment
