# Pinned WebRTC Package

ClawDad uses the prebuilt `stasel/WebRTC` XCFramework release `150.0.0`.

Run `bin/fetch-webrtc-dependency` to download the framework. The script verifies
the archive before extraction with SHA-256:

```text
f9890492b0016e4c88ab20f07867b8b420054caedc8a692b2ec6ac041f3cf6b2
```

The downloaded framework is intentionally ignored by Git. Its upstream license
is included inside the XCFramework as `LICENSE`.
