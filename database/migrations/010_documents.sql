CREATE TABLE documents (
  id uuid PRIMARY KEY,
  title varchar(160) NOT NULL CHECK(btrim(title)<>''),
  category text NOT NULL CHECK(category IN ('CONTRACT','ESTIMATE','ACT','INVOICE','PHOTO','OTHER')),
  object_id uuid REFERENCES objects(id) ON DELETE RESTRICT,
  note varchar(500) NOT NULL DEFAULT '',
  original_name varchar(180) NOT NULL,
  file_key uuid UNIQUE NOT NULL,
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
  sha256 char(64) NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_object_idx ON documents(object_id);
CREATE TABLE document_events (
  id bigserial PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN ('UPLOAD','EDIT','ARCHIVE','RESTORE','DOWNLOAD')),
  changed_fields text[] NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_events_history_idx ON document_events(document_id,id DESC);
