#!/usr/bin/env node

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import 'dotenv/config';
import * as boardDb from './board-db.js';
import pool from './db.js';
import { getTypingStatus } from './typing-status.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [
      'http://localhost:3000',
      'https://heyphil.bot',
      'https://www.heyphil.bot',
      process.env.CLIENT_URL
    ].filter(Boolean),
    credentials: true
  }
});

const PORT = process.env.PORT || 3002;

// Auto-migrate: Add deleted_at column if it doesn't exist
async function autoMigrate() {
  try {
    await pool.query(`
      ALTER TABLE cards 
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL
    `);
    console.log('✅ Database migration: deleted_at column ready');
  } catch (error) {
    console.error('⚠️  Migration warning (may be safe to ignore):', error.message);
  }
}
autoMigrate();

// Allowed users
const ALLOWED_EMAILS = ['chad@philo.ventures', 'tracy.stratton@philo.ventures', 'greg@philo.ventures', 'scott@philo.ventures'];

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

// ========== WEBSOCKET CONNECTION ==========
io.on('connection', (socket) => {
  console.log('✅ WebSocket client connected:', socket.id, 'from', socket.handshake.address);
  console.log('   Total clients:', io.engine.clientsCount);
  
  socket.on('disconnect', (reason) => {
    console.log('❌ WebSocket client disconnected:', socket.id, 'reason:', reason);
    console.log('   Remaining clients:', io.engine.clientsCount);
  });
  
  socket.on('error', (err) => {
    console.error('❌ WebSocket error:', socket.id, err);
  });
  
  // Clients will receive:
  // - card:created
  // - card:updated
  // - card:deleted
  // - action:toggled
  // - action:created
  // - action:deleted
});

// Helper: Broadcast change to all connected clients
function broadcastChange(event, data) {
  const clientCount = io.engine.clientsCount;
  console.log(`📡 Broadcasting ${event} to ${clientCount} clients:`, data.id || data.cardId || data.actionId || '');
  io.emit(event, data);
}

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

// Get all charts for user
app.get('/api/orgcharts', requireAuth, async (req, res) => {
  try {
    const sheets = getSheets();
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgCharts!A:G'
    });
    
    const rows = response.data.values || [];
    const charts = rows.slice(1)
      .filter(row => row[2] === req.user.email)
      .map(row => ({
        id: row[0],
        name: row[1],
        owner: row[2],
        createdAt: row[3],
        updatedAt: row[4],
        nodeCount: parseInt(row[5]) || 0,
        connectionCount: parseInt(row[6]) || 0
      }));
    
    res.json({ charts });
  } catch (error) {
    console.error('Failed to load charts:', error);
    res.status(500).json({ error: 'Failed to load charts' });
  }
});

// Get specific chart
app.get('/api/orgcharts/:id', requireAuth, async (req, res) => {
  try {
    const sheets = getSheets();
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    const chartId = req.params.id;
    
    // Get chart metadata
    const chartResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgCharts!A:G'
    });
    
    const chartRows = chartResponse.data.values || [];
    const chartRow = chartRows.slice(1).find(row => row[0] === chartId && row[2] === req.user.email);
    
    if (!chartRow) {
      return res.status(404).json({ error: 'Chart not found' });
    }
    
    // Get chart data
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgChartData!A:C'
    });
    
    const dataRows = dataResponse.data.values || [];
    const nodes = [];
    const connections = [];
    
    dataRows.slice(1).forEach(row => {
      if (row[0] === chartId) {
        try {
          const data = JSON.parse(row[2]);
          if (row[1] === 'node') nodes.push(data);
          if (row[1] === 'connection') connections.push(data);
        } catch (e) {
          console.error('Failed to parse data:', e);
        }
      }
    });
    
    res.json({
      id: chartRow[0],
      name: chartRow[1],
      owner: chartRow[2],
      createdAt: chartRow[3],
      updatedAt: chartRow[4],
      nodeCount: nodes.length,
      connectionCount: connections.length,
      nodes,
      connections
    });
  } catch (error) {
    console.error('Failed to load chart:', error);
    res.status(500).json({ error: 'Failed to load chart' });
  }
});

// Create new chart
app.post('/api/orgcharts', requireAuth, async (req, res) => {
  try {
    console.log('Creating chart for:', req.user.email);
    const sheets = getSheets();
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    const { name } = req.body;
    
    console.log('Spreadsheet ID:', spreadsheetId);
    console.log('Chart name:', name);
    
    if (!spreadsheetId) {
      console.error('No spreadsheet ID configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    const chartId = Date.now().toString();
    const now = new Date().toISOString();
    
    console.log('Attempting to append to OrgCharts sheet...');
    
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'OrgCharts!A:G',
      valueInputOption: 'RAW',
      resource: {
        values: [[chartId, name, req.user.email, now, now, 0, 0]]
      }
    });
    
    console.log('Chart created successfully:', chartId);
    
    res.json({
      id: chartId,
      name,
      owner: req.user.email,
      createdAt: now,
      updatedAt: now,
      nodeCount: 0,
      connectionCount: 0,
      nodes: [],
      connections: []
    });
  } catch (error) {
    console.error('Failed to create chart - Full error:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to create chart',
      details: error.message 
    });
  }
});

// Update chart
app.put('/api/orgcharts/:id', requireAuth, async (req, res) => {
  try {
    const sheets = getSheets();
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    const chartId = req.params.id;
    const { nodes, connections } = req.body;
    
    // Verify ownership
    const chartResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgCharts!A:G'
    });
    
    const chartRows = chartResponse.data.values || [];
    const chartRowIndex = chartRows.slice(1).findIndex(row => row[0] === chartId && row[2] === req.user.email);
    
    if (chartRowIndex === -1) {
      return res.status(404).json({ error: 'Chart not found' });
    }
    
    // Delete existing data for this chart
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgChartData!A:C'
    });
    
    const existingRows = dataResponse.data.values || [];
    const rowsToKeep = [existingRows[0]]; // Keep header
    existingRows.slice(1).forEach(row => {
      if (row[0] !== chartId) rowsToKeep.push(row);
    });
    
    // Add new data
    nodes.forEach(node => {
      rowsToKeep.push([chartId, 'node', JSON.stringify(node)]);
    });
    
    connections.forEach(conn => {
      rowsToKeep.push([chartId, 'connection', JSON.stringify(conn)]);
    });
    
    // Write data back
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'OrgChartData!A:C',
      valueInputOption: 'RAW',
      resource: { values: rowsToKeep }
    });
    
    // Update metadata
    const now = new Date().toISOString();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `OrgCharts!E${chartRowIndex + 2}:G${chartRowIndex + 2}`,
      valueInputOption: 'RAW',
      resource: { values: [[now, nodes.length, connections.length]] }
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
    const spreadsheetId = process.env.ORIGINATION_SHEET_ID;
    const chartId = req.params.id;
    
    console.log('Delete request:', { chartId, userEmail: req.user.email });
    
    // Delete chart metadata
    const chartResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgCharts!A:G'
    });
    
    const chartRows = chartResponse.data.values || [];
    console.log('Total chart rows before delete:', chartRows.length);
    
    const filteredCharts = [chartRows[0]]; // Keep header
    let deletedCount = 0;
    chartRows.slice(1).forEach(row => {
      if (row[0] !== chartId || row[2] !== req.user.email) {
        filteredCharts.push(row);
      } else {
        deletedCount++;
        console.log('Deleting chart row:', { id: row[0], email: row[2], name: row[1] });
      }
    });
    
    console.log('Charts deleted:', deletedCount);
    console.log('Rows after filter:', filteredCharts.length);
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'OrgCharts!A:G',
      valueInputOption: 'RAW',
      resource: { values: filteredCharts }
    });
    
    // Delete chart data
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'OrgChartData!A:C'
    });
    
    const dataRows = dataResponse.data.values || [];
    const filteredData = [dataRows[0]]; // Keep header
    dataRows.slice(1).forEach(row => {
      if (row[0] !== chartId) filteredData.push(row);
    });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'OrgChartData!A:C',
      valueInputOption: 'RAW',
      resource: { values: filteredData }
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
    const data = await boardDb.getBoardData();
    
    // Calculate metrics with proper null handling
    const filteredCards = data.cards.filter(c => 
      c.column !== 'ideation' && c.column !== 'closed' && c.column !== 'abandoned'
    );
    
    // Group by stage for detailed metrics
    const byStage = {};
    filteredCards.forEach(card => {
      if (!byStage[card.column]) {
        byStage[card.column] = { count: 0, value: 0 };
      }
      byStage[card.column].count++;
      byStage[card.column].value += parseFloat(card.dealValue) || 0;
    });
    
    const metrics = {
      totalDeals: filteredCards.length,
      totalValue: filteredCards.reduce((sum, c) => sum + (parseFloat(c.dealValue) || 0), 0),
      totalDealValue: filteredCards.reduce((sum, c) => sum + (parseFloat(c.dealValue) || 0), 0),
      totalProjects: filteredCards.length,
      activeProjects: filteredCards.filter(c => 
        c.column !== 'backlog' && c.column !== 'closed' && c.column !== 'abandoned'
      ).length,
      byStage
    };
    
    res.json({ 
      cards: data.cards,
      people: data.people,
      ownerColors: data.ownerColors,
      projectTypeColors: data.projectTypeColors,
      metrics
    });
  } catch (error) {
    console.error('Failed to fetch board:', error);
    res.status(500).json({ error: 'Failed to fetch board data' });
  }
});

// DEPRECATED: Old Sheets-based endpoint (keeping structure for reference)
app.get('/api/origination/board__OLD_SHEETS', requireAuth, async (req, res) => {
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
    
    // Input validation
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (title.length > 500) {
      return res.status(400).json({ error: 'Title must be 500 characters or less' });
    }
    if (description && description.length > 10000) {
      return res.status(400).json({ error: 'Description must be 10,000 characters or less' });
    }
    if (!column || column.trim().length === 0) {
      return res.status(400).json({ error: 'Column is required' });
    }
    if (dealValue && (isNaN(dealValue) || dealValue < 0 || dealValue > 999999999999)) {
      return res.status(400).json({ error: 'Deal value must be a valid positive number' });
    }
    if (notes && notes.length > 10000) {
      return res.status(400).json({ error: 'Notes must be 10,000 characters or less' });
    }
    
    // Generate unique card ID
    const cardId = `card_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create card in database
    const card = await boardDb.createCard({
      id: cardId,
      title,
      description,
      column,
      owner,
      notes,
      dealValue: dealValue || 0,
      dateCreated: new Date(),
      projectType
    });
    
    // Log creation
    await boardDb.addLog(
      cardId,
      title,
      'Created',
      req.user.name || req.user.email,
      `New card in ${column}. Owner: ${owner || 'Unassigned'}`
    );
    
    // Broadcast to all clients
    broadcastChange('card:created', card);
    
    res.json({ success: true, card });
  } catch (error) {
    console.error('Failed to create card:', error);
    res.status(500).json({ 
      error: 'Failed to create card',
      details: error.message
    });
  }
});

app.put('/api/origination/card/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, column, owner, notes, dealValue, projectType } = req.body;
    
    // Get old card for change tracking
    const oldCard = await boardDb.getCardById(id);
    if (!oldCard) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    // Update in database
    const updatedCard = await boardDb.updateCard(id, {
      title,
      description,
      column,
      owner,
      notes,
      dealValue,
      projectType
    });
    
    // Log changes
    const changes = [];
    if (oldCard.column_name !== column) changes.push(`Status: ${oldCard.column_name} → ${column}`);
    if (oldCard.owner !== owner) changes.push(`Owner: ${oldCard.owner || 'Unassigned'} → ${owner || 'Unassigned'}`);
    if (oldCard.title !== title) changes.push(`Title changed`);
    if (oldCard.description !== description) changes.push(`Description updated`);
    if (oldCard.notes !== notes) changes.push(`Notes updated`);
    if (parseFloat(oldCard.deal_value || 0) !== parseFloat(dealValue || 0)) {
      changes.push(`Deal value: $${oldCard.deal_value || 0} → $${dealValue || 0}`);
    }
    if ((oldCard.project_type || '') !== (projectType || '')) {
      changes.push(`Project type: ${oldCard.project_type || 'None'} → ${projectType || 'None'}`);
    }
    
    if (changes.length > 0) {
      await boardDb.addLog(
        id,
        title,
        'Updated',
        req.user.name || req.user.email,
        changes.join(', ')
      );
    }
    
    // Broadcast to all clients
    broadcastChange('card:updated', {
      id,
      title,
      description,
      column,
      owner,
      notes,
      dealValue,
      projectType
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
    
    // Get card details before deletion for logging
    const card = await boardDb.getCardById(id);
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    // Soft delete from database
    await boardDb.deleteCard(id);
    
    // Log deletion
    await boardDb.addLog(
      id,
      card.title,
      'Deleted',
      req.user.name || req.user.email,
      `Card moved to trash`
    );
    
    // Broadcast to all clients
    broadcastChange('card:deleted', { id });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete card:', error);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

// Get deleted cards (trash)
app.get('/api/origination/trash', requireAuth, async (req, res) => {
  try {
    const deletedCards = await boardDb.getDeletedCards();
    res.json({ cards: deletedCards });
  } catch (error) {
    console.error('Failed to get deleted cards:', error);
    res.status(500).json({ error: 'Failed to get deleted cards' });
  }
});

// Restore a deleted card
app.post('/api/origination/card/:id/restore', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get card details for logging
    const card = await boardDb.getCardById(id);
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    // Restore the card
    await boardDb.restoreCard(id);
    
    // Log restoration
    await boardDb.addLog(
      id,
      card.title,
      'Restored',
      req.user.name || req.user.email,
      `Card restored from trash`
    );
    
    // Get the restored card with all data
    const restoredCard = await boardDb.getCardById(id);
    const actions = await boardDb.getActionsByCardId(id);
    const links = await boardDb.getLinksByCardId(id);
    
    // Broadcast to all clients
    broadcastChange('card:created', {
      ...restoredCard,
      actions,
      links
    });
    
    res.json({ success: true, card: restoredCard });
  } catch (error) {
    console.error('Failed to restore card:', error);
    res.status(500).json({ error: 'Failed to restore card' });
  }
});

// Toggle action item completion
app.post('/api/origination/action/toggle', requireAuth, async (req, res) => {
  try {
    const { actionId, completed, cardId, cardTitle } = req.body;
    const user = req.user.name || req.user.email;
    
    // Toggle action in database
    const action = await boardDb.toggleAction(actionId, completed, user);
    
    // Log activity
    await boardDb.addLog(
      cardId,
      cardTitle,
      completed ? 'Action Completed' : 'Action Uncompleted',
      user,
      action.text
    );
    
    // Broadcast to all clients
    broadcastChange('action:toggled', {
      actionId,
      cardId,
      completed,
      completedOn: action.completed_on,
      completedBy: action.completed_by
    });
    
    res.json({ success: true, action });
  } catch (error) {
    console.error('Failed to toggle action:', error);
    res.status(500).json({ error: 'Failed to toggle action' });
  }
});

// Add new action item
app.post('/api/origination/action', requireAuth, async (req, res) => {
  try {
    const { cardId, cardTitle, text } = req.body;
    
    // Input validation
    if (!cardId || cardId.trim().length === 0) {
      return res.status(400).json({ error: 'Card ID is required' });
    }
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Action text is required' });
    }
    if (text.length > 1000) {
      return res.status(400).json({ error: 'Action text must be 1,000 characters or less' });
    }
    
    // Create action in database
    const action = await boardDb.createAction(cardId, cardTitle, text);
    
    // Broadcast to all clients
    broadcastChange('action:created', {
      actionId: action.id,
      cardId,
      cardTitle,
      text
    });
    
    res.json({ success: true, action });
  } catch (error) {
    console.error('Failed to add action:', error);
    res.status(500).json({ error: 'Failed to add action' });
  }
});

// Update action item
app.put('/api/origination/action/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    
    // Input validation
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Action text is required' });
    }
    if (text.length > 1000) {
      return res.status(400).json({ error: 'Action text must be 1,000 characters or less' });
    }
    
    // Get action details for cardId before update
    const actions = await boardDb.getAllActions();
    const action = actions.find(a => a.id === parseInt(id));
    
    if (action) {
      await boardDb.updateAction(id, text);
      
      // Broadcast to all clients
      broadcastChange('action:updated', {
        actionId: parseInt(id),
        cardId: action.card_id,
        text
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update action:', error);
    res.status(500).json({ error: 'Failed to update action' });
  }
});

// Delete action item
app.delete('/api/origination/action/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get action details for cardId before deletion
    const actions = await boardDb.getAllActions();
    const action = actions.find(a => a.id === parseInt(id));
    
    if (action) {
      await boardDb.deleteAction(id);
      
      // Broadcast to all clients
      broadcastChange('action:deleted', {
        actionId: parseInt(id),
        cardId: action.card_id
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete action:', error);
    res.status(500).json({ error: 'Failed to delete action' });
  }
});

// Add link to card
app.post('/api/origination/link', requireAuth, async (req, res) => {
  try {
    const { cardId, title, url } = req.body;
    
    // Input validation
    if (!cardId || cardId.trim().length === 0) {
      return res.status(400).json({ error: 'Card ID is required' });
    }
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Link title is required' });
    }
    if (title.length > 255) {
      return res.status(400).json({ error: 'Link title must be 255 characters or less' });
    }
    if (!url || url.trim().length === 0) {
      return res.status(400).json({ error: 'URL is required' });
    }
    // Basic URL validation
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    
    const link = await boardDb.createLink(cardId, title, url);
    
    // Broadcast to all clients
    broadcastChange('link:created', {
      linkId: link.id,
      cardId,
      title,
      url
    });
    
    res.json({ success: true, link });
  } catch (error) {
    console.error('Failed to add link:', error);
    res.status(500).json({ error: 'Failed to add link' });
  }
});

// Delete link
app.delete('/api/origination/link/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get link details for cardId before deletion
    const links = await boardDb.getAllLinks();
    const link = links.find(l => l.id === parseInt(id));
    
    if (link) {
      await boardDb.deleteLink(id);
      
      // Broadcast to all clients
      broadcastChange('link:deleted', {
        linkId: parseInt(id),
        cardId: link.card_id
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete link:', error);
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

// Bulk update cards
app.post('/api/origination/bulk-update', requireAuth, async (req, res) => {
  try {
    const { cardIds, updates } = req.body; // updates: { column?, owner? }
    const user = req.user.name || req.user.email;
    
    // Update each card
    for (const cardId of cardIds) {
      const oldCard = await boardDb.getCardById(cardId);
      if (!oldCard) continue;
      
      await boardDb.updateCard(cardId, updates);
      
      // Log bulk update
      const changes = [];
      if (updates.column && oldCard.column_name !== updates.column) {
        changes.push(`Bulk moved: ${oldCard.column_name} → ${updates.column}`);
      }
      if (updates.owner && oldCard.owner !== updates.owner) {
        changes.push(`Bulk assigned: ${updates.owner}`);
      }
      
      if (changes.length > 0) {
        await boardDb.addLog(
          cardId,
          oldCard.title,
          'Bulk Update',
          user,
          changes.join(', ')
        );
      }
      
      // Broadcast each update
      broadcastChange('card:updated', {
        id: cardId,
        ...updates
      });
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
    const cards = await boardDb.getAllCards();
    
    const escapeCsv = (val) => {
      if (!val) return '';
      const str = String(val).replace(/"/g, '""');
      return str.includes(',') || str.includes('"') ? `"${str}"` : str;
    };
    
    // CSV header
    const csv = [
      'Title,Description,Stage,Owner,Notes,Card ID,Deal Value,Date Created,Project Type'
    ];
    
    // Add data rows
    cards.forEach(card => {
      csv.push([
        escapeCsv(card.title),
        escapeCsv(card.description),
        escapeCsv(card.column),
        escapeCsv(card.owner),
        escapeCsv(card.notes),
        escapeCsv(card.id),
        escapeCsv(card.deal_value),
        escapeCsv(card.date_created),
        escapeCsv(card.project_type)
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

// Save settings (people, project types, colors)
app.post('/api/origination/settings', requireAuth, async (req, res) => {
  try {
    console.log('📝 Saving settings:', JSON.stringify(req.body, null, 2));
    const { people, ownerColors, projectTypeColors } = req.body;
    
    // Save people (name, photo, border color)
    const peopleToSave = Object.keys(people || {}).concat(Object.keys(ownerColors || {}));
    const uniquePeople = [...new Set(peopleToSave)];
    
    console.log(`   Saving ${uniquePeople.length} people...`);
    for (const name of uniquePeople) {
      await boardDb.createPerson(
        name,
        (people || {})[name] || null,
        (ownerColors || {})[name] || null
      );
    }
    
    // Save project types
    const projectTypeCount = Object.keys(projectTypeColors || {}).length;
    console.log(`   Saving ${projectTypeCount} project types...`);
    for (const [name, color] of Object.entries(projectTypeColors || {})) {
      await boardDb.createProjectType(name, color);
    }
    
    console.log('✅ Settings saved successfully');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Failed to save settings:', error);
    res.status(500).json({ error: 'Failed to save settings', details: error.message });
  }
});

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
httpServer.listen(PORT, host, () => {
  console.log(`🚀 HeyPhil API running on http://${host}:${PORT}`);
  console.log(`🔌 WebSocket server ready for real-time updates`);
});
