-- Keep only the latest Yjs snapshot per room (saveSnapshot uses MERGE / upsert).
-- Snapshots are taken every ~30s while a room is dirty plus once on last
-- client disconnect, so without this constraint the table would grow without
-- bound. We only ever need the most recent state for cold-start recovery.

ALTER TABLE room_snapshots
  ADD CONSTRAINT uk_snapshots_room_id UNIQUE (room_id);
