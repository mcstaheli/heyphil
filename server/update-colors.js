import { google } from 'googleapis';
import 'dotenv/config';

async function updateColors() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.ORIGINATION_SHEET_ID;

  // Owner colors (bold for borders) - Column C
  const ownerColors = [
    ['#3b82f6'],  // Chad - Blue
    ['#10b981'],  // Greg - Green
    ['#8b5cf6']   // Scott - Purple
  ];

  // Project type colors (subtle for backgrounds) - Columns E:F
  const projectTypes = [
    ['Studio', '#ff6b9d'],
    ['Innovation', '#fbbf24'],
    ['Development', '#60a5fa'],
    ['Hospitality', '#34d399'],
    ['Senior Living', '#a78bfa'],
    ['Philo', '#f87171']
  ];

  // Update owner colors (C2:C4)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Backend!C2:C4',
    valueInputOption: 'RAW',
    resource: { values: ownerColors }
  });

  // Update project types (E2:F7)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Backend!E2:F7',
    valueInputOption: 'RAW',
    resource: { values: projectTypes }
  });

  console.log('✅ Colors added to Backend sheet!');
}

updateColors().catch(console.error);
