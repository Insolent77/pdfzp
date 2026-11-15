#!/bin/sh
set -eu
umask 077
: "${BACKUP_DIR:?Set BACKUP_DIR to a private directory on a separate encrypted disk}"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR/$stamp"
docker compose exec -T db pg_dump -U acts -Fc acts > "$BACKUP_DIR/$stamp/database.dump"
docker compose exec -T app tar -czf - -C /app/storage . > "$BACKUP_DIR/$stamp/documents.tar.gz"
printf '%s\n' "Backup stored in $BACKUP_DIR/$stamp; encryption key must be backed up separately."
