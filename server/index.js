#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { google } from 'googleapis';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3002;

// Allowed users
const ALLOWED_EMAILS = ['chad@philo.ventures', 'greg@example.com', 'scott@example.com'];

// Configure session
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
});

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

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Middleware
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
};

// Routes
app.get('/auth/google', passport.authenticate('google'));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/failed' }),
  (req, res) => {
    res.redirect(process.env.APP_URL || 'http://localhost:3000');
  }
);

app.get('/auth/status', (req, res) => {
  res.json({
    authenticated: req.isAuthenticated(),
    user: req.user ? {
      email: req.user.email,
      name: req.user.name,
      picture: req.user.picture
    } : null
  });
});

app.post('/auth/logout', (req, res) => {
  req.logout(() => {
    res.json({ success: true });
  });
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

// Origination board endpoints
app.get('/api/origination/board', requireAuth, async (req, res) => {
  try {
    const sheets = getSheets(req.user);
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    if (!spreadsheetId) {
      return res.json({ columns: [], cards: [] });
    }
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!A:F'
    });
    
    const rows = response.data.values || [];
    const cards = rows.slice(1).map((row, idx) => ({
      id: idx + 1,
      title: row[0] || '',
      description: row[1] || '',
      column: row[2] || 'backlog',
      owner: row[3] || '',
      dueDate: row[4] || '',
      notes: row[5] || ''
    }));
    
    res.json({ cards });
  } catch (error) {
    console.error('Failed to fetch board:', error);
    res.status(500).json({ error: 'Failed to fetch board data' });
  }
});

app.post('/api/origination/card', requireAuth, async (req, res) => {
  try {
    const { title, description, column, owner, dueDate, notes } = req.body;
    const sheets = getSheets(req.user);
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Board!A:F',
      valueInputOption: 'RAW',
      resource: {
        values: [[title, description, column, owner, dueDate, notes]]
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to create card:', error);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

app.put('/api/origination/card/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, column, owner, dueDate, notes } = req.body;
    const sheets = getSheets(req.user);
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    const rowIndex = parseInt(id) + 1; // +1 for header row
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Board!A${rowIndex}:F${rowIndex}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[title, description, column, owner, dueDate, notes]]
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update card:', error);
    res.status(500).json({ error: 'Failed to update card' });
  }
});

app.delete('/api/origination/card/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const sheets = getSheets(req.user);
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    const rowIndex = parseInt(id) + 1;
    
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
