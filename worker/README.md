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

Deployed by `.github/workflows/deploy-worker.yml` from four GitHub repository secrets:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BRIDGE_KEY`, `FIREBASE_SERVICE_ACCOUNT`.
