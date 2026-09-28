# Care Log bridge

A small Cloudflare Worker on the free plan. It holds the secrets Care Log needs and
receives Apple Health data from the Health Auto Export app, writing steps and sleep
straight into Firestore. No secret is ever in the public site.

Endpoints:
- `POST /health` with header `X-Care-Log-Key: <BRIDGE_KEY>` and Health Auto Export's JSON.
  Writes `exercise/{day}.steps` and `entries/{day}_sleep` (deterministic id, so re-sends update).
  Also `nutrition/{day}` ({ kcal, prot, carb, fat, source "apple-health" }) from the metrics Dietary Energy, Protein,
  Carbohydrates and Total Fat, summed per day, for anyone who logs food in an app that writes to Apple Health
  (MyFitnessPal, Nutracheck, Apple's own). Add those four metrics to the same Health Auto Export automation.
  Also stores the last raw payload at `bridge/last` for checking the shape.
- `GET /ping` health check.
- `POST /explain` with header `Authorization: Bearer <Firebase ID token>` and JSON
  `{ kind: "document" | "notes", title?, date?, text?, pages?: [base64 JPEG] }`. "Explain in Daybook":
  asks Claude (the Messages API over plain fetch, model `claude-opus-5`, the `ANTHROPIC_API_KEY` secret)
  for a plain English explanation of a letter, or for a numbered list of questions to ask from the
  Notes for the team text, and returns `{ text, model, usage }`. The token is checked against Google's
  public keys; the real project needs a `users/{uid}` record with role family, the shared demo
  (`DEMO_PROJECT_ID` in wrangler.toml) any signed-in guest. A daily count in `bridge/explainLog`
  (40 real, 12 demo) caps what a day can spend; the letter itself is never stored. Answers
  `503 not-set-up` until the key exists, `429 limit` when the day is used up, `422 refused` if the
  model declines.

Deployed by `.github/workflows/deploy-worker.yml` from four GitHub repository secrets:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BRIDGE_KEY`, `FIREBASE_SERVICE_ACCOUNT`.
