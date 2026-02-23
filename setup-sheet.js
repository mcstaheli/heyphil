#!/usr/bin/env node

import { google } from 'googleapis';
import 'dotenv/config';

const SHEET_ID = process.env.ORIGINATION_SHEET_ID;

if (!SHEET_ID) {
  console.error('❌ ORIGINATION_SHEET_ID not set in .env');
  process.exit(1);
}

console.log('🔧 Setting up Origination Board sheet...');
console.log(`📊 Sheet ID: ${SHEET_ID}`);
console.log('\n👉 Steps to complete setup:\n');
console.log('1. Go to: https://docs.google.com/spreadsheets/d/' + SHEET_ID);
console.log('2. Create a new tab called "Board" (if it doesn\'t exist)');
console.log('3. In the Board tab, add this header row in A1:F1:');
console.log('   Title | Description | Column | Owner | Due Date | Notes');
console.log('\n4. Share the sheet with your Google account: chad@philo.ventures');
console.log('5. Give it "Editor" permissions\n');
console.log('✅ Once done, try creating a card in the app!');
