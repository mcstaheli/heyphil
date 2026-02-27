#!/usr/bin/env node

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupSheets() {
  try {
    console.log('🔧 Setting up OrgChart sheets...\n');
    
    const serviceAccountPath = path.join(__dirname, 'service-account.json');
    const credentials = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID || '1bdXv9eA4fbNDj4vGGZf2kU6v24yYaLow2BVVHWtZaYQ';
    
    // Get existing sheets
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
    
    console.log('📋 Existing sheets:', existingSheets.join(', '));
    
    const requests = [];
    
    // Create OrgCharts sheet if it doesn't exist
    if (!existingSheets.includes('OrgCharts')) {
      console.log('➕ Creating OrgCharts sheet...');
      requests.push({
        addSheet: {
          properties: {
            title: 'OrgCharts'
          }
        }
      });
    }
    
    // Create OrgChartData sheet if it doesn't exist
    if (!existingSheets.includes('OrgChartData')) {
      console.log('➕ Creating OrgChartData sheet...');
      requests.push({
        addSheet: {
          properties: {
            title: 'OrgChartData'
          }
        }
      });
    }
    
    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests }
      });
      console.log('✅ New sheets created!\n');
    } else {
      console.log('✅ All sheets already exist!\n');
    }
    
    // Add headers to OrgCharts if needed
    const orgChartsRange = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgCharts!A1:G1'
    });
    
    if (!orgChartsRange.data.values || orgChartsRange.data.values.length === 0) {
      console.log('📝 Adding headers to OrgCharts...');
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'OrgCharts!A1:G1',
        valueInputOption: 'RAW',
        resource: {
          values: [['ID', 'Name', 'Owner', 'Created At', 'Updated At', 'Node Count', 'Connection Count']]
        }
      });
      console.log('✅ OrgCharts headers added!');
    }
    
    // Add headers to OrgChartData if needed
    const dataRange = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgChartData!A1:C1'
    });
    
    if (!dataRange.data.values || dataRange.data.values.length === 0) {
      console.log('📝 Adding headers to OrgChartData...');
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'OrgChartData!A1:C1',
        valueInputOption: 'RAW',
        resource: {
          values: [['Chart ID', 'Type', 'Data (JSON)']]
        }
      });
      console.log('✅ OrgChartData headers added!');
    }
    
    console.log('\n🎉 Setup complete! Your sheets are ready for org charts.');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

setupSheets();
