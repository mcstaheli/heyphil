# Migration: Add Trash/Soft Delete Support

## What this does
Adds a `deleted_at` column to the `cards` table to support soft deletes (trash functionality).

## How to run

### On Railway (Production)
1. Go to Railway dashboard
2. Click on your service
3. Go to Settings > Variables
4. Make sure DATABASE_URL is set
5. Open a new deployment shell or run via the CLI:
   ```bash
   npm run migrate:deleted-at
   ```

### Locally (if testing)
```bash
cd heyphil-app
npm run migrate:deleted-at
```

## What it does
- Adds `deleted_at TIMESTAMP DEFAULT NULL` column to `cards` table
- Existing cards will have `deleted_at = NULL` (not deleted)
- Deleted cards will have `deleted_at = NOW()` (timestamp of deletion)
- `getAllCards()` now filters out deleted cards
- New endpoints:
  - `GET /api/origination/trash` - Get all deleted cards
  - `POST /api/origination/card/:id/restore` - Restore a deleted card

## UI Changes
- Added 🗑️ Trash button in the header next to Settings
- Opens modal showing deleted cards (most recent first)
- Each card has a ↩️ Restore button
- Deleted cards are soft-deleted (can be restored)
