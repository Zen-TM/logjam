# Developer setup

From a fresh clone to Logjam Web running against a local API, and optionally
Logjam GPS on an Android emulator or phone. Linux is the reference host; the
Windows and macOS sections say only what differs from it.

The [`Makefile`](../Makefile) is the one source of commands. This page tells
you which target to run, what it does and roughly how long it takes; `make
help` lists them all, and the Makefile itself is the place to read how one
works.

**What you install yourself:** Docker (with Compose), `make`, [mise] and git.
Everything else is either pinned in [`mise.toml`](../mise.toml) (Node, Python,
Terraform, the AWS CLI and a couple of linters), installed by npm from the
lockfiles, or runs in a container (Postgres, MiniStack and the worker images).
You need no AWS account: local dev uses fake auth and MiniStack, a local AWS
emulator, and never reaches AWS.

[mise]: https://mise.jdx.dev/

- [Linux](#linux)
- [Windows (WSL2)](#windows-wsl2)
- [macOS](#macos)
- [Logjam GPS on an emulator or phone](#logjam-gps-on-an-emulator-or-phone)
- [Gotchas](#gotchas)

## Linux

### 1. Install the prerequisites

On Debian or Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y git make curl
```

- **Docker Engine and the Compose plugin:** follow
  [Docker's install guide](https://docs.docker.com/engine/install/) for your
  distribution, then the
  [post-install step](https://docs.docker.com/engine/install/linux-postinstall/)
  that lets you run `docker` without `sudo` (log out and back in after it).
  Docker Desktop for Linux works too.
- **mise:**

  ```bash
  curl https://mise.run | sh
  echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
  exec bash
  ```

  For zsh or fish, use the line from
  [mise's activation guide](https://mise.jdx.dev/getting-started.html) instead.
  Activation is what puts the pinned Node and Terraform on your `PATH` inside
  the repo; without it `make setup` falls back to whatever Node you already
  have.

**It worked if** each of these prints a version and no error:

```bash
git --version && make --version | head -1 && mise --version
docker compose version && docker run --rm hello-world
```

### 2. Clone and set up (a few minutes)

```bash
git clone https://github.com/Zen-TM/logjam.git
cd logjam
mise trust
make setup
cp frontend/.env.example frontend/.env
```

- `mise trust` lets mise read the repo's `mise.toml`; you run it once per clone.
- `make setup` installs the pinned tools, runs `npm ci` in every package,
  builds `shared/` and generates the Prisma client. Most of the time is the
  npm installs; the tool downloads are once per machine.
- `frontend/.env` is Logjam Web's own config. The example's values
  (`VITE_AUTH_MODE=fake`, API on `localhost:8080`) are the ones local dev
  wants; without the file Logjam Web falls back to Cognito sign-in.

**It worked if** `make setup` ends with Prisma's "Generated Prisma Client"
line and no `npm ERR!`, and `node --version` inside the repo prints the major
version `mise.toml` pins.

### 3. Start the local stack with `make dev` (first run 10–20 minutes, then about a minute)

```bash
make dev
```

This builds the two worker images, starts Postgres and MiniStack in Docker,
provisions MiniStack's S3 buckets and ECS task definitions with Terraform
(which also writes the root `.env.local` the API reads), runs the database
migrations and seeds three users with sample places and trips. The first run
is slow because the topo worker image builds GDAL, PDAL and tippecanoe; Docker
caches it after that.

`make dev` starts **infrastructure only**. It ends by printing the commands
for the two app servers:

```
  Infra ready. Start app servers in separate terminals:
    Terminal 1: cd api  && npm run dev
    Terminal 2: cd frontend && npm run dev
```

**It worked if** you see that message, and `docker compose ps` shows
`postgres` and `ministack` as `healthy`.

### 4. Start the API and Logjam Web

In a second terminal:

```bash
cd api && npm run dev
```

In a third:

```bash
cd frontend && npm run dev
```

**It worked if** `curl localhost:8080/health` prints `{"status":"ok",...}` and
Vite prints `Local:   http://localhost:5173/`.

### 5. Sign in

Open <http://localhost:5173>. There is no sign-in screen: with fake auth,
every request is the seeded user **alice**, and Logjam Web opens on the map
with its sidebar (Places, Logs, Friends and so on). Open **Places** to see her
seeded places.

**It worked if** `curl -H 'Authorization: Bearer x' localhost:8080/users/me`
includes `"username":"alice"`.

To be someone else, restart the API with a different seeded user
(`fake-bob-sub` or `fake-carol-sub`):

```bash
cd api && FAKE_USER_SUB=fake-bob-sub npm run dev
```

The seeded users and the relationships the tests rely on are listed in
[README → Seeded test data](../README.md#seeded-test-data).

### 6. Before you open a pull request

```bash
make verify
```

`make verify` checks formatting, lints and typechecks every package (a minute
or two). Then run the unit suites, which need no running stack:

```bash
(cd shared && npm test)
(cd api && npm run test:unit)
(cd frontend && npm test)
(cd mobile && npm test)
(cd topo && python -m unittest discover -s tests)
```

The topo suite needs the pure-Python part of `topo/requirements.txt`, once:
`grep -iE '^(numpy|Pillow|requests)' topo/requirements.txt | xargs pip install`.
Without them it runs against stubs and fails with `MagicMock` errors.

If you changed the API, also run its integration suite against the running
stack from steps 3–4: `cd api && npm test` (several minutes: it waits out
the API's rate limits). Each package's `AGENTS.md` says
what its suites need.

**It worked if** every command exits 0. The same checks run in CI on your
pull request.

### Day to day

| When | Run |
|---|---|
| Starting work | `make dev`, then the two app servers |
| You edited `shared/` | `make shared`, then restart the API (and Metro) |
| You changed worker code (`topo/`, the GeoPDF worker) | `make build-workers` |
| You want a clean database | `make reset` (wipes the volumes, re-migrates and re-seeds) |
| Stopping for the day | `make down` (keeps the data) |

## Windows (WSL2)

Develop inside WSL2 (Ubuntu), with Docker Desktop providing Docker.

1. Install WSL2 with Ubuntu: in an administrator PowerShell,
   `wsl --install -d Ubuntu`, then reboot and create your Linux user.
2. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   and turn on **Settings → Resources → WSL integration** for the Ubuntu
   distribution. Do not install a second Docker Engine inside Ubuntu.
3. Open the Ubuntu terminal and follow the [Linux](#linux) steps unchanged,
   except that Docker is already there.

**Clone inside the WSL filesystem** (for example under `~/`), never under
`/mnt/c/...` and never with Git for Windows:

- builds, `npm ci` and file watching on an NTFS mount through WSL are many
  times slower, and hot reload can miss changes;
- the repo tracks a symlink, `.claude/skills`, which a native Windows clone
  checks out as a plain text file.

To edit from Windows, open the folder through WSL (VS Code's WSL extension, or
`\\wsl$\Ubuntu\...` in Explorer). Docker Desktop publishes the stack's ports on
Windows' `localhost` too, so <http://localhost:5173> works in a Windows
browser.

### Logjam GPS on Windows: not yet verified

> **Not yet verified.** Nobody has yet run Logjam GPS from a Windows host. The
> approach below is the most likely to work, not a tested recipe.

Run Android Studio and the emulator on Windows, and Metro, the API and the
rest of the repo in WSL. The rough edge is `adb`: the emulator (or a USB
phone) is attached to Windows' `adb` server, which a Linux `adb` inside WSL
cannot see, and `npm run dev:android` calls `adb` and `emulator` by name.

The likely working setup:

1. Install Android Studio on Windows and create the AVD (see
   [Set up an emulator](#set-up-an-emulator)).
2. In WSL, make `adb` and `emulator` run the Windows binaries, so everything
   talks to the one Windows `adb` server:

   ```bash
   mkdir -p ~/bin
   SDK="/mnt/c/Users/<windows-user>/AppData/Local/Android/Sdk"
   ln -s "$SDK/platform-tools/adb.exe" ~/bin/adb
   ln -s "$SDK/emulator/emulator.exe" ~/bin/emulator
   # ~/bin must come before any Linux adb on PATH
   ```

3. `adb reverse` then maps a port on the device to a port on **Windows'**
   `localhost`. WSL2 forwards Windows' `localhost` to servers listening in WSL
   by default, which should carry the device's `8081` and `8080` through to
   Metro and the API. If it does not, switch WSL to mirrored networking
   (Windows 11 22H2 or later), in `%UserProfile%\.wslconfig`:

   ```ini
   [wsl2]
   networkingMode=mirrored
   ```

   then `wsl --shutdown` and reopen Ubuntu.
4. Building the dev client (`npm run dev:android -- --build`) runs Gradle
   where the repo is, so it needs a JDK 17 and the Android SDK inside WSL
   (`ANDROID_HOME`), separate from Android Studio's copy on Windows.

**The first Windows contributor to get this working:** replace this section
with what you actually did, and record: the Windows and WSL versions
(`wsl --version`), the WSL networking mode, how `adb` was reached from WSL,
where the dev client APK was built, the output of `npm run dev:android`, and
anything from this section that turned out to be wrong.

## macOS

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) or
[OrbStack](https://orbstack.dev/), git and `make` (both come with
`xcode-select --install`), and mise (`brew install mise`, or the `curl` line
in the Linux section, then add `eval "$(mise activate zsh)"` to `~/.zshrc`).
Then follow the [Linux](#linux) steps from step 2.

**Apple Silicon:** Postgres (`postgres:16`) and MiniStack
(`ministackorg/ministack`) publish arm64 images and run natively. The two
worker images are built for `linux/amd64` on every host (`make build-workers`
passes `--platform`), because that is what production runs, and because the
API image downloads an x86-64 `pmtiles` binary. On Apple Silicon they build
and run under emulation: turn on Docker Desktop's **Use Rosetta for x86/amd64
emulation** (OrbStack uses Rosetta by default). Expect the first `make dev` to
take noticeably longer than on Linux while the topo image compiles, and a topo
job to run slower than on an x86 machine.

## Logjam GPS on an emulator or phone

Logjam GPS is an Expo app with a dev client (a debug build of the app that
loads its JavaScript from Metro), not Expo Go. A real phone is better than an
emulator for anything involving GPS, the camera or the biometric prompt;
`mobile/AGENTS.md` has the rules of the dev loop.

You need the Linux (or macOS) steps done first, with the API running.

### Install the Android tooling

Install [Android Studio](https://developer.android.com/studio). From its SDK
Manager, install the Android SDK Platform-Tools, the Android Emulator and a
recent Android platform. Building the dev client needs a JDK 17; Android
Studio's bundled one works. Then put the tools on your `PATH`, for example in
`~/.bashrc` on Linux:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"   # macOS: $HOME/Library/Android/sdk
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

**It worked if** `adb version` and `emulator -list-avds` both run.

### Set up an emulator

In Android Studio, **Device Manager → Create Virtual Device**: a Pixel phone
with a recent **Google APIs** system image, named **`logjam`**, which is the
AVD name `npm run dev:android -- --emulator` boots. On a phone instead, turn on
USB debugging and accept the prompt when you plug it in.

### Configure `mobile/.env`

```bash
cp mobile/.env.example mobile/.env
```

Then set, for the local stack with fake auth:

```bash
EXPO_PUBLIC_API_URL=http://127.0.0.1:8080
EXPO_PUBLIC_AUTH_MODE=fake
```

- `fake` signs in as the seeded alice, like Logjam Web.
  `EXPO_PUBLIC_FAKE_SUB=fake-bob-sub` picks another seeded user; it is baked
  into the bundle, so restart Metro after changing it.
- `cognito` shows the real sign-in, and needs the Cognito pool and client IDs
  and a Cognito test account. You do not need it for everyday work.
- Use `127.0.0.1`, not the example's `10.0.2.2`, on an emulator too: the
  `adb reverse` tunnels below make the device's own `127.0.0.1` reach your
  machine.

### Run it

```bash
cd mobile
npm start                               # Metro, in its own terminal
npm run dev:android -- --build          # first time: builds and installs the dev client
npm run dev:android                     # after that
```

`npm run dev:android` (add `-- --emulator` to boot the `logjam` AVD first)
reverses the ports the app dials on `127.0.0.1` (8081 Metro, 8080 API, 4566
MiniStack), installs the dev client if it is missing and launches it. It
prints each port it reversed and whether anything was listening there.
Building the dev client takes 10–20 minutes the first time; you only rebuild
it after a native change.

**It worked if** the app opens on alice's places. If it opens but shows
nothing, or edits never sync, rerun `npm run dev:android`: a reverse tunnel
died.

Maestro UI flows and their prerequisites are in
[`mobile/e2e/README.md`](../mobile/e2e/README.md).

## Gotchas

| Symptom | Fix |
|---|---|
| `make dev` fails with "port is already allocated" or "address already in use" (5432, 4566), or `npm run dev` with `EADDRINUSE` (8080, 5173) | Something else holds the port: another Postgres, another checkout's servers, an old `npm run dev`. Find it with `ss -ltnp \| grep :5432` (macOS: `lsof -i :5432`) and stop it. Every checkout shares one Compose stack, so a second clone's `make dev` reuses the first one's containers. |
| Metro fails to start on 8081 | Another Metro or React Native tool holds it: stop it, or check `lsof -i :8081`. |
| Nothing on <http://localhost:5173> after `make dev` | `make dev` starts only Postgres and MiniStack; the API and Logjam Web are the two `npm run dev` terminals from step 4. |
| A change in `shared/` does not show up in the API, Logjam Web or Logjam GPS | They read the built `shared/dist`, not the source: `make shared`, then restart the API (nodemon does not see it) and Metro. |
| The API integration suite (`cd api && npm test`) fails with a refused connection, or 500s in tests your change does not touch | The dev database is not reachable: check `docker compose ps`, rerun `make dev`, restart the API. Not a regression. |
| The stack runs on a different machine (or VM or container) from your editor and browser | Everything listens on that machine's `localhost` only. Forward the ports to where your browser and phone are, for example `ssh -L 5173:localhost:5173 -L 8080:localhost:8080 <host>`, and add `-L 8081:localhost:8081` for Metro. Your editor's remote-development feature can forward them for you. |
| Uploads fail with `InvalidAccessKeyId` (the integration suite's media, track and file tests fail with `presigned PUT failed 403`) | Your shell exports real AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_PROFILE`), which win over the MiniStack ones the API reads from its env file. Start the API without them: `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_PROFILE npm run dev`. |
| Logjam GPS opens but has no data, or its edits never sync | `127.0.0.1` in `mobile/.env` means the phone: rerun `npm run dev:android` to restore the `adb reverse` tunnels. |

More symptoms, with causes, for the stack and for Metro and devices are in the
[`local-testing` skill](../.agents/skills/local-testing/SKILL.md).
