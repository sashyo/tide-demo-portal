# tide-demo-portal

A portal to other demo apps. A visitor arrives with no account, provisions **their own Tide
realm**, comes back, signs in with it, and unlocks the demo apps — which share that realm.

Pairs with `tide-realm-provisioner`, which does the realm creation. That service holds a
credential that can create realms on a live TideCloak instance, so it lives in a separate
private repository under the tide-foundation org. Nothing in this repository can create a
realm on its own; it calls `PROVISIONER_URL` and consumes what comes back.

---

## The loop

```
  visitor → portal /                     no realm yet → "Create my realm"
          → provisioner  ?app_url=<portal>&return_to=<portal>/onboard/complete
          → (≈2 min: realm, license, IGA, admin user, invite)
          → visitor links their Tide account
          → back to portal /onboard/complete?job=<id>&realm=<realm>
                 └─ portal GETs the job from the provisioner, takes .adapter,
                    writes data/realms/<realm>/tidecloak.json, remembers the realm
          → portal /  →  "Sign in with Tide"  →  OIDC + PKCE + DPoP
          → signed in, apps unlocked
```

`app_url` is the crux: it becomes the new realm's client `redirectUris` and `webOrigins`, so
it MUST be this portal's real public origin. Set `PORTAL_URL` accordingly before going live —
with it wrong, realms come out unable to accept this app's callback and sign-in fails.

## Where tidecloak.json comes from

The portal never asks anyone to paste config. On return it fetches
`GET {provisioner}/api/realms/jobs/:id`, takes the `adapter` field, and stores it three ways:

| Where | For |
|---|---|
| `data/tenants.json` | the portal's own OIDC wiring |
| `data/realms/<realm>/tidecloak.json` | a real file, the way a Tide app normally ships one |
| `GET /api/realms/:realm/tidecloak.json` | **sibling demo apps**, so they need no provisioning code |

The adapter is entirely public — realm, auth server URL, client id, the realm's *public*
signing key, vendor id, home ORK URL. No secret, which is why it is safe in a file and safe
to serve unauthenticated. `GET /api/me` tells a sibling app which realm this browser is on.

---

## Two things that will break a naive client

**1. Tokens are EdDSA, not RS256.** Tide realms sign with Ed25519. Node's `jsonwebtoken` has
no EdDSA support at all, so it cannot verify these tokens — this portal uses `jose`, and pins
no algorithm. Anything hard-coded to RS256 401s on every request.

**2. DPoP is required.** The realm's client carries `dpop.bound.access.tokens: true`, so every
token request must present a proof signed by a key the client holds, and the issued token is
bound to that key's thumbprint. Without one:

```
POST /token   (no proof)
→ 400 {"error":"invalid_request","error_description":"DPoP proof is missing"}
```

`src/dpop.ts` implements it: an Ed25519 key per login attempt, a fresh proof JWT per request
(`typ: dpop+jwt`, with the public JWK in the header), `ath` binding the proof to the access
token when one is presented, and a retry when the server demands a `DPoP-Nonce`. Two details
that silently break otherwise: `htu` must be scheme+host+path with no query string, and a
first-request 400 carrying `use_dpop_nonce` is a **retry instruction, not a failure**.

After sign-in the portal shows the binding it achieved — our key's thumbprint, the `cnf.jkt`
the realm recorded, whether they match, and whether the token was actually accepted at
`/userinfo`. That is a real check, not a claim: a wrong binding 401s there.

---

## Run

```bash
cp .env.example .env      # set PORTAL_URL and PROVISIONER_URL
npm install && npm run build && npm start
```

| Var | Meaning |
|---|---|
| `PORTAL_URL` | This portal's public origin — becomes the realms' redirect URI |
| `PROVISIONER_URL` | Where visitors go to create a realm |
| `SESSION_SECRET` | Signs the session cookie. Unset = generated per boot = everyone signed out on restart |
| `SECURE_COOKIES` | `true` once served over https |
| `DEMO_APPS_FILE` | The app tiles (`data/demo-apps.json`) |

### The app tiles

`data/demo-apps.json` ships three entries with `"url": null`, which render as **Coming soon**
rather than dead links. Give them real URLs to make them live.

---

## Demo caveats

- **Sessions are in memory.** A restart signs everyone out. Realms survive in `data/`.
- **One realm per browser**, tracked by cookie. `/switch` forgets it and starts over; the realm
  itself is not deleted.
- **Never attempt a governed write on a provisioned realm from the provisioner's service
  account.** Once IGA is on, an admin-API write becomes a change request, and one the service
  account cannot self-approve returns `authorize=409` (four-eyes) — which then blocks
  *everything else queued behind it, including `DELETE_REALM`*. That wedges the realm
  permanently. MEASURED 2026-09-02: `portal-loop-01` was wedged this way by an attempt to flip
  one client attribute after creation, and could not afterwards be fixed or deleted. Get the
  realm right in the template at creation time; there is no second chance.
