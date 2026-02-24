#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { google } from 'googleapis';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3002;

// Allowed users
const ALLOWED_EMAILS = ['chad@philo.ventures', 'greg@example.com', 'scott@example.com'];

const JWT_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';

// Configure Google OAuth
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.API_URL || 'http://localhost:3002'}/auth/google/callback`,
      scope: ['profile', 'email', 'https://www.googleapis.com/auth/spreadsheets'],
      accessType: 'offline',
      prompt: 'consent'
    },
    (accessToken, refreshToken, profile, done) => {
      const email = profile.emails[0].value;
      
      if (!ALLOWED_EMAILS.includes(email)) {
        return done(null, false, { message: 'Unauthorized email' });
      }
      
      const user = {
        id: profile.id,
        email: email,
        name: profile.displayName,
        picture: profile.photos[0]?.value,
        accessToken,
        refreshToken
      };
      
      return done(null, user);
    }
  )
);

// Middleware
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(passport.initialize());

// JWT verification middleware
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Routes
app.get('/auth/google', passport.authenticate('google'));

app.get('/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/auth/failed' }),
  (req, res) => {
    // Generate JWT
    const token = jwt.sign(
      {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        picture: req.user.picture,
        accessToken: req.user.accessToken,
        refreshToken: req.user.refreshToken
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Redirect to frontend with token
    const redirectUrl = `${process.env.APP_URL || 'http://localhost:3000'}?token=${token}`;
    res.redirect(redirectUrl);
  }
);

app.get('/auth/status', requireAuth, (req, res) => {
  res.json({
    authenticated: true,
    user: {
      email: req.user.email,
      name: req.user.name,
      picture: req.user.picture
    }
  });
});

app.post('/auth/logout', (req, res) => {
  res.json({ success: true });
});

// Google Sheets API
const getSheets = (user) => {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken
  });
  return google.sheets({ version: 'v4', auth });
};

// Log activity to Log sheet
const logActivity = async (sheets, spreadsheetId, cardTitle, action, user, details) => {
  try {
    const timestamp = new Date().toISOString();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Log!A:E',
      valueInputOption: 'RAW',
      resource: {
        values: [[timestamp, cardTitle, action, user, details]]
      }
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
    // Don't throw - logging failure shouldn't break the main action
  }
};

// Origination board endpoints
app.get('/api/origination/board', requireAuth, async (req, res) => {
  try {
    const sheets = getSheets(req.user);
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    if (!spreadsheetId) {
      return res.json({ columns: [], cards: [], people: {} });
    }
    
    // Fetch board data (Card ID in column F, removed Due Date)
    const boardResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!A:F'
    });
    
    // Fetch people photos
    const backendResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Backend!A:B'
    });
    
    const boardRows = boardResponse.data.values || [];
    const backendRows = backendResponse.data.values || [];
    
    // Build people photo mapping
    const people = {};
    backendRows.slice(1).forEach(row => {
      if (row[0] && row[1]) {
        people[row[0]] = row[1]; // person name -> photo URL
      }
    });
    
    // Fetch actions
    const actionsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Actions!A:E'
    });
    const actionsRows = actionsResponse.data.values || [];
    const actionsByCard = {};
    
    actionsRows.slice(1).forEach((row, idx) => {
      const cardId = row[0];
      if (cardId) {
        if (!actionsByCard[cardId]) actionsByCard[cardId] = [];
        actionsByCard[cardId].push({
          rowIndex: idx + 2, // 1-indexed + header row
          cardId: row[0],
          cardTitle: row[1] || '',
          text: row[2] || '',
          completedOn: row[3] || null,
          completedBy: row[4] || null
        });
      }
    });
    
    const cards = boardRows.slice(1).map((row) => ({
      id: row[5] || '', // Card ID from column F
      title: row[0] || '',
      description: row[1] || '',
      column: row[2] || 'ideation',
      owner: row[3] || '',
      notes: row[4] || '',
      actions: actionsByCard[row[5]] || []
    })).filter(card => card.id); // Only include cards with IDs
    
    res.json({ cards, people });
  } catch (error) {
    console.error('Failed to fetch board:', error);
    res.status(500).json({ error: 'Failed to fetch board data' });
  }
});

app.post('/api/origination/card', requireAuth, async (req, res) => {
  try {
    const { title, description, column, owner, notes } = req.body;
    const sheets = getSheets(req.user);
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    // Generate unique ID (timestamp + random)
    const cardId = `card_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Board!A:F',
      valueInputOption: 'RAW',
      resource: {
        values: [[title, description, column, owner, notes, cardId]]
      }
    });
    
    // Log creation
    await logActivity(
      sheets,
      spreadsheetId,
      title,
      'Created',
      req.user.email,
      `New card in ${column}. Owner: ${owner || 'Unassigned'}`
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to create card:', error);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

app.put('/api/origination/card/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params; // This is now the cardId, not row index
    const { title, description, column, owner, notes } = req.body;
    const sheets = getSheets(req.user);
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    // Find the row by Card ID
    const allData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!A:F'
    });
    const rows = allData.data.values || [];
    const rowIndex = rows.findIndex((row, idx) => idx > 0 && row[5] === id);
    
    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    const actualRow = rowIndex + 1; // Convert to 1-indexed
    const oldRow = rows[rowIndex];
    const [oldTitle, oldDesc, oldColumn, oldOwner, oldNotes] = oldRow;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Board!A${actualRow}:F${actualRow}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[title, description, column, owner, notes, id]]
      }
    });
    
    // Log changes
    const changes = [];
    if (oldColumn !== column) changes.push(`Status: ${oldColumn} → ${column}`);
    if (oldOwner !== owner) changes.push(`Owner: ${oldOwner || 'Unassigned'} → ${owner || 'Unassigned'}`);
    if (oldTitle !== title) changes.push(`Title changed`);
    if (oldDesc !== description) changes.push(`Description updated`);
    if (oldNotes !== notes) changes.push(`Actions updated`);
    
    if (changes.length > 0) {
      await logActivity(
        sheets,
        spreadsheetId,
        title,
        'Updated',
        req.user.email,
        changes.join(', ')
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update card:', error);
    res.status(500).json({ error: 'Failed to update card' });
  }
});

app.delete('/api/origination/card/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params; // This is now the cardId
    const sheets = getSheets(req.user);
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    // Find the row by Card ID
    const allData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!A:F'
    });
    const rows = allData.data.values || [];
    const rowIndex = rows.findIndex((row, idx) => idx > 0 && row[5] === id);
    
    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: 0,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1
            }
          }
        }]
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete card:', error);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

// Start server
const host = process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : 'localhost';
app.listen(PORT, host, () => {
  console.log(`🚀 HeyPhil API running on http://${host}:${PORT}`);
});

// Toggle action item completion
app.post('/api/origination/action/toggle', requireAuth, async (req, res) => {
  try {
    const { rowIndex, completed, cardId, cardTitle } = req.body;
    const sheets = getSheets(req.user);
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    const user = req.user.name || req.user.email;
    
    const timestamp = completed ? new Date().toISOString() : '';
    const completedBy = completed ? user : '';
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Actions!D${rowIndex}:E${rowIndex}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[timestamp, completedBy]]
      }
    });
    
    // Log activity
    await logActivity(
      sheets,
      spreadsheetId,
      cardTitle,
      completed ? 'Action Completed' : 'Action Uncompleted',
      user,
      `Row ${rowIndex}`
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to toggle action:', error);
    res.status(500).json({ error: 'Failed to toggle action' });
  }
});

// Add new action item
app.post('/api/origination/action', requireAuth, async (req, res) => {
  try {
    const { cardId, cardTitle, text } = req.body;
    const sheets = getSheets(req.user);
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Actions!A:E',
      valueInputOption: 'RAW',
      resource: {
        values: [[cardId, cardTitle, text, '', '']]
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to add action:', error);
    res.status(500).json({ error: 'Failed to add action' });
  }
});
