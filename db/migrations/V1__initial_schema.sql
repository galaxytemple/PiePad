-- PiePad initial schema (Oracle Autonomous Database)

-- Site-level access password (single active row; managed manually).
CREATE TABLE site_passwords (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  password_hash VARCHAR2(255) NOT NULL,
  is_active     NUMBER(1) DEFAULT 1 NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT chk_site_pw_active CHECK (is_active IN (0, 1))
);

-- Admin accounts (no in-app signup; rows inserted directly via SQL).
CREATE TABLE admins (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      VARCHAR2(100) NOT NULL,
  password_hash VARCHAR2(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  last_login_at TIMESTAMP,
  CONSTRAINT uk_admins_username UNIQUE (username)
);

-- Rooms. Persist forever unless inactive 30 days.
CREATE TABLE rooms (
  id                  VARCHAR2(32) PRIMARY KEY,
  name                VARCHAR2(200) NOT NULL,
  password_hash       VARCHAR2(255),
  created_by_admin_id NUMBER,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  last_accessed_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT fk_rooms_admin
    FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE INDEX idx_rooms_last_accessed ON rooms (last_accessed_at);

-- Periodic Yjs binary snapshots (CRDT state).
CREATE TABLE room_snapshots (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id     VARCHAR2(32) NOT NULL,
  yjs_state   BLOB NOT NULL,
  snapshot_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT fk_snapshot_room
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX idx_snapshots_room ON room_snapshots (room_id, snapshot_at DESC);

-- Audit trail for room deletions.
CREATE TABLE room_deletions (
  id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id    VARCHAR2(32) NOT NULL,
  room_name  VARCHAR2(200),
  deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  reason     VARCHAR2(50) NOT NULL,
  CONSTRAINT chk_deletion_reason
    CHECK (reason IN ('30_DAY_INACTIVITY', 'ADMIN_DELETE'))
);

CREATE INDEX idx_deletions_at ON room_deletions (deleted_at);
