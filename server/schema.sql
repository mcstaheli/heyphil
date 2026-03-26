-- Project Board Database Schema

-- Projects table (unified table for board cards and project details)
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT,                -- Board column (replaces cards.column_name)
  owner VARCHAR(255),         -- Project owner (from cards)
  notes TEXT,                 -- Notes (from cards)
  project_type VARCHAR(100),  -- Project type (from cards)
  deal_value DECIMAL(15, 2),
  target_close DATE,
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- From cards.date_created
  deleted_at TIMESTAMP,       -- For soft deletes
  budget JSONB,               -- Budget tracking (future)
  timeline JSONB,             -- Timeline/gantt tasks
  team JSONB,                 -- Team members (future)
  files JSONB,                -- File attachments (future)
  tasks JSONB DEFAULT '[]',   -- Tasks (migrated from actions table)
  links JSONB DEFAULT '[]',   -- Links (migrated from links table)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Note: Actions and Links are now stored as JSONB in projects.tasks and projects.links

-- Activity log table (history of changes)
CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  project_id UUID,            -- References projects.id
  card_id VARCHAR(255),       -- Legacy field (kept for migration)
  card_title VARCHAR(500),    -- Legacy field (will be phased out)
  action VARCHAR(100) NOT NULL,
  user_name VARCHAR(255),
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- People table (team members with photos and colors)
CREATE TABLE IF NOT EXISTS people (
  name VARCHAR(255) PRIMARY KEY,
  photo_url TEXT,
  border_color VARCHAR(7), -- hex color
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Project types table (project categories and colors)
CREATE TABLE IF NOT EXISTS project_types (
  name VARCHAR(100) PRIMARY KEY,
  color VARCHAR(7), -- hex color
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner);
CREATE INDEX IF NOT EXISTS idx_projects_project_type ON projects(project_type);
CREATE INDEX IF NOT EXISTS idx_projects_date_created ON projects(date_created);
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_projects_target_close ON projects(target_close);
CREATE INDEX IF NOT EXISTS idx_activity_project_id ON activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_card_id ON activity_log(card_id);  -- Legacy
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_people_updated_at ON people;
CREATE TRIGGER update_people_updated_at BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_project_types_updated_at ON project_types;
CREATE TRIGGER update_project_types_updated_at BEFORE UPDATE ON project_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
