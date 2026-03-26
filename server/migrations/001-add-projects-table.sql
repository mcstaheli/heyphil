-- Migration: Add projects table (Phase 1 - Non-destructive)
-- Creates new projects table alongside existing cards table

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

-- Add project_id to cards table (nullable for backward compatibility)
ALTER TABLE cards ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cards_project_id ON cards(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_target_close ON projects(target_close);

-- Trigger to update updated_at timestamp on projects
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Migration applied successfully
COMMENT ON TABLE projects IS 'Phase 1: Project-level data separate from cards. One-to-one relationship initially.';
