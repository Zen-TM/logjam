# Logjam — Data Breach Response Runbook

**Status:** DRAFT — review with a solicitor before relying on it for a real breach.
**Audience:** internal (Logjam operator). Not user-facing.
**Purpose:** satisfy the Notifiable Data Breaches (NDB) scheme under the Privacy
Act 1988 (Cth) and the breach-notification commitment in `frontend/public/privacy.html`.

Logjam stores **sensitive location data** (canyon coordinates, trip history) plus
account email and the Cognito-linked social graph. A breach exposing this data is
plausibly "likely to result in serious harm", so the NDB obligations are taken to
apply regardless of the small-business turnover exemption.

---

## 1. What counts as an eligible data breach

An **eligible data breach** = unauthorised access to, unauthorised disclosure of,
or loss of personal information, **and** a reasonable person would conclude it is
**likely to result in serious harm** to an affected individual.

Examples for Logjam:
- Database (RDS) or S3 contents accessed by an unauthorised party.
- Presigned URL or credential leak exposing another user's canyons/media.
- Cognito account takeover exposing trip history.
- Lost/leaked operational logs that (despite scrubbing) contain identifiable data.

---

## 2. Response steps

### Step 1 — Contain (immediately)
- Revoke leaked credentials / rotate AWS keys and Cognito secrets.
- Invalidate affected presigned URLs; tighten S3 bucket policy / IAM.
- Take the affected component offline if exposure is ongoing.

### Step 2 — Assess (within 30 days — sooner if serious harm is likely)
- Identify what data, which users, and the cause.
- Decide whether serious harm is **likely**. For canyon coordinates + identity,
  treat the bar as low. Document the reasoning.
- If remedial action prevents the likely-serious-harm outcome, the breach may not
  be notifiable — record why.

### Step 3 — Notify (if eligible, as soon as practicable)
- **OAIC:** lodge the Notifiable Data Breach form at
  <https://www.oaic.gov.au/privacy/notifiable-data-breaches>.
- **Affected users:** email each affected account (the address on file) with:
  what happened, what data, what we are doing, and what they should do
  (e.g. reset password, be alert to exposure of locations they care about).
- If notifying each user is not practicable, publish a notice and make it
  prominently available.

### Step 4 — Review
- Root-cause the incident; file remediation as code/infra changes.
- Update this runbook with anything learned.

---

## 3. Contacts & references

- **Operator contact:** zentmarcos@gmail.com
- **OAIC NDB scheme:** <https://www.oaic.gov.au/privacy/notifiable-data-breaches>
- **Privacy policy commitment:** `frontend/public/privacy.html` (Data breaches section)

---

## 4. Pre-breach checklist (reduce blast radius)

- [ ] Confirm operational-log scrubbing still keeps coords/names out of plaintext.
- [ ] Confirm S3 buckets (`logjam-media`, `logjam-topo-jobs`) deny public access.
- [ ] Confirm presigned URL TTLs are short.
- [ ] Confirm CloudWatch log retention is bounded (policy states ≤90 days).
- [ ] Keep an up-to-date way to email all users (for mass notification).
