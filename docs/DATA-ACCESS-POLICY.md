# Data-Access Policy (Operator Commitment)

_Last updated: 2026-11-12_

Logjam is privacy-by-design **for users**. This document is about the one party
that design does not, by itself, constrain: **the operator** — me, the person who
runs the AWS account Logjam lives in.

It is written to be honest rather than reassuring. Where I can only limit a risk
rather than eliminate it, this says so plainly. The infrastructure that backs
these claims is in this repository (`infra/terraform/`) so you can verify it
rather than take my word.

## Where the data lives

Logjam's API and database run on one server I run myself, called the brain
([the decision](decisions/0047-prod-runs-on-one-self-managed-instance-with-object-lock-backups.md)).

## My commitment

Everything below describes what I am technically _capable_ of — not what I do.
To be unambiguous:

> I will not read, use, share, or sell your data for personal gain, curiosity, or
> any purpose other than operating, maintaining, and debugging Logjam on your
> behalf.

The controls on this page — least-privilege access, tamper-evident logging, and
data minimisation — exist precisely so that this commitment is _accountable_
rather than something you have to take purely on faith. This policy is about
being honest about the technical reality, not a statement of intent to misuse it.

## What access exists

I hold root/administrative access to the AWS account hosting Logjam. In practice
that means I _can_:

- Read the production database. Open a root shell on the host through AWS Systems
  Manager Session Manager (there is no SSH, no key pair and no open port to log in
  with) and run `psql` as the database's superuser, or read its data files
  directly.
- Read its backups. They are the whole database as ordinary objects in
  an S3 bucket (`logjam-brain-backups-…`), so anyone with S3 read access in the
  account can download them. So can the role the application runs as on the host,
  which is how the application and the backup tool reach AWS.
- Read objects in the S3 buckets (`logjam-media`, `logjam-topo-jobs`).
- Change the infrastructure, including the logging described below.

A contributor I have invited has read-only access to the AWS account's
infrastructure configuration, under the same restrictions as the automated
roles in this repository: no user data, no secret values, no logs and no user
directory. That includes no backup objects, no disk snapshot
contents, no text or output of a command I have run on the brain, and no way to
start a session or send a command there: the automated roles, the account's
Terraform apply role and any invited contributor are all denied that, and only
my own identity can. Signing in
requires multi-factor authentication, and every change goes through the
Terraform in `infra/terraform/envs/prod/iam_contributor.tf`.

There is **no admin UI inside Logjam Web or Logjam GPS** — Logjam has no "god
mode" screen. All operator access happens at the AWS/infrastructure layer, which
is exactly why the controls below live in infrastructure, not in application
code.

Besides what I type, two things read the data on my behalf:

- **A daily restore drill.** Each morning a short-lived task restores the
  latest backup onto its own scratch disk to prove the backup works, reads every
  table, throws the counts away, writes one pass-or-fail file with a fixed set of
  fields, and exits. Its role can read the backups and write that one file and
  nothing else, it accepts no connections, and nothing leaves it but the verdict
  and its own log. That log lists table names, never values, and goes to an
  ordinary log group kept for 14 days, not the write-once bucket. The task's
  start and its reads of the backups are in the audit trail.
This is **not** end-to-end encryption. Your data is encrypted in transit, but I
hold the keys the application uses. Losing your password does **not** mean your
data is unrecoverable to me — Logjam is not a zero-knowledge system.

## What I do to limit and account for it

The goal is to turn operator access from _silent, traceless, and deniable_ into
_deliberate, recorded, and impossible-to-hide_:

- **Tamper-evident audit logging (WORM).** Three signals are captured and shipped
  to an S3 bucket with **Object Lock in compliance mode** — write-once, and
  undeletable (even by the root account) until the retention period expires:
  - **CloudTrail management events** — e.g. creating a disk snapshot, and
    starting a Session Manager session or sending a command to the brain. This is
    what makes data _extraction_ recorded (see the snapshot limit below). It
    records who did it, when, on which instance and with which command
    document, but not what the command said or returned.
  - **CloudTrail data events** — on the media and topo buckets, object reads and
    writes. Also every read of a backup object (a download, a head, a
    listing of the bucket, or a copy out to another bucket in this account) and
    every block read of a disk snapshot through EBS's direct APIs, each naming who
    and which object or snapshot. Writes into the backup bucket are not recorded:
    Object Lock stops them overwriting or deleting anything for seven days.
  - **pgaudit** — direct SQL statements against the database, shipped off the
    instance to the same WORM bucket: the brain's Postgres runs pgaudit and ships
    its log through CloudWatch Logs and Firehose. Any read I run as the
    operator is logged, as the database's superuser. The application
    itself runs as a separate restricted role whose *routine reads are
    deliberately not logged* — they are high-volume, automatic, and carry no
    operator-access signal, so logging them would only add cost and noise. What **is** always
    logged is every *database connection* (which role, from where), so the
    application's identity cannot be used as a quiet back-door without leaving a
    record (see the honest limit below), plus all writes and schema changes from
    any role.
- **Least-privilege application role.** The application connects to the database as
  a dedicated non-superuser role, not the superuser. My own ad-hoc database
  access uses the superuser, so an operator read is **distinct in the logs** from
  ordinary application traffic — and because the application's own reads are not
  logged while operator reads are, an operator read does not hide in a sea of app
  traffic. The host's own scheduled jobs (a health check and the backup) connect as a third role that
  cannot connect to the application's database at all. Two exceptions run the
  application's own code, as the application role, in a one-off task I launch:
  sending a message to every user
  ([`operations/announcements.md`](operations/announcements.md)), and the
  one-time deletion of LiDAR jobs from before areas were sharpened
  ([`operations/purge-legacy-topo-jobs.md`](operations/purge-legacy-topo-jobs.md)).
  Each launch, with its command (and an announcement's message), is a CloudTrail
  management event in the WORM log. The announcement task reads only account
  ids and push device tokens, and its writes (the announcement, one inbox row
  per user, and pruning dead push tokens) are logged like any other. The
  deletion reads those jobs' ids, owners, statuses and sizes, and which
  running exports use them (ids only). Its writes (deleting each job's row,
  its shares and its sharees' share notifications, failing any export still
  queued from it, and lowering its owner's storage charge) are logged like any
  other; it deletes the jobs' files from S3.
- **Data minimisation.** No third-party analytics or telemetry. Short retention on
  topo/LiDAR artifacts. Operational logs are scrubbed so canyon names and
  coordinates never appear in plain text — and the audit logs above record SQL
  with bound parameters _omitted_, so they do not leak coordinates either.
- **You can leave with your data.** Logjam Web has self-service "Download my
  data"; Logjam Web and Logjam GPS each have "Delete account" — no request to
  me required.

## The honest limits

I will not pretend this is airtight. It is not.

1. **I can still read; I just can't erase the record.** WORM logging does not stop
   me reading the database. It means that if I do, I cannot silently delete the
   evidence that I did. One nuance: to keep costs sane, the *application's* own
   restricted role does not log its individual reads (only its writes and schema
   changes). I hold that role's credentials too, so I *could* connect as the
   application to read without each query being logged — but the **connection
   itself is always logged** (which role connected, and from where). An operator
   read via the application role from anywhere other than the app's own servers is
   therefore anomalous and on the record, even though the individual statements
   are not. The honest path — me reading as the database's superuser — logs every read.
   The announcement and job-deletion tasks above are the operator actions
   that run as the application from the app's own network; their connections
   are logged but look like the application's own, so their record is the
   CloudTrail launch event.
2. **Snapshot exfiltration is recorded, but the downstream read is not.**
   The brain's disk has a read interface: EBS's direct APIs read a
   disk snapshot block by block. They are recorded too, each call naming who and
   which snapshot, as is creating the snapshot. The backups are plain objects in a
   bucket, so reading one needs no restore at all, and each read, or copy out to
   another bucket in this account, is a recorded event. However, once a snapshot
   or backup is restored to a separate instance, or the data has left the
   account, reads on _that copy_ are outside this audit. So: the act of extracting a snapshot or a
   backup is undeniable; the subsequent read of the extracted copy is not.
3. **Single-account caveat.** The WORM logs live in the same AWS account I
   control. AWS Object Lock prevents me deleting already-written entries even as
   root, but a determined operator could stop or reconfigure logging _going
   forward_ (itself a recorded event). After I change what the audit
   trail records, it can miss events for a few minutes: about three, measured on
   a copy.
4. **You are trusting me to have set this up honestly.** I could mis-configure or
   disable these controls. The mitigation is verifiability: the configuration is
   in `infra/terraform/` in this repository. A technical user can read it and
   confirm the WORM log exists and is configured as described.
5. **Root on the host sits below the audit.** With a root shell I can read
   the database's data files directly, or stop the process that ships its log, and
   neither goes through Postgres, so pgaudit would see neither. What is recorded
   is that a session or command was started, by whom, and on which instance; not
   what was done in it. I keep no transcript of what is typed or what comes back,
   and AWS hides a command's text from the record. So what a session does may go
   unrecorded while the session itself is recorded.
6. **An old data volume holds data until it is deleted.** When I replace a
   lost disk or rewind the database, the old volume is detached but kept, because
   it is the way back. Until I delete it, it holds a full copy of the database
   that none of the above watches beyond the events of attaching or snapshotting
   it.
7. **A deleted photo or file stays for about ten days.** The media bucket keeps
   old versions so a deletion can be undone: for about ten days after you
   delete something, its bytes remain in the bucket, readable by me, and are
   then removed for good. A file sent with "Send a copy" goes sooner, about a
   day after its bytes are deleted.

That is the real claim, stated plainly:

> I have administrative access and can read your data. I have configured logging so
> that if I do, I cannot hide it — the access record is write-once and outside my
> ability to delete. You are trusting that I set this up honestly, and you can
> verify the configuration in the repository.

## Verify it yourself

- WORM bucket + CloudTrail + pgaudit: `infra/terraform/envs/prod/audit.tf`,
  `infra/terraform/envs/prod/brain_logs.tf`.
- Least-privilege application role: the bootstrap SQL and Secrets Manager wiring
  referenced from `audit.tf` / `iam.tf`.
- Log redaction (no coords/names in operational logs): `api/src/lib/logger.ts`.
- What the audit trail records, including backup reads, disk
  snapshot reads, and Session Manager and command starts:
  `infra/terraform/envs/prod/audit.tf` (`audit_event_selectors`), held by the
  test `audit_trail_records_every_route_to_user_data` in
  `infra/terraform/envs/prod/tests/guards.tftest.hcl`.
- That no CI role (the apply role included) and no invited
  contributor can open a shell on the brain, or read a command's output, a disk
  snapshot's blocks, a backup object or the database's log: the shared privacy
  Deny in `infra/terraform/envs/prod/iam.tf` (`DenyShells` and its neighbours), held by
  `ci_reads_no_secret_or_user_data` and `contributor_is_read_only_and_mfa_gated`.
- The media bucket (versioned, with old versions removed after about ten days,
  and no rule that expires current photos): `infra/terraform/envs/prod/s3.tf`,
  held by `media_is_versioned_and_never_expires_current_objects`.
- The backup bucket (versioned, write-once for 7 days, no rule that
  expires current objects): `infra/terraform/envs/prod/brain_s3.tf`, held by
  `brain_backups_are_locked_and_never_expire`; and what the host's role may do
  with it, held by `brain_role_has_only_its_grants`.
- The brain's database log reaching the write-once bucket:
  `infra/terraform/envs/prod/brain_logs.tf`; pgaudit's settings, read back from a
  running server by `infra/brain/postgres/tests/test.sh`.
- The roles in the database: the application's in
  `scripts/bootstrap-app-db-role.sql`, the host's scheduled-job role in
  `infra/brain/host/agent.sql`.
- No SSH and no key pair: `infra/terraform/envs/prod/brain_instance.tf`
  and `infra/terraform/envs/prod/brain_network.tf`, held by
  `brain_instance_is_locked_down` and `brain_security_group_has_two_ingress_rules`.
- The restore drill can only read the backups:
  `infra/brain/postgres/drill.sh` and `infra/terraform/envs/prod/brain_drill.tf`,
  held by `brain_drill_role_cannot_write_the_backups` and the drill scenario of
  `infra/brain/tests/e2e.sh`.

## Who can read the audit logs

The audit logs themselves are deliberately **not public**. They record which
tables were queried, which storage objects were touched, and when — so publishing
them would itself leak information about users. They are stored privately and,
because of Object Lock, cannot be altered or deleted by anyone (including me)
until their retention period expires.

What _is_ public is the **configuration** that produces them — this repository.
Anyone can read it and confirm that the logging exists and is tamper-proof
(see "Verify it yourself" above). The logs themselves can be read by an
authorised reviewer through the AWS console/CLI, and can be produced intact if a
dispute, incident, or lawful request ever requires it. The point of the logging
is therefore not that the public reads it day to day — it is that the record is
**honest and impossible for me to doctor after the fact**.

## Contact

Logjam is operated by Zen Marcos. Privacy or data-access questions:
zentmarcos@gmail.com.
