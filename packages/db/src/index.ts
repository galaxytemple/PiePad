import fs from "node:fs";
import path from "node:path";
import oracledb, { type Connection, type Pool } from "oracledb";

oracledb.fetchAsBuffer = [oracledb.BLOB];
oracledb.autoCommit = false;

let pool: Pool | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

function resolveWalletDir(): string {
  const explicit = process.env.ORACLE_WALLET_DIR;
  if (explicit) {
    const absolute = path.resolve(explicit);
    if (fs.existsSync(path.join(absolute, "cwallet.sso"))) return absolute;
  }
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, "wallet");
    if (fs.existsSync(path.join(candidate, "cwallet.sso"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not locate Oracle wallet (cwallet.sso). Set ORACLE_WALLET_DIR to an absolute path."
  );
}

// Oracle identifier — letters/digits/underscore only. Used to reject any
// ORACLE_SCHEMA env value that could not be a real schema name and would
// otherwise be interpolated raw into ALTER SESSION (no bind variables
// allowed there).
const SCHEMA_NAME_RE = /^[A-Za-z_][A-Za-z0-9_$#]*$/;

function resolveSchema(): string | undefined {
  const value = process.env.ORACLE_SCHEMA?.trim();
  if (!value) return undefined;
  if (!SCHEMA_NAME_RE.test(value)) {
    throw new Error(
      `ORACLE_SCHEMA contains invalid characters: ${JSON.stringify(value)}`
    );
  }
  return value;
}

export async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const walletDir = resolveWalletDir();
  // ADB wallet zip ships cwallet.sso (autologin) for JDBC, but node-oracledb
  // Thin mode opens the encrypted ewallet.p12 instead and therefore requires
  // the wallet password set during ADB wallet download. See lessons.md.
  pool = await oracledb.createPool({
    user: requireEnv("ORACLE_USER"),
    password: requireEnv("ORACLE_PASSWORD"),
    connectString: requireEnv("ORACLE_TNS_NAME"),
    configDir: walletDir,
    walletLocation: walletDir,
    walletPassword: requireEnv("ORACLE_WALLET_PASSWORD"),
    poolMin: 1,
    poolMax: 8,
    poolIncrement: 1,
  });
  return pool;
}

export async function withConnection<T>(
  fn: (conn: Connection) => Promise<T>
): Promise<T> {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    // Login user and table-owner schema can differ (e.g. APP_PROD_USER
    // logs in but tables live in APP_PROD_SCHEMA). Set CURRENT_SCHEMA
    // every time we check out a connection so unqualified table names
    // resolve into the owner's schema. We tried oracledb's sessionCallback
    // for this (one-shot per pool session) but it hung connection acquisition
    // in 6.6 — running it here is idempotent and trivial overhead.
    const schema = resolveSchema();
    if (schema) {
      await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${schema}`);
    }
    return await fn(conn);
  } finally {
    await conn.close();
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.close(0);
  pool = undefined;
}

// ---- User / OAuth -----------------------------------------------------------

export interface UpsertOAuthUserInput {
  email: string;
  name: string | null;
  avatarUrl: string | null;
  provider: string;
  providerSubject: string;
}

export interface UpsertOAuthUserResult {
  id: number;
  nickname: string | null;
  avatarUrl: string | null;
  name: string | null;
}

export async function upsertOAuthUser(
  input: UpsertOAuthUserInput
): Promise<UpsertOAuthUserResult> {
  return withConnection(async (conn) => {
    type FindRow = {
      ID: number;
      NICKNAME: string | null;
      AVATAR_URL: string | null;
      NAME: string | null;
    };
    const found = await conn.execute<FindRow>(
      `SELECT id, nickname, avatar_url, name FROM users WHERE email = :email`,
      { email: input.email },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    let userId: number;
    let nickname: string | null;
    if (found.rows && found.rows.length > 0) {
      const row = found.rows[0]!;
      userId = row.ID;
      nickname = row.NICKNAME;
      await conn.execute(
        `UPDATE users
            SET name = :name,
                avatar_url = :avatarUrl,
                last_login_at = CURRENT_TIMESTAMP,
                primary_provider = COALESCE(primary_provider, :provider)
          WHERE id = :id`,
        {
          name: input.name,
          avatarUrl: input.avatarUrl,
          provider: input.provider,
          id: userId,
        }
      );
    } else {
      const inserted = await conn.execute(
        `INSERT INTO users (email, name, avatar_url, primary_provider, last_login_at)
         VALUES (:email, :name, :avatarUrl, :provider, CURRENT_TIMESTAMP)
         RETURNING id INTO :outId`,
        {
          email: input.email,
          name: input.name,
          avatarUrl: input.avatarUrl,
          provider: input.provider,
          outId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
        }
      );
      const outBinds = inserted.outBinds as { outId: number[] } | undefined;
      const newId = outBinds?.outId?.[0];
      if (typeof newId !== "number") {
        throw new Error("INSERT INTO users did not return id");
      }
      userId = newId;
      nickname = null;
    }

    await conn.execute(
      `MERGE INTO user_oauth_accounts a
         USING (SELECT :provider AS p, :subject AS s FROM dual) src
         ON (a.provider = src.p AND a.provider_subject = src.s)
       WHEN MATCHED THEN
         UPDATE SET provider_email = :email, user_id = :userId
       WHEN NOT MATCHED THEN
         INSERT (user_id, provider, provider_subject, provider_email)
         VALUES (:userId, :provider, :subject, :email)`,
      {
        userId,
        provider: input.provider,
        subject: input.providerSubject,
        email: input.email,
      }
    );

    await conn.commit();
    return {
      id: userId,
      nickname,
      avatarUrl: input.avatarUrl,
      name: input.name,
    };
  });
}

export interface AdminUserRow {
  id: number;
  email: string;
  name: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  primaryProvider: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export async function listAllUsers(limit = 100): Promise<AdminUserRow[]> {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  return withConnection(async (conn) => {
    type Row = {
      ID: number;
      EMAIL: string;
      NAME: string | null;
      NICKNAME: string | null;
      AVATAR_URL: string | null;
      PRIMARY_PROVIDER: string | null;
      CREATED_AT: Date;
      LAST_LOGIN_AT: Date | null;
    };
    const result = await conn.execute<Row>(
      `SELECT id, email, name, nickname, avatar_url, primary_provider,
              created_at, last_login_at
         FROM users
        ORDER BY last_login_at DESC NULLS LAST, created_at DESC
        FETCH FIRST ${safeLimit} ROWS ONLY`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return (result.rows ?? []).map((row) => ({
      id: row.ID,
      email: row.EMAIL,
      name: row.NAME,
      nickname: row.NICKNAME,
      avatarUrl: row.AVATAR_URL,
      primaryProvider: row.PRIMARY_PROVIDER,
      createdAt: row.CREATED_AT,
      lastLoginAt: row.LAST_LOGIN_AT,
    }));
  });
}

export interface AdminRoomRow extends RoomRow {
  creatorEmail: string | null;
  creatorName: string | null;
}

export async function listAllRooms(limit = 100): Promise<AdminRoomRow[]> {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  return withConnection(async (conn) => {
    type Row = {
      ID: string;
      NAME: string;
      HAS_PASSWORD: number;
      CREATED_BY_USER_ID: number | null;
      CREATED_AT: Date;
      LAST_ACCESSED_AT: Date;
      CREATOR_EMAIL: string | null;
      CREATOR_NAME: string | null;
    };
    const result = await conn.execute<Row>(
      `SELECT r.id, r.name,
              CASE WHEN r.password_hash IS NULL THEN 0 ELSE 1 END AS has_password,
              r.created_by_user_id, r.created_at, r.last_accessed_at,
              u.email AS creator_email, u.name AS creator_name
         FROM rooms r
         LEFT JOIN users u ON u.id = r.created_by_user_id
        ORDER BY r.last_accessed_at DESC
        FETCH FIRST ${safeLimit} ROWS ONLY`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return (result.rows ?? []).map((row) => ({
      id: row.ID,
      name: row.NAME,
      hasPassword: row.HAS_PASSWORD === 1,
      createdByUserId: row.CREATED_BY_USER_ID,
      createdAt: row.CREATED_AT,
      lastAccessedAt: row.LAST_ACCESSED_AT,
      creatorEmail: row.CREATOR_EMAIL,
      creatorName: row.CREATOR_NAME,
    }));
  });
}

export interface UserProfile {
  id: number;
  email: string;
  name: string | null;
  nickname: string | null;
  avatarUrl: string | null;
}

export async function updateUserNickname(
  id: number,
  nickname: string | null
): Promise<void> {
  const trimmed = nickname?.trim() ?? "";
  await withConnection(async (conn) => {
    await conn.execute(
      `UPDATE users SET nickname = :nickname WHERE id = :id`,
      { id, nickname: trimmed.length > 0 ? trimmed : null },
      { autoCommit: true }
    );
  });
}

export async function getUserById(id: number): Promise<UserProfile | null> {
  return withConnection(async (conn) => {
    type Row = {
      ID: number;
      EMAIL: string;
      NAME: string | null;
      NICKNAME: string | null;
      AVATAR_URL: string | null;
    };
    const result = await conn.execute<Row>(
      `SELECT id, email, name, nickname, avatar_url
         FROM users WHERE id = :id`,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return {
      id: row.ID,
      email: row.EMAIL,
      name: row.NAME,
      nickname: row.NICKNAME,
      avatarUrl: row.AVATAR_URL,
    };
  });
}

// ---- Rooms ------------------------------------------------------------------

export async function ensureRoom(
  roomId: string,
  name?: string,
  createdByUserId?: number | null
): Promise<void> {
  await withConnection(async (conn) => {
    await conn.execute(
      `MERGE INTO rooms r
         USING (SELECT :roomId AS id FROM dual) src
         ON (r.id = src.id)
       WHEN NOT MATCHED THEN
         INSERT (id, name, created_by_user_id)
         VALUES (:roomId, :name, :userId)`,
      {
        roomId,
        name: name ?? roomId,
        userId: createdByUserId ?? null,
      },
      { autoCommit: true }
    );
  });
}

export async function renameRoom(
  roomId: string,
  name: string
): Promise<void> {
  const trimmed = name.trim().slice(0, 200);
  if (trimmed.length === 0) throw new Error("name_empty");
  await withConnection(async (conn) => {
    await conn.execute(
      `UPDATE rooms SET name = :name WHERE id = :roomId`,
      { roomId, name: trimmed },
      { autoCommit: true }
    );
  });
}

export interface ExpiredRoomRow {
  id: string;
  name: string;
  lastAccessedAt: Date;
}

export async function listExpiredRooms(
  ttlDays: number,
  limit = 500
): Promise<ExpiredRoomRow[]> {
  const safeDays = Math.max(1, Math.min(3650, Math.floor(ttlDays)));
  const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
  return withConnection(async (conn) => {
    type Row = { ID: string; NAME: string; LAST_ACCESSED_AT: Date };
    const result = await conn.execute<Row>(
      `SELECT id, name, last_accessed_at
         FROM rooms
        WHERE last_accessed_at < SYSTIMESTAMP - INTERVAL '${safeDays}' DAY
        ORDER BY last_accessed_at ASC
        FETCH FIRST ${safeLimit} ROWS ONLY`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return (result.rows ?? []).map((r) => ({
      id: r.ID,
      name: r.NAME,
      lastAccessedAt: r.LAST_ACCESSED_AT,
    }));
  });
}

export async function recordRoomDeletion(
  roomId: string,
  roomName: string,
  reason: "30_DAY_INACTIVITY" | "ADMIN_DELETE"
): Promise<void> {
  await withConnection(async (conn) => {
    await conn.execute(
      `INSERT INTO room_deletions (room_id, room_name, reason)
       VALUES (:roomId, :roomName, :reason)`,
      { roomId, roomName, reason },
      { autoCommit: true }
    );
  });
}

export async function deleteRoom(roomId: string): Promise<void> {
  // FK ON DELETE CASCADE on room_visits and room_snapshots cleans up
  // dependent rows automatically.
  await withConnection(async (conn) => {
    await conn.execute(
      `DELETE FROM rooms WHERE id = :roomId`,
      { roomId },
      { autoCommit: true }
    );
  });
}

export async function setRoomPasswordHash(
  roomId: string,
  hash: string | null
): Promise<void> {
  await withConnection(async (conn) => {
    await conn.execute(
      `UPDATE rooms SET password_hash = :hash WHERE id = :roomId`,
      { roomId, hash },
      { autoCommit: true }
    );
  });
}

export async function getRoomPasswordHash(
  roomId: string
): Promise<string | null> {
  return withConnection(async (conn) => {
    type Row = { PASSWORD_HASH: string | null };
    const result = await conn.execute<Row>(
      `SELECT password_hash FROM rooms WHERE id = :roomId`,
      { roomId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return result.rows?.[0]?.PASSWORD_HASH ?? null;
  });
}

export async function upsertRoomVisit(
  userId: number,
  roomId: string
): Promise<void> {
  // UPDATE-then-INSERT instead of MERGE: Oracle's MERGE with re-used
  // bind names tripped ORA-00923 ("FROM keyword not found") in the
  // node-oracledb Thin driver. This split is two round-trips but plain
  // ANSI and bulletproof.
  await withConnection(async (conn) => {
    const updated = await conn.execute(
      `UPDATE room_visits
          SET last_visited_at = CURRENT_TIMESTAMP,
              visit_count = visit_count + 1
        WHERE user_id = :userId AND room_id = :roomId`,
      { userId, roomId }
    );
    if ((updated.rowsAffected ?? 0) === 0) {
      await conn.execute(
        `INSERT INTO room_visits (user_id, room_id)
         VALUES (:userId, :roomId)`,
        { userId, roomId }
      );
    }
    await conn.commit();
  });
}

export interface RoomRow {
  id: string;
  name: string;
  hasPassword: boolean;
  createdByUserId: number | null;
  createdAt: Date;
  lastAccessedAt: Date;
}

export async function getRoomById(roomId: string): Promise<RoomRow | null> {
  return withConnection(async (conn) => {
    type Row = {
      ID: string;
      NAME: string;
      HAS_PASSWORD: number;
      CREATED_BY_USER_ID: number | null;
      CREATED_AT: Date;
      LAST_ACCESSED_AT: Date;
    };
    const result = await conn.execute<Row>(
      `SELECT id, name,
              CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS has_password,
              created_by_user_id,
              created_at, last_accessed_at
         FROM rooms WHERE id = :roomId`,
      { roomId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return {
      id: row.ID,
      name: row.NAME,
      hasPassword: row.HAS_PASSWORD === 1,
      createdByUserId: row.CREATED_BY_USER_ID,
      createdAt: row.CREATED_AT,
      lastAccessedAt: row.LAST_ACCESSED_AT,
    };
  });
}

export async function listRoomsCreatedByUser(
  userId: number,
  limit = 50
): Promise<RoomRow[]> {
  // FETCH FIRST :lim ROWS ONLY with a bind variable can choke in oracledb
  // Thin; safe to interpolate since `limit` is a server-controlled number.
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  return withConnection(async (conn) => {
    type Row = {
      ID: string;
      NAME: string;
      HAS_PASSWORD: number;
      CREATED_BY_USER_ID: number | null;
      CREATED_AT: Date;
      LAST_ACCESSED_AT: Date;
    };
    const result = await conn.execute<Row>(
      `SELECT id, name,
              CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS has_password,
              created_by_user_id, created_at, last_accessed_at
         FROM rooms
        WHERE created_by_user_id = :userId
        ORDER BY last_accessed_at DESC
        FETCH FIRST ${safeLimit} ROWS ONLY`,
      { userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return (result.rows ?? []).map((row) => ({
      id: row.ID,
      name: row.NAME,
      hasPassword: row.HAS_PASSWORD === 1,
      createdByUserId: row.CREATED_BY_USER_ID,
      createdAt: row.CREATED_AT,
      lastAccessedAt: row.LAST_ACCESSED_AT,
    }));
  });
}

export interface VisitedRoomRow extends RoomRow {
  firstVisitedAt: Date;
  lastVisitedAt: Date;
  visitCount: number;
}

export async function listRoomsVisitedByUser(
  userId: number,
  limit = 50
): Promise<VisitedRoomRow[]> {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  return withConnection(async (conn) => {
    type Row = {
      ID: string;
      NAME: string;
      HAS_PASSWORD: number;
      CREATED_BY_USER_ID: number | null;
      CREATED_AT: Date;
      LAST_ACCESSED_AT: Date;
      FIRST_VISITED_AT: Date;
      LAST_VISITED_AT: Date;
      VISIT_COUNT: number;
    };
    const result = await conn.execute<Row>(
      `SELECT r.id, r.name,
              CASE WHEN r.password_hash IS NULL THEN 0 ELSE 1 END AS has_password,
              r.created_by_user_id, r.created_at, r.last_accessed_at,
              v.first_visited_at, v.last_visited_at, v.visit_count
         FROM room_visits v
         JOIN rooms r ON r.id = v.room_id
        WHERE v.user_id = :userId
        ORDER BY v.last_visited_at DESC
        FETCH FIRST ${safeLimit} ROWS ONLY`,
      { userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return (result.rows ?? []).map((row) => ({
      id: row.ID,
      name: row.NAME,
      hasPassword: row.HAS_PASSWORD === 1,
      createdByUserId: row.CREATED_BY_USER_ID,
      createdAt: row.CREATED_AT,
      lastAccessedAt: row.LAST_ACCESSED_AT,
      firstVisitedAt: row.FIRST_VISITED_AT,
      lastVisitedAt: row.LAST_VISITED_AT,
      visitCount: row.VISIT_COUNT,
    }));
  });
}

export async function touchRoomAccess(roomId: string): Promise<void> {
  await withConnection(async (conn) => {
    await conn.execute(
      `UPDATE rooms
          SET last_accessed_at = CURRENT_TIMESTAMP
        WHERE id = :roomId`,
      { roomId },
      { autoCommit: true }
    );
  });
}

interface SnapshotRow {
  YJS_STATE: Buffer;
}

export async function getLatestSnapshot(
  roomId: string
): Promise<Uint8Array | null> {
  return withConnection(async (conn) => {
    const result = await conn.execute<SnapshotRow>(
      `SELECT yjs_state
         FROM room_snapshots
        WHERE room_id = :roomId`,
      { roomId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return new Uint8Array(row.YJS_STATE);
  });
}

export async function saveSnapshot(
  roomId: string,
  state: Uint8Array
): Promise<void> {
  const buffer = Buffer.from(state);
  await withConnection(async (conn) => {
    await conn.execute(
      `MERGE INTO room_snapshots s
         USING (SELECT :roomId AS room_id FROM dual) src
         ON (s.room_id = src.room_id)
       WHEN MATCHED THEN
         UPDATE SET yjs_state = :state, snapshot_at = CURRENT_TIMESTAMP
       WHEN NOT MATCHED THEN
         INSERT (room_id, yjs_state) VALUES (:roomId, :state)`,
      { roomId, state: buffer },
      { autoCommit: true }
    );
  });
}
