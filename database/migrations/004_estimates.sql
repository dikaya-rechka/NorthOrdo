CREATE TABLE estimates (
  id uuid PRIMARY KEY,
  object_id uuid NOT NULL REFERENCES objects (id) ON DELETE RESTRICT,
  title varchar(160) NOT NULL,
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT
);

CREATE INDEX estimates_object_updated_at_idx ON estimates (object_id, updated_at DESC);

CREATE TABLE estimate_versions (
  id uuid PRIMARY KEY,
  estimate_id uuid NOT NULL REFERENCES estimates (id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  note varchar(500) NOT NULL DEFAULT '',
  total numeric(18, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  UNIQUE (estimate_id, version_number)
);

CREATE INDEX estimate_versions_history_idx
  ON estimate_versions (estimate_id, version_number DESC);

CREATE TABLE estimate_items (
  id bigserial PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES estimate_versions (id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 500),
  description varchar(240) NOT NULL,
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit varchar(24) NOT NULL,
  unit_price numeric(14, 2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(18, 2) GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED,
  UNIQUE (version_id, position)
);
