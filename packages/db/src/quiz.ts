import oracledb, { type Connection, type Pool } from "oracledb";
import fs from "node:fs";
import path from "node:path";

// Ensure CLOBs are returned as strings
if (!oracledb.fetchAsString?.includes(oracledb.CLOB)) {
  oracledb.fetchAsString = [...(oracledb.fetchAsString ?? []), oracledb.CLOB];
}

let quizPool: Pool | undefined;
let pendingQuizPoolInit: Promise<Pool> | null = null;

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
  for (let i = 0; i < 10; i++) {
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

const SCHEMA_NAME_RE = /^[A-Za-z_][A-Za-z0-9_$#]*$/;

function resolveQuizSchema(): string | undefined {
  const value = (process.env.QUIZ_ORACLE_SCHEMA || process.env.ORACLE_SCHEMA)?.trim();
  if (!value) return undefined;
  if (!SCHEMA_NAME_RE.test(value)) {
    throw new Error(
      `QUIZ_ORACLE_SCHEMA contains invalid characters: ${JSON.stringify(value)}`
    );
  }
  return value;
}

export async function getQuizPool(): Promise<Pool> {
  const quizUser = process.env.QUIZ_ORACLE_USER || process.env.ORACLE_USER;
  const quizPass = process.env.QUIZ_ORACLE_PASSWORD || process.env.ORACLE_PASSWORD;

  if (!quizUser || !quizPass) {
    throw new Error("QUIZ_ORACLE_USER/PASSWORD (or ORACLE_USER/PASSWORD) is required");
  }

  if (quizPool) return quizPool;
  if (!pendingQuizPoolInit) {
    pendingQuizPoolInit = (async () => {
      const walletDir = resolveWalletDir();
      const created = await oracledb.createPool({
        poolAlias: "quiz_pool",
        user: quizUser,
        password: quizPass,
        connectString: requireEnv("ORACLE_TNS_NAME"),
        configDir: walletDir,
        walletLocation: walletDir,
        walletPassword: requireEnv("ORACLE_WALLET_PASSWORD"),
        poolMin: 1,
        poolMax: 4,
        poolIncrement: 1,
        poolPingInterval: 60,
      });
      quizPool = created;
      return created;
    })();
  }
  try {
    return await pendingQuizPoolInit;
  } catch (err) {
    pendingQuizPoolInit = null;
    throw err;
  }
}

export async function withQuizConnection<T>(
  fn: (conn: Connection) => Promise<T>
): Promise<T> {
  const p = await getQuizPool();
  const conn = await p.getConnection();
  try {
    const schema = resolveQuizSchema();
    if (schema) {
      await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${schema}`);
    }
    const tz = process.env.ORACLE_TIMEZONE || "America/Los_Angeles";
    await conn.execute(`ALTER SESSION SET TIME_ZONE = '${tz}'`);
    return await fn(conn);
  } finally {
    try {
      await conn.rollback();
    } catch {}
    await conn.close();
  }
}

// ==================== Types & Queries ====================

export interface Passage {
  id: number;
  title: string;
  body: string;
  keywords: string | null;
  createdAt: Date;
}

export interface QuizRatio {
  blankPct: number;
  firstPct: number;
  recitePct: number;
}

export async function getPassages(): Promise<Passage[]> {
  return withQuizConnection(async (conn) => {
    const result = await conn.execute<[number, string, string, string | null, Date]>(
      `SELECT id, title, body, keywords, created_at FROM quiz_passages ORDER BY id DESC`,
      [],
      { outFormat: oracledb.OUT_FORMAT_ARRAY }
    );
    return (result.rows ?? []).map(([id, title, body, keywords, createdAt]) => ({
      id,
      title,
      body,
      keywords,
      createdAt,
    }));
  });
}

export async function createPassage(title: string, body: string, keywords: string): Promise<void> {
  return withQuizConnection(async (conn) => {
    await conn.execute(
      `INSERT INTO quiz_passages (title, body, keywords) VALUES (:title, :body, :keywords)`,
      { title, body, keywords },
      { autoCommit: true }
    );
  });
}

export async function updatePassage(id: number, title: string, body: string, keywords: string): Promise<void> {
  return withQuizConnection(async (conn) => {
    await conn.execute(
      `UPDATE quiz_passages SET title = :title, body = :body, keywords = :keywords WHERE id = :id`,
      { title, body, keywords, id },
      { autoCommit: true }
    );
  });
}

export async function deletePassage(id: number): Promise<void> {
  return withQuizConnection(async (conn) => {
    await conn.execute(`DELETE FROM quiz_passages WHERE id = :id`, { id }, { autoCommit: true });
  });
}

export async function getQuizConfig(): Promise<QuizRatio> {
  return withQuizConnection(async (conn) => {
    const result = await conn.execute<[number, number, number]>(
      `SELECT blank_pct, first_pct, recite_pct FROM quiz_config WHERE id = 1`,
      [],
      { outFormat: oracledb.OUT_FORMAT_ARRAY }
    );
    const row = result.rows?.[0];
    return {
      blankPct: row?.[0] ?? 50,
      firstPct: row?.[1] ?? 50,
      recitePct: row?.[2] ?? 0,
    };
  });
}

export async function updateQuizConfig(blankPct: number, firstPct: number, recitePct: number): Promise<void> {
  return withQuizConnection(async (conn) => {
    await conn.execute(
      `UPDATE quiz_config SET blank_pct = :b, first_pct = :f, recite_pct = :r WHERE id = 1`,
      { b: blankPct, f: firstPct, r: recitePct },
      { autoCommit: true }
    );
  });
}

export async function getMonthlyStats(ym: string): Promise<Map<number, number>> {
  return withQuizConnection(async (conn) => {
    const result = await conn.execute<[number, number]>(
      `SELECT TO_NUMBER(TO_CHAR(day, 'DD')) AS d, correct_count
       FROM quiz_daily
       WHERE day >= TO_DATE(:ym || '-01', 'YYYY-MM-DD')
         AND day <  ADD_MONTHS(TO_DATE(:ym || '-01', 'YYYY-MM-DD'), 1)`,
      { ym },
      { outFormat: oracledb.OUT_FORMAT_ARRAY }
    );
    const out = new Map<number, number>();
    for (const [d, count] of result.rows ?? []) out.set(d, count);
    return out;
  });
}

export async function fetchRandomPassages(limit = 5): Promise<Array<{ title: string; body: string; keywords: string | null }>> {
  return withQuizConnection(async (conn) => {
    const result = await conn.execute<[string, string, string | null]>(
      `SELECT title, body, keywords FROM quiz_passages
       ORDER BY DBMS_RANDOM.VALUE FETCH FIRST :limit ROWS ONLY`,
      { limit },
      { outFormat: oracledb.OUT_FORMAT_ARRAY }
    );
    return (result.rows ?? []).map(([title, body, keywords]) => ({
      title,
      body,
      keywords,
    }));
  });
}

export async function recordCorrectAnswer(tz = "America/Los_Angeles"): Promise<void> {
  return withQuizConnection(async (conn) => {
    await conn.execute(
      `MERGE INTO quiz_daily d
       USING (SELECT TRUNC(SYSTIMESTAMP AT TIME ZONE '${tz}') AS day FROM dual) s
       ON (d.day = s.day)
       WHEN MATCHED THEN UPDATE SET d.correct_count = d.correct_count + 1
       WHEN NOT MATCHED THEN INSERT (day, correct_count) VALUES (s.day, 1)`,
      [],
      { autoCommit: true }
    );
  });
}
