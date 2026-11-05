#!/bin/bash
# Daily screenshots on Apple's iPhone simulators (v416, Chris's idea, Mark: "yes set up item 5").
# For each chosen iPhone (the smallest SE, a standard size, the largest Pro Max and the iPhone Duo when the image has it),
# in light and dark, and at two larger text sizes: the real app's opening screen (checks it fills the screen, not letterboxed), then each tab of the
# cancer preview in Safari (?preview=cancer&tab=...), the same WebKit the app runs on. Made-up data only.
# Usage: tools/sim_shots.sh <path to App.app> <out dir>
set -u
APP="$1"; OUT="$2"; mkdir -p "$OUT"
BUNDLE=uk.co.mark1apps.daybook
URL=https://app.mymedicaldaybook.co.uk/
TABS="today meds chemo exercise vitals more"

xcrun simctl list devices available > "$OUT/devices.txt"
shot() { # shot UDID FILE: the default display, else each display the device names (the iPhone Duo has two)
  xcrun simctl io "$1" screenshot "$2" 2>"$OUT/err.txt" && return 0
  for D in internal external inner outer; do xcrun simctl io "$1" screenshot --display="$D" "${2%.png}-$D.png" 2>/dev/null && ok=1; done
  [ "${ok:-}" = 1 ] || { echo "screenshot failed on $1: $(head -c 300 "$OUT/err.txt")"; }; ok=
}
pick() { grep -E "$1" "$OUT/devices.txt" | grep -v -i "ipad" | head -1 | sed -E 's/^ *(.*) \(([0-9A-F-]{36})\).*/\2|\1/'; }
DEVICES=$( { pick 'iPhone SE'; pick 'iPhone 1[0-9]e \('; pick 'iPhone 1[0-9] \('; pick 'Pro Max'; pick 'Duo'; } | grep -v '^$' | sort -u )
echo "Devices:"; echo "$DEVICES" | cut -d'|' -f2

echo "$DEVICES" | while IFS='|' read -r UDID NAME; do
  [ -z "$UDID" ] && continue
  SLUG=$(echo "$NAME" | tr 'A-Z ' 'a-z-' | sed 's/[^a-z0-9-]//g')
  xcrun simctl boot "$UDID" 2>/dev/null; xcrun simctl bootstatus "$UDID" -b >/dev/null
  xcrun simctl status_bar "$UDID" override --time 09:41 --batteryState charged --batteryLevel 100 --wifiBars 3 2>/dev/null
  xcrun simctl install "$UDID" "$APP"
  for LOOK in light dark; do
    xcrun simctl ui "$UDID" appearance "$LOOK"
    xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null; sleep 12
    shot "$UDID" "$OUT/$SLUG-$LOOK-app.png"
    xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null
    xcrun simctl openurl "$UDID" "${URL}?preview=cancer"; sleep 15 # Safari's first open, so the first picture is not its Start Page
    for TAB in $TABS; do
      xcrun simctl openurl "$UDID" "${URL}?preview=cancer&tab=$TAB"; sleep 10
      shot "$UDID" "$OUT/$SLUG-$LOOK-$TAB.png"
    done
    xcrun simctl terminate "$UDID" com.apple.mobilesafari 2>/dev/null
  done
  # Larger Text (v417): the phone's Text Size at the largest standard step and at an accessibility size, light only
  xcrun simctl ui "$UDID" appearance light
  for SIZE in extra-extra-extra-large accessibility-large; do
    xcrun simctl ui "$UDID" content_size "$SIZE"
    xcrun simctl openurl "$UDID" "${URL}?preview=cancer"; sleep 15
    for TAB in $TABS; do
      xcrun simctl openurl "$UDID" "${URL}?preview=cancer&tab=$TAB"; sleep 10
      shot "$UDID" "$OUT/$SLUG-text-$SIZE-$TAB.png"
    done
    xcrun simctl terminate "$UDID" com.apple.mobilesafari 2>/dev/null
  done
  xcrun simctl ui "$UDID" content_size large
  xcrun simctl shutdown "$UDID"
  echo "$NAME: done"
done
ls "$OUT" | grep -c png | sed 's/^/Screenshots: /'
