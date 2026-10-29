# Daybook for iPhone

The iPhone app around Daybook's own web code, made with Capacitor. The web files at the repository root are copied into the app (`npm run copy-web`), so the app works the same as app.mymedicaldaybook.co.uk.

Not finished: the bridge must allow the app's origin, then Apple Health read directly. See ROADMAP.md, action 17.

On the Mac, once Xcode is installed:

1. `cd native && npm install`
2. `npm run sync` (copies the web files and updates the Xcode project)
3. `npx cap open ios`, then in Xcode choose the Mark 1 Apps Ltd team under Signing and run it on the iPhone.
