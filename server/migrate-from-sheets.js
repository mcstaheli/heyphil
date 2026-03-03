// Migration script: Copy data from Google Sheets to PostgreSQL
import { google } from 'googleapis';
import pg from 'pg';
const { Pool } = pg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// ES module dirname workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Google Sheets setup
function getSheets() {
  let credentials;
  
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } else {
    const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
    if (fs.existsSync(serviceAccountPath)) {
      credentials = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    } else {
      throw new Error('No Google credentials found');
    }
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({ version: 'v4', auth });
}

async function migrate() {
  console.log('🚀 Starting migration from Google Sheets to PostgreSQL...\n');
  
  const sheets = getSheets();
  const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
  
  if (!spreadsheetId) {
    console.error('❌ ORIGINATION_SHEET_ID not set');
    process.exit(1);
  }

  try {
    // 1. Create schema
    console.log('📋 Creating database schema...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ Schema created\n');

    // 2. Migrate People
    console.log('👥 Migrating people...');
    const backendResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Backend!A:F'
    });
    const backendRows = backendResponse.data.values || [];
    
    let peopleCount = 0;
    for (const row of backendRows.slice(1)) {
      if (row[0]) {
        await pool.query(
          'INSERT INTO people (name, photo_url, border_color) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET photo_url = $2, border_color = $3',
          [row[0], row[1] || null, row[2] || null]
        );
        peopleCount++;
      }
    }
    console.log(`✅ Migrated ${peopleCount} people\n`);

    // 3. Migrate Project Types
    console.log('🏷️  Migrating project types...');
    const projectTypeMap = {};
    let typesCount = 0;
    backendRows.slice(1).forEach(row => {
      if (row[4] && row[5]) {
        projectTypeMap[row[4]] = row[5];
      }
    });
    
    for (const [name, color] of Object.entries(projectTypeMap)) {
      await pool.query(
        'INSERT INTO project_types (name, color) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET color = $2',
        [name, color]
      );
      typesCount++;
    }
    console.log(`✅ Migrated ${typesCount} project types\n`);

    // 4. Migrate Cards
    console.log('🎴 Migrating cards...');
    const boardResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!A:I'
    });
    const boardRows = boardResponse.data.values || [];
    
    let cardsCount = 0;
    for (const row of boardRows.slice(1)) {
      if (row[5]) { // Card ID exists
        await pool.query(
          `INSERT INTO cards (id, title, description, column_name, owner, notes, deal_value, date_created, project_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             title = $2, description = $3, column_name = $4, owner = $5, notes = $6, 
             deal_value = $7, date_created = $8, project_type = $9`,
          [
            row[5],                                        // Card ID
            row[0] || 'Untitled',                         // Title
            row[1] || null,                               // Description
            row[2] || 'backlog',                          // Column
            row[3] || null,                               // Owner
            row[4] || null,                               // Notes
            row[6] ? parseFloat(row[6]) : null,          // Deal Value
            row[7] ? new Date(row[7]) : new Date(),      // Date Created
            row[8] || null                                // Project Type
          ]
        );
        cardsCount++;
      }
    }
    console.log(`✅ Migrated ${cardsCount} cards\n`);

    // 5. Migrate Actions (only for cards that exist)
    console.log('✔️  Migrating actions...');
    const actionsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Actions!A:E'
    });
    const actionsRows = actionsResponse.data.values || [];
    
    // Get set of valid card IDs
    const validCardIds = new Set((await pool.query('SELECT id FROM cards')).rows.map(r => r.id));
    
    let actionsCount = 0;
    let skippedActions = 0;
    for (const row of actionsRows.slice(1)) {
      if (row[0] && row[2]) { // Card ID and text exist
        // Skip if card doesn't exist
        if (!validCardIds.has(row[0])) {
          skippedActions++;
          continue;
        }
        
        await pool.query(
          `INSERT INTO actions (card_id, card_title, text, completed_on, completed_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            row[0],                                      // Card ID
            row[1] || null,                             // Card Title
            row[2],                                     // Text
            row[3] ? new Date(row[3]) : null,          // Completed On
            row[4] || null                              // Completed By
          ]
        );
        actionsCount++;
      }
    }
    console.log(`✅ Migrated ${actionsCount} actions (skipped ${skippedActions} orphaned)\n`);

    // 6. Migrate Activity Log (can have logs for deleted cards, that's ok)
    console.log('📜 Migrating activity log...');
    const logResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Log!A:F'
    });
    const logRows = logResponse.data.values || [];
    
    let logCount = 0;
    for (const row of logRows.slice(1)) {
      if (row[0]) { // Timestamp exists
        try {
          await pool.query(
            `INSERT INTO activity_log (timestamp, card_title, action, user_name, details, card_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              new Date(row[0]),    // Timestamp
              row[1] || null,      // Card Title
              row[2] || 'update',  // Action
              row[3] || null,      // User
              row[4] || null,      // Details
              row[5] || null       // Card ID (can be null for old logs)
            ]
          );
          logCount++;
        } catch (err) {
          // Skip invalid log entries
          console.log(`   Skipped invalid log entry: ${err.message}`);
        }
      }
    }
    console.log(`✅ Migrated ${logCount} log entries\n`);

    // 7. Verify migration
    console.log('🔍 Verifying migration...');
    const counts = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM cards) as cards,
        (SELECT COUNT(*) FROM actions) as actions,
        (SELECT COUNT(*) FROM activity_log) as logs,
        (SELECT COUNT(*) FROM people) as people,
        (SELECT COUNT(*) FROM project_types) as types
    `);
    
    console.log('\n📊 Final counts:');
    console.log(`   Cards: ${counts.rows[0].cards}`);
    console.log(`   Actions: ${counts.rows[0].actions}`);
    console.log(`   Activity Log: ${counts.rows[0].logs}`);
    console.log(`   People: ${counts.rows[0].people}`);
    console.log(`   Project Types: ${counts.rows[0].types}`);
    
    console.log('\n✨ Migration complete!\n');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migration
migrate()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
