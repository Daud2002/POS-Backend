# Store server

A store server runs this backend on a restaurant's cashier PC (Windows) with its own local
PostgreSQL. The shop's phones, tablets and the cashier's browser talk to it over the shop Wi-Fi,
so the restaurant keeps working when the internet drops. It syncs with the cloud whenever the
internet is up.

```
 Waiter phones   Kitchen screen   Cashier PC (browser + STORE SERVER)
       \               |              /
        \____ shop Wi-Fi (HTTPS) ____/        works with no internet
                       |
           TapNtradeServer (Node) + TapNtradeDB (Postgres, 127.0.0.1)
                       |  push, then pull, every 10 seconds
                       v  (when the internet is up)
           Cloud: api.tapntrade.store
```

## How it works

- **One writer.** Once the owner activates a store server, the cloud refuses to take orders,
  move tables or open and close shifts for that store (HTTP 409, `code: STORE_SERVER_MODE`).
  Staff can't sign in to the cloud either; owners still can, from anywhere.
- **Change capture.** Postgres triggers record every write in `sync_meta`, including raw SQL
  and stock increments. The triggers are generated from `src/sync/sync.config.ts`.
- **Newest edit wins, per column group.** Each table is split into groups. Menu edits made in
  both places resolve per group, so a sale bumping the order counter can't overwrite the
  owner's currency change.
- **Counters are deltas.** Stock, inventory quantity and customer totals sync as +/− changes,
  so a stock-in from home and a sale in the shop both count.
- **HTTPS with the shop's own certificate authority.** It's generated on the PC and
  name-constrained to local addresses only. Each device installs it once from the setup page.

Code lives in:

| Path | What it holds |
|---|---|
| `src/sync/` | The sync |
| `src/store-server/` | HTTPS, the setup page and hosting |
| `packaging/windows/` | The installer |

## Try it on a laptop (Mac)

Build the web app the store server serves once: `npm run build:store` in POS-Frontend.

```
npm run store:dev -- --smoke   # pairs, activates, takes an order, syncs; prints ✓ per step
npm run store:dev              # a practice cloud (http://localhost:3100) and a store server
                               # (https://localhost:8443, setup http://localhost:8088/setup)
                               # with a seeded restaurant. Press c to cut / restore the
                               # "internet" (stops the practice cloud), q to quit.
npm run store:dev -- --cloud https://api.tapntrade.store/api
                               # only the store server, linked to the real cloud; data kept
                               # in ~/.tapntrade-store-laptop (--reset wipes it). Pair it
                               # with a TEST store: activating moves that store's orders here.
```

None of these read `.env`, so the practice runs never touch production. In practice mode,
open the cloud web app with `VITE_API_URL=http://localhost:3100/api npm run dev` in
POS-Frontend. Its logins are `owner@snack.test` / `owner123` and `waiter@snack.test` /
`waiter123`.

## Build the installer

1. On GitHub, run **Actions → Store server installer (Windows)**. It needs the secret
   `FRONTEND_REPO_TOKEN`; the signing secrets are optional.
2. Every download is pinned by sha256 in `packaging/windows/versions.json`, so a tampered mirror
   can't get into a shop PC. To change a version, blank its sha256: the build then stops and
   prints the new one to pin. `vc_redist` comes from a Microsoft link that sometimes changes
   behind the scenes; if its check fails, re-pin it.
3. Download the `TapNtradeServerSetup` artifact.

Without a code-signing certificate, Windows shows a "Windows protected your PC" warning. Choose
**More info → Run anyway**. Buy a certificate before rolling out to customers.

## Install at a restaurant

Before the visit:

- **Router:** under DHCP Binding (or Address Reservation), give the cashier PC a fixed address.
  Change the router's admin password from the default.
- **UPS:** put the router and the PC on the UPS.
- **Cashier PC:** Windows 10 or 11, 64-bit. Nothing else may be using ports 80 and 443.

On the day:

1. **Install.** Run `TapNtradeServerSetup.exe` and leave "Set this PC's network to Private"
   ticked. When it finishes, it opens `http://localhost/setup`.
2. **Pair.** In TapNtrade on the cloud (pos.tapntrade.store), sign in as the owner and open
   **Settings → Store Server → Generate pairing code**. Type the code on the setup page. It
   copies the store's data down, which takes up to a minute.
3. **Activate.** Back in cloud Settings → Store Server, press **Activate**. Within about 10
   seconds the setup page shows "✅ Taking orders".
4. **Set up each phone and tablet.** Do this once per device:
   - **Scan:** scan the QR code on the setup page, or open `http://<pc-address>/setup`.
   - **Install the certificate:** follow the steps on the page for iPhone or Android.
   - **Connect:** in the app, tap **Connect to store server** and scan the same QR.
   - **Browsers:** a kitchen screen in a browser opens `https://<pc-address>`.
5. **Test.** Take an order through waiter → kitchen → cashier. Then unplug the internet cable
   from the router, take another order, and plug it back in. Both orders should appear on the
   cloud dashboard within a minute.

## Day to day

- **Switching the PC off at night is fine.** The services start at boot, before anyone logs in.
  The first order of the day is still #1, even if the PC was off at 06:00.
- **Backups:** one runs nightly at 05:30, and also at boot if the last one is older than a day.
  The newest 14 are kept in `C:\ProgramData\TapNtrade\backups`.
- **Internet:** the store server needs it at least once every 14 days. After that, sign-in stops
  until it reconnects. This is how a store deactivated in the cloud stops trading.

## When something breaks

**The PC is dead and the shop must keep trading**
1. In cloud Settings → Store Server, press **Switch to cloud mode**. Phones then work through
   the internet.
2. If the old PC comes back, it learns it was replaced, stops taking orders, and hands over
   whatever orders it still held.

**Replacing the PC**
1. Install on the new PC.
2. Pair it with a new code.
3. Activate it.
4. Remove the old server in Settings.
5. Every device re-installs the new PC's certificate, because each PC has its own.

**Restoring a backup**
1. Stop the TapNtradeServer service.
2. Run `pg_restore --clean -d tapntrade <file>`, using the `pgsql\bin` tools and the password in
   `C:\ProgramData\TapNtrade\config\server.env`.
3. Start the service again.

**Logs** are in `C:\ProgramData\TapNtrade\logs`.

## Not done yet

- **QZ Tray silent printing on the store server, automatically.** A store server has no signing
  key until it is given one, so it falls back to QZ's "Allow" prompt. For now each shop's
  certificate is issued by hand from the root and installed on the shop PC: see
  `qz-tray/README.md`, "Store servers". Still to do: issue it at pairing, by the cloud, through
  a QZ intermediate CA (test first that QZ accepts the chain). `packaging/windows/install-qz.ps1`
  has never been run on Windows.
- **Automatic updates.** For now an update means running the newer installer. It stops the
  server, takes a backup, keeps all data, and migrates on start.
- **Live refresh of the owner's cloud dashboard when shop orders arrive by sync.** It updates on
  the next refresh.
- **Merging customers created with the same phone number on both sides while offline.** These
  stay as two customers for now.
- **A signed lease.** The 14-day offline limit is checked on the PC itself, without a signature
  from the cloud.
