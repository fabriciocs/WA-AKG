# Setup and execution

The supported entrypoint for configuring a local WA-AKG instance is:

```text
npm run setup
```

The command invokes the Node.js configurator and is intended to behave consistently on Windows, Linux and macOS. Run it from the repository root after `npm install`.

## First run

When no local configuration exists, the wizard asks for the required settings, validates the values it can validate locally, and creates the configuration needed by the selected execution mode. Secret values are entered interactively and are not echoed or printed in diagnostic output.

## Existing or older configuration

If a configuration already exists, the wizard reports that state and offers:

- keep the current configuration and continue;
- configure again, reviewing values interactively;
- cancel without changing files.

If the configuration belongs to an older format, the wizard creates a timestamped backup before migration. Known values are preserved, new required values are requested, and the backup should be retained until the instance is verified. To recover, stop the instance, restore the appropriate backup, and run `npm run setup` again.

## Execution modes

### Development

```bash
npm run setup
npm run dev
```

### Production

```bash
npm run setup
node scripts/setup.mjs --mode=production
```

In production mode the wizard asks for the network binding (`127.0.0.1` is the recommended default), sets `NODE_ENV=production`, confirms `prisma migrate deploy`, checks the port and migrations, then runs migration, build and `npm start` in that order. A migration or build failure stops the flow before the server starts. For automation, use `node scripts/setup.mjs --mode=production --non-interactive --apply-migrations` only after reviewing the target database and configuration.

The production process runs in the foreground. Put a TLS reverse proxy in front of a loopback binding for public access, configure firewall rules before selecting `0.0.0.0`, and back up the database before migration. The wizard does not install PM2, systemd, Windows services or launchd; use an already-approved supervisor separately when required.

### Docker Compose

```bash
npm run setup
docker compose build app
docker compose --profile ops run --rm migrate
docker compose up -d db app
```

Use the Compose files and database procedure documented in [Database Setup](DATABASE_SETUP.md). Existing databases must be backed up and their schema verified before migration or baselining.

## Platform notes

- Windows: run `npm run setup` from PowerShell or Command Prompt; Docker Desktop is required only for Docker mode.
- Linux: run from a shell with Node.js installed; ensure the configured port and database are reachable by the service account.
- macOS: run from Terminal; Docker Desktop is required only for Docker mode.

## Security limits

The configurator is local setup assistance, not a deployment or authorization boundary. It does not deploy, push, reset databases, delete data, expose administrative ports, or install global process managers. Keep `.env` and generated backups out of source control, use unique secrets, bind local development services to loopback where appropriate, and do not place real credentials in documentation or shell history. Database migrations, reverse-proxy exposure, WhatsApp sessions and external service changes require separate operational review.
