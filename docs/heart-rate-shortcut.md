# Heart rate: Apple Health shortcut

Care Log is a web app, so it cannot read Apple Health or the Apple Watch
directly. Safari has no web API for HealthKit, on the Home Screen or not.
The "Get from Apple Health" button on the Heart rate screen works around
this by handing off to the iOS Shortcuts app, which can read Health data
and can also talk to Firestore directly. This page is the recipe for
building that Shortcut, once, on each phone that should use the button.

If you would rather just type the number in from a blood pressure monitor
or pulse check, use "Or enter manually" on the same screen. The Shortcut
is optional.

## What the button does

The button is a plain link to:

```
shortcuts://x-callback-url/run-shortcut?name=Care%20Log%20Heart%20Rate&x-success=...
```

iOS intercepts that link and opens the Shortcuts app, running a shortcut
called **exactly** `Care Log Heart Rate`. Care Log itself never touches
Health data. If nothing happens when you tap the button, the shortcut
either does not exist yet on that phone, or is named differently.

## A secret lives on the phone

The shortcut has to sign in to Firebase to be allowed to write an entry,
the same way the app does. That means it needs an email and password for
one of the two accounts, stored as plain text inside the shortcut. It
never leaves the phone and is protected the same way the rest of the
phone is (passcode or Face ID), but it is worth knowing it is there
before you build it. Build a separate copy on Mark's phone and on
Shelley's phone, each signed in as themselves, so `addedBy` stays correct.

## Values this project uses

- Firebase project ID: `care-log-3d05a`
- Firebase web API key: `AIzaSyCrc8VkeAzXAMzeTZp-NblqVsg7EAreH64` (this is
  the public web config key already in `config.js`, not a secret; access
  is controlled by `firestore.rules`, not by hiding this key)

## Building the shortcut

Open the Shortcuts app, create a new shortcut, name it **exactly**
`Care Log Heart Rate`, and add these actions in order. Exact action names
can move slightly between iOS versions; the shape below is what matters.

1. **Text** — your email, e.g. `markbrown667@gmail.com`
2. **Text** — your password
3. **Find Health Samples** — Type: Heart Rate, Sort by: Newest First,
   Limit: 1
4. **Get Details of Health Samples** — Detail: Quantity (or "Value" on
   older iOS). This is the bpm number.
5. **Get Numbers from Input**, fed the result of step 4 — a safety net
   so a stray unit like "bpm" never ends up in the value.
6. **Format Date** — Current Date, Date Format: ISO 8601. This is today's
   timestamp for `at` and `createdAt`.
7. **Format Date** — Current Date, Date Format: Custom, Custom Format
   `yyyy-MM-dd`. This is `day`.
8. **Get Contents of URL** (sign in):
   - URL: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyCrc8VkeAzXAMzeTZp-NblqVsg7EAreH64`
   - Method: POST
   - Headers: `Content-Type: application/json`
   - Request Body: JSON, with `email` = result of step 1, `password` =
     result of step 2, `returnSecureToken` = Boolean `true`
9. **Get Dictionary from Input**, fed the result of step 8
10. **Get Dictionary Value** — Key: `idToken`. This is the sign-in token.
11. **Text** — build the Firestore document, typing this literally and
    inserting the matching variable from steps 4–7, 10 wherever shown:

    ```
    {"fields":{"day":{"stringValue":"<step 7>"},"at":{"timestampValue":"<step 6>"},"type":{"stringValue":"heart"},"value":{"integerValue":"<step 5>"},"addedBy":{"stringValue":"Mark"},"createdAt":{"timestampValue":"<step 6>"}}}
    ```

    Change `"addedBy":{"stringValue":"Mark"}` to `"Shelley"` on Shelley's
    phone.
12. **Get Contents of URL** (write the entry):
    - URL: `https://firestore.googleapis.com/v1/projects/care-log-3d05a/databases/(default)/documents/entries`
    - Method: POST
    - Headers: `Content-Type: application/json`, `Authorization` =
      `Bearer ` followed by the result of step 10 (no line break, one
      space after "Bearer")
    - Request Body: File, using the Text from step 11
13. **Show Notification** — "Heart rate logged: " followed by the result
    of step 5, then " bpm", so you get confirmation it worked.

Test each stage as you build it (Shortcuts can show a quick preview of
any action's result), rather than wiring the whole thing blind. Once
step 13 shows a sensible number, open Care Log, tap the Heart rate
button, then "Get from Apple Health", and the new entry should appear in
the timeline within a second or two, on both phones.

## Not medical advice

This shortcut only moves a number from one app to another. It does not
check, interpret or flag anything. Treat every reading the same way you
would treat one written down by hand.
