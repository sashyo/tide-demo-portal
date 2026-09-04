# Running this in GitHub Codespaces

Open a Codespace, wait for it to build, and you get a running portal on a public https URL
with no local setup. From there you create your own Tide realm and the demo apps unlock.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/sashyo/tide-demo-portal?quickstart=1)

---

## Why the URL cannot be committed

A Codespace forwards port 8090 to a hostname generated for that Codespace:

```
https://<codespace-name>-8090.app.github.dev
```

Nobody knows it until the Codespace exists, and it is different for every user and every
rebuild. That matters more here than in a typical demo, because this URL is not just where
the app happens to be reachable. It is **registered as the new realm's redirect URI** at the
moment the realm is created.

Get it wrong and the failure is delayed and expensive: provisioning succeeds, you link your
Tide account, and then sign-in fails with an unregistered-redirect error. The realm cannot be
edited to fix it from here. You have to create another one.

So the portal derives it at boot instead, in [`src/config.ts`](src/config.ts):

```ts
`https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
```

Both variables are set by the platform. `PORTAL_URL` still overrides them when you set it
explicitly, which is what you want behind a tunnel or a real deployment; the startup banner
tells you which of the two the running process actually used, so a leftover value in `.env`
cannot quietly build a realm around the wrong address.

Two related settings flip on automatically in a Codespace for the same reason:
`TRUST_PROXY=1` and `SECURE_COOKIES=true`. The forwarded URL is https served through GitHub's
proxy, and without those the session cookie is issued in a form the browser drops, so every
page looks signed out no matter how many times you sign in.

---

## Port 8090 goes public automatically

This is the step that, if it does not happen, produces the most confusing failure in the whole
flow. The sign-in journey leaves this origin three times and comes back: out to the
provisioner, out to TideCloak, and out to the Tide enclave running on the ORK. A **private**
forwarded port answers each returning redirect with a GitHub authentication page, so the
callback never arrives and you land on a GitHub login screen part-way through signing in.

`postStartCommand` handles it:

```bash
gh codespace ports visibility 8090:public --codespace "$CODESPACE_NAME"
```

That call needs the `codespace` scope, which the built-in token does not always carry. When it
fails, the terminal says so in as many words:

```
!! Could not set port 8090 public automatically (gh CLI is missing the codespace scope).
   Open the Ports tab, right-click 8090, Port Visibility, Public.
```

That manual fallback is one right-click, and it is worth confirming the Visibility column
reads **Public** before you start regardless.

Public means anyone with the URL can open the portal. That is the intent for a demo. The realm
behind it is yours, the data in it is whatever you type, and you can delete the Codespace when
you are done.

---

## Point it at a provisioner

The portal cannot create realms. It asks a separate service to, and that service holds a
credential for a live TideCloak instance, which is why it is a private repository and not
something you can run locally.

**This is already configured.** `.devcontainer/devcontainer.json` points at the hosted
provisioner, so a fresh Codespace works with no edit:

```jsonc
"containerEnv": {
  "PROVISIONER_URL": "https://tidecloak-provisioner.thankfulmushroom-6a65d40c.australiaeast.azurecontainerapps.io"
}
```

Check it is up before you start:

```bash
curl -s "$PROVISIONER_URL/health"
```

```json
{"ok":true,"tidecloak":"https://login.dauth.me","active":null,"queued":0,
 "storage":{"path":"/data/jobs.json","writable":true,"error":null}}
```

`active` and `queued` tell you whether someone else is provisioning right now, which is the
usual reason a realm seems slow to start.

Only change the URL if you are running your own provisioner. If you do, **Rebuild Container**
from the command palette afterwards, since `containerEnv` is read at container start. Left
unset entirely, the portal says so at boot:

```
  !! PROVISIONER_URL still points at localhost, and nothing is listening there.
```

To change it without a rebuild, export it in the terminal and restart: `PROVISIONER_URL=... npm start`.

### You do not need to touch the provisioner's CORS allowlist

Worth stating plainly, because the opposite is the natural assumption and it sends people
configuring `ALLOWED_ORIGINS` for a hostname that changes every rebuild.

Every call from this portal to the provisioner is made **server side**, from the Node process,
where CORS does not apply. The only thing your browser does is follow a top-level redirect to
the provisioner's own page, which is same-origin to itself. So a brand-new Codespace hostname
works against an unchanged provisioner.

---

## The first run

1. Open the Codespace. `onCreateCommand` runs `npm ci` and `updateContentCommand` runs
   `npm run build`. Both are skipped when you start from a prebuild; see below.
2. `postStartCommand` sets port 8090 public and runs `npm start`. Read the banner: it prints
   the Portal URL it derived and warns about anything misconfigured.
3. The port forwards and opens in a real browser tab (`onAutoForward: openBrowser`). Use that
   tab rather than the in-editor Simple Browser: sign-in opens the Tide enclave in a popup and
   depends on `window.opener` surviving a cross-origin `postMessage` back, which the embedded
   browser does not reliably do.
4. Click **Create my workspace**. You go to the provisioner, fill in the form, and wait about
   two minutes while the realm is created, licensed, and IGA-enabled.
5. Link your Tide account when prompted. This step is a human by design; the provisioner
   cannot do it for you, because there is nothing to sign with until you have.
6. You are returned to the portal, which fetches the adapter config and writes
   `data/realms/<realm>/tidecloak.json` for you. There is no `tidecloak.json` to copy by hand.
7. Sign in. The five demo apps unlock.

---

## When you rebuild or restart

**Stopping and restarting the same Codespace is fine.** The name is stable, so the forwarded
URL is the same and your realm keeps working. Check that port 8090 is still Public.

**Deleting the Codespace and making a new one gives you a new hostname**, which the realm you
already created does not have registered. Create a fresh workspace in the new Codespace. The
old realm is not damaged, it is just not reachable from the new address.

`data/` is gitignored, so realms and signed policies live only in that Codespace. Losing the
Codespace loses the local record of the realm, not the realm itself.

---

## "Do you trust the authors of the files in this folder?"

VS Code asks this before it will create a terminal, which means it blocks `postStartCommand`,
which means the port is never made public and `npm start` never runs. Nothing works until it
is answered.

**Answer it once.** Click *Yes, I trust the authors*. It is your own repository, and the
answer sticks for that Codespace.

**To stop being asked at all**, put it in your own **User** settings rather than in this
repository. User settings travel to every Codespace you open through Settings Sync:

```json
"security.workspace.trust.enabled": false
```

Or, to keep trust on but skip the prompt on startup:

```json
"security.workspace.trust.startupPrompt": "never"
```

This repository deliberately does not set either. Workspace trust is application-scoped, so a
devcontainer setting would probably be ignored anyway, and shipping it would turn the prompt
off for everyone who opens a public repo rather than just for you. That is your decision to
make in your own editor, not ours to make on your behalf.

---

## Making it start faster

Almost none of the wait is this project. Measured on a clean clone:

```
npm ci        0.8s
npm run build 0.05s
```

The time goes into creating the container: pulling the base image and installing the
`github-cli` feature. Nothing in the repository can shorten that, but a **prebuild** removes
it, because GitHub builds the container ahead of time and hands you a snapshot.

Turn it on once, in the repository: **Settings → Codespaces → Set up prebuild**, targeting the
`main` branch. New Codespaces then start from the snapshot.

The lifecycle commands are already split to take advantage of it:

| Command | Runs during a prebuild | Runs on every start |
|---|---|---|
| `onCreateCommand` (`npm ci`) | yes | no |
| `updateContentCommand` (`npm run build`) | yes | no |
| `postStartCommand` (port + `npm start`) | no | yes |

So a Codespace from a prebuild opens with `node_modules` and the browser bundles already
present and goes straight to starting the server.

Two things that are *not* worth doing: bundling `public/*.bundle.js` into git to skip the
build (it is 50 milliseconds and a megabyte of churn per dependency bump), and dropping the
`github-cli` feature to save the feature install (you would lose the automatic port
visibility, which is the step most likely to cost you a confusing ten minutes).

### Realm creation is a separate clock

Creating the realm itself takes 65 to 95 seconds, and that is almost entirely TideCloak
working, not this portal waiting. From real runs:

```
43s  activating the Tide license
14s  enabling IGA
 5s  approving the admin user
 4s  creating the realm
```

The license step is consistently 43 to 45 seconds across every successful run, so it is
server-side work rather than something retrying. Provisioning is also serialised, one realm at
a time, so if `queued` is not zero on the provisioner's `/health` you are waiting behind
somebody else as well.

---

## Troubleshooting

**A GitHub sign-in page appears part-way through the Tide sign-in.** Port 8090 is Private:
the automatic `gh codespace ports visibility` call failed, and the message saying so has
scrolled past. Set it Public in the Ports panel.

**"Invalid redirect_uri" or "unregistered redirect" after linking.** The realm was created
against a different address than the one you are browsing. Check the Portal URL in the startup
banner against the address bar. If a leftover `PORTAL_URL` is overriding the Codespace address,
the banner says so on the next line. Fix it and create a new workspace; the existing realm
cannot be repointed from here.

**The enclave popup never opens.** Allow popups for `app.github.dev`. If you are in the
in-editor Simple Browser rather than a real tab, open the forwarded URL in your browser
instead; the popup's handle back to the opener does not survive the embedded one.

**Provisioning stops at "waiting in the queue".** Expected. The provisioner creates one realm
at a time on purpose, so you are behind someone else. It reports your position and continues
on its own.

**Everything 502s or the page never loads.** `npm start` is not running. It is the tail of
`postStartCommand`, so it starts with the Codespace and stops if you kill that terminal. Open
a new one and run `npm start`.
