#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    serviceAccount: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || fs.existsSync(path.join(__dirname, '..', 'service-account.json')),
    timestamp: new Date().toISOString()
  });
});

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

// Google Sheets API with Service Account
const getSheets = () => {
  try {
    // Try to use service account first (preferred for automation)
    const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
    
    if (fs.existsSync(serviceAccountPath)) {
      console.log('Using local service-account.json');
      const credentials = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      return google.sheets({ version: 'v4', auth });
    }
    
    // Fallback to environment variable (for Railway deployment)
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      console.log('Using GOOGLE_SERVICE_ACCOUNT_JSON env variable');
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      console.log('Service account email:', credentials.client_email);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      return google.sheets({ version: 'v4', auth });
    }
    
    console.error('No service account credentials found!');
    throw new Error('No service account credentials found. Please set up service-account.json or GOOGLE_SERVICE_ACCOUNT_JSON env variable.');
  } catch (error) {
    console.error('Failed to initialize Google Sheets:', error.message);
    throw error;
  }
};

// Log activity to Log sheet (now includes Card ID)
const logActivity = async (sheets, spreadsheetId, cardTitle, action, user, details, cardId = null) => {
  try {
    const timestamp = new Date().toISOString();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Log!A:F',
      valueInputOption: 'RAW',
      resource: {
        values: [[timestamp, cardTitle, action, user, details, cardId || '']]
      }
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
    // Don't throw - logging failure shouldn't break the main action
  }
};

// ========== ORG CHARTS ENDPOINTS ==========

// Get all charts for current user
app.get('/api/orgcharts', requireAuth, async (req, res) => {
  try {
    const sheets = getSheets();
    const spreadsheetId = process.env.ORGCHART_SHEET_ID || process.env.ORIGINATION_SHEET_ID;
    
    if (!spreadsheetId) {
      return res.json({ charts: [] });
    }
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgCharts!A:F'
    });
    
    const rows = response.data.values || [];
    const charts = rows.slice(1).map(row => ({
      id: row[0],
      name: row[1],
      owner: row[2],
      createdAt: row[3],
      updatedAt: row[4],
      nodeCount: parseInt(row[5]) || 0
    })).filter(c => c.owner === req.user.email);
    
    res.json({ charts });
  } catch (error) {
    console.error('Failed to load charts:', error);
    res.status(500).json({ error: 'Failed to load charts' });
  }
});

// Get specific chart with nodes
app.get('/api/orgcharts/:id', requireAuth, async (req, res) => {
  try {
    const sheets = getSheets();
    const spreadsheetId = process.env.ORGCHART_SHEET_ID || process.env.ORIGINATION_SHEET_ID;
    const chartId = req.params.id;
    
    // Get chart metadata
    const chartResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgCharts!A:F'
    });
    
    const chartRows = chartResponse.data.values || [];
    const chartRow = chartRows.slice(1).find(row => row[0] === chartId);
    
    if (!chartRow || chartRow[2] !== req.user.email) {
      return res.status(404).json({ error: 'Chart not found' });
    }
    
    // Get nodes
    const nodesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgChartNodes!A:J'
    });
    
    const nodeRows = nodesResponse.data.values || [];
    const nodes = nodeRows.slice(1)
      .filter(row => row[0] === chartId)
      .map(row => ({
        id: row[1],
        title: row[2],
        name: row[3],
        department: row[4],
        email: row[5],
        phone: row[6],
        parentId: row[7] || null,
        x: parseInt(row[8]) || 0,
        y: parseInt(row[9]) || 0
      }));
    
    res.json({
      id: chartRow[0],
      name: chartRow[1],
      owner: chartRow[2],
      createdAt: chartRow[3],
      updatedAt: chartRow[4],
      nodes
    });
  } catch (error) {
    console.error('Failed to load chart:', error);
    res.status(500).json({ error: 'Failed to load chart' });
  }
});

// Create new chart
app.post('/api/orgcharts', requireAuth, async (req, res) => {
  try {
    console.log('Creating chart for user:', req.user.email);
    const sheets = getSheets();
    const spreadsheetId = process.env.ORGCHART_SHEET_ID || process.env.ORIGINATION_SHEET_ID;
    const { name } = req.body;
    
    console.log('Spreadsheet ID:', spreadsheetId);
    console.log('Chart name:', name);
    
    const chartId = Date.now().toString();
    const now = new Date().toISOString();
    
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'OrgCharts!A:F',
      valueInputOption: 'RAW',
      resource: {
        values: [[chartId, name, req.user.email, now, now, 0]]
      }
    });
    
    console.log('Chart created successfully:', chartId);
    res.json({ id: chartId, name, owner: req.user.email, createdAt: now, updatedAt: now, nodes: [] });
  } catch (error) {
    console.error('Failed to create chart:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Failed to create chart', details: error.message });
  }
});

// Update chart nodes
app.put('/api/orgcharts/:id', requireAuth, async (req, res) => {
  try {
    const sheets = getSheets();
    const spreadsheetId = process.env.ORGCHART_SHEET_ID || process.env.ORIGINATION_SHEET_ID;
    const chartId = req.params.id;
    const { nodes } = req.body;
    
    // Verify ownership
    const chartResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgCharts!A:F'
    });
    
    const chartRows = chartResponse.data.values || [];
    const chartRowIndex = chartRows.slice(1).findIndex(row => row[0] === chartId && row[2] === req.user.email);
    
    if (chartRowIndex === -1) {
      return res.status(404).json({ error: 'Chart not found' });
    }
    
    // Delete existing nodes for this chart
    const nodesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgChartNodes!A:J'
    });
    
    const existingRows = nodesResponse.data.values || [];
    const rowsToKeep = [existingRows[0]]; // Keep header
    existingRows.slice(1).forEach(row => {
      if (row[0] !== chartId) rowsToKeep.push(row);
    });
    
    // Add new nodes
    nodes.forEach(node => {
      rowsToKeep.push([
        chartId,
        node.id,
        node.title,
        node.name || '',
        node.department || '',
        node.email || '',
        node.phone || '',
        node.parentId || '',
        node.x || 0,
        node.y || 0
      ]);
    });
    
    // Write all nodes back
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'OrgChartNodes!A:J',
      valueInputOption: 'RAW',
      resource: { values: rowsToKeep }
    });
    
    // Update chart metadata
    const now = new Date().toISOString();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `OrgCharts!E${chartRowIndex + 2}:F${chartRowIndex + 2}`,
      valueInputOption: 'RAW',
      resource: { values: [[now, nodes.length]] }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update chart:', error);
    res.status(500).json({ error: 'Failed to update chart' });
  }
});

// Delete chart
app.delete('/api/orgcharts/:id', requireAuth, async (req, res) => {
  try {
    const sheets = getSheets();
    const spreadsheetId = process.env.ORGCHART_SHEET_ID || process.env.ORIGINATION_SHEET_ID;
    const chartId = req.params.id;
    
    // Verify ownership and delete chart
    const chartResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgCharts!A:F'
    });
    
    const chartRows = chartResponse.data.values || [];
    const filteredCharts = [chartRows[0]]; // Keep header
    chartRows.slice(1).forEach(row => {
      if (row[0] !== chartId || row[2] !== req.user.email) {
        filteredCharts.push(row);
      }
    });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'OrgCharts!A:F',
      valueInputOption: 'RAW',
      resource: { values: filteredCharts }
    });
    
    // Delete nodes
    const nodesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgChartNodes!A:J'
    });
    
    const nodeRows = nodesResponse.data.values || [];
    const filteredNodes = [nodeRows[0]]; // Keep header
    nodeRows.slice(1).forEach(row => {
      if (row[0] !== chartId) filteredNodes.push(row);
    });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'OrgChartNodes!A:J',
      valueInputOption: 'RAW',
      resource: { values: filteredNodes }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete chart:', error);
    res.status(500).json({ error: 'Failed to delete chart' });
  }
});

// ========== ORIGINATION BOARD ENDPOINTS ==========
app.get('/api/origination/board', requireAuth, async (req, res) => {
  try {
    const sheets = getSheets();
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    if (!spreadsheetId) {
      return res.json({ columns: [], cards: [], people: {} });
    }
    
    // Fetch board data (expanded to include deal value and date created)
    // A: Title, B: Description, C: Column, D: Owner, E: Notes, F: Card ID, G: Deal Value, H: Date Created
    const boardResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!A:I'
    });
    
    // Fetch people photos/colors and project type colors
    const backendResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Backend!A:F'
    });
    
    const boardRows = boardResponse.data.values || [];
    const backendRows = backendResponse.data.values || [];
    
    // Build people photo and color mapping + project type colors
    const people = {};
    const ownerColors = {};
    const projectTypeColors = {};
    
    backendRows.slice(1).forEach(row => {
      if (row[0]) {
        if (row[1]) people[row[0]] = row[1]; // person name -> photo URL
        if (row[2]) ownerColors[row[0]] = row[2]; // person name -> border color hex
      }
      if (row[4] && row[5]) { // Column E = project type, F = hex color
        projectTypeColors[row[4]] = row[5];
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
    
    // Fetch activity log (now includes Card ID in column F)
    const logResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Log!A:F'
    });
    const logRows = logResponse.data.values || [];
    const logsByCard = {};
    
    logRows.slice(1).forEach(row => {
      const cardId = row[5] || row[1]; // Try Card ID first, fallback to title for old logs
      if (cardId) {
        if (!logsByCard[cardId]) logsByCard[cardId] = [];
        logsByCard[cardId].push({
          timestamp: row[0],
          cardTitle: row[1],
          action: row[2],
          user: row[3],
          details: row[4]
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
      dealValue: parseFloat(row[6]) || 0,
      dateCreated: row[7] || new Date().toISOString(),
      projectType: row[8] || '', // Project Type from column I
      actions: actionsByCard[row[5]] || [],
      activity: logsByCard[row[5]] || [] // Use Card ID for activity lookup
    })).filter(card => card.id); // Only include cards with IDs
    
    // Calculate metrics
    const metrics = {
      totalDeals: cards.length,
      totalValue: cards.reduce((sum, c) => sum + c.dealValue, 0),
      byStage: {},
      avgTimeInStage: {}
    };
    
    cards.forEach(card => {
      if (!metrics.byStage[card.column]) {
        metrics.byStage[card.column] = { count: 0, value: 0 };
      }
      metrics.byStage[card.column].count++;
      metrics.byStage[card.column].value += card.dealValue;
      
      // Calculate days in current stage
      const created = new Date(card.dateCreated);
      const daysInStage = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
      card.daysInStage = daysInStage;
    });
    
    res.json({ cards, people, ownerColors, projectTypeColors, metrics });
  } catch (error) {
    console.error('Failed to fetch board:', error);
    res.status(500).json({ error: 'Failed to fetch board data' });
  }
});

app.post('/api/origination/card', requireAuth, async (req, res) => {
  try {
    const { title, description, column, owner, notes, dealValue, projectType } = req.body;
    const sheets = getSheets();
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    // Get all existing cards to find highest ID
    const allData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!F:F'
    });
    const rows = allData.data.values || [];
    
    // Find highest numeric ID (skip header row)
    let maxId = 999;
    rows.slice(1).forEach(row => {
      const id = parseInt(row[0]);
      if (!isNaN(id) && id > maxId) {
        maxId = id;
      }
    });
    
    // Increment for new card
    const cardId = maxId + 1;
    const dateCreated = new Date().toISOString();
    
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Board!A:I',
      valueInputOption: 'RAW',
      resource: {
        values: [[title, description, column, owner, notes, cardId, dealValue || 0, dateCreated, projectType || '']]
      }
    });
    
    // Log creation
    await logActivity(
      sheets,
      spreadsheetId,
      title,
      'Created',
      req.user.email,
      `New card in ${column}. Owner: ${owner || 'Unassigned'}`,
      cardId
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to create card:', error);
    res.status(500).json({ 
      error: 'Failed to create card',
      details: error.message,
      stack: error.stack 
    });
  }
});

app.put('/api/origination/card/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params; // Numeric card ID
    const { title, description, column, owner, notes, dealValue, projectType } = req.body;
    const sheets = getSheets();
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    // Find the row by Card ID
    const allData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!A:I'
    });
    const rows = allData.data.values || [];
    const rowIndex = rows.findIndex((row, idx) => idx > 0 && String(row[5]) === String(id));
    
    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    const actualRow = rowIndex + 1; // Convert to 1-indexed
    const oldRow = rows[rowIndex];
    const [oldTitle, oldDesc, oldColumn, oldOwner, oldNotes, cardId, oldDealValue, dateCreated, oldProjectType] = oldRow;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Board!A${actualRow}:I${actualRow}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[title, description, column, owner, notes, id, dealValue || 0, dateCreated || new Date().toISOString(), projectType || '']]
      }
    });
    
    // Log changes
    const changes = [];
    if (oldColumn !== column) changes.push(`Status: ${oldColumn} → ${column}`);
    if (oldOwner !== owner) changes.push(`Owner: ${oldOwner || 'Unassigned'} → ${owner || 'Unassigned'}`);
    if (oldTitle !== title) changes.push(`Title changed`);
    if (oldDesc !== description) changes.push(`Description updated`);
    if (oldNotes !== notes) changes.push(`Notes updated`);
    if (parseFloat(oldDealValue || 0) !== parseFloat(dealValue || 0)) {
      changes.push(`Deal value: $${oldDealValue || 0} → $${dealValue || 0}`);
    }
    if ((oldProjectType || '') !== (projectType || '')) {
      changes.push(`Project type: ${oldProjectType || 'None'} → ${projectType || 'None'}`);
    }
    
    if (changes.length > 0) {
      await logActivity(
        sheets,
        spreadsheetId,
        title,
        'Updated',
        req.user.email,
        changes.join(', '),
        id
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
    const { id } = req.params; // Numeric card ID
    const sheets = getSheets();
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    // Find the row by Card ID
    const allData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!A:I'
    });
    const rows = allData.data.values || [];
    const rowIndex = rows.findIndex((row, idx) => idx > 0 && String(row[5]) === String(id));
    
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

// Toggle action item completion
app.post('/api/origination/action/toggle', requireAuth, async (req, res) => {
  try {
    const { rowIndex, completed, cardId, cardTitle } = req.body;
    const sheets = getSheets();
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
      `Row ${rowIndex}`,
      cardId
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
    const sheets = getSheets();
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

// Bulk update cards
app.post('/api/origination/bulk-update', requireAuth, async (req, res) => {
  try {
    const { cardIds, updates } = req.body; // updates: { column?, owner? }
    const sheets = getSheets();
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    const allData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!A:H'
    });
    const rows = allData.data.values || [];
    
    for (const cardId of cardIds) {
      const rowIndex = rows.findIndex((row, idx) => idx > 0 && row[5] === cardId);
      if (rowIndex === -1) continue;
      
      const actualRow = rowIndex + 1;
      const row = rows[rowIndex];
      
      const updatedRow = [
        row[0], // title
        row[1], // description
        updates.column !== undefined ? updates.column : row[2],
        updates.owner !== undefined ? updates.owner : row[3],
        row[4], // notes
        row[5], // card ID
        row[6], // deal value
        row[7]  // date created
      ];
      
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Board!A${actualRow}:H${actualRow}`,
        valueInputOption: 'RAW',
        resource: { values: [updatedRow] }
      });
      
      // Log bulk update
      const changes = [];
      if (updates.column && row[2] !== updates.column) {
        changes.push(`Bulk moved: ${row[2]} → ${updates.column}`);
      }
      if (updates.owner && row[3] !== updates.owner) {
        changes.push(`Bulk assigned: ${updates.owner}`);
      }
      
      if (changes.length > 0) {
        await logActivity(
          sheets,
          spreadsheetId,
          row[0],
          'Bulk Update',
          req.user.email,
          changes.join(', '),
          cardId
        );
      }
    }
    
    res.json({ success: true, updated: cardIds.length });
  } catch (error) {
    console.error('Failed bulk update:', error);
    res.status(500).json({ error: 'Failed to bulk update cards' });
  }
});

// Export to CSV
app.get('/api/origination/export', requireAuth, async (req, res) => {
  try {
    const sheets = getSheets();
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    const boardResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Board!A:H'
    });
    const rows = boardResponse.data.values || [];
    
    // CSV header
    const csv = [
      'Title,Description,Stage,Owner,Notes,Card ID,Deal Value,Date Created'
    ];
    
    // Add data rows
    rows.slice(1).forEach(row => {
      const escapeCsv = (val) => {
        if (!val) return '';
        const str = String(val).replace(/"/g, '""');
        return str.includes(',') || str.includes('"') ? `"${str}"` : str;
      };
      
      csv.push([
        escapeCsv(row[0]),
        escapeCsv(row[1]),
        escapeCsv(row[2]),
        escapeCsv(row[3]),
        escapeCsv(row[4]),
        escapeCsv(row[5]),
        escapeCsv(row[6]),
        escapeCsv(row[7])
      ].join(','));
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=origination-board-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv.join('\n'));
  } catch (error) {
    console.error('Failed to export:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Serve static files from React app in production (MUST be after all API routes)
if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
  // Serve static files with proper cache headers
  app.use(express.static(path.join(__dirname, '../client/build'), {
    maxAge: '1h',  // Cache static assets for 1 hour
    setHeaders: (res, filePath) => {
      // Don't cache index.html or service workers
      if (filePath.endsWith('index.html') || filePath.endsWith('service-worker.js')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    }
  }));
  
  // All remaining requests return the React app, so it can handle routing
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// Start server
const host = process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : 'localhost';
app.listen(PORT, host, () => {
  console.log(`🚀 HeyPhil API running on http://${host}:${PORT}`);
});
