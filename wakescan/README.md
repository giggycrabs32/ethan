# WakeScan — the alarm you have to get up for

WakeScan is an alarm clock web app with a twist: the alarm **doesn't turn off
until you physically get out of bed and scan a code on something in your
house** — the bathroom sink, the coffee maker, your toothpaste. No more
half-asleep snooze-spamming.

## Features

- **Multiple alarms** — each with its own time, label, and repeat days
  (every day, weekdays, weekends, or one-time).
- **5 alarm sounds** — Classic Beep, Digital Pulse, Siren, Gentle Rise, and
  Heavy Buzzer, all synthesized in the browser (no downloads). Preview each
  one while picking. Volume escalates the longer you ignore it.
- **Scan items** — register things around your house two ways:
  - **Make a QR sticker**: the app generates a printable QR code you stick on
    the item.
  - **Link an existing code**: scan a barcode/QR already printed on something
    (shampoo bottle, cereal box…).
- **Pick and choose per alarm** — select and deselect which items each alarm
  requires. With multiple items you choose: scan **any one** or scan **ALL**
  of them.
- **Snooze rules** — set snooze to 3/5/10 minutes, or disable snooze entirely
  for hardcore mode.
- **Escape hatches, but honest ones** — wrong codes are rejected, refreshing
  the page resumes the alarm, and the optional emergency stop requires
  holding a button for a full 10 seconds.
- **PWA** — installable to your home screen, works offline, flashlight button
  in the scanner for dark mornings.

## Running it

It's a static site — no build step. The only requirement is **HTTPS**
(the camera API refuses to work on plain `http://`).

**Easiest: GitHub Pages.** Enable Pages for this repo (Settings → Pages →
deploy from branch), then open `https://<user>.github.io/<repo>/wakescan/`
on your phone.

**Local testing:**

```bash
cd wakescan
python3 -m http.server 8000
# open http://localhost:8000  (localhost counts as secure)
```

## How to use it

1. **Items tab** → add an item (e.g. "Bathroom sink") → print its QR sticker
   and stick it on the item, or link a barcode that's already on it.
2. **Alarms tab** → new alarm → set the time, repeat days, pick a sound, and
   tick the items you want to be forced to scan.
3. Before bed: open WakeScan, turn on **Keep screen awake** in Settings,
   plug your phone in, volume up.
4. In the morning: the alarm rings until you walk over and scan. Good morning.

Use the **Test alarm** button in Settings to try the whole flow right now
(it rings 15 seconds after you press it).

> **Honest limitation:** this is a web app, so it can't wake your phone from
> a locked screen the way the built-in clock can. Keeping the app open
> overnight (step 3) is what makes it reliable.

## Tech notes

- Vanilla HTML/CSS/JS, no framework, no build.
- Scanning uses the native `BarcodeDetector` API where available (Android
  Chrome — QR + retail barcodes) and falls back to the bundled
  [jsQR](https://github.com/cozmo/jsQR) decoder (QR only) elsewhere.
- QR stickers are generated with
  [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator).
  Both libraries are vendored in `js/vendor/` so the app works offline.
- Alarm sounds are Web Audio synthesis — zero audio assets.
- Data is stored in `localStorage` on your device. Nothing leaves your phone.
- `icons/make_icons.py` regenerates the PNG icons from the design (needs
  Pillow).
