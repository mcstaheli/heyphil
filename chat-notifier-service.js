#!/usr/bin/env node
// Real-time chat notification service
// Monitors database every 10 seconds and sends Telegram notifications

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { setTyping } from './server/typing-status.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:gOcOEhhjWYhlYGKYEtCsryktTycBEVbH@gondola.proxy.rlwy.net:25917/railway';
const STATE_FILE = path.join(__dirname, '.last-notified-id');
const CHECK_INTERVAL = 10000; // 10 seconds

let pool;

function getLastNotifiedId() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return parseInt(fs.readFileSync(STATE_FILE, 'utf8').trim());
    }
  } catch (err) {
    console.error('Error reading state:', err);
  }
  return 0;
}

function saveLastNotifiedId(id) {
  fs.writeFileSync(STATE_FILE, id.toString());
}

async function checkAndNotify() {
  const lastId = getLastNotifiedId();
  
  try {
    const result = await pool.query(
      'SELECT * FROM chat_messages WHERE id > $1 AND role = $2 ORDER BY created_at ASC',
      [lastId, 'user']
    );
    
    if (result.rows.length > 0) {
      console.log(`\n🔔 ${result.rows.length} new message(s) found!`);
      
      // Set typing indicator immediately
      setTyping(true);
      console.log('💭 Typing indicator activated');
      
      for (const msg of result.rows) {
        console.log('━'.repeat(60));
        console.log(`💬 Web Chat from ${msg.user_name} (ID: ${msg.id})`);
        console.log(`   Message: "${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}"`);
        console.log('━'.repeat(60));
        
        // Spawn a Clawdbot sub-agent to handle this message
        try {
          const task = `You received a web chat message from ${msg.user_name}:

"${msg.content}"

Respond naturally and helpfully. When you have your response ready, post it back to the web chat using:

cd /Users/philo/clawd/heyphil-app && ./respond-to-chat.sh "your response text here"

Make sure to actually run the command - don't just suggest it.`;

          console.log('🤖 Spawning Clawdbot sub-agent to respond...');
          
          // Use sessions_spawn via Clawdbot CLI
          await execAsync(`clawdbot session spawn --label "webchat-${msg.id}" --task "${task.replace(/"/g, '\\"')}" --cleanup delete`);
          
          console.log('✅ Sub-agent spawned - it will respond automatically');
        } catch (err) {
          console.error('⚠️  Failed to spawn sub-agent:', err.message);
          
          // Fallback: just notify the main session
          const fallbackMsg = `❌ Auto-response failed. Manual response needed:\n\nFrom ${msg.user_name}: "${msg.content}"\n\nID: ${msg.id}\nRespond: cd /Users/philo/clawd/heyphil-app && ./respond-to-chat.sh "your response"`;
          try {
            const tmpFile = path.join(__dirname, '.tmp-notification.txt');
            fs.writeFileSync(tmpFile, fallbackMsg);
            await execAsync(`clawdbot message send --channel telegram --target 8469369979 --message "$(cat ${tmpFile})"`);
            fs.unlinkSync(tmpFile);
          } catch (e) {
            console.error('⚠️  Fallback notification also failed:', e.message);
          }
        }
        
        saveLastNotifiedId(msg.id);
      }
    } else {
      process.stdout.write('.');
    }
  } catch (err) {
    console.error('\n❌ Error checking messages:', err.message);
  }
}

async function start() {
  console.log('🚀 Chat Notifier Service Starting...');
  console.log(`   Database: ${DATABASE_URL.substring(0, 50)}...`);
  console.log(`   Check interval: ${CHECK_INTERVAL / 1000}s`);
  console.log(`   Starting from message ID: ${getLastNotifiedId()}`);
  console.log('\n👀 Monitoring for new messages...\n');
  
  pool = new Pool({ connectionString: DATABASE_URL });
  
  // Initial check
  await checkAndNotify();
  
  // Set up interval
  setInterval(checkAndNotify, CHECK_INTERVAL);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n👋 Shutting down gracefully...');
  if (pool) await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n👋 Shutting down gracefully...');
  if (pool) await pool.end();
  process.exit(0);
});

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
