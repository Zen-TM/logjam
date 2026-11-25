#!/usr/bin/env bash
# Run by the instance's user data after it has put infra/brain/ at /opt/brain
# and written /etc/brain/brain.env: install the units and start them. Does not
# wait for boot.sh, which a restore can keep busy for a long time.
set -euo pipefail
install -m 0644 /opt/brain/host/systemd/*.service /opt/brain/host/systemd/*.timer /etc/systemd/system/
install -d -m 0755 /etc/brain
systemctl daemon-reload
systemctl enable --now --no-block brain-boot.service brain-release.timer brain-status.timer brain-backup-full.timer
