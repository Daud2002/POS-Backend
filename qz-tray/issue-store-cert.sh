#!/usr/bin/env bash
# Issues the QZ Tray signing certificate for ONE shop's store server (the
# offline site), from the TapNtrade root in this folder.
#
#   ./issue-store-cert.sh snack-fuel "Snack Fuel"
#
# A store server signs print requests itself, so it needs a key of its own on
# the shop PC. Giving every shop the cloud's signing.key would put the one key
# that prints silently on every station onto every shop PC; a per-store
# certificate means a lost PC exposes that shop only. Stations still trust the
# same root (override.crt), so one QZ Tray setup covers the cloud site and the
# offline site.
#
# Writes stores/<slug>/, which is git-ignored because it holds the private key:
#   signing.key      this store's private key        (secret)
#   signing.crt      its certificate, issued by root (public)
#   qz-signing.env   the two lines for the store server's server.env (secret)
#   override.crt     the root, for QZ Tray on each station (public)
#   install-qz.ps1   puts both in place on the shop PC
# Hand the last three to the shop. See README.md, "Store servers".
set -euo pipefail
cd "$(dirname "$0")"

slug="${1:-}"
name="${2:-}"
if [[ -z "$slug" || -z "$name" ]]; then
  echo 'usage: ./issue-store-cert.sh <slug> "<Store name>"' >&2
  exit 1
fi
if [[ ! "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "slug must be lowercase letters, digits and dashes: $slug" >&2
  exit 1
fi
# The name goes into the certificate subject, where / and = are separators.
if [[ "$name" == */* || "$name" == *=* ]]; then
  echo 'the store name cannot contain "/" or "="' >&2
  exit 1
fi
for file in root.key override.crt; do
  [[ -f "$file" ]] || { echo "$file is missing from $(pwd): it issues the certificate" >&2; exit 1; }
done

out="stores/$slug"
if [[ -e "$out/signing.key" ]]; then
  echo "$out already holds a key. Delete that folder to issue a new one (the old one stops working only when the shop PC gets the new lines)." >&2
  exit 1
fi

umask 077
mkdir -p "$out"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A certificate cannot usefully outlive the root that vouches for it.
root_end="$(openssl x509 -in override.crt -noout -enddate | cut -d= -f2)"
days="$(node -e 'const d = Math.floor((new Date(process.argv[1]) - Date.now()) / 864e5) - 1; if (!(d > 0)) process.exit(1); console.log(d)' "$root_end")"

openssl req -newkey rsa:2048 -nodes -keyout "$out/signing.key" \
  -subj "/CN=TapNtrade POS - $name/O=TapNtrade" -out "$tmp/request.csr" 2>/dev/null
printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\n' > "$tmp/leaf.ext"
openssl x509 -req -in "$tmp/request.csr" -CA override.crt -CAkey root.key \
  -CAserial "$tmp/serial.srl" -CAcreateserial -sha256 -days "$days" \
  -extfile "$tmp/leaf.ext" -out "$out/signing.crt" 2>/dev/null

# Refuse to hand over anything QZ Tray would not accept.
openssl verify -CAfile override.crt "$out/signing.crt" >/dev/null

# base64 on one line: the form the backend reads and that survives an env file.
{
  echo "QZ_SIGNING_KEY=$(base64 < "$out/signing.key" | tr -d '\n')"
  echo "QZ_SIGNING_CERT=$(base64 < "$out/signing.crt" | tr -d '\n')"
} > "$out/qz-signing.env"

cp override.crt "$out/override.crt"
cp ../packaging/windows/install-qz.ps1 "$out/install-qz.ps1"
chmod 644 "$out/signing.crt" "$out/override.crt" "$out/install-qz.ps1"

echo "Issued for $name:"
openssl x509 -in "$out/signing.crt" -noout -subject -enddate | sed 's/^/  /'
echo "Folder: $(pwd)/$out"
