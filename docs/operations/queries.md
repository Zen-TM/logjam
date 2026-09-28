# Operational queries

Saved queries for questions that come up more than once. Run them in the AWS
console (CloudWatch → Logs Insights, region `ap-southeast-2`) or with
`aws logs start-query`. Every one reads prod, so they need the maintainer's
AWS access.

## Which Logjam GPS versions are in the field

Every `/sync/*` request that passes the client-header check
(`requireClientHeader` in `api/src/routes/sync.ts`) logs one `sync_client`
line:

```json
{"msg":"sync_client","client_platform":"mobile","client_version":"0.3.1"}
```

A request with a missing or malformed `x-logjam-client` header is refused
with a 400 and logs `{"msg":"sync_client_rejected","reason":"missing"}` (or
`"malformed"`), never the header itself. Counts are requests, not people: a phone that syncs
often weighs more than one that syncs rarely.

These numbers inform a `MIN_MOBILE_VERSION` bump;
[ADR 0022](../decisions/0022-mobile-builds-supported-three-months.md) has the
rule.

### Log group

The API's stdout (pino JSON) streams to the Elastic Beanstalk group:

```
/aws/elasticbeanstalk/logjam-api-prod/var/log/eb-docker/containers/eb-current-app/stdouterr.log
```

EB names it, not Terraform (`infra/terraform/envs/prod/logging.tf`), so list
`/aws/elasticbeanstalk/logjam-api-prod/` in the console if it is not there. If
Logs Insights shows no `msg` field, the lines carry a prefix: each query
needs `parse @message` before the `filter`, and the `SyncRequests` metric
below counts nothing, because its filter reads each line as JSON.

### 7 days: Logs Insights

The group keeps 7 days (`api/.ebextensions/cloudwatch-logs.config`, the figure
`frontend/public/privacy.html` promises), so 7 days is the longest window
these queries can see. Set the time range to the last 7 days.

Requests per version:

```
filter msg = "sync_client"
| stats count(*) as requests by client_platform, client_version
| sort requests desc
```

The same, per day, to see an upgrade taking hold:

```
filter msg = "sync_client"
| stats count(*) as requests by client_version, bin(1d) as day
| sort day desc, requests desc
```

Refused requests by reason. A spike in `malformed` after a release means the
build sends a header the API does not accept:

```
filter msg = "sync_client_rejected"
| stats count(*) as requests by reason
```

### 30 and 90 days: the `SyncRequests` metric

Logs cannot answer these, and keeping API logs longer would break the 7-day
retention promise. A CloudWatch metric filter on the `sync_client` line
(`aws_cloudwatch_log_metric_filter.sync_client` in
`infra/terraform/envs/prod/logging.tf`) counts each Logjam GPS request as
metric `SyncRequests` in namespace `Logjam/Clients`, with `client_version` as
its one dimension. A metric keeps 15 months and holds only a version string
and a count.

It counts from the day the filter was applied, not before: for a window that
starts earlier, the numbers are short by the days it did not exist.

The console query (CloudWatch → Metrics → Query, source tab) for each window
is the one expression with a different period:

```
SEARCH('{Logjam/Clients,client_version} MetricName="SyncRequests"', 'Sum', 2592000)
```

Set the graph range to 30 days with period `2592000` (30 days) for one bar
per version, or the range to 90 days with period `86400` for a daily line per
version.
