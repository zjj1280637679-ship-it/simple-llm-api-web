# Local workspace persistence

Local IndexedDB, schema version 1, database scoped to this app's pathname (not the query/cache-buster). There was no prior persistent format to migrate: unsupported future/corrupt snapshots fail closed and are never overwritten. No cloud upload or extra package dependency.

Saved: both workspaces' drafts, prepared attachment bytes/metadata, visible messages, native model history (including thought signatures, tool responses and opaque native thinking blocks), model/family settings, independent reply/last-request metrics, selected page and per-page reading position. Generated image bytes are retained, not expired object URLs. Pending streams restore as incomplete and requests are not reissued. Native history only contains the engine's committed checkpoints.

Excluded: API key, trusted target, request headers, controllers, loading objects, model-list diagnostics, network logs and full response diagnostics. API configuration/cards have explicit allowlists. Current and previously entered keys are redacted from snapshot string values using a memory-only secret set. This cannot discover an arbitrary credential manually pasted into chat that was never supplied as an API key; exported backups contain user-authored content and must be protected by the user. Unsafe credential/query-bearing API URLs are not persisted.

Hydration finishes before interactive rendering or page-session registration. Snapshot creation is debounced 250 ms (not repeated on each streaming token/scroll). User-message submission, committed history/image results, clear, and completion flush immediately. Visibility/pagehide flush is best-effort: a mobile OS kill can still lose the latest uncommitted draft/stream tail. Save success is reported only after IDB transaction completion; `strict` durability is requested when supported. No web storage API is used for credentials or fallback.

Snapshots are atomic and capped at 48 MiB encoded JSON; existing per-file 5 MiB/per-turn 8 MiB attachment limits remain. No automatic attachment pruning: size/quota/write failure keeps the previous successful snapshot and displays a persistent warning. The + menu contains state, JSON export/import and retry; normal autosave has no toast. Invalid imports are rejected before replacing application state. Backup is local download, not upload.

Revision comparison occurs inside one readwrite transaction. A stale tab stops writing and shows a conflict instead of overwriting a newer tab. Export the stale tab before refreshing; no automatic merge. `versionchange` closes the connection and stops writes. Opening IDB has a 5-second timeout; unavailable/blocked storage leaves a usable memory-only app with a visible warning. Private browsing cannot be reliably detected: the UI explicitly warns that private-mode data may vanish when the session closes.

## Tests and limitations

- Pure serializer/schema tests and synthetic serialized-transaction tests: `node --test tests/persistence*.test.js`.
- Real IndexedDB manual UI harness: serve repository and open `tests/browser/persistence.html`. Test DB names are random `qa-*`; synthetic app fixture can only be seeded on localhost. Tests exercise actual transactions/conflict/versionchange and a deliberately aborted transaction (not actual exhausted disk).
- `qa/persistence-browser.mjs` is an optional Playwright script. Local environment launch was blocked by sandbox socket restrictions; escalation also failed at sandbox mount setup. Do not treat this script as executed browser evidence.
- Existing regression harness intentionally bypasses async hydration; persistence semantics have separate tests. `tests/browser/persistence.html` covers the real startup path via the application link and reload steps.
- Safari/WebKit/iOS physical-device reload and OS-eviction behavior remain unverified. IndexedDB is not permanent backup.

Primary references checked 2026-10-29:
- [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): origin quotas, quota errors and storage pressure eviction.
- [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/): Safari/WebKit quota and eviction behavior.
- [IndexedDB transactions](https://www.w3.org/TR/IndexedDB/): transaction atomicity, durability options and version-change lifecycle.
