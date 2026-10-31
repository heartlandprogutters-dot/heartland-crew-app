# Heartland Crew

This is the phone app for Heartland ProGutters in Farmington, Kentucky. A crew member takes photos of a finished job and sends it in. Kent or Haley checks it. After they approve it, the job shows up on the company website map.

The exact house pin and the street address stay inside this app. The website gets a pin that has been moved 150–250 meters in a random direction. That move happens once, inside the database, when the job is approved.

The app is a website you can install on an iPhone or an Android phone. It also works in a desktop browser, which is the easier place for approving jobs and downloading backups.

Nothing here is deployed for you. After the steps below, GitHub Pages hosts the app and Supabase holds the logins, jobs, and photos. Both have free plans.

## What you need

- A free [Supabase](https://supabase.com) account
- This GitHub repo
- A computer with a web browser for the one-time setup
- The crew phones

You do not need a credit card. You do not need to install Node unless you want to run the automatic checks.

## 1. Merge the app

Merge the pull request into the `main` branch. The rest of these steps happen on `main`.

## 2. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com) and create a new project. The free plan is enough.
2. Pick a database password and save it somewhere private. You need it if you ever open the database settings.
3. Wait until the project says it is ready.

## 3. Create the tables

1. In Supabase, open **SQL Editor** → **New query**.
2. On GitHub, open `supabase/migrations/20261031120000_init.sql`. Click **Raw**, select all, and copy.
3. Paste that into the SQL Editor and click **Run**. You want a success message. If you see "already exists", the file was already run.
4. Open a new query. Copy all of `supabase/migrations/20261031120100_storage.sql` and run it. If an earlier copy stopped with "must be owner of table objects", that attempt was undone. Run this updated file. It only adds the photo folders and their rules.
5. Open one more query. Copy all of `supabase/migrations/20261031130000_videos.sql` and run it. This adds short job videos.
6. Open one more query. Copy all of `supabase/migrations/20261031140000_move_pin.sql` and run it. This lets Kent or Haley drag the exact house pin. The website pin does not move.

That creates the job tables, the privacy rules, the public jobs feed, and two photo folders:

- `job-photos-private` — pictures before a job is approved
- `job-photos` — pictures the website is allowed to show
- `job-videos-private` and `job-videos` — the same idea for short clips, after you run the third SQL file

## 4. Turn off public sign-up

1. Open **Authentication** → **Sign In / Providers** (sometimes labeled **Providers**).
2. Open **Email**.
3. Leave Email turned on.
4. Turn **off** "Allow new users to sign up".
5. Save.

Kent creates every login. There is no sign-up screen in the app.

## 5. Create Kent's login

1. Open **Authentication** → **Users** → **Add user** → **Create new user**.
2. Type Kent's email and a password he can type on a phone.
3. Turn on **Auto Confirm User** so he does not have to click an email link.
4. Create the user.

The database starts that login in the off position until the next step.

## 6. Make Kent the admin

1. On GitHub, open `supabase/bootstrap_admin.sql`.
2. Change `kent@example.com` to the email you just used. Leave the quotes.
3. Copy the whole file into a new SQL Editor query and run it.
4. The result grid should show Kent with role `admin` and disabled `false`.

If the grid is empty, the email does not match the user you created. Fix the email and run it again.

## 7. Put the public keys in the app

1. In Supabase open **Project Settings** → **API** (or **API Keys**).
2. Copy the **Project URL**. It looks like `https://abcdefgh.supabase.co`.
3. Copy the **anon public** key. It is a long public key.
4. Do **not** copy the **service_role** key. That key ignores every privacy rule. It must never go in this app or in GitHub.

On GitHub:

1. Open `src/config.js` on the `main` branch.
2. Click the pencil.
3. Replace `https://YOUR_PROJECT.supabase.co` with the Project URL.
4. Replace `YOUR_SUPABASE_ANON_KEY` with the anon key. Keep the quotes.
5. Commit the file to `main`.

That commit starts the site build.

## 8. Turn on GitHub Pages

1. On GitHub open **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open the **Actions** tab. The "Deploy GitHub Pages" workflow should be running or green.
4. When it is green, the site address is `https://heartlandprogutters-dot.github.io/heartland-crew-app/`.

If the address is different, use the URL shown on the green workflow run.

## 9. Tell Supabase the site address

1. In Supabase open **Authentication** → **URL Configuration**.
2. Set **Site URL** to the Pages address from step 8, including the `https://` and the final slash.
3. Add that same address under **Redirect URLs**.
4. Save.

Password-reset emails send people back to this address.

## 10. Keep the free database awake

Supabase pauses a free project after about a week with no traffic. A daily GitHub Action pings it so that does not happen.

1. On GitHub open **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Name: `SUPABASE_URL`. Value: the Project URL from step 7.
3. Add another secret. Name: `SUPABASE_ANON_KEY`. Value: the anon key from step 7.
4. Open **Actions** → **Keep Supabase awake** → **Run workflow** once, to prove the secrets work.

## 11. Add Haley and the crew

1. Open the Pages address on a computer.
2. Sign in as Kent.
3. Open **Crew**.
4. Add Haley with role **Approver**.
5. Add each crew member with role **Crew**.
6. The temporary password is shown once. Tell them in person or by a phone call, then have them open **Password** and change it.

If **Add person** shows an error, use the fallback:

1. In Supabase, **Authentication** → **Users** → **Add user**, with **Auto Confirm User** on.
2. Back in the app, open **Crew**, find them, and set the role.

An approver can see and approve every job, including the exact map pin. An admin can do that and can also add or turn off people. Crew members only see their own posts.

## 12. Install it on an iPhone

1. Open the Pages address in Safari. Chrome on iPhone will not install it.
2. Tap the Share button.
3. Tap **Add to Home Screen**.
4. The name will be **HL Crew**.
5. Open it from the home screen icon.
6. The first time someone taps **Use my location**, tap **Allow**. If it was blocked: Settings → Privacy & Security → Location Services → Safari Websites, or the HL Crew app if it is listed on its own.

## 13. Install it on Android

1. Open the Pages address in Chrome.
2. Tap the menu (three dots) → **Install app** or **Add to Home screen**.
3. Open it from the icon.
4. Allow location when the phone asks.

## A normal day

**Crew**

1. Open the app and tap **New job**.
2. Take or choose up to 8 photos. The phone shrinks each one to a WebP around 150 KB, no wider than 1200 pixels, and removes the camera's hidden location stamp.
3. Pick the service and the town. **Use my location** or type the address and tap **Find address**. Address search runs only when that button is tapped.
4. A video is optional. **Record video** or **Choose video** can be any length. The phone keeps at most 30 seconds before upload. By default that is the middle of the recording. **Adjust the clip** moves the start, and **Play the part we'll keep** previews it. Preparing the clip takes about as long as the clip itself. If the phone cannot trim, it stops and does not upload the full recording.
5. Write one short line about the work. Leave out the house number and the customer's name.
6. Tap **Send for approval**.

**My posts** shows Pending, Approved, or Rejected, plus any clip. A rejected job includes the reason. **Start a fixed copy** fills in the note again. Photos and the location have to be added again. **Delete** removes a job that is not on the website.

**Kent or Haley**

1. Open **Review**. A computer is easier than a phone for this.
2. Open a waiting job. The copper dot is the real house. The note under the map says so.
3. Fix the title or the summary if needed. Tap a photo and choose **Make main** if the cover shot should change.
4. A review is optional. The name must look like `Mike L.` — first name and last initial. No surnames.
5. A Google Business post link is optional. It must start with `https://`.
6. A video plays on the review screen. **Remove video** takes it off the job.
7. **Approve** saves the website pin and copies the trimmed clip into the public video folder. The pin will not move later.
8. **Reject** asks for a short reason the crew can read.
9. On an approved job, **Save changes** edits the words without moving the pin. **Take off the website** hides it. **Put back on the website** shows it again at the same pin.

## How the website map gets the jobs

The live list is:

`https://YOUR_PROJECT.supabase.co/rest/v1/rpc/public_jobs_feed`

The website must send two headers:

- `apikey`: the anon key
- `Authorization`: `Bearer ` plus the same anon key

The answer is a JSON list, newest approved job first. Each item looks like this:

```json
{
  "id": "unique-id",
  "title": "Seamless Gutters in Murray, KY",
  "service": "Seamless Gutters",
  "town": "Murray",
  "state": "KY",
  "lat": 36.61,
  "lng": -88.31,
  "date": "2026-11-05",
  "summary": "one line, no backslashes",
  "photos": ["https://YOUR_PROJECT.supabase.co/storage/v1/object/public/job-photos/seamless-gutters-murray-2026-11-05-1.webp"],
  "review": null,
  "gbpUrl": null,
  "videos": ["https://YOUR_PROJECT.supabase.co/storage/v1/object/public/job-videos/seamless-gutters-murray-2026-11-05-video-1.mp4"]
}
```

When there is a review, `review` is `{ "name": "Mike L.", "stars": 5, "text": "Clean work and on time.", "date": "2026-11-05" }`.

`lat` and `lng` are the shifted pin. The list has no street address, no exact pin, and no crew name. `videos` is an extra list. Older maps can ignore it. Jobs with no clip send `"videos": []`.

Each clip is cut to 30 seconds on the phone and squeezed to about 720p, aiming for roughly 10 MB and never over 20 MB. The free plan allows 1 GB of files total and 50 MB per file. A phone that cannot trim shows a message and does not upload the raw recording. iPhone Safari and Android Chrome use the browser's own recorder. The clip is an mp4 when the phone can make one, and webm when that is the format the phone records.

Photo files are named `service-town-YYYY-MM-DD-N.webp`, for example `seamless-gutters-murray-2026-11-05-1.webp`. `N` starts at 1. The main photo is number 1. If that file name is already taken, four extra letters are added before `.webp`.

There is also a table view at `/rest/v1/approved_jobs`. The feed above is the one that is already sorted newest first.

**Export jobs.txt + photos** downloads a zip. `jobs.txt` is that same JSON list. The `photos` folder has the image files and the `videos` folder has the clips. You can hand that zip to whoever updates the current website if it still reads a file instead of the live feed. The backup file includes the videos too. Keep the backup private.

## Backups and old jobs

The free Supabase plan does not keep its own backups.

- **Download backup** saves a JSON file. It includes exact locations. Keep it private. Do not email it to a customer and do not put it on the website.
- **Import jobs** accepts either that backup, or a JSON file in the website format above (the same shape as `samples/sample-jobs.json`). Pins in an imported website file stay where they already are. They are not shifted again. Jobs that were typed in by the crew are shifted only when someone approves them. Existing ids are skipped.

## Add a service or a town

1. On GitHub, open `src/lists.js`.
2. Copy one line in `SERVICES` or `TOWNS` and change the name. Towns need a two-letter state, usually `KY` or `TN`.
3. Commit to `main`. The site rebuilds with the new list.

## How to test it yourself

Use two browsers, or a private window for the second person.

1. Sign in as a crew member. Post a job with a photo, a town, and your location. It should land on **My posts** as Pending.
2. Sign in as a different crew member. That person's **My posts** should not show the first job.
3. Sign in as Haley or Kent. **Review** should show the job, the address, and the copper dot on the real spot.
4. Approve it. Open the public feed URL from the section above. The pin in the JSON should not match the exact dot you saw, and the file should not contain the street address or the crew member's name.
5. Reject a second job with a reason. The crew member should see that reason.
6. On a computer, use **Download backup**, then **Export jobs.txt + photos**.

Before any of that, you can open the site and tap **Preview the screens**. That tour uses sample houses and saves nothing. It disappears after the Supabase keys are in `src/config.js`.

## What the automatic checks cover

`npm test` runs in the GitHub Pages build, and it was run here before this app was opened as a pull request.

- Crew member A cannot read crew member B's jobs.
- A crew member cannot read the exact-location table, including their own row, after it is saved.
- An approver can read the exact latitude, longitude, and address.
- The public anon key cannot read the jobs table or the location table.
- A crew member cannot approve a job, and cannot change their own role to admin even if the database is later given a too-wide update permission.
- Approving a job stores a new pin 150–250 meters from the house. Editing the words afterward does not move it. Taking it off the website and putting it back does not move it.
- The public feed is newest first and uses the key order above. A checked sample feed did not contain the exact coordinate, the street address, or the poster's id.
- Importing a website JSON file stores the pin from the file and does not create an exact-location row, even if the file also contains an address.
- A turned-off login cannot post.
- Private photos can be uploaded only into the signed-in person's own folder. Only an approver can put a file in the public photo folder. The public anon key can read the public folder and cannot read the private folder.
- Summaries with a phone number, email, or link are rejected. The phone screen warns on a house number or a full name.
- Photo names follow `service-town-YYYY-MM-DD-N.webp`.
- The zip export contains `jobs.txt` plus a `photos` folder.

## Address search and the map

Address search uses the public OpenStreetMap Nominatim service. It does not need a key. The app calls it only when someone taps **Use my location** or **Find address**, waits at least one second between calls, and remembers recent answers on the phone. It does not search on every keystroke. The screen credits OpenStreetMap contributors.

If OpenStreetMap asks you to stop using their shared server, change the two `GEOCODER_` lines in `src/config.js` and commit. The map tiles are also from OpenStreetMap, with the usual credit on the map, and the app only loads them on the private review screen.

## If something goes wrong

- **"This login is turned off."** Kent has not run step 6, or an admin turned the login off. Crew members should call Kent.
- **"Add person" fails.** Create the user in Supabase Authentication, then set the role on the Crew screen. Supabase sometimes changes the internal login tables; the Crew screen still works after a dashboard user exists.
- **The home screen icon opens a blank page.** The Pages address must include `/heartland-crew-app/`. In **Settings → Pages**, the source must be **GitHub Actions**, not "Deploy from a branch".
- **Photos fail on an older phone.** WebP saving needs a current Safari (iOS 16 or newer) or Chrome.
- **Location is blocked.** On iPhone, Settings → Privacy & Security → Location Services. Allow it for the home-screen app, or for Safari if you have not installed the icon yet.
- **The public feed is empty.** Only approved jobs are in it. Pending and rejected jobs stay private.
- **The site build failed.** Open the Actions tab and read the red log. A failed test blocks the deploy on purpose.

## For a developer

```bash
npm install
npm test
npm run dev
npm run build
```

`npm run dev` serves the app at the site root. The GitHub Action builds with `PAGES_BASE=/<repo-name>/` so the project site on GitHub Pages works. Config lives only in `src/config.js`. Database changes live only in `supabase/migrations`.
