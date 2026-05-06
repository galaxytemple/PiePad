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

export interface UserProfile {
  id: number;
  email: string;
  name: string | null;
  nickname: string | null;
  avatarUrl: string | null;
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

export async function upsertRoomVisit(
  userId: number,
  roomId: string
): Promise<void> {
  await withConnection(async (conn) => {
    await conn.execute(
      `MERGE INTO room_visits v
         USING (SELECT :userId AS uid, :roomId AS rid FROM dual) src
         ON (v.user_id = src.uid AND v.room_id = src.rid)
       WHEN MATCHED THEN
         UPDATE SET last_visited_at = CURRENT_TIMESTAMP,
                    visit_count = v.visit_count + 1
       WHEN NOT MATCHED THEN
         INSERT (user_id, room_id, first_visited_at, last_visited_at, visit_count)
         VALUES (:userId, :roomId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      { userId, roomId },
      { autoCommit: true }
    );
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
        FETCH FIRST :lim ROWS ONLY`,
      { userId, lim: limit },
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
        FETCH FIRST :lim ROWS ONLY`,
      { userId, lim: limit },
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
