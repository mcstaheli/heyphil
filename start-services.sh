#!/bin/bash
# Start heyphil chat services

cd "$(dirname "$0")"

# Kill any existing instances
pkill -9 -f "chat-notifier-service.js" 2>/dev/null
pkill -9 -f "heyphil.*server/index.js" 2>/dev/null
sleep 2

# Start server
nohup node server/index.js > server.log 2>&1 &
SERVER_PID=$!
echo "Server started (PID: $SERVER_PID)"

sleep 2

# Start chat notifier  
nohup node chat-notifier-service.js > chat-notifier.log 2>&1 &
NOTIFIER_PID=$!
echo "Chat notifier started (PID: $NOTIFIER_PID)"

sleep 2

# Verify running
echo ""
echo "Running processes:"
ps aux | grep -E "node.*(chat-notifier|server/index)" | grep -v grep | head -4

echo ""
echo "✅ Services started. Logs:"
echo "   Server: tail -f server.log"
echo "   Notifier: tail -f chat-notifier.log"
