# Silent printing through QZ Tray

QZ Tray shows an "Allow" prompt for any print request it cannot trace to a
certificate it trusts. The web app used to send no certificate, so every
station saw the prompt after each browser restart. QZ sells a certificate its
built-in root trusts; this folder is the free equivalent, which QZ documents as
the "override certificate": we are our own root.

| File | What it is | Where it goes |
|---|---|---|
| `override.crt` | Our root CA certificate. Public. | Every station PC, into QZ Tray (below). |
| `signing.crt` | The certificate the web app presents to QZ Tray, issued by our root. Public. | Backend env `QZ_SIGNING_CERT`. |
| `signing.key` | Private key for `signing.crt`. **Secret.** Git-ignored. | Backend env `QZ_SIGNING_KEY`. Nowhere else. |
| `root.key` | Private key of the root CA. **Secret.** Git-ignored. | Offline. Only needed to issue a new `signing.crt`. |

Both certificates are valid until 2046, so nothing needs renewing.

## Server (once)

Add the two values to the backend `.env` on the server, base64 on one line so
the PEM line breaks survive:

```sh
echo "QZ_SIGNING_KEY=$(base64 -i signing.key | tr -d '\n')"
echo "QZ_SIGNING_CERT=$(base64 -i signing.crt | tr -d '\n')"
```

Restart the API. The log should say `QZ Tray request signing enabled`. With the
variables unset the API still runs and printing still works, with the prompt.

## Each station PC (once, Windows)

1. Install QZ Tray **2.1 or newer**. Check with the tray icon → About; older
   versions ignore the override file.
2. Copy `override.crt` to the QZ Tray install folder, normally
   `C:\Program Files\QZ Tray\override.crt`. Windows asks for administrator
   permission to write there.
3. Quit QZ Tray from the tray icon and start it again from the Start menu, so
   it reads the file.
4. In the POS, open Settings › Printer and press **Test print**. The slip should
   print with no QZ Tray dialog.

That is the whole station setup. Nothing is tied to the browser, the user
account or the printer, so a reinstalled browser keeps printing silently.

## Store servers (the offline site)

A shop's store server signs print requests itself, so it needs a signing key
on the shop PC. Each shop gets its own key and certificate, issued from the
same root. Stations keep the one `override.crt`, which covers the cloud site
and the offline site alike, and a lost shop PC exposes that shop's key only,
not the one in the cloud's `QZ_SIGNING_KEY`.

Issue one (needs `root.key` in this folder):

```sh
./issue-store-cert.sh snack-fuel "Snack Fuel"
```

That writes `stores/<slug>/`, which is git-ignored because it holds the
private key. Take three files from it to the shop: `qz-signing.env`,
`override.crt` and `install-qz.ps1`.

On the shop PC that runs the store server, open PowerShell as Administrator in
that folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-qz.ps1
```

It adds the two `QZ_SIGNING_` lines to
`C:\ProgramData\TapNtrade\config\server.env` (keeping the old file as
`server.env.before-qz`), restarts the TapNtrade server, and copies
`override.crt` into the QZ Tray folder. Then quit QZ Tray from its tray icon
and open it again.

The same by hand:

1. Paste the two lines of `qz-signing.env` at the end of
   `C:\ProgramData\TapNtrade\config\server.env`, then restart the
   **TapNtrade Server** service. Its log in `C:\ProgramData\TapNtrade\logs`
   should say `QZ Tray request signing enabled`.
2. Copy `override.crt` to `C:\Program Files\QZ Tray\override.crt` and
   restart QZ Tray.

Any other PC in the shop that prints through QZ Tray needs only step 2. The
script can be run there too: it skips the server part when there is no store
server on the PC.

Treat `qz-signing.env` like a password: delete it from the USB stick or
download folder once it is installed.

## If the prompt still appears

- **The dialog names the certificate as untrusted.** `override.crt` is not
  where QZ Tray looks, or QZ Tray was not restarted after copying it. Also
  check the QZ Tray version.
- **The dialog says the request is unsigned.** The API has no key configured,
  or the browser could not reach it. While signed in, open
  `https://api.tapntrade.store/api/printing/qz/certificate` with the app's
  bearer token: a 503 means the env variables are missing on the server.
- **The browser console logs "Signing failed".** The API rejected the sign
  call. The route needs a signed-in user, so an expired session shows this
  until the app refreshes its token.

## Rotating the key

Only needed if `signing.key` leaks. Issue a new signing certificate from the
root, then update the two env variables. Stations need nothing: they trust the
root, not the signing certificate.

```sh
openssl req -newkey rsa:2048 -nodes -keyout signing.key \
  -subj "/CN=TapNtrade POS/O=TapNtrade" -out signing.csr
printf "basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\n" > leaf.ext
openssl x509 -req -in signing.csr -CA override.crt -CAkey root.key -CAcreateserial \
  -sha256 -days 7300 -extfile leaf.ext -out signing.crt
rm signing.csr leaf.ext override.srl
```

If `root.key` leaks, generate a new root the same way `override.crt` was made
and redo every station.
