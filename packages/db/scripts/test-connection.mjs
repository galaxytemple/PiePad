import fs from "node:fs";
import path from "node:path";
import oracledb from "oracledb";

function resolveWalletDir() {
  const explicit = process.env.ORACLE_WALLET_DIR;
  if (explicit) {
    const abs = path.resolve(explicit);
    if (fs.existsSync(path.join(abs, "cwallet.sso"))) return abs;
  }
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, "wallet");
    if (fs.existsSync(path.join(candidate, "cwallet.sso"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("wallet (cwallet.sso) not found");
}

const walletDir = resolveWalletDir();
const password = process.env.ORACLE_PASSWORD;
const user = process.env.ORACLE_USER;
const tns = process.env.ORACLE_TNS_NAME;
const walletPassword = process.env.ORACLE_WALLET_PASSWORD ?? "";

console.log("walletDir:", walletDir);
console.log("user:", user, "tns:", tns);
console.log(
  "ORACLE_WALLET_PASSWORD set:",
  walletPassword.length > 0 ? "yes" : "no"
);

const variants = [
  {
    label: "[1] configDir only",
    config: { configDir: walletDir },
  },
  {
    label: "[2] configDir + walletLocation (dir)",
    config: { configDir: walletDir, walletLocation: walletDir },
  },
  {
    label: "[3] configDir + walletLocation + walletPassword",
    config: {
      configDir: walletDir,
      walletLocation: walletDir,
      walletPassword,
    },
  },
  {
    label: "[4] configDir + walletLocation pointing at ewallet.pem",
    config: {
      configDir: walletDir,
      walletLocation: path.join(walletDir, "ewallet.pem"),
      walletPassword,
    },
  },
];

for (const variant of variants) {
  process.stdout.write(`\n${variant.label} ... `);
  try {
    const conn = await oracledb.getConnection({
      user,
      password,
      connectString: tns,
      ...variant.config,
    });
    const r = await conn.execute("SELECT 1 FROM dual");
    await conn.close();
    console.log("✅ OK", JSON.stringify(r.rows));
  } catch (err) {
    console.log("❌");
    console.log(`    code: ${err.code}`);
    console.log(
      `    message: ${err.message?.split("\n")[0]?.slice(0, 200)}`
    );
  }
}

console.log("\n--- done ---");
