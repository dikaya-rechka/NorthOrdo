ALTER TABLE objects
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES app_users (id) ON DELETE RESTRICT;

CREATE INDEX objects_deleted_updated_at_idx
  ON objects (deleted_at, updated_at DESC);

ALTER TABLE audit_log
  DROP CONSTRAINT audit_log_action_check;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_action_check
  CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'RESTORE'));
