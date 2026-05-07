-- V4: timestamp consistency + admin sort index + tighter rooms.id width.
--
-- Background. ATP currently runs all sessions in UTC, so the previous
-- TIMESTAMP-without-zone columns happen to behave correctly today, but
-- TIMESTAMP WITH LOCAL TIME ZONE is the correct semantic and removes the
-- latent risk if a future session ever changes its TZ. SYSTIMESTAMP / the
-- existing CURRENT_TIMESTAMP defaults all return WITH TIME ZONE values
-- already; Oracle silently strips the zone on the way into TIMESTAMP today.
--
-- Run locally from a workstation with the table-owner schema's DDL
-- privileges. The runtime user (APP_PROD_USER) intentionally has no DDL —
-- this migration must NEVER run from CI.

-- --- timestamps -------------------------------------------------------------
ALTER TABLE rooms MODIFY (
  created_at       TIMESTAMP WITH LOCAL TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TIMESTAMP WITH LOCAL TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE room_snapshots MODIFY (
  snapshot_at TIMESTAMP WITH LOCAL TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE room_deletions MODIFY (
  deleted_at TIMESTAMP WITH LOCAL TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users MODIFY (
  created_at    TIMESTAMP WITH LOCAL TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP WITH LOCAL TIME ZONE
);

ALTER TABLE user_oauth_accounts MODIFY (
  created_at TIMESTAMP WITH LOCAL TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE room_visits MODIFY (
  first_visited_at TIMESTAMP WITH LOCAL TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_visited_at  TIMESTAMP WITH LOCAL TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --- indexes ----------------------------------------------------------------
-- /admin/users orders by last_login_at DESC NULLS LAST (admin-only, low
-- traffic, but a full scan + sort on every visit). NULLS LAST mirrors the
-- query so the index can be used directly without a sort step.
CREATE INDEX idx_users_last_login
  ON users (last_login_at DESC NULLS LAST);

-- --- column widths ----------------------------------------------------------
-- nanoid(12) → 12 chars. VARCHAR2(32) was over-provisioned. Tightening to
-- VARCHAR2(16) leaves headroom for any future id-length bump while shaving
-- bytes off every FK index entry (rooms, room_snapshots, room_visits,
-- room_deletions all carry a room_id).
--
-- Oracle requires CASCADE CONSTRAINTS to alter a column referenced by FKs;
-- the type/precision change of a VARCHAR2 to a smaller width is allowed
-- only when no row exceeds the new size — make sure to check before
-- running on a populated DB:
--
--   SELECT MAX(LENGTH(id)) FROM rooms;
--
ALTER TABLE rooms MODIFY (id VARCHAR2(16));
ALTER TABLE room_snapshots MODIFY (room_id VARCHAR2(16));
ALTER TABLE room_visits MODIFY (room_id VARCHAR2(16));
ALTER TABLE room_deletions MODIFY (room_id VARCHAR2(16));
