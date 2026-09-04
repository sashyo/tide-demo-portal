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

## Set the port to Public

This is the one manual step, and skipping it produces the most confusing failure in the whole
flow.

The sign-in journey leaves this origin three times and comes back: out to the provisioner, out
to TideCloak, and out to the Tide enclave running on the ORK. A **private** forwarded port
answers each returning redirect with a GitHub authentication page, so the callback never
reaches the app and you land on a GitHub login screen mid-sign-in.

`.devcontainer/devcontainer.json` asks for public visibility up front. Confirm it took:

1. Open the **Ports** panel (next to Terminal).
2. Find port 8090. The Visibility column should read **Public**.
3. If it reads Private: right-click the row → **Port Visibility** → **Public**.

Public means anyone with the URL can open the portal. That is the intent for a demo. The realm
behind it is yours, the data in it is whatever you type, and you can delete the Codespace when
you are done.

---

## Point it at a provisioner

The portal cannot create realms. It asks a separate service to, and that service holds a
credential for a live TideCloak instance, which is why it is a private repository and not
something you can run locally.

Set its address in `.devcontainer/devcontainer.json`:

```jsonc
"containerEnv": {
  "PROVISIONER_URL": "https://your-provisioner.example.com"
}
```

Then **Rebuild Container** from the command palette, since `containerEnv` is read at container
start. If you leave it at the placeholder, the portal says so at boot:

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

1. Open the Codespace. `postCreateCommand` runs `npm install && npm run build`; the first
   build takes a couple of minutes.
2. `postAttachCommand` runs `npm start`. Read the banner: it prints the Portal URL it derived
   and warns about anything misconfigured.
3. The port forwards and a preview opens. Prefer the real browser tab over the in-editor
   preview: the sign-in flow opens the Tide enclave in a popup, and popups behave better in a
   normal tab.
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

## Troubleshooting

**A GitHub sign-in page appears part-way through the Tide sign-in.** Port 8090 is Private.
Set it Public in the Ports panel.

**"Invalid redirect_uri" or "unregistered redirect" after linking.** The realm was created
against a different address than the one you are browsing. Check the Portal URL in the startup
banner against the address bar. If a leftover `PORTAL_URL` is overriding the Codespace address,
the banner says so on the next line. Fix it and create a new workspace; the existing realm
cannot be repointed from here.

**The enclave popup never opens.** Allow popups for `app.github.dev`, and use a real browser
tab rather than the in-editor Simple Browser.

**Provisioning stops at "waiting in the queue".** Expected. The provisioner creates one realm
at a time on purpose, so you are behind someone else. It reports your position and continues
on its own.

**Everything 502s or the page never loads.** `npm start` is not running. Open a terminal and
run it; `postAttachCommand` only fires when you attach.
