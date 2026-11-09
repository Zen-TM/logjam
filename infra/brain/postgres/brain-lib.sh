# Sourced by brain-entrypoint.sh and initdb/10-brain-init.sh. Runs as the user
# that owns the data directory.

# Prod's pg_hba.conf unless BRAIN_DEV=1. Replaces the file initdb wrote.
brain_install_hba() {
  local src=prod
  [ "${BRAIN_DEV:-}" = 1 ] && src=dev
  install -m 0600 "/etc/postgresql/pg_hba.$src.conf" "$PGDATA/pg_hba.conf"
}

# A self-signed certificate that is its own CA, so clients pin it as
# sslrootcert and connect with sslmode=verify-full. SANs: BRAIN_TLS_SANS,
# comma-separated names (an IP is accepted too).
brain_gen_cert() {
  local sans="${BRAIN_TLS_SANS:-postgres,localhost}" san list=""
  for san in ${sans//,/ }; do
    if [[ $san =~ ^[0-9.]+$ || $san == *:* ]]; then list+="IP:$san,"; else list+="DNS:$san,"; fi
  done
  openssl req -x509 -newkey rsa:3072 -nodes -days 3650 \
    -subj "/CN=${sans%%,*}" \
    -addext "subjectAltName=${list%,}" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign" \
    -addext "extendedKeyUsage=serverAuth" \
    -keyout "$PGDATA/server.key" -out "$PGDATA/server.crt" 2>/dev/null
  chmod 0600 "$PGDATA/server.key"
}
