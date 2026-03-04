# Railway Environment Variables for Instant Chat Notifications

To enable instant Telegram notifications when users send chat messages, add these environment variables to your Railway project:

## Required Variables

```
TELEGRAM_BOT_TOKEN=8097830867:AAFDcfZxfM7yyVHaFLe7hHzqfNr3uGEiO-w
TELEGRAM_CHAT_ID=8469369979
```

## How to Add in Railway:

1. Go to https://railway.app
2. Open the `heyphil-app` project
3. Click on the `server` service
4. Go to **Variables** tab
5. Click **+ New Variable**
6. Add each variable above
7. Click **Deploy** to apply changes

## What This Does:

When someone sends a message in the web chat:
- ✅ Instant notification sent to your Telegram
- ✅ Shows username, message preview, screenshot indicator
- ✅ You can respond within seconds
- ✅ No more 60-second polling delay!

## Test It:

1. Deploy with these variables
2. Send a test message in web chat
3. Get instant Telegram notification
4. Respond immediately
5. User sees your response in ~3 seconds

Response time improved from 60 seconds → 5 seconds! 🚀
