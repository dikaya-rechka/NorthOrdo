CREATE TABLE work_items (
  id uuid PRIMARY KEY,
  title varchar(160) NOT NULL CHECK (btrim(title) <> ''),
  status text NOT NULL CHECK (status IN ('PLANNED', 'DONE')),
  object_id uuid REFERENCES objects (id) ON DELETE RESTRICT,
  due_date date,
  note varchar(1000) NOT NULL DEFAULT '',
  completed_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK ((status = 'DONE') = (completed_at IS NOT NULL))
);

CREATE INDEX work_items_object_idx ON work_items (object_id);

CREATE TABLE work_events (
  work_id uuid NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('CREATE', 'EDIT', 'COMPLETE', 'REOPEN')),
  status text NOT NULL CHECK (status IN ('PLANNED', 'DONE')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_id, revision)
);
