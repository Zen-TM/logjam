#!/usr/bin/env bash
# Nightly at 03:00 Sydney time (brain-backup-full.timer).
. "$(dirname "$0")/lib.sh"
pgb --type=full backup
pgb expire
