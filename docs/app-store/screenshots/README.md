# ClawDad App Store Screenshots

The iPhone screenshots in `iphone-6.9/` are captured from the production
SwiftUI surfaces with a DEBUG-only, in-memory preview fixture. The fixture uses
synthetic project paths and conversations, performs no pairing or network
requests, and is unavailable in Release and TestFlight builds.

Regenerate the 6.9-inch set from the repository root:

```sh
zsh ./bin/clawdad-app-store-screenshots
```

The script builds the Debug simulator target, installs it on the dedicated
`ClawDad App Store 6.9` simulator, fixes the status bar at 9:41, captures each
scenario, and rejects output that is not exactly `1290x2796`.

Before upload, visually inspect every generated PNG for:

- complete, readable labels with no clipping or overlap;
- representative ClawDad UI and truthful synthetic content;
- absence of credentials, real project paths, customer data, and debug chrome;
- consistent status-bar state and current ClawDad branding.
