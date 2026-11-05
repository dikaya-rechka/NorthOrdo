CREATE TABLE finance_entries (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('INCOME', 'EXPENSE')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  operation_date date NOT NULL,
  category text NOT NULL,
  object_id uuid REFERENCES objects(id) ON DELETE RESTRICT,
  note varchar(1000) NOT NULL DEFAULT '',
  voided boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  CHECK (
    (kind = 'INCOME' AND category IN ('ADVANCE','PAYMENT','REFUND','OTHER_INCOME')) OR
    (kind = 'EXPENSE' AND category IN ('MATERIALS','LABOR','TOOLS','TRANSPORT','OTHER_EXPENSE'))
  )
);
CREATE INDEX finance_entries_date_idx ON finance_entries(operation_date DESC, id);
CREATE INDEX finance_entries_object_idx ON finance_entries(object_id);

CREATE TABLE finance_events (
  entry_id uuid NOT NULL REFERENCES finance_entries(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('CREATE','EDIT','VOID','RESTORE')),
  changed_fields text[] NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(entry_id, revision)
);
