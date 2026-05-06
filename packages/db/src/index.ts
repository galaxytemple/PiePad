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
  pool = await oracledb.createPool({
    user: requireEnv("ORACLE_USER"),
    password: requireEnv("ORACLE_PASSWORD"),
    connectString: requireEnv("ORACLE_TNS_NAME"),
    configDir: walletDir,
    walletLocation: walletDir,
    walletPassword: "",
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

// ---- Domain helpers ---------------------------------------------------------

export async function ensureRoom(
  roomId: string,
  name?: string
): Promise<void> {
  await withConnection(async (conn) => {
    await conn.execute(
      `MERGE INTO rooms r
         USING (SELECT :roomId AS id FROM dual) src
         ON (r.id = src.id)
       WHEN NOT MATCHED THEN
         INSERT (id, name) VALUES (:roomId, :name)`,
      { roomId, name: name ?? roomId },
      { autoCommit: true }
    );
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
