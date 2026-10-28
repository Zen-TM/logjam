# Maintainer announcements

An announcement is a message from the maintainer to every Logjam user. Each
user gets it as one row in their inbox on Logjam Web and Logjam GPS, plus a
phone push titled "A message from the Logjam maintainer". Opening the row shows
the whole message. It is never emailed.

The script `api/src/scripts/announce.ts` is the only way to send or retract
one; there is no endpoint for it. Users who sign up after a message was sent
do not get it.

## Write the message

A Markdown file. The first line is the title as a `# ` heading, in plain text;
everything after it is the body:

```markdown
# Logjam is moving to a new server

Logjam will be **offline for about an hour** on Saturday morning.

## What to expect

- Logjam GPS keeps recording and syncs when it is back.
- Logjam Web shows an error until then.

Questions: [email me](mailto:maintainer@example.com).
```

The body can use headings, paragraphs, bullet and numbered lists (one
level), **bold**, *italic*, `code`, links (`https:`, `http:` or `mailto:`
only) and line breaks (two trailing spaces). Heading levels are relative: the
shallowest heading is level 1 and the deepest may be two below it (`#` to
`###`, or `##` to `####`). The script refuses a message that uses anything
else (raw HTML, images, tables, code blocks, nested lists, quotes, rules,
strikethrough, a link inside a link, an HTML entity such as `&amp;`: type the
character) and says what it found. Text that only looks like an entity, such
as `Q&A;`, is refused too; write `Q\&A;` to keep the `&`.

## Send it

Send only once Logjam Web and a Logjam GPS release that opens the message
have shipped: before then, a user sees the title and cannot open the row.
Even after, anyone still on an older Logjam GPS build gets a row titled
"Notification" that opens nothing until they update.

Run the script twice. Without `--yes` it checks the message and prints how
many users would get it. With `--yes` it sends: the announcement and every
user's inbox row in one transaction, then the pushes. A push that fails is
logged and skipped, since the inbox row is the message.

The output is JSON log lines: `announcement_checked` (the title and
`recipients`), `announcement_refused` (what to fix), `announcement_sent` (the
`announcementId`; keep it to retract) and `announcement_pushed`.

### Locally

Against the dev stack (`make dev`):

```sh
make announce ARGS="send /path/to/message.md"
make announce ARGS="send /path/to/message.md --yes"
```

### In prod

The script is in the API image, so it runs as a one-off Fargate task on the
`logjam-geo-pdf-worker` task definition (it no longer renders GeoPDFs; the name stays, [0043](../decisions/0043-geopdfs-render-in-the-browser.md)): that definition runs the live API
image (pinned by every deploy) with the API's environment and database
credentials, and reaches the internet for the pushes. Only the command
changes; the message travels in an environment variable. This needs the
maintainer's AWS access, in `ap-southeast-2`.

The task connects as the application's database role, not the master
account, and reads only user ids and push device tokens. Its record is the
`RunTask` call in CloudTrail, command and message included, in the write-once
audit log ([DATA-ACCESS-POLICY.md](../DATA-ACCESS-POLICY.md)).

A run that exits 1 (a refused message, a retract that finds nothing, an
error) is a stopped task with a non-zero exit in `logjam-cluster`, so it
counts towards the `logjam-worker-failures` alarm like a failed export,
and its event, overrides and message included, is kept in
`/aws/events/logjam-worker-failures`. Three in an hour page; the alarm's
runbook says what to do ([alarms.md](alarms.md#logjam-worker-failures)).

Define the helpers once in your shell:

```sh
# Runs one command in a one-off task on the live API image, waits for it,
# and prints its output.
announce_task() {
  local sg task
  sg=$(aws ec2 describe-security-groups \
    --filters Name=group-name,Values=logjam-worker-sg \
    --query 'SecurityGroups[0].GroupId' --output text)
  task=$(aws ecs run-task \
    --cluster logjam-cluster \
    --task-definition logjam-geo-pdf-worker \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[subnet-0f59b0845905891be,subnet-0c10e1438a8fd0231],securityGroups=[$sg],assignPublicIp=ENABLED}" \
    --overrides "$1" \
    --query 'tasks[0].taskArn' --output text)
  aws ecs wait tasks-stopped --cluster logjam-cluster --tasks "$task"
  aws logs tail /ecs/logjam-geo-pdf-worker \
    --log-stream-names "ecs/geo-pdf-worker/${task##*/}" --format short
}

# send <message.md> [--yes]
announce_send() {
  announce_task "$(jq -n --rawfile md "$1" --arg yes "${2:-}" '{containerOverrides: [{
    name: "geo-pdf-worker",
    environment: [{name: "ANNOUNCEMENT_MARKDOWN", value: $md}],
    command: ["sh", "-c", "printf %s \"$ANNOUNCEMENT_MARKDOWN\" > /tmp/message.md && exec node dist/scripts/announce.js send /tmp/message.md \($yes)"]
  }]}')"
}

# retract <announcementId>
announce_retract() {
  announce_task "$(jq -n --arg id "$1" '{containerOverrides: [{
    name: "geo-pdf-worker",
    command: ["node", "dist/scripts/announce.js", "retract", $id]
  }]}')"
}
```

Then check, read what it printed, and send:

```sh
announce_send message.md
announce_send message.md --yes
```

ECS caps a task's overrides at 8 KB, so a message must be a little shorter
than that. The subnets and security group are the ones the deploy workflow
uses for the migrate task (`.github/workflows/deploy-api.yml`).

## Retract it

Retracting deletes the announcement and every user's inbox row for it, so it
disappears from both clients at their next refresh. A push already delivered
stays in the phone's notification tray; tapping it opens an inbox without the
message.

```sh
make announce ARGS="retract <announcementId>"   # locally
announce_retract <announcementId>               # in prod
```

`announcement_retracted` reports how many inbox rows went;
`announcement_not_found` means no announcement has that id.
