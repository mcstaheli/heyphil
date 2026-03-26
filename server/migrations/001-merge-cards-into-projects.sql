-- Migration: Merge cards table into projects table
-- This combines the redundant cards/projects structure into a single projects table

-- Step 1: Add missing fields to projects table
ALTER TABLE projects 
  ADD COLUMN IF NOT EXISTS owner VARCHAR(255),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS project_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS tasks JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '[]';

-- Step 2: Create a temporary mapping table for card_id -> project_id
CREATE TEMP TABLE card_to_project_map (
  card_id VARCHAR(255) PRIMARY KEY,
  project_id UUID NOT NULL
);

-- Step 3: For each card with a project_id, update the project with card data
UPDATE projects p
SET 
  status = c.column_name,
  owner = c.owner,
  notes = c.notes,
  deal_value = c.deal_value,
  project_type = c.project_type,
  date_created = c.date_created
FROM cards c
WHERE p.id = c.project_id 
  AND c.project_id IS NOT NULL;

-- Step 4: Record the mapping for cards with project_id
INSERT INTO card_to_project_map (card_id, project_id)
SELECT id, project_id FROM cards WHERE project_id IS NOT NULL;

-- Step 5: For cards WITHOUT a project_id, create new projects
INSERT INTO projects (title, description, status, owner, notes, deal_value, project_type, date_created)
SELECT 
  title,
  description,
  column_name,
  owner,
  notes,
  deal_value,
  project_type,
  date_created
FROM cards
WHERE project_id IS NULL
RETURNING id;

-- Step 6: Map the orphaned cards to their new projects
-- (Using a DO block to handle the insertion)
DO $$
DECLARE
  card_rec RECORD;
  new_project_id UUID;
BEGIN
  FOR card_rec IN SELECT * FROM cards WHERE project_id IS NULL LOOP
    -- Find the project we just created (matching by title and date)
    SELECT id INTO new_project_id
    FROM projects
    WHERE title = card_rec.title 
      AND date_created = card_rec.date_created
    LIMIT 1;
    
    -- Record mapping
    INSERT INTO card_to_project_map (card_id, project_id)
    VALUES (card_rec.id, new_project_id);
  END LOOP;
END $$;

-- Step 7: Migrate actions to tasks JSONB
UPDATE projects p
SET tasks = (
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'text', a.text,
      'completed', a.completed_on IS NOT NULL,
      'completedOn', a.completed_on,
      'completedBy', a.completed_by
    ) ORDER BY a.id
  ), '[]'::jsonb)
  FROM actions a
  JOIN card_to_project_map m ON m.card_id = a.card_id
  WHERE m.project_id = p.id
);

-- Step 8: Migrate links to links JSONB
UPDATE projects p
SET links = (
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'title', l.title,
      'url', l.url
    ) ORDER BY l.id
  ), '[]'::jsonb)
  FROM links l
  JOIN card_to_project_map m ON m.card_id = l.card_id
  WHERE m.project_id = p.id
);

-- Step 9: Update activity_log to reference project IDs
-- Add new column for project_id
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS project_id UUID;

-- Populate project_id from card_id mapping
UPDATE activity_log al
SET project_id = m.project_id
FROM card_to_project_map m
WHERE al.card_id = m.card_id;

-- Step 10: Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner);
CREATE INDEX IF NOT EXISTS idx_projects_project_type ON projects(project_type);
CREATE INDEX IF NOT EXISTS idx_projects_date_created ON projects(date_created);
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_project_id ON activity_log(project_id);

-- Step 11: Drop foreign key constraints from actions and links
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_card_id_fkey;
ALTER TABLE links DROP CONSTRAINT IF EXISTS links_card_id_fkey;

-- Step 12: Rename cards table to cards_backup (for safety)
ALTER TABLE cards RENAME TO cards_backup;

-- Step 13: Drop the old cards table indexes
DROP INDEX IF EXISTS idx_cards_column;
DROP INDEX IF EXISTS idx_cards_owner;
DROP INDEX IF EXISTS idx_cards_project_type;
DROP INDEX IF EXISTS idx_cards_project_id;
DROP INDEX IF EXISTS idx_cards_date_created;

-- Done! The cards_backup table can be dropped after verification:
-- DROP TABLE cards_backup CASCADE;
-- DROP TABLE actions CASCADE;
-- DROP TABLE links CASCADE;

-- Summary of what was migrated:
SELECT 
  'Migration Summary' as status,
  (SELECT COUNT(*) FROM cards_backup) as total_cards,
  (SELECT COUNT(*) FROM projects) as total_projects,
  (SELECT COUNT(*) FROM card_to_project_map) as mapped_cards;
