ALTER TABLE estimate_items
  ADD COLUMN calculation jsonb NOT NULL DEFAULT '{"mode":"manual"}'::jsonb;

UPDATE estimate_items
   SET calculation = jsonb_build_object(
     'mode', 'manual',
     'quantity', quantity::text,
     'repetitions', '1',
     'wastePercent', '0'
   );

ALTER TABLE estimate_items
  ADD CONSTRAINT estimate_items_calculation_object_check
  CHECK (jsonb_typeof(calculation) = 'object');
