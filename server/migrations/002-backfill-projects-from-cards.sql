-- Migration: Phase 2 - Backfill projects from existing cards
-- Creates one project for each card, establishes one-to-one relationship

-- Step 1: Create projects from existing cards
INSERT INTO projects (id, title, description, status, target_close, deal_value, created_at, updated_at)
SELECT 
  gen_random_uuid() as id,
  title,
  description,
  column_name as status,  -- Use current column as initial status
  date_created::date + INTERVAL '90 days' as target_close,  -- Estimate: 90 days from creation
  deal_value,
  date_created as created_at,
  CURRENT_TIMESTAMP as updated_at
FROM cards
WHERE deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM projects WHERE projects.title = cards.title
  );

-- Step 2: Link each card to its corresponding project (match by title)
-- Note: This assumes titles are unique. If not, it will link to the first match.
UPDATE cards
SET project_id = (
  SELECT id 
  FROM projects 
  WHERE projects.title = cards.title
  LIMIT 1
)
WHERE deleted_at IS NULL
  AND project_id IS NULL;

-- Verify migration
DO $$
DECLARE
  cards_count INTEGER;
  projects_count INTEGER;
  linked_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO cards_count FROM cards WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO projects_count FROM projects;
  SELECT COUNT(*) INTO linked_count FROM cards WHERE project_id IS NOT NULL AND deleted_at IS NULL;
  
  RAISE NOTICE 'Migration summary:';
  RAISE NOTICE '  Active cards: %', cards_count;
  RAISE NOTICE '  Projects created: %', projects_count;
  RAISE NOTICE '  Cards linked to projects: %', linked_count;
  
  IF linked_count < cards_count THEN
    RAISE WARNING 'Not all cards were linked! Check for duplicate titles.';
  END IF;
END $$;

COMMENT ON TABLE projects IS 'Phase 2: Backfilled from cards. One-to-one relationship established.';
