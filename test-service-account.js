#!/usr/bin/env node

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function test() {
  try {
    console.log('🔧 Testing service account authentication...\n');
    
    const serviceAccountPath = path.join(__dirname, 'service-account.json');
    
    if (!fs.existsSync(serviceAccountPath)) {
      console.error('❌ service-account.json not found!');
      process.exit(1);
    }
    
    const credentials = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    console.log('✅ Service account loaded:', credentials.client_email);
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID || '1bdXv9eA4fbNDj4vGGZf2kU6v24yYaLow2BVVHWtZaYQ';
    console.log('📊 Testing access to sheet:', spreadsheetId);
    
    // Try to read a simple range
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!A1:B2'
    });
    
    console.log('\n✅ SUCCESS! Can access the sheet.');
    console.log('📄 Sample data:', JSON.stringify(response.data.values, null, 2));
    
  } catch (error) {
    console.error('\n❌ FAILED:', error.message);
    if (error.code === 403) {
      console.error('\n⚠️  Make sure you shared the sheet with:', credentials.client_email);
    }
    process.exit(1);
  }
}

test();
