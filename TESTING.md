# Automated tests

Run all checks from the project root with `npm run test:all` (Node.js 24+).
It checks types, builds production output, then runs the suites below sequentially.

| Command | Coverage |
| --- | --- |
| `npm test` | API integration: accounts, permissions, file content and previews, Office extraction, versions, Trash, ZIP, quotas, session and data persistence |
| `npm run test:features` | Preferences, resumable uploads and retry/restart behavior, checksum rejection, public links, password changes, session revocation, TOTP and recovery replay, backups and corrupted blobs, suspended accounts |
| `npm run test:ui` | React components in jsdom: initial loading, six sort modes, persisted sort preferences, filters and empty states, breadcrumb, offline/reconnect, Trash Undo, Thai controls, timeout errors |

The integration and feature suites need a current production build (`npm run build`). They start temporary servers on ports 3107 and 3109 and stop them in a finally block. Use these ports only for these tests while running the suite. Their databases and files are created under the OS temporary directory. UI compilation fixtures go under ignored `.test-data/`; its API is mocked and it does not access the live workspace.

The UI suite verifies DOM behavior, not browser rendering, pixel layout, real mobile touch behavior or accessibility compliance. ClamAV is not exercised by these suites; run `npm run test:antivirus` separately (see below). No real credentials are required.

`.github/workflows/tests.yml` runs `npm run test:all` for pushes, pull requests and manual runs on GitHub. The workflow runs only after this project is pushed to a GitHub repository; no remote run was triggered locally.

Demo access is covered by `npm run test:demo` (port 3110, isolated data). It checks three real roles, department boundaries, demo-only management, protection of real accounts, immutable shared security credentials, and rejection of demo sessions when demo mode is disabled. It is included in `npm run test:all`. The UI suite also checks the three demo choices and clicking a demo login button.

## TH / EN interface

The TH / EN switch is available on login, workspace, admin and public share pages. A choice is stored in `nexafile-ui` on the device; signed-in users also save it with `/api/preferences`. Account settings retain the same language selector. Dates in the file workspace, admin activity and link expiry follow the selected locale. Names, file contents, emails, department names, paths and API configuration keys remain original data.

Translations are defined in `components/preferences.tsx` and `lib/translations.ts`. Use `t('English UI text')` for interface copy, and `t('{count} files', {count})` for interpolated text. Unknown technical/provider messages fall back to their original wording. Do not send document contents to the translator.

Run `npm run test:i18n` to check literal UI copy coverage. The DOM suite also checks TH/EN switching on login/workspace/admin, persistent language choices, accessible selected-language state, interpolated help text and preservation of file names. Both are included in `npm run test:all` and the GitHub workflow.


## External services

- npm run services:check: live MySQL, Redis and S3 connectivity and a minimal reversible read/write probe.
- npm run test:services: production API on port 3111 with a generated temporary MySQL database and dedicated Redis/S3 prefixes; covers session persistence, resumable uploads, Thai search, permissions, versioning, MySQL rollback, S3 downloads and PDF cache restoration, MFA/recovery, verified remote backups, retention and atomic Redis limits. Only its own generated test data is cleaned up. It needs .env.local and private network connectivity.
- npm run test:transfer: data:export from one isolated SQLite/local install and data:import into another (port 3115); covers refusal to overwrite members without --replace, rejection of a modified archive, same file IDs and contents, and 2FA still working because server.key is carried over.
- Ordinary test suites explicitly force SQLite/local/no-Redis, so npm run test:all and CI never access the live database or bucket.


## Performance and SEO

`npm run test:performance` checks isolated SQLite fixtures with 1 and 201 files, constant workspace query counts, excerpt limits, sharing inheritance, Trash isolation, recent activity, and supporting indexes. `npm run test:seo` requires a production build and uses loopback port 3112 with isolated data. It verifies server HTML, TH/EN content, metadata, noindex headers, local fonts, robots, sitemap, and the generated PNG preview. Both commands are included in `test:all`; neither calls external storage. The UI suite covers 50-file pagination, next/previous controls, and clamping after results shrink. See [SEO.md](SEO.md) for deployment settings and performance limits.

## Antivirus

`npm run test:antivirus` needs a running clamd, by default `127.0.0.1:3310` (override with `CLAMAV_HOST` / `CLAMAV_PORT`). Locally the Docker stack provides one when started with `docker-compose.dev.yml` (see DEPLOYMENT.md, "Local development against the Docker stack"):

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d clamav
```

It uses isolated SQLite data on port 3114 and the harmless EICAR test file. It checks that clean uploads are scanned and accepted, EICAR is rejected through simple and resumable uploads, manual rescans work, and uploads fail closed when ClamAV is unreachable. It is not part of `test:all` because CI has no ClamAV.

