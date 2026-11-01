# Performance and search visibility

## Current local configuration

The application has no public domain yet. Search indexing is disabled by default. The workspace at `/`, admin pages, share pages, and API responses include `X-Robots-Tag: noindex, nofollow, noarchive`. Page metadata also defaults to `noindex`. These settings reduce search exposure; authentication and permission checks remain the access controls.

The public product pages are `/about/en` and `/about/th`. They render static HTML with localized headings, descriptions, language links, FAQs, and `SoftwareApplication` structured data. Their content describes existing features and contains no documents, account information, fabricated ratings, or pricing claims. An “About NexaFile” link is available on the sign-in page.

## Enable indexing after deployment

Configure the real HTTPS origin before creating the production build:

```dotenv
# Replace the placeholder with your real domain.
APP_URL=https://your-real-domain.example
SITE_URL=https://your-real-domain.example
SEO_INDEXING_ENABLED=true
```

The placeholder above intentionally does not enable indexing. `SITE_URL` must be an HTTPS public domain, without embedded credentials. Localhost, numeric IP addresses, internal/test/placeholder domains, development mode, and an absent opt-in keep indexing disabled. `APP_URL` controls session/origin security; `SITE_URL` controls public SEO URLs. Configure both consistently.

Run `npm run build` again after changing these settings, then restart the production server. Metadata routes and public pages are generated at build time. Environment changes on an already running build do not regenerate them.

When enabled:

- Each product page has its own canonical URL and reciprocal `en`, `th`, and `x-default` alternates.
- `/sitemap.xml` lists only the two public product pages.
- `/robots.txt` allows crawling and advertises the sitemap. API crawling is excluded.
- Workspace, admin, and share routes keep their `noindex` response headers. Their URLs are never added to the sitemap. Private pages must remain crawlable for a crawler to read their `noindex` directives; do not treat robots.txt as an access control.
- `/opengraph-image` supplies a generic 1200 × 630 PNG for social previews. It includes no personal file information.

Verify the deployed pages and sitemap, then submit the sitemap in Google Search Console. Search engines decide whether and when to index pages; configuration does not guarantee inclusion or rankings.

## Performance changes

- Workspace file metadata is loaded with one SQL query instead of per-file owner, folder, favorite, sharing, and permission queries. Effective owner/editor/viewer permissions and inherited sharing are preserved.
- Only the first 300 characters of indexed text are transferred from the database for workspace excerpts. Document details and content search retain access to the indexed content.
- Folder metadata/counts are loaded in one query. Recent activity is scoped by permissions in SQL before applying the 30-entry limit.
- Independent workspace reads run concurrently. Account authentication reuses the security/profile rows within the request, without caching authorization across requests.
- Composite indexes support owner/deleted/modified filters, folder counts, share lookups, and activity ownership on SQLite and MySQL. Index creation is idempotent. The MySQL application account needs index creation privileges; on a large installation, schedule schema changes with the database operator.
- The browser renders at most 50 file rows/cards per page. Filters and ordering apply to the entire loaded file list; selections may span pages. This limits DOM work, but the workspace response still includes all accessible file metadata. Large deployments may need server-side cursor pagination later.
- Noto Sans Latin and Noto Sans Thai variable fonts are self-hosted with `next/font/local`, preloaded, and use `font-display: swap`. Opening a page no longer requests the Google Fonts stylesheet. Font licenses are served under `/fonts/licenses/`.

## Verification

```sh
npm run typecheck
npm run build
npm run test:performance
npm run test:seo
npm run test:ui
```

The performance test uses isolated SQLite fixtures and verifies a constant query count with 1 and 201 files, bounded excerpts, direct/inherited grants, Trash isolation, and activity visibility. The SEO test starts an isolated production server on loopback port 3112 and checks server-rendered metadata/content, font preloads, image dimensions, robots, sitemap, unsupported languages, and private response headers. No live documents are used.

These are functional and query-count checks, not a measured Lighthouse or Core Web Vitals score. Measure LCP, INP, and CLS on the eventual public deployment with representative files, devices, and network conditions.

References: [Google noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing), [localized page guidance](https://developers.google.com/search/docs/specialty/international/localized-versions).
