# Daybook bridge

A small Cloudflare Worker on the free plan. It holds the secrets Daybook needs and
receives Apple Health data from the Health Auto Export app, writing steps, sleep, workouts and
food totals straight into Firestore. No secret is ever in the public site.

Since v75 every household's data lives under `households/{id}/...` and the bridge only ever
touches one household per request (`hp(hid, path)`).

Endpoints:
- `POST /health` with header `X-Care-Log-Key: <the household's inbox key>` and Health Auto Export's
  JSON. The key's SHA-256 hash is looked up in `healthKeys/{hash}` { household }; keys themselves are
  never stored, and each household has its own (made by the Household admin workflow, shown in the
  app under More > Settings > Apple Health). Writes `exercise/{day}.steps`, `entries/{day}_sleep`
  (deterministic id, so re-sends update), `exercise/{day}.workouts` and `nutrition/{day}`
  ({ kcal, prot, carb, fat, source "apple-health" }) inside that household, and keeps the last raw
  payload at `households/{id}/bridge/last`.
- `GET /last?key=<inbox key>` the last send into that key's household, for checking field names.
- `GET /ping` health check.
- `POST /explain` with header `Authorization: Bearer <Firebase ID token>` and JSON
  `{ kind: "document" | "notes" | "programme", title?, date?, text?, pages?: [base64 JPEG] }`.
  "Explain in Daybook": asks Claude (the Messages API over plain fetch, model `claude-opus-5`, the
  `ANTHROPIC_API_KEY` secret) for a plain English explanation of a letter, a numbered list of
  questions to ask, or an exercise plan read from a photo, and returns `{ text, model, usage }`.
  The token is checked against Google's public keys; the real project needs `users/{uid}.household`
  and a family record in that household's `members`; the shared demo (`DEMO_PROJECT_ID` in
  wrangler.toml) any signed-in guest, in its one household `demo`. A daily count in
  `households/{id}/bridge/explainLog` (40 per household, 12 for the demo) caps what a day can
  spend; the letter itself is never stored. Answers `503 not-set-up` until the key exists,
  `429 limit` when the day is used up, `422 refused` if the model declines.
- `GET /push-test?key=<inbox key>` sends a test notification to every phone in that household.
- `GET /remind-now?key=<BRIDGE_KEY>` runs the reminder check for every household by hand (the
  same thing the five-minute cron does).

Deployed by `.github/workflows/deploy-worker.yml` from four GitHub repository secrets:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BRIDGE_KEY`, `FIREBASE_SERVICE_ACCOUNT`.
`BRIDGE_KEY` is the operator's key: it guards `/remind-now`, and the migration linked it to the
first household as that household's inbox key.
