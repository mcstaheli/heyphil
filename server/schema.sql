-- Project Board Database Schema

-- Projects table (project-level data)
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT,
  target_close DATE,
  deal_value DECIMAL(15, 2),
  budget JSONB,              -- Budget tracking (future)
  timeline JSONB,            -- Timeline/gantt tasks
  team JSONB,                -- Team members (future)
  files JSONB,               -- File attachments (future)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cards table (main kanban board items)
CREATE TABLE IF NOT EXISTS cards (
  id VARCHAR(255) PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  column_name VARCHAR(100) NOT NULL,
  owner VARCHAR(255),
  notes TEXT,
  deal_value DECIMAL(15, 2),
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  project_type VARCHAR(100),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Actions table (checklist items for cards)
CREATE TABLE IF NOT EXISTS actions (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(255) NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  card_title VARCHAR(500),
  text TEXT NOT NULL,
  completed_on TIMESTAMP,
  completed_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Links table (external links for cards)
CREATE TABLE IF NOT EXISTS links (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(255) NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Activity log table (history of changes)
CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  card_id VARCHAR(255),
  card_title VARCHAR(500),
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
CREATE INDEX IF NOT EXISTS idx_projects_target_close ON projects(target_close);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_name);
CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(owner);
CREATE INDEX IF NOT EXISTS idx_cards_project_type ON cards(project_type);
CREATE INDEX IF NOT EXISTS idx_cards_project_id ON cards(project_id);
CREATE INDEX IF NOT EXISTS idx_cards_date_created ON cards(date_created);
CREATE INDEX IF NOT EXISTS idx_actions_card_id ON actions(card_id);
CREATE INDEX IF NOT EXISTS idx_links_card_id ON links(card_id);
CREATE INDEX IF NOT EXISTS idx_activity_card_id ON activity_log(card_id);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_cards_updated_at ON cards;
CREATE TRIGGER update_cards_updated_at BEFORE UPDATE ON cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_people_updated_at ON people;
CREATE TRIGGER update_people_updated_at BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_project_types_updated_at ON project_types;
CREATE TRIGGER update_project_types_updated_at BEFORE UPDATE ON project_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_actions_updated_at ON actions;
CREATE TRIGGER update_actions_updated_at BEFORE UPDATE ON actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_links_updated_at ON links;
CREATE TRIGGER update_links_updated_at BEFORE UPDATE ON links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
