# Daybook for iPhone

The iPhone app around Daybook's own web code, made with Capacitor. The web files at the repository root are copied into the app (`npm run copy-web`), so the app works the same as app.mymedicaldaybook.co.uk.

Not finished: the bridge must allow the app's origin, then Apple Health read directly. See ROADMAP.md, action 17.

On the Mac, once Xcode is installed:

1. `cd native && npm install`
2. `npm run sync` (copies the web files and updates the Xcode project)
3. `npx cap open ios`, then in Xcode choose the Mark 1 Apps Ltd team under Signing and run it on the iPhone.


## Android (v397)

`android/` is the Android project. GitHub builds it: the **Android app for Google Play** workflow (Actions tab, Run workflow) makes a signed `.aab` and keeps it on the run for 7 days. It needs the `ANDROID_KEYSTORE_PASSWORD` repository secret (20 characters or more, kept in the password manager). The first run makes the upload key and stores it here encrypted with that password; never delete `android/upload-key.p12.enc` or change the password, or Google Play will refuse the next upload until the key is reset with Play support.
