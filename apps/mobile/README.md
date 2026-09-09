# apps/mobile

React Native (Expo Router) thin client — login/signup, dashboard, invoices (list/detail/create/send/mark-paid/share), clients (list/create), plan view (read-only, no in-app purchase). Auth tokens via `expo-secure-store`, never AsyncStorage (see `src/lib/secure-storage.ts`).

**Expo SDK 57** · React Native 0.86.3 · React 19.2.3.

## Running

```bash
pnpm --filter @invoice-saas/mobile start        # Metro on :8081
pnpm --filter @invoice-saas/mobile start --ios  # boots an iOS simulator and opens the app
```

Needs `apps/api` running. Defaults to `http://localhost:4000/api/v1`; set `EXPO_PUBLIC_API_BASE_URL` to point elsewhere (a physical device needs your machine's LAN IP, not `localhost`).

To open on a simulator that's already booted:

```bash
xcrun simctl openurl booted "exp://127.0.0.1:8081"
```

## Verification status

**Verified running on an iOS simulator (iPhone 15 Pro):** the app boots, the login screen renders, and Metro reports no runtime errors. `tsc --noEmit` is clean.

Not yet verified: the authenticated flows past login (dashboard, invoice list/detail/create, clients) have not been exercised on a device — they're implemented against the same API contract the web app uses successfully, but nobody has tapped through them. Android has not been run at all.

## History worth knowing

This app was previously unrunnable, and the cause was misdiagnosed twice before it was found:

1. It was first assumed to be an `expo-router`/`react-native-web` tooling bug, because the failure was only ever observed on the web target. **That was wrong** — it reproduced identically on a native iOS simulator.
2. The real cause was **two copies of React in one tree**: on Expo SDK 52, `expo-router` resolved React 19.2.8 while React Native resolved 18.3.1. Elements created by one React aren't recognised by the other, which surfaced as `Objects are not valid as a React child (found: object with keys {$$typeof, type, key, props, ...})` thrown from inside expo-router's own `ErrorOverlay` — the overlay crashed while trying to render the underlying error, hiding it.

Fixed by upgrading SDK 52 → 57 (React Native 0.76 couldn't run React 19 at all; React 19 support starts at RN 0.79) and pinning `react`/`react-dom` to a single version workspace-wide in the root `package.json` `pnpm.overrides`, so web, admin and mobile all share one copy. **Don't let mobile's React drift from web/admin's** — a version split is what caused this, and it fails in a way that hides its own cause.

That same alignment also removed the long-standing `@types/react` `tsc` errors, which were a symptom of the same version split rather than a separate cosmetic issue.

## Testing

```bash
pnpm --filter @invoice-saas/mobile test        # vitest; no component tests written yet
pnpm --filter @invoice-saas/mobile typecheck
pnpm --filter @invoice-saas/mobile lint
```
