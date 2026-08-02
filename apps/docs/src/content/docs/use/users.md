---
title: Users & Roles
description: First-run onboarding, admin vs viewer roles, and account management.
---

SunReye uses email/password authentication (Better-Auth) with two roles — **admin** and
regular **user** — and a first-run onboarding flow. Registration is otherwise **invite-only**:
new accounts are created by an admin, not self-service.

## First-run onboarding

On a fresh install with no accounts, visiting the app takes you to **onboarding** to
"Create the administrator." The first account becomes an **admin**, after which registration
closes and further users are added from [Settings → Users](/use/settings/#users).

The server tracks this via a setup-status check, so `/login` redirects to `/onboarding` until
the first account exists, and back to `/login` afterwards.

## Signing in

The **login** page is a standard email/password form. In development, a "Continue as
developer" shortcut signs you in as a spoofed admin so you can work without creating an
account.

## Roles

| Capability | Admin | User |
| --- | --- | --- |
| View dashboard, history, statistics | ✅ | ✅ |
| [Controls](/use/controls/) (write settings) | ✅ | — |
| [Settings](/use/settings/) (all tabs) | ✅ | — |
| Manage users & profiles | ✅ | — |

Non-admins don't see the Controls or Settings nav entries, and hitting those URLs directly
redirects them home.

:::caution[Server-authoritative]
Role gating in the UI is a convenience. Every mutation — settings writes, control commands,
user management — is enforced on the server regardless of what the client shows.
:::

## Managing users

From [Settings → Users](/use/settings/#users) an admin can add users (name, email, password,
role) and edit or remove them, including changing a user's role inline.
