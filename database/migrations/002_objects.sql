CREATE TABLE objects (
  id uuid PRIMARY KEY,
  name varchar(120) NOT NULL,
  address varchar(300) NOT NULL,
  customer_name varchar(120) NOT NULL,
  customer_phone varchar(40),
  customer_email varchar(254),
  responsible_name varchar(120),
  status text NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  start_date date,
  completion_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT
);

CREATE INDEX objects_status_updated_at_idx ON objects (status, updated_at DESC);
CREATE INDEX objects_name_lower_idx ON objects (lower(name));

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('CREATE', 'UPDATE')),
  entity_type text NOT NULL CHECK (entity_type = 'object'),
  entity_id uuid NOT NULL REFERENCES objects (id) ON DELETE RESTRICT,
  changed_fields text[] NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_history_idx ON audit_log (entity_type, entity_id, occurred_at DESC);
