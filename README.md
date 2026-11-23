# Gymnos

[![CI](https://github.com/kayas881/gym-app/actions/workflows/ci.yml/badge.svg)](https://github.com/kayas881/gym-app/actions/workflows/ci.yml)

**Site:** [gymnos.tech](https://gymnos.tech)  
**Demo:** [YouTube short](https://www.youtube.com/shorts/v1MzwtwfV60)

Gymnos is a gym-ops app for a small Indian gym that was running memberships off handwritten receipts. The owner needed to know who was a member, when they expired, and who still owed fees. Members needed a place to check their own status, pay, get announcements, and raise complaints — without a Play Store listing in the way.

Android builds go out as an APK from the site / GitHub Releases.

## Voice workout logging

Speak a set. Confirm it. Gymnos saves it once.

A member on the floor taps the mic and says something like:

> “Bench press, eighty kilos, eight reps, two RIR.”

Meta Voice transcribes the clip. Meta Spark pulls out exercise, weight, reps, and RIR. A confirm card is the only write — Discard leaves the database untouched. Rest timer, personal records, and next-session suggestions then run on those saved rows.

```mermaid
flowchart LR
  subgraph phone [On the phone]
    A[Tap the mic] --> B[16 kHz PCM → WAV]
    B --> C{Rest command?}
    C -->|yes| D[Rest timer only]
    C -->|no| E[Clerk session JWT]
  end

  subgraph edge [Supabase Edge — key stays here]
    E --> F["Meta Voice<br/>transcribe"]
    F --> G["Meta Spark<br/>extract set"]
  end

  subgraph save [Only after Confirm]
    G --> H[Confirm card]
    H -->|Discard| I[Nothing written]
    H -->|Confirm| J[Local set + client_id]
    J --> K[(workout_sessions / workout_sets)]
  end
```

1. **Speak.** The phone records 16 kHz audio and turns it into a WAV on device. Short clips never leave the phone.
2. **Understand.** Meta Voice transcribes. Gymnos then extracts exercise, weight, reps, and RIR. Rest commands (“skip rest”, “add 30 seconds”) stay on the timer.
3. **Confirm.** A card shows the draft. Discard writes nothing. Confirm keeps the set on the phone first, even if gym wifi drops.
4. **Save once.** One session per IST day. Each set has a unique `client_id`, so a retry cannot create a duplicate.

![gymnos.tech — product page and APK download](docs/screenshots/landing.png)

## Who uses it

| Role | What they do |
| --- | --- |
| Owner | Members, plans, dues, QR desk, announcements, receipts |
| Staff | Check-in, invites, announcements, staff chat |
| Member | Status, payments, attendance, complaints, workouts |

Owner-created members can exist before they ever install the app. A claim code attaches a later login to that record.

## What’s in the product

- Memberships, plans, part-payments, outstanding dues
- Cash / UPI payment log and printable receipts
- QR check-in and a live front-desk attendance count
- Announcements aimed at morning or evening batches (so a night blast doesn’t wake the 6am crowd)
- Complaints, staff chat, push notifications
- Voice workout logging, rest timer, PRs, and next-session suggestions
- IST dates end-to-end (`utils/date.ts`)

<p>
  <img src="docs/screenshots/members.png" alt="Member roster" width="49%" />
  <img src="docs/screenshots/payments.png" alt="Payments and receipts" width="49%" />
</p>
<p>
  <img src="docs/screenshots/attendance.png" alt="QR check-in" width="49%" />
  <img src="docs/screenshots/announcements.png" alt="Time-slot announcements" width="49%" />
</p>

## Stack

Expo SDK 57 · React Native · Expo Router · TypeScript  
Clerk for identity (third-party into Supabase)  
Supabase (Postgres, RLS, Storage, Edge Functions)  
EAS + GitHub Releases for the APK

Landing site is a separate repo: [kayas881/Gymnos-Landing-page](https://github.com/kayas881/Gymnos-Landing-page).

## Repo layout

```
app/(owner)    owner screens
app/(staff)    staff screens
app/(member)   member screens
app/(auth)     sign-in / gym setup
components/
hooks/
lib/           Clerk + Supabase clients
supabase/      migrations and Edge Functions
```

## Run locally

You need Node, Expo, a Clerk app, and a Supabase project. Copy whatever env files this repo already uses locally — do not commit secrets.

```bash
npm install
npx expo start
```

Then `npm run android` for a device/emulator, or scan the QR from Expo Go / a dev client.

## License

See [LICENSE](LICENSE).
