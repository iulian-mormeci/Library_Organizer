# Music Dedup

A self-hosted web app for finding and cleaning up duplicate tracks in a large music library. Built for a homelab setup: Docker Compose, Postgres, a music folder mounted over NFS from a NAS.

## Why

Years of pulling music from Soulseek, YouTube grabbers, random forum links and the occasional CD rip leaves you with the same album in three different folders, half of them tagged differently, some as MP3 and some as FLAC, and no realistic way to find the overlap by eye. I built this because manually deduping an 8000-track FLAC library by hand wasn't happening. It scans a library, groups the tracks it's confident are duplicates, and gives you a UI to clear them out — including a one-click option for the cases where there's genuinely zero risk of deleting the wrong thing.

It's not a music player, a tagger, or a library manager. It does one job: find duplicates, help you decide what to keep, delete the rest.

## How duplicate detection works

Scanning walks the library, extracts tags with `music-metadata`, hashes every file (SHA256), and runs each file through `fpcalc` (Chromaprint) to get an audio fingerprint. All of that gets stored per track. Finding duplicates is then a separate step that groups tracks using three passes, from most to least certain:

1. **Exact hash.** Same SHA256 = byte-for-byte identical files. Zero ambiguity — this is the only thing the auto-clean button touches by default without extra conditions.
2. **Fuzzy metadata.** Normalizes artist + title (strips "feat.", "remastered", punctuation, case) and compares with a Levenshtein distance. Catches things like *Song (Remaster 2011)* vs *song*, but it's a text match, not an audio match — two different live versions with similar tags would also match here. Needs a human to look at it.
3. **Audio fingerprint.** Compares Chromaprint fingerprints with a Hamming-distance similarity. This is the one that actually catches "same recording, different file" — a FLAC and an MP3 of the same rip will usually match here even with completely different tags, since the hash and the metadata are both different but the audio isn't.

Each level only looks at tracks the previous levels didn't already group, so nothing gets reported twice. Duplicate detection is too expensive to run inline in a request (comparing thousands of tracks pairwise would block the server for minutes), so it runs as a background job and the `/duplicates` page just reads whatever was computed last. A recompute kicks off automatically after every scan, or you can trigger one manually from the dashboard.

Within a group, the app picks a "recommended" copy to keep: lossless format beats lossy, then higher bitrate, then larger file size, and if a group is still tied on all of that (which happens constantly for exact-hash duplicates — they're identical, so of course the numbers match) it falls back to the shortest file path, just so the choice is consistent instead of effectively random.

### Automatic cleanup

There's a button on the duplicates page that skips the manual review entirely for the cases that don't need it: exact hash matches, plus fingerprint matches at *exactly* 100% similarity — not 99%, not "close enough," the literal maximum value the similarity metric can produce. At that point Chromaprint found zero perceptible difference between the decoded audio, so even if the files differ in tags or container format, deleting the non-recommended copy is exactly as safe as deleting a byte-identical file. Everything below that threshold, even by a fraction of a percent, and anything from the fuzzy-metadata pass, is left alone — those need a person to actually look at the tracks and decide.

The button shows a preview (group count, track count, total size) before anything is touched, and needs one explicit confirmation to run.

## Requirements

- Docker + Docker Compose
- A music library the app can read (and, if you want deletion to work, write to) — a local folder for testing, an NFS mount in practice
- That's it from the host's point of view; Postgres, Node, and Chromaprint all run inside the containers

## Getting started

```bash
git clone git@github.com:iulian-mormeci/Library_Organizer.git music-dedup
cd music-dedup
cp .env.example .env
# edit .env — at minimum set LIBRARY_PATH_ON_HOST to your music folder

docker compose build
docker compose up -d
```

The entrypoint runs `prisma migrate deploy` automatically before starting the app, so the database schema is ready on first boot. Postgres data persists in a named volume across restarts.

Once it's up, open `http://localhost:3000`, hit "Start new scan" on the dashboard, and once it finishes head to `/duplicates`. A recompute of the duplicate groups runs automatically right after the scan.

For scheduled rescans (cron, systemd timer, whatever), there's a standalone entry point that doesn't need the web server running:

```bash
docker compose exec app npm run scan -- /music
```

## Environment variables

All of these live in `.env` (see `.env.example` for the full file with defaults):

| Variable | What it's for |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Postgres credentials, used both by the `postgres` container and to build `DATABASE_URL` |
| `DATABASE_URL` | Full Postgres connection string — built for you under Compose, but read directly if you run the app or `cli-scan.ts` on the host |
| `LIBRARY_PATH_ON_HOST` | Host-side path to your music library, bind-mounted into the container |
| `LIBRARY_PATH_IN_CONTAINER` | Where that mount shows up inside the container (matches `LIBRARY_PATH` below) |
| `LIBRARY_MOUNT_MODE` | `ro` or `rw` — controls the Docker bind mount itself, see the permissions section below |
| `LIBRARY_PATH` | The path the app actually scans/writes to; normally just mirrors `LIBRARY_PATH_IN_CONTAINER` |
| `APP_PORT` | Host port the web UI is exposed on |
| `FPCALC_PATH` | Path to the `fpcalc` binary; only needed if it's not already on `PATH` (the Docker image installs it, so you shouldn't need to touch this) |

## NFS permissions (read this before you deploy to a NAS)

This one bit me directly, so it's worth being explicit about it. If your library is mounted from a NAS over NFS, the delete button will fail even when everything *looks* fine — mount shows `rw`, permissions on the files look correct — because of `root_squash`. Most NFS servers map the client's root user to an unprivileged, often anonymous, user on the server side, specifically so a compromised or misconfigured client can't just delete arbitrary files as root. Since containers run as root by default, that anonymous mapping is exactly what you get, and it usually isn't allowed to touch your files.

The fix is to not run the container as root. `docker-compose.yml` sets:

```yaml
user: "1000:1000"
```

on the app service, and the Dockerfile `chown`s the app directory to match. `1000:1000` isn't arbitrary — it's the UID/GID of the `node` user that `node:20-bookworm-slim` ships with, which conveniently means Node doesn't hit the (also real, also annoying) crash it throws when run as a numeric UID with no matching `/etc/passwd` entry. Set your NFS export to allow that UID to write, and make sure it's the UID that actually owns your music files — if your NAS uses a different UID/GID for the share, change both the compose file and the export to match.

Separately from that, `LIBRARY_MOUNT_MODE` controls whether Docker mounts the library read-only or read-write *inside the container*, independent of whatever the actual NFS export permissions are. It defaults to `ro` on purpose — the app should never be able to write to your library during a normal scan, only during an explicit, user-initiated delete. Set it to `rw` and recreate the container (`docker compose up -d`) when you actually want deletion to work.

If a delete still fails after all that, the app tries to tell you which of the two problems it is (`EROFS` — the mount itself is read-only, check `LIBRARY_MOUNT_MODE` — vs `EACCES`/`EPERM` — permission denied on the specific file, check the NFS export's UID mapping) instead of just a generic "failed."

## Things to keep in mind

- **Duplicate results aren't live.** The `/duplicates` page reads whatever the last background computation produced, not a fresh calculation on every page load. It's kept current automatically (recomputes after every scan) and you can force one manually, but if you delete files outside the app or the recompute hasn't caught up yet, the list can be briefly stale.
- **Deletion needs a writable mount.** Read-only is the safe default; you have to opt in to `rw` per the section above.
- **Auto-clean is intentionally narrow.** Exact-hash duplicates are actually pretty rare in a real library — different rips of the same album almost always differ in tags or encoding, which changes the hash even when the audio is identical. Most of what auto-clean *won't* touch (fingerprint matches below 100%, fuzzy-metadata matches) is still genuinely useful to review, it just isn't zero-risk enough to automate.
- **Fingerprinting needs decodable audio.** If `fpcalc` can't read a file (corrupt, unsupported codec, or not actually audio), that track just won't participate in fingerprint-level matching — it can still be caught by exact-hash or fuzzy-metadata.
- **This is a single-instance tool.** No auth, no multi-user support, nothing designed to be exposed past your own network. It assumes you're the only one using it and trusts whoever can reach the dashboard.
- **Large libraries change the math.** Detection is duration-bucketed to stay fast (tens of milliseconds even at several thousand tracks in testing), but the scan itself is still bound by disk/NFS I/O and fingerprinting cost — the first scan of a big library takes a while.

## Stack

Next.js (App Router) + TypeScript, Prisma/PostgreSQL, `music-metadata` for tags, Chromaprint (`fpcalc`) for audio fingerprints, all wired together with Docker Compose.
