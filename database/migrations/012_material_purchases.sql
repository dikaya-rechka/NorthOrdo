CREATE TABLE material_purchases (
  id uuid PRIMARY KEY,
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  object_id uuid REFERENCES objects(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  note varchar(1000) NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'NEEDED' CHECK (status IN ('NEEDED','BOUGHT','CANCELLED')),
  movement_id uuid REFERENCES material_movements(id) ON DELETE RESTRICT,
  revision integer NOT NULL DEFAULT 1,
  CHECK ((status = 'BOUGHT') = (movement_id IS NOT NULL))
);
CREATE TABLE material_purchase_movements (
  purchase_id uuid NOT NULL REFERENCES material_purchases(id) ON DELETE RESTRICT,
  movement_id uuid PRIMARY KEY REFERENCES material_movements(id) ON DELETE RESTRICT
);
CREATE TABLE material_purchase_events (
  id bigserial PRIMARY KEY,
  purchase_id uuid NOT NULL REFERENCES material_purchases(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN ('CREATE','BUY','REOPEN','CANCEL')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_purchases_status_idx ON material_purchases(status,material_id);
