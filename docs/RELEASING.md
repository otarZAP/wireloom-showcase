# Releasing Wireloom

## Cut a release

```sh
npm run test:all                 # everything green locally first
npm version patch                # or minor / major: bumps package.json, commits, tags vX.Y.Z
git push --follow-tags
```

The **Release** workflow (`.github/workflows/release.yml`) runs on the tag. It re-runs every test,
checks the tag matches `package.json`, builds `Wireloom-Setup-X.Y.Z.exe` with electron-builder, and
publishes a GitHub Release with three files:

| File | What it's for |
|---|---|
| `Wireloom-Setup-X.Y.Z.exe` | the installer people download |
| `latest.yml` | the update feed installed copies read |
| `Wireloom-Setup-X.Y.Z.exe.blockmap` | lets updates download only the changed blocks |

Add a `## X.Y.Z (date)` section to `CHANGELOG.md` before tagging — the workflow uses it as the release
notes (plus the install instructions in `.github/release-footer.md`) and fails if it's missing.

electron-builder only builds; the GitHub CLI publishes. electron-builder's own uploader raced itself
creating the release on v0.1.0's first run and dropped the installer while still exiting successfully.

## How auto-update works

An installed Wireloom (NSIS build) runs `electron-updater` four seconds after it starts. It reads
`latest.yml` from the newest GitHub Release, and if the version is higher it downloads the installer in
the background. The status bar shows the progress and then *"Update vX ready — click to restart"*; if
you don't click, it installs the next time you quit. *Help → Check for updates…* does it on demand.

**The release files must be publicly downloadable** for this to work — installed copies can't log in
to GitHub. This public repo is the release host (`build.publish` in `package.json` points here), so every
release published here is the update feed. If the host were ever private, installed copies would report
*"Update check unavailable"* in the status bar — harmless; new versions would just be installed by hand.

## Code signing (the SmartScreen warning)

Unsigned installers trigger *"Windows protected your PC — unknown publisher"*. Options, cheapest first:

- **SignPath Foundation** — free signing for open-source projects (needs a public repo and an
  application).
- **Azure Trusted Signing** — about US$10/month; available to individual developers in the US and
  Canada. electron-builder supports it via `win.azureSignOptions`.
- **An OV code-signing certificate** — from roughly US$200/year. Set `CSC_LINK` / `CSC_KEY_PASSWORD`
  as workflow secrets and electron-builder signs automatically.

Signing doesn't change how updates work; it only removes the warning (fully, once the certificate
builds SmartScreen reputation).

## Build locally

```sh
npm run dist        # -> release/Wireloom-Setup-X.Y.Z.exe and release/win-unpacked/
release/win-unpacked/Wireloom.exe --smoke-test     # boots hidden, self-checks, exits 0
```

Run the smoke test from a normal terminal, or prefix it with `env -u ELECTRON_RUN_AS_NODE` inside VS Code.

## Test an update end to end

1. Install version N from its release.
2. Bump to N+1, tag, push; wait for the release to publish.
3. Start the installed version N — the status bar should show the download, then *"Update ready"*.
