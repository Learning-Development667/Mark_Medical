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
pick() { grep -E "$1" "$OUT/devices.txt" | grep -v -i "ipad" | head -1 | sed -E 's/^ *(.*) \(([0-9A-F-]{36})\).*/\2|\1/'; }
DEVICES=$( { pick 'iPhone SE'; pick 'iPhone 1[0-9] \('; pick 'Pro Max'; pick 'Duo'; } | grep -v '^$' | sort -u )
echo "Devices:"; echo "$DEVICES" | cut -d'|' -f2

echo "$DEVICES" | while IFS='|' read -r UDID NAME; do
  [ -z "$UDID" ] && continue
  SLUG=$(echo "$NAME" | tr ' ()' '-__' | tr -s '-_' | tr 'A-Z' 'a-z')
  xcrun simctl boot "$UDID" 2>/dev/null; xcrun simctl bootstatus "$UDID" -b >/dev/null
  xcrun simctl status_bar "$UDID" override --time 09:41 --batteryState charged --batteryLevel 100 --wifiBars 3 2>/dev/null
  xcrun simctl install "$UDID" "$APP"
  for LOOK in light dark; do
    xcrun simctl ui "$UDID" appearance "$LOOK"
    xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null; sleep 14
    xcrun simctl io "$UDID" screenshot "$OUT/$SLUG-$LOOK-app.png" >/dev/null 2>&1
    xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null
    for TAB in $TABS; do
      xcrun simctl openurl "$UDID" "${URL}?preview=cancer&tab=$TAB"; sleep 9
      xcrun simctl io "$UDID" screenshot "$OUT/$SLUG-$LOOK-$TAB.png" >/dev/null 2>&1
    done
    xcrun simctl terminate "$UDID" com.apple.mobilesafari 2>/dev/null
  done
  # Larger Text (v417): the phone's Text Size at the largest standard step and at an accessibility size, light only
  xcrun simctl ui "$UDID" appearance light
  for SIZE in extra-extra-extra-large accessibility-large; do
    xcrun simctl ui "$UDID" content_size "$SIZE"
    for TAB in $TABS; do
      xcrun simctl openurl "$UDID" "${URL}?preview=cancer&tab=$TAB"; sleep 9
      xcrun simctl io "$UDID" screenshot "$OUT/$SLUG-text-$SIZE-$TAB.png" >/dev/null 2>&1
    done
    xcrun simctl terminate "$UDID" com.apple.mobilesafari 2>/dev/null
  done
  xcrun simctl ui "$UDID" content_size large
  xcrun simctl shutdown "$UDID"
  echo "$NAME: done"
done
ls "$OUT" | grep -c png | sed 's/^/Screenshots: /'
