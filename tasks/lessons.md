# Lessons Learned

Patterns captured from real failures during PiePad development. Re-read at the
start of related work to avoid repeating the same mistakes.

---

## Flyway

### Baseline silently skips your first migration
- **Symptom**: `pnpm db:migrate` reports `Schema version: 1` and Success, but no
  application tables are created. `flyway info` shows V1 as
  `Ignored (Baseline)` with a separate `Baseline` row also at V1.
- **Cause**: `flyway.baselineOnMigrate=true` combined with the default
  `flyway.baselineVersion=1` tells Flyway "treat V1 as already applied" —
  every migration `<= baselineVersion` is skipped.
- **Fix**: For greenfield projects, always set `flyway.baselineVersion=0` when
  `baselineOnMigrate=true` is used. With V0 baseline, V1+ all run.
- **Recovery when bitten**: drop `flyway_schema_history` in the target schema,
  fix the config, re-run migrate.

---

## Docker Compose

### `--env-file` is required when the compose file lives in a subdirectory
- **Symptom**: `WARN The "FOO" variable is not set. Defaulting to a blank string.`
  for variables that are clearly defined in project-root `.env`.
- **Cause**: Compose's default project directory is the directory of the first
  `-f` compose file. With `docker/docker-compose.yml`, it looks for
  `docker/.env`, not the project root.
- **Fix**: Pass `--env-file .env` explicitly in package.json scripts when the
  compose file is nested.

### `.env` does not recursively expand `${VAR}`
- **Symptom**: A composite var like
  `FLYWAY_URL=jdbc:oracle:thin:@${ORACLE_TNS_NAME}?...` is passed to the
  container literally, without `${ORACLE_TNS_NAME}` substituted.
- **Cause**: `.env` is parsed as plain `KEY=VALUE`. Compose only interpolates
  `${VAR}` references in the YAML, not inside `.env` values themselves.
- **Fix**: Build the composite value inline in the compose YAML's
  `environment:` block, referencing the simple atoms from `.env`. Don't
  duplicate composite values in `.env`.

---

## Oracle Autonomous Database

### Newly created users have no privileges to create tables
- **Symptom**: Migration fails with `ORA-01031: insufficient privileges` when
  Flyway tries to `CREATE TABLE "<USER>"."flyway_schema_history"`.
- **Cause**: ADB users created via `CREATE USER` only get login. They need
  privileges and a tablespace quota explicitly.
- **Fix**: As ADMIN, run:
  ```sql
  GRANT CONNECT, RESOURCE TO <user>;
  ALTER USER <user> QUOTA UNLIMITED ON DATA;
  ```
  Or `GRANT DWROLE TO <user>;` for the ADB convenience role.

### Wallet `sqlnet.ora` `?/network/admin` placeholder breaks in containers
- **Symptom**: `ORA-12578: TNS:wallet open failed` or similar SSL/wallet errors
  when running JDBC/oracledb from Docker.
- **Cause**: ADB-supplied `sqlnet.ora` uses
  `WALLET_LOCATION=...DIRECTORY="?/network/admin"` where `?` resolves to
  `$ORACLE_HOME` — undefined in slim Flyway/Node containers.
- **Fix**: Replace `?/network/admin` with the actual mounted wallet path
  (`/wallet`) before first use:
  ```sh
  sed -i.bak 's|?/network/admin|/wallet|' wallet/sqlnet.ora
  ```
