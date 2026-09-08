# Gym App — agent briefing

A React Native / Expo gym management app for a single real gym in India. Three
roles — owner, staff, member — in expo-router route groups `(auth)`, `(owner)`,
`(staff)`, `(member)`.

## Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before
writing any code. SDK 57, React Native 0.86.3. APIs you remember from older SDKs
are frequently wrong.

## The one thing that will burn you: failures here are silent

Almost every serious bug in this project has been invisible in the UI. A DELETE
blocked by RLS **returns success with 0 rows**. A missing SELECT policy returns
an empty list, not an error. A trigger that never fired looks exactly like a
feature that works.

**Verify against the live database, not the screen.** Run the real query, and
simulate the caller's role rather than querying as admin:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_...","role":"authenticated"}';
-- your query here
rollback;
```

## Auth: Clerk third-party auth into Supabase

Clerk is the identity provider, wired into Supabase as a **third-party auth
provider** — not via JWT templates.

- **`auth.uid()` is always NULL.** Never write a policy that uses it.
- RLS uses `public.get_clerk_id()` (reads the `sub` claim) and
  `public.get_current_profile_id()`.
- `profiles.clerk_id` is **nullable** — see managed members below. Because
  `get_current_profile_id()` is `WHERE clerk_id = get_clerk_id()` and `NULL` never
  equals `NULL`, a member with no login can never be impersonated. Do not "fix"
  that column by making it NOT NULL.
- `profile_id` is the real key everywhere. `clerk_id` only answers "does this
  person have an app login".

## Dates: the app is IST, the server is UTC

Three separate production bugs came from this. Rules:

- Use `utils/date.ts` — `today()`, `localDateOf()`, `localDayRange()`. **Never
  `new Date().toISOString().split('T')[0]`** for a local day; it silently reads
  the UTC date and is wrong for 5.5 hours every day in IST.
- In SQL use `(now() AT TIME ZONE 'Asia/Kolkata')::date`, not `CURRENT_DATE`.
- Dates display day-first (`DD/MM/YYYY`) throughout. `toIndianDate()` /
  `parseIndianDate()` convert; storage stays ISO `YYYY-MM-DD` because ordering is
  compared as strings.
- Day counts must not be memoized without `hooks/useToday.ts`, or a screen left
  open overnight shows a frozen number. `useToday()` is a hook — call it
  unconditionally, above any early `return`.

## Subscriptions: a member can hold TWO active at once

Someone who renews early has an active plan and an upcoming one. Therefore:

- **`status = 'active'` does not mean "in effect today".**
- Access ends at **`coverageEndDate`** (the later end date), never
  `activeSubscription.end_date`. Reading the current row once showed a member
  "90 Days Left" when he was paid up for another six months.
- One member can owe money on more than one subscription; count distinct members
  by `gymMemberId`, not by row.

## Members who never download the app

The gym owner's members mostly will not install anything. A member is a **record
the owner creates**; an app login is an optional upgrade attached later.

- `create_managed_member()` / `update_managed_member()` (migration 037) create a
  profile with `clerk_id NULL`. A photo taken at the desk is the identity for
  these members — the member is saved **first**, photo attached after, because
  gym wifi drops and losing a paying member beats losing a picture.
- **Claim codes** (migration 038) link a later app login to an existing record:
  `generate_member_claim_code()`, `revoke_member_claim_code()`,
  `claim_member_record()`. Claiming adopts the existing record and repoints
  `push_tokens` before deleting the duplicate profile — `push_tokens.profile_id`
  is `ON DELETE CASCADE`, so a naive adoption silently kills push.
- `claim_member_record()` returns **JSONB** (`ok` / `reason` / `message`) rather
  than raising. PL/pgSQL rolls back everything on `RAISE`, so rate-limit rows
  written before an exception vanish — the rate limiting was decorative until
  this changed.
- Managed members cannot scan the check-in QR, so attendance screens must say
  "not tracked" rather than showing a misleading zero.
- **Decided: no staff-side check-in, ever.** The owner keeps no register today.

## Part payments

Members routinely pay ₹300 of a ₹500 plan. `subscriptions.plan_price` is
**snapshotted at the sale** so editing a plan's price later cannot rewrite an old
debt; `subscription_payments` is a ledger and a trigger keeps `amount_paid` as its
total. Balance is `plan_price - amount_paid`. A NULL `plan_price` means the
expected amount was never recorded — exclude those rather than reporting a debt
of the full amount.

## Realtime does not appear to deliver

Supabase `postgres_changes` subscriptions seem never to reach this client. Every
"live" feature works because of an **explicit refetch** (on focus, after a
mutation, pull to refresh). Do not assume a realtime subscription is doing
anything; add the refetch.

## Migrations

Numbered files in `supabase/migrations/` (001–038), applied to the hosted
project. **`supabase db push` cannot rebuild from zero** — migration tracking
starts at file 005 and 001–004 are untracked. This matters before provisioning a
second gym, which is a real near-term plan.

## Running it

The user runs **Metro against an Android emulator (MuMu)**, loading a
`development`-profile EAS build (`developmentClient: true`):

```
npx expo start --dev-client
```

There is also a `preview`-profile APK — standalone, bundle embedded, which
**deliberately ignores Metro**. Do not confuse them. JS-only changes need no new
build; rebuild only when native deps change. Check build status with
`npx eas-cli build:list` — `build:view --json` does not parse and reports
"unknown".

**A local Gradle build is impossible on this machine**: no Android SDK, and only
JDK 23 while AGP needs 17. Do not suggest `./gradlew`.

Package and bundle id are both `com.kayas.mygymapp`.

## Repo conventions and traps

- **Line endings are mixed.** LF and CRLF files coexist, which silently breaks
  multi-line scripted edits. Normalize, replace, then restore the file's dominant
  ending — or use a real editing tool instead of `sed`.
- **Recurring failure mode: "the screen exists but nothing links to it."** This
  has happened six or seven times. After building a screen, grep for something
  that navigates to it. Routes hidden from tab bars use `href: null`, so a
  conditional banner may be the *only* way in.
- Comments here explain **why**, especially the non-obvious constraint or the bug
  that motivated the code. Match that; do not strip it.
- **Do not push or merge without being asked.** The user drives that.
