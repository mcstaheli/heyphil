#!/usr/bin/env node
// Checks database for new chat messages and prints notification
// Run this as a cron job every 10 seconds

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:gOcOEhhjWYhlYGKYEtCsryktTycBEVbH@gondola.proxy.rlwy.net:25917/railway';
const STATE_FILE = path.join(__dirname, '.last-checked-id');

async function checkForNewMessages() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  
  try {
    // Get last checked ID
    let lastId = 0;
    if (fs.existsSync(STATE_FILE)) {
      lastId = parseInt(fs.readFileSync(STATE_FILE, 'utf8').trim());
    }
    
    // Query for new user messages
    const result = await pool.query(
      'SELECT * FROM chat_messages WHERE id > $1 AND role = $2 ORDER BY created_at ASC',
      [lastId, 'user']
    );
    
    if (result.rows.length > 0) {
      // Found new messages! 
      for (const msg of result.rows) {
        const preview = msg.content.length > 200 ? msg.content.substring(0, 200) + '...' : msg.content;
        console.log(`NEW_CHAT_MESSAGE|${msg.id}|${msg.user_name}|${preview}|${msg.screenshot ? 'yes' : 'no'}`);
        
        // Update last checked ID
        fs.writeFileSync(STATE_FILE, msg.id.toString());
      }
      
      process.exit(1); // Exit with code 1 to signal "new messages found"
    } else {
      // No new messages
      process.exit(0);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(2);
  } finally {
    await pool.end();
  }
}

checkForNewMessages();
