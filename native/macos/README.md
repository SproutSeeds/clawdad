# ClawDad macOS Shell

This is the native macOS shell for ClawDad.

Run it from the repo with:

```sh
swift run --package-path native/macos ClawDad
```

The shell:

- starts or connects to a loopback `clawdad serve` process
- loads the existing web UI in `WKWebView`
- authenticates with a Keychain-backed local token
- exposes native folder selection through `window.ClawDadNative.chooseFolder`
- embeds the current ClawDad server, UI, production Node dependencies, and
  required visual assets when built with `build-app.sh`
- stages that signed, versioned runtime in ClawDad's Application Support
  directory before launching Node

Packaged apps run from their bundled runtime. Set
`CLAWDAD_ROOT=/path/to/clawdad` only when intentionally running against a
development checkout.
