# Review later

Notes on features to revisit and understand. Nothing here is urgent.

---

## 1. Cached retrieve zip (the "reuse" feature) — explain in plain words

**What problem it solves:** deploying is two steps —
1. **Retrieve**: download the selected components *from the source org* (uat) onto
   your machine as a file: `.sfm-retrieve/unpackaged.zip`.
2. **Deploy**: push that file to the *target org* (prod).

Step 1 talks to Salesforce over the network and can take a while. If a deploy
**fails** and you retry, you don't want to download the same components again.

**What the feature does:** after step 1, the tool remembers *which components*
were in the zip (a small fingerprint file `.sfm-retrieve/.sfm-sig.json`).
Next time you deploy:
- If your selection is **the same** as what's in the zip → it **skips the
  download and reuses the existing zip**. You'll see:
  `↳ reused the cached zip (selection unchanged)`
- If you **added/removed** components → the fingerprint won't match → it
  downloads fresh automatically.

**Plain example**
1. Pick 12 classes, press `d` (deploy). Step 1 downloads them → `unpackaged.zip`.
2. Deploy fails (say a test error).
3. You fix something and run `sfm ui` again → your 12 picks are still checked
   (that's the *session* feature). Press `d`.
4. Because the 12 picks are identical, step 1 says **"reused the cached zip"**
   and goes straight to deploying — no re-download.

**When to force a fresh download:** if you changed the components *in the source
org itself* between the two attempts, the cached zip is stale. Run:
```
sfm ui --refetch
```
`--refetch` always re-downloads from the org, ignoring the cache.

**Files involved (for when you read the code):**
- `src/orgflow.js` → `retrieveFromSource()` and `manifestSignature()`
- the cache lives in `.sfm-retrieve/` (the zip + `.sfm-sig.json`), gitignored

**Question to decide later:** is auto-reuse the behavior you want, or would you
rather it *always* asks "reuse cached zip or re-fetch?" before deploying?

---

## 2. (related) Selection persistence

Separate but complementary: your selection + last target org + test level are
saved to `.sfm-session.json` per source org, so a failed/abandoned deploy never
loses your picks. See `src/session.js`.
