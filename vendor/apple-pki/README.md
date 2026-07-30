# Apple Root Certificates

These DER certificates are the trust anchors used by Apple's official App Store
Server Library to verify StoreKit signed transaction JWS payloads.

Sources:

- `https://www.apple.com/appleca/AppleIncRootCertificate.cer`
- `https://www.apple.com/certificateauthority/AppleRootCA-G2.cer`
- `https://www.apple.com/certificateauthority/AppleRootCA-G3.cer`

SHA-256:

```text
b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024  AppleIncRootCertificate.cer
c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050  AppleRootCA-G2.cer
63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179  AppleRootCA-G3.cer
```
