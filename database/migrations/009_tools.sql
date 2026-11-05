CREATE TABLE tool_assets (
  id uuid PRIMARY KEY,
  inventory_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  name varchar(160) NOT NULL CHECK(btrim(name)<>''),
  type text NOT NULL CHECK(type IN ('POWER','HAND','MEASURING','ACCESS','EQUIPMENT','OTHER')),
  status text NOT NULL CHECK(status IN ('AVAILABLE','IN_USE','REPAIR','LOST','RETIRED')),
  condition text NOT NULL CHECK(condition IN ('GOOD','WORN','BROKEN')),
  location text NOT NULL CHECK(location IN ('WAREHOUSE','OBJECT','OTHER')),
  object_id uuid REFERENCES objects(id) ON DELETE RESTRICT,
  location_note varchar(240) NOT NULL DEFAULT '',
  responsible varchar(120) NOT NULL DEFAULT '',
  model varchar(120) NOT NULL DEFAULT '',
  serial_number varchar(120) NOT NULL DEFAULT '',
  service_date date,
  note varchar(1000) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  CHECK ((location='OBJECT') = (object_id IS NOT NULL)),
  CHECK (location<>'OTHER' OR btrim(location_note)<>''),
  CHECK (condition<>'BROKEN' OR status NOT IN ('AVAILABLE','IN_USE'))
);
CREATE INDEX tool_assets_object_idx ON tool_assets(object_id);
CREATE TABLE tool_events (
  id bigserial PRIMARY KEY,
  tool_id uuid NOT NULL REFERENCES tool_assets(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN ('CREATE','MOVE','UPDATE')),
  changed_fields text[] NOT NULL,
  location text NOT NULL,
  object_id uuid REFERENCES objects(id) ON DELETE RESTRICT,
  location_note varchar(240) NOT NULL,
  status text NOT NULL,
  condition text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tool_id,revision)
);
