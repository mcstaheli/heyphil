-- Add version column for optimistic locking
ALTER TABLE cards ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE actions ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

-- Create trigger to increment version on update
CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to cards
DROP TRIGGER IF EXISTS increment_card_version ON cards;
CREATE TRIGGER increment_card_version 
  BEFORE UPDATE ON cards
  FOR EACH ROW 
  EXECUTE FUNCTION increment_version();

-- Apply trigger to actions  
DROP TRIGGER IF EXISTS increment_action_version ON actions;
CREATE TRIGGER increment_action_version 
  BEFORE UPDATE ON actions
  FOR EACH ROW 
  EXECUTE FUNCTION increment_version();
