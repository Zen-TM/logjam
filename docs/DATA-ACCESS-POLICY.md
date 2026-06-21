# Data-Access Policy (Operator Commitment)

_Last updated: 2026-06-21_

Logjam is privacy-by-design **for users**. This document is about the one party
that design does not, by itself, constrain: **the operator** — me, the person who
runs the AWS account Logjam lives in.

It is written to be honest rather than reassuring. Where I can only limit a risk
rather than eliminate it, this says so plainly. The infrastructure that backs
these claims is in this repository (`infra/terraform/`) so you can verify it
rather than take my word.

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

- Read the production database (`psql`, the RDS console, or a restored snapshot).
- Read objects in the S3 buckets (`logjam-media`, `logjam-topo-jobs`).
- Change the infrastructure, including the logging described below.

There is **no admin UI inside the app** — Logjam has no "god mode" screen. All
operator access happens at the AWS/infrastructure layer, which is exactly why the
controls below live in infrastructure, not in application code.

This is **not** end-to-end encryption. Your data is encrypted in transit, but I
hold the keys the application uses. Losing your password does **not** mean your
data is unrecoverable to me — Logjam is not a zero-knowledge system.

## What I do to limit and account for it

The goal is to turn operator access from _silent, traceless, and deniable_ into
_deliberate, recorded, and impossible-to-hide_:

- **Tamper-evident audit logging (WORM).** Three signals are captured and shipped
  to an S3 bucket with **Object Lock in compliance mode** — write-once, and
  undeletable (even by the root account) until the retention period expires:
  - **CloudTrail management events** — e.g. creating, copying, sharing, restoring,
    or exporting a database snapshot. This is what makes data _extraction_
    recorded (see the snapshot limit below).
  - **CloudTrail S3 data events** on the media and topo buckets — object reads and
    writes.
  - **pgaudit** — direct SQL statements against the database, shipped off the
    instance to the same WORM bucket.
- **Least-privilege application role.** The application connects to the database as
  a dedicated non-superuser role, not the master account. My own ad-hoc database
  access uses the master account, so an operator read is **distinct in the logs**
  from ordinary application traffic.
- **Data minimisation.** No third-party analytics or telemetry. Short retention on
  topo/LiDAR artifacts. Operational logs are scrubbed so canyon names and
  coordinates never appear in plain text — and the audit logs above record SQL
  with bound parameters _omitted_, so they do not leak coordinates either.
- **You can leave with your data.** The app has self-service "Download my data"
  and "Delete account" — no request to me required.

## The honest limits

I will not pretend this is airtight. It is not.

1. **I can still read; I just can't erase the record.** WORM logging does not stop
   me reading the database. It means that if I do, I cannot silently delete the
   evidence that I did.
2. **Snapshot exfiltration is recorded, but the downstream read is not.** I cannot
   query a backup invisibly — there is no read interface on a snapshot. To get
   data out I must restore, export, copy, or share it, and **every one of those is
   a recorded management event** in the WORM log. However, once a snapshot is
   restored to a separate instance (or another AWS account), reads on _that copy_
   are outside this instance's audit. So: the act of extraction is undeniable;
   the subsequent read of the extracted copy is not.
3. **Single-account caveat.** The WORM logs live in the same AWS account I
   control. AWS Object Lock prevents me deleting already-written entries even as
   root, but a determined operator could stop or reconfigure logging _going
   forward_ (itself a recorded event).
4. **You are trusting me to have set this up honestly.** I could mis-configure or
   disable these controls. The mitigation is verifiability: the configuration is
   in `infra/terraform/` in this repository. A technical user can read it and
   confirm the WORM log exists and is configured as described.

That is the real claim, stated plainly:

> I have administrative access and can read your data. I have configured logging so
> that if I do, I cannot hide it — the access record is write-once and outside my
> ability to delete. You are trusting that I set this up honestly, and you can
> verify the configuration in the repository.

## Verify it yourself

- WORM bucket + CloudTrail + pgaudit: `infra/terraform/envs/prod/audit.tf`,
  `infra/terraform/envs/prod/rds.tf`.
- Least-privilege application role: the bootstrap SQL and Secrets Manager wiring
  referenced from `audit.tf` / `iam.tf`.
- Log redaction (no coords/names in operational logs): `api/src/lib/logger.ts`.

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

Privacy or data-access questions: zentmarcos@gmail.com.
