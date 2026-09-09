# SKYGRID · going live

Two hosts. Vercel serves the site. Render runs the Python backend, because Vercel cannot hold
a WebSocket open and the command center needs one.

Do Render first. You need its URL before you can finish Vercel.

---

## A · Backend on Render

1. Go to <https://dashboard.render.com> and sign in with GitHub.
2. **New +** → **Web Service** → connect `Abhii2310/drone-delivery`.
3. Render reads `render.yaml` from the repo. Confirm it shows:

   | Field | Value |
   |---|---|
   | Root Directory | `backend` |
   | Runtime | Python |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
   | Instance Type | Free |

   If it asks instead of showing these, type them in by hand.
4. Environment variables: **none are required.** Leave `SKYGUARD_ORIGINS` unset.
   The backend already allows any `*.vercel.app` origin.
5. **Create Web Service.** The first build takes 3 to 5 minutes.
6. Copy the URL, something like `https://skyguard-backend.onrender.com`.
7. Check it works. Open `<your-render-url>/health` in a browser. You want:

   ```json
   {"ok":true}
   ```

---

## B · Frontend on Vercel

1. Go to <https://vercel.com/new> and import `Abhii2310/drone-delivery`.
2. Settings:

   | Field | Value |
   |---|---|
   | Root Directory | `frontend` |
   | Framework Preset | Vite |
   | Build Command | leave off, `vercel.json` supplies it |
   | Output Directory | leave off, `vercel.json` supplies it |
   | Install Command | leave off, `vercel.json` supplies it |

   Root Directory is the one that breaks the build if you miss it.
3. Environment Variables. Add these two, both for Production and Preview:

   | Key | Value |
   |---|---|
   | `VITE_API_BASE` | your Render URL, no trailing slash |
   | `VITE_CESIUM_ION_TOKEN` | your Cesium tokens, comma separated (optional) |

   `VITE_API_BASE` example: `https://skyguard-backend.onrender.com`

   Leave the Cesium one out entirely if you would rather not. The site deploys fine; the
   3D CITY toggle just stays hidden.
4. **Deploy.**

---

## C · Check the three routes

| Route | What you should see |
|---|---|
| `/` | The landing page. Boot sequence, then the night city and live counters. |
| `/signin` | Dot matrix, four role tiles. Pick one, it opens the console filtered to it. |
| `/command` | The command center with aircraft moving. This is the one that needs Render. |

If `/command` shows CONNECTION LOST, check in this order:

1. Does `<render-url>/health` return `{"ok":true}`? If not, the backend is asleep or failed.
2. Is `VITE_API_BASE` set on Vercel with no trailing slash and no quotes?
3. Did you redeploy Vercel **after** adding the variable? Vite bakes it in at build time.
   Changing it later does nothing until you redeploy.

---

## The free tier catch, worth knowing before you present

Render's free plan puts the service to sleep after about 15 minutes with no traffic. The next
request wakes it, which takes roughly a minute, and during that minute `/command` shows
CONNECTION LOST. The simulation is held in memory, so it restarts from the fixture.

**Before you demo, open the Render URL yourself and wait for `{"ok":true}`.** Then the console
is warm and everything is instant.

The landing page and sign-in do not touch the backend at all. They are always fast.
