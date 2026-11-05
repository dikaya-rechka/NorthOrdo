CREATE TABLE finance_planning_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  budget numeric(14,2) CHECK (budget >= 0),
  budget_from date, budget_to date,
  opening_balance numeric(14,2), opening_date date,
  revision integer NOT NULL DEFAULT 1,
  CHECK ((budget IS NULL AND budget_from IS NULL AND budget_to IS NULL) OR (budget IS NOT NULL AND budget_from IS NOT NULL AND budget_to >= budget_from)),
  CHECK ((opening_balance IS NULL) = (opening_date IS NULL))
);
INSERT INTO finance_planning_settings(id) VALUES(true);
CREATE TABLE finance_plans (
  id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('INCOME','EXPENSE')),
  amount numeric(14,2) NOT NULL CHECK(amount > 0), plan_date date NOT NULL,
  category text NOT NULL, object_id uuid REFERENCES objects(id), note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','SETTLED','CANCELLED')),
  settled_entry_id uuid REFERENCES finance_entries(id), revision integer NOT NULL DEFAULT 1,
  CHECK ((status = 'SETTLED') = (settled_entry_id IS NOT NULL))
);
CREATE TABLE finance_planning_events (
  id bigserial PRIMARY KEY, actor_id uuid NOT NULL REFERENCES app_users(id),
  entity_id text NOT NULL, action text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE finance_plan_entries (
  plan_id uuid NOT NULL REFERENCES finance_plans(id),
  entry_id uuid PRIMARY KEY REFERENCES finance_entries(id)
);
