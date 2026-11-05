CREATE TABLE materials (
  id uuid PRIMARY KEY,
  name varchar(160) NOT NULL CHECK (btrim(name) <> ''),
  unit varchar(24) NOT NULL CHECK (btrim(unit) <> ''),
  note varchar(1000) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1
);
CREATE TABLE material_movements (
  id uuid PRIMARY KEY,
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('RECEIPT','ISSUE','TRANSFER')),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  source_id uuid REFERENCES objects(id) ON DELETE RESTRICT,
  destination_id uuid REFERENCES objects(id) ON DELETE RESTRICT,
  movement_date date NOT NULL,
  unit_price numeric(14,2) CHECK (unit_price >= 0),
  total numeric(28,2) GENERATED ALWAYS AS (round(quantity * unit_price,2)) STORED,
  supplier varchar(160) NOT NULL DEFAULT '',
  note varchar(1000) NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  CHECK (
    (kind='RECEIPT' AND source_id IS NULL) OR
    (kind='ISSUE' AND destination_id IS NULL AND unit_price IS NULL AND supplier='') OR
    (kind='TRANSFER' AND source_id IS DISTINCT FROM destination_id AND unit_price IS NULL AND supplier='')
  )
);
CREATE INDEX material_movements_material_idx ON material_movements(material_id, movement_date DESC);
CREATE TABLE material_events (
  id bigserial PRIMARY KEY,
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  movement_id uuid REFERENCES material_movements(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('CREATE','EDIT','MOVEMENT','VOID','RESTORE')),
  changed_fields text[] NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_events_material_idx ON material_events(material_id, occurred_at DESC);

CREATE VIEW material_stock AS
SELECT material_id, object_id, sum(delta) AS balance FROM (
  SELECT material_id, destination_id AS object_id, quantity AS delta
    FROM material_movements WHERE NOT voided AND kind IN ('RECEIPT','TRANSFER')
  UNION ALL
  SELECT material_id, source_id AS object_id, -quantity AS delta
    FROM material_movements WHERE NOT voided AND kind IN ('ISSUE','TRANSFER')
) AS legs GROUP BY material_id, object_id;
