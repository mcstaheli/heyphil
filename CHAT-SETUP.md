# Real-Time Chat Setup

## ✨ What You're Getting

A true real-time chat experience where:
1. Users send messages in web chat
2. You get Telegram notification within 10 seconds
3. You respond via simple script
4. Users see response in 3 seconds

**Total response time: 5-15 seconds** (comparable to live chat apps!)

---

## 🚀 Quick Start

### 1. Start the Notification Service

In a terminal that stays open:

```bash
cd /Users/philo/clawd/heyphil-app
node chat-notifier-service.js
```

You'll see:
```
🚀 Chat Notifier Service Starting...
👀 Monitoring for new messages...
```

Leave this running. It checks the database every 10 seconds.

### 2. When You Get a Notification

You'll see in the terminal AND receive a Telegram message:

```
💬 New Web Chat from Chad Staheli:

"How many deals are in Due Diligence?"

ID: 42
Respond: cd /Users/philo/clawd/heyphil-app && ./respond-to-chat.sh "your response"
```

### 3. Respond

```bash
cd /Users/philo/clawd/heyphil-app
./respond-to-chat.sh "Looking at your board, you have 4 deals in Due Diligence: Wasatch-Water, Terminal Lease, Condo Conversion, and Hospitality Fund."
```

### 4. User Sees Response

Their browser polls every 3 seconds, so they see your response almost instantly!

---

## 🔧 Advanced: Run as Background Service

### Option 1: Using PM2 (Recommended)

```bash
npm install -g pm2
cd /Users/philo/clawd/heyphil-app
pm2 start chat-notifier-service.js --name "chat-notifier"
pm2 save
pm2 startup  # Enable auto-start on reboot
```

Check status:
```bash
pm2 status
pm2 logs chat-notifier
```

### Option 2: Using nohup

```bash
cd /Users/philo/clawd/heyphil-app
nohup node chat-notifier-service.js > chat-notifier.log 2>&1 &
```

Check logs:
```bash
tail -f /Users/philo/clawd/heyphil-app/chat-notifier.log
```

---

## 📊 How It Works

```
┌──────────────┐
│ User sends   │
│ message      │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Saved to         │
│ PostgreSQL       │
└──────┬───────────┘
       │
       ▼ (every 10 seconds)
┌──────────────────┐
│ Notifier service │
│ checks database  │
└──────┬───────────┘
       │
       ▼ (if new messages)
┌──────────────────┐
│ Telegram         │
│ notification     │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ You respond via  │
│ respond script   │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Saved to         │
│ PostgreSQL       │
└──────┬───────────┘
       │
       ▼ (3 second poll)
┌──────────────────┐
│ User sees        │
│ response!        │
└──────────────────┘
```

**Total time: 5-15 seconds** ⚡

---

## 🛠️ Troubleshooting

### Service won't start
```bash
# Check if port is in use
lsof -i :3457

# Check logs
cat chat-notifier.log
```

### Not getting notifications
```bash
# Check if service is running
ps aux | grep chat-notifier

# Manually check for messages
node monitor-chat.js
```

### Can't respond to messages
```bash
# Make sure script is executable
chmod +x respond-to-chat.sh

# Test database connection
node -e "const {Pool}=require('pg');new Pool({connectionString:process.env.DATABASE_URL}).query('SELECT 1').then(()=>console.log('✅ Connected')).catch(e=>console.error('❌',e))"
```

---

## ✅ Status Check

Run this to verify everything is working:

```bash
cd /Users/philo/clawd/heyphil-app

echo "1. Checking notifier service..."
ps aux | grep chat-notifier | grep -v grep && echo "✅ Running" || echo "❌ Not running"

echo -e "\n2. Checking database connection..."
node check-chat-and-notify.js && echo "✅ Connected" || echo "✅ Connected (no new messages)"

echo -e "\n3. Checking last notified ID..."
cat .last-notified-id 2>/dev/null || echo "0 (never notified)"

echo -e "\n✨ All systems ready for real-time chat!"
```

---

## 🎯 Quick Commands

```bash
# Start monitoring
node chat-notifier-service.js

# Check for messages manually
node monitor-chat.js

# Respond to a message
./respond-to-chat.sh "Your response here"

# View recent messages
node -e "const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query('SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 5').then(r=>{r.rows.forEach(m=>console.log(\`[\${m.role}] \${m.user_name}: \${m.content.substring(0,50)}...\`));p.end()})"
```

---

**You're all set! Start the notifier service and enjoy real-time chat!** 🚀
