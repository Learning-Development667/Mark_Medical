# Rules tests

Break-in tests for `firestore.rules`, the security rules that keep each household's data to its own
members. They run on Google's own Firestore emulator, so they prove what the live database will do
without touching it.

What they try, and what must happen:

- a stranger who is signed in but in no household: refused everywhere
- someone not signed in: refused everywhere
- a member of household A reading or writing household B: refused
- a read-only member writing anything: refused (reading works)
- a viewer reading food, notes, letters, exercise or the profile: refused (medicines, the calendar and readings work)
- anyone writing a members record, a household record, a users record, an inbox key or the bridge's logs: refused
- an oversized document page or recording part: refused
- a family member doing ordinary things in their own household: allowed

Run locally (needs Java 11 or newer and Node 20):

```
cd tests/rules
npm install
npm test
```

`.github/workflows/rules-test.yml` runs the same on every push that touches the rules or these tests.
The cases live in `households.test.mjs`; add one whenever a rule changes.
