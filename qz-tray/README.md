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
