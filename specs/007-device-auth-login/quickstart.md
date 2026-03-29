# Quickstart: Device Authorization Login

## New User Flow

```bash
# 1. Install Valis CLI
npm install -g valis

# 2. Initialize in your project
cd ~/my-project
valis init
# → Choose: "Create new account"
# → Enter: name, email, project name
# → Done! API key saved locally.

# 3. On another machine — log in
valis login
# → Browser opens: https://valis.krukit.co/auth/device?code=ABCD-1234
# → If not logged into dashboard: enter email → get magic link → click it
# → Click "Approve" on dashboard
# → CLI: ✓ Logged in as Dmytro (krukit)
```

## Existing User — New Device

```bash
# Already have a Valis account. New laptop, no credentials.
valis login
# → Browser opens automatically
# → Already logged into dashboard? Just click "Approve"
# → Not logged in? Enter email → magic link → approve
# → Done!
```

## Headless / SSH

```bash
valis login
# Can't open browser? Copy the URL:
#   https://valis.krukit.co/auth/device?code=ABCD-1234
# Open on your phone or another computer, approve there.
```

## Fallback: API Key Login

```bash
# If you have your API key (tmm_...)
valis login --api-key
# → Enter API key manually
```

## Verification

```bash
valis whoami
# → Dmytro (krukit) — admin

valis status
# → Cloud: OK (hosted mode)
```
