# Dokploy deployment

`docker-compose.dokploy.yml` runs the same self-contained stack (app, MySQL, Redis, SeaweedFS, ClamAV) on Dokploy. It publishes no ports, mounts no files from the repository (Dokploy re-clones it on every deploy) and sets no `container_name`.

1. Push this project to a Git repository. Never commit `.env`, `.env.local` or export archives (they are git-ignored).
2. In Dokploy create a **Compose** service from that repository and set **Compose Path** to `./docker-compose.dokploy.yml`.
3. **Environment** tab: paste `.env.dokploy.example` and replace every `CHANGE_ME` with a long random value. Set `APP_URL` to the exact public URL (`https://…`); any other origin makes every change fail with 403. Set `NEXAFILE_ADMIN_EMAILS` to the real admin's email, keep `NEXAFILE_DEMO_FULL_ADMIN=false` on a reachable site, and see the demo-account note below before changing `NEXAFILE_DEMO`.
4. **Domains** tab: add the domain for service `app`, container port `3005`, with HTTPS. Dokploy adds Traefik and `dokploy-network` itself.
5. Deploy. The first start waits for ClamAV to load signatures (about a minute). Plan on 4 GB RAM or more for the host: ClamAV needs 1.5–3 GB and the Next.js build is heavy.

Data lives in the named volumes `mysql-data`, `redis-data`, `seaweedfs-data`, `app-data` (holds `server.key`, which encrypts 2FA secrets) and `clamav-data`. Do not delete them; back them up with Dokploy's Volume Backups or the in-app Backups page.

## Moving existing data to Dokploy

`data:export` writes one archive with every database row (except sessions and one-time tokens), every stored file and `server.key`; `data:import` checks the archive's checksums and loads it into whatever backends the process is configured for.

1. On the machine with the current data (the one whose `.env.local` points at it, i.e. the local Docker stack). This only reads the source:
   ```sh
   npm run data:export -- nexafile-export.zip
   ```
2. Copy the archive to the Dokploy host and into the app container (find its name with `docker ps | grep app`):
   ```sh
   scp nexafile-export.zip user@dokploy-host:/tmp/
   docker cp /tmp/nexafile-export.zip <app-container>:/data/import.zip
   ```
3. Import, restart, then scan anything that has no antivirus result yet (uploads open only after a clean scan):
   ```sh
   docker exec <app-container> npm run data:import -- /data/import.zip
   docker restart <app-container>
   docker exec <app-container> npm run antivirus:scan-existing
   docker exec <app-container> rm /data/import.zip
   ```
   Then delete the archive copies on the host and your machine: they contain every file and password hash.

Demo accounts can only sign in while `NEXAFILE_DEMO=true`. The current data belongs entirely to the three demo accounts, so keep `NEXAFILE_DEMO=true` after importing it, or those files become unreachable. Their shared password is in the source and on the login page, so anyone who can open the site can use them; keep such a deployment private (VPN, IP allow-list or Dokploy basic auth) until the data lives in real accounts.

The import refuses to run when the destination already has files or non-demo members; add `--replace` to delete them and load the archive instead. Users sign in again afterwards (sessions are not carried over); passwords, 2FA, roles, departments, shares, versions, trash, audit log and antivirus results are kept, and file IDs stay the same. Stop writing to the old system after the export (or export again right before switching), and keep only one deployment with backups enabled per database.

# Docker deployment (self-contained)

The whole system runs in Docker: the app, MySQL, Redis and SeaweedFS (S3). Nothing connects to hosts outside Docker. Only the app publishes a port (default 3005); the data services sit on an internal-only network.

```sh
cp .env.docker.example .env      # then replace every CHANGE_ME with a long random value
docker compose up -d --build
docker compose exec app npm run services:check
```

Open http://localhost:3005 and register the first account. Set `APP_URL` in `.env` to the exact public origin if you put an HTTPS reverse proxy in front (and `APP_PORT` to change the published port). The `.env` file holds all secrets and is git-ignored.

Data lives in the named volumes `mysql-data`, `redis-data`, `seaweedfs-data` and `app-data` (the last holds `server.key`, which encrypts 2FA secrets). `docker compose down` keeps them; `docker compose down -v` deletes everything. Run operational scripts inside the container, e.g. `docker compose exec app npm run backup` or `docker compose exec app npm run admin -- grant EMAIL`. Backups are written to the SeaweedFS bucket on the same host, so copy them off the machine for real disaster recovery.

The system starts empty. To bring over data from another install, use `data:export` / `data:import` as described in [Moving existing data to Dokploy](#moving-existing-data-to-dokploy); it works the same with `docker compose exec app`.

Two more containers make every feature work without the internet:

- **Password resets:** there is no email service. A Super Admin, or a Department Admin for members of their department, opens Admin → Members → Edit → Reset password, sets a new password (optionally turning off 2FA) and gives it to the member privately. The member is signed out of all devices.
- **Antivirus (ClamAV):** every upload is scanned and `ANTIVIRUS_REQUIRED=true`, so uploads fail with 503 while ClamAV is still loading signatures (about a minute after start, roughly 1.5 GB RAM). Signatures are frozen at image build time because the stack has no internet access; rebuild with `docker compose pull clamav` on a connected machine to refresh them.

Open the app only at the exact `APP_URL` origin (default http://localhost:3005); `127.0.0.1` or a LAN IP makes mutations fail origin validation. The `appuser` MySQL account can also create `file_management*` databases, which `services:restore` and `test:services` need. On a volume created before this grant existed, run `docker compose exec mysql sh /docker-entrypoint-initdb.d/10-grants.sh` once.

## Local development against the Docker stack

`docker-compose.dev.yml` publishes the data services on 127.0.0.1 only (MySQL 3316, Redis 6390, SeaweedFS S3 8343, ClamAV 3310) so `npm run dev` (port 3008) and the app container (port 3005) share the same data. Add `COMPOSE_PATH_SEPARATOR=:` and `COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml` to `.env` (see `.env.docker.example`) so plain `docker compose` commands include it, and point `.env.local` at those ports with the passwords and S3 keys from `.env` (see `.env.example`). Never use this override on a server. The earlier LAN servers (192.168.1.13/14) are no longer used; their data was moved into this stack with `data:export` / `data:import`.

# MySQL / Redis / SeaweedFS configuration

The app uses MySQL (database file_management), Redis and SeaweedFS S3 (bucket backups). The S3 gateway is port 8333 inside Docker; the filer endpoint on 8888 is not the S3 API. Credentials are stored only in ignored .env / .env.local; the app uses appuser rather than the MySQL root account.

Set DATABASE_BACKEND=mysql, REDIS_ENABLED=true and BLOB_BACKEND=s3, then populate the connection variables from .env.example. These modes do not silently fall back to local storage if an external service is unavailable. Redis database IDs are numeric: REDIS_DB=0 and REDIS_PREFIX=file_management: implement the requested application namespace.

Run npm ci (including tooling dependencies for operational scripts). Run npm run dev -- --hostname 127.0.0.1 --port 3005 for local use. For production, build first and run npm start -- --hostname 127.0.0.1 --port 3005 behind your configured reverse proxy. Set APP_URL to the exact public origin when using a proxy.

## Data and sessions

MySQL owns metadata, accounts, roles, permissions, versions and audit records. Session metadata also remains there for session listing and immediate revocation; an active login must additionally have a valid Redis session key with a TTL. Redis Lua applies atomic rate limits. File objects use S3 keys file_management/blobs/<SHA-256>. Objects are private and the app checks permissions before reading them; public links go through the app rather than exposing S3 credentials or object URLs.

Keep data/server.key: it encrypts existing 2FA secrets. Local data/blobs is a cache that can be restored from S3; the API reads originals from S3. Incomplete resumable uploads are local. This deployment therefore still expects one persistent application host; sharing upload staging across multiple application hosts is not configured.

## Migration and checks

Stop the application before npm run services:migrate. The migration requires an empty target database, snapshots the local SQLite database under ignored .test-data/migration-backup-*, retains the original SQLite/files, verifies S3 bytes and table counts, then imports records in a MySQL transaction. A completed migration has a marker and reruns do not overwrite accounts. Activate the three backend flags only after success.

npm run services:check tests MySQL write/read/rollback, Redis PING plus a TTL key, and S3 put/get/hash/delete. Test objects are generated probe keys and are removed afterwards. It prints no passwords. npm run test:all runs local isolated regression tests without accessing these services. npm run test:services is an explicit live test: it creates a temporary file_management_test_* database and Redis/S3 namespaces and removes only that run's data. Do not add it to public CI without a secure route to these private services.

## Backups and recovery

npm run backup and the Super Admin backup controls create a consistent MySQL logical JSON snapshot, independent copies of referenced blobs and the encryption key under file_management/backups/nexafile-*/ in the S3 bucket. Database SHA-256, every blob hash and the encryption key are checked. Retention removes only verified generated backup prefixes belonging to this application. Automatic backup scheduling runs while the application is online.

For recovery, use npm run services:restore -- --name BACKUP_NAME --database NEW_EMPTY_DATABASE --prefix file_management/recovery/UNIQUE_ID/. The restore command refuses a non-empty target or the live database, verifies the backup first and restores data to an isolated target. Point a stopped application at the new MYSQL_DATABASE and S3_PREFIX and put the restored server.key in its NEXAFILE_DATA_DIR. Redis sessions are intentionally not restored, so users sign in again. Keep the old database and S3 prefixes until recovery is reviewed. Copy backups off this SeaweedFS instance as a separate disaster-recovery step.

npm run storage:cleanup is a dry run by default; --apply --server-stopped removes only unreferenced local cache files older than 24 hours and never deletes S3 originals. npm run admin -- grant|revoke EMAIL changes roles in the active database.

## Local backend reference

The following earlier instructions apply only with DATABASE_BACKEND=sqlite, BLOB_BACKEND=local and REDIS_ENABLED=false:

### SQLite/local backend operations

NexaFile runs on one stateful Node.js server with SQLite and private filesystem blobs. Use Node.js 24.13+ and persistent writable storage. Run from the project root and include lib/extract-worker.cjs and installed dependencies; a standalone deployment bundle is not configured. Do not use static hosting or an ephemeral serverless filesystem.

## Launch

Run `npm ci`, optionally copy `.env.example` to `.env.local`, then `npm run build` and `npm start`. Open http://localhost:3000 and create an account. There are no default credentials. For development, use `npm run dev`.

`NEXAFILE_DATA_DIR` sets an absolute storage path; the default is `data/`. Metadata and sessions are in `nexafile.sqlite`; content is in `blobs/`. Keep the entire directory private to the server account and outside `public/`. It is excluded from Git. Fresh accounts have five empty folders; old UI sample files are not imported.

## Permissions

Recipients register on the same server first; owners grant access by account email. There is no invitation email service.

| Access | Preview/download | Personal favorite | Rename/tags/new version | Upload to shared folder | Move/Trash/sharing |
| --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | Yes | Yes | No |
| Viewer | Yes | Yes | No | No | No |

Folder grants apply to all files inside. Direct and inherited grants combine, with the strongest permission winning. Revoke a folder grant to remove inherited access. Moving files changes inherited grants. Editor uploads to shared folders belong to the folder owner and count against that owner's quota. Trashed files are accessible only to their owner.

## Storage and versions

Defaults: 1 GB per account including all versions and Trash, 50 MB per file. Configure `NEXAFILE_QUOTA_MB` and `NEXAFILE_MAX_UPLOAD_MB`. The UI uploads up to ten files sequentially with progress; the API supports atomic batches up to ten files and a 100 MB total request limit. Bulk metadata changes roll back together on any failure.

New uploads of versions preserve old content; restoring a version creates another saved version. Rename preserves the extension. Trash is recoverable. Permanent deletion requires typing the exact file name, removes all versions and shares, and frees logical quota. Immutable blobs remain until maintenance to avoid corrupting another duplicate or an in-flight upload.

## Backups and restore

```sh
npm run backup -- C:/Backups/nexafile-2026-10-21
```

Use a new destination outside the live data directory. The script creates a consistent SQLite snapshot and copies every referenced content blob. It can run online. `backup.json` is written only after all content is copied. The script never overwrites an existing directory. Restrict backup access; NexaFile itself does not encrypt backups.

To restore: stop the app, preserve the current data directory, set `NEXAFILE_DATA_DIR` to the complete backup (or a new copy of it), then start the app. Never overwrite a running database.

Unused blob cleanup is dry-run by default:

```sh
npm run storage:cleanup
```

After a backup, stop the app before applying cleanup:

```sh
npm run storage:cleanup -- --apply --server-stopped
```

Only unreferenced SHA-256 blob files older than 24 hours are eligible. All referenced versions are retained. Do not run apply mode concurrently with the server or backup jobs.

## Previews and indexing limits

- PDF previews render actual pages to PNG on the server, with page navigation and no browser plugin required. Rendering is limited to PDFs under 12 MB; larger files can be downloaded and opened in a native reader. Text extraction covers up to 50 pages.
- DOCX/XLSX/PPTX previews show extracted content, not pixel-perfect Office layout or editing. Extraction limits: 500 nonempty rows per worksheet and 100 slides.
- PNG/JPEG/WebP/GIF, browser-supported video/audio, and UTF-8 text have native previews. Unsupported codecs require downloading.
- Plain text, Markdown, CSV, JSON, and code are indexed as text. HTML and SVG uploads are never executed as web pages.
- Indexed content is capped at 100,000 characters. Office/PDF extraction is limited to files below 12 MB, a 20-second subprocess timeout, a JavaScript heap limit, and ZIP expansion limits. Files that cannot be indexed still remain downloadable, with an explicit status.
- Scanned PDFs and images have no extractable text, so their contents are not searchable. Encrypted documents and legacy `.doc`, `.xls`, `.ppt` do not support content extraction. Exact duplicates are detected by original content hashes for every format.

## Team deployment

Run one persistent server behind an HTTPS reverse proxy. Set `APP_URL` to its exact public origin for mutation origin validation and secure session cookies. Match proxy body limits to app upload limits. Sessions are HTTP-only, SameSite Strict, and expire after seven days. Passwords are salted scrypt hashes. Login, registration, mutations, and uploads are rate limited. Set `DISABLE_REGISTRATION=true` after creating required accounts if public registration is unwanted.

The server operator can access stored data. Outgoing email (password-reset links, email verification, invitations), MFA, SSO, billing, antivirus scanning, end-to-end encryption, multi-server storage, and document co-editing are not included. Add the services needed for your public/enterprise deployment; this project does not provision external accounts or hosting.

## Checks

```sh
npm run typecheck
npm run build
npm test
```

Integration tests run a production server on port 3107 with isolated temporary data. They cover account/file isolation, sessions, origin protection, viewer/editor/owner permissions, folder grants and revocation, document extraction, Thai content search, atomic edits, range requests, duplicates, quotas, Trash, permanent deletion, versions, and persistence after restart.
