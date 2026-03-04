#!/usr/bin/env node
// Monitor for new web chat messages and alert via console
// Run with: node monitor-chat.js

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:gOcOEhhjWYhlYGKYEtCsryktTycBEVbH@gondola.proxy.rlwy.net:25917/railway';
const pool = new Pool({ connectionString: DATABASE_URL });

const STATE_FILE = path.join(__dirname, '.last-message-id');

// Get last processed message ID
function getLastMessageId() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return parseInt(fs.readFileSync(STATE_FILE, 'utf8').trim());
    }
  } catch (err) {
    console.error('Error reading state file:', err);
  }
  return 0;
}

// Save last processed message ID
function saveLastMessageId(id) {
  fs.writeFileSync(STATE_FILE, id.toString());
}

// Check for new messages
async function checkForNewMessages() {
  const lastId = getLastMessageId();
  
  try {
    const result = await pool.query(
      'SELECT * FROM chat_messages WHERE id > $1 AND role = $2 ORDER BY created_at ASC',
      [lastId, 'user']
    );
    
    if (result.rows.length > 0) {
      console.log(`\n🔔 ${result.rows.length} NEW MESSAGE(S):\n`);
      
      result.rows.forEach(msg => {
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`💬 From: ${msg.user_name}`);
        console.log(`📝 Message: ${msg.content}`);
        if (msg.screenshot) {
          console.log(`📸 Screenshot: Attached (${msg.screenshot.length} bytes)`);
        }
        console.log(`🕐 Time: ${new Date(msg.created_at).toLocaleString()}`);
        console.log(`🆔 ID: ${msg.id}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        
        // Save the highest ID
        saveLastMessageId(msg.id);
      });
      
      console.log(`\n✅ To respond, run:\n`);
      console.log(`   ./respond-to-chat.sh "Your response here"\n`);
    } else {
      console.log(`✓ No new messages (last checked ID: ${lastId})`);
    }
  } catch (err) {
    console.error('❌ Error checking messages:', err);
  }
}

// Run once
checkForNewMessages().then(() => {
  pool.end();
  process.exit(0);
});
