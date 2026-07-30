#if canImport(AuthenticationServices)
import AuthenticationServices
import Foundation

struct PasskeyRequests {
  let relyingPartyIdentifier: String

  func registration(challenge: Data, userId: Data, username: String) -> ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest {
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingPartyIdentifier)
    return provider.createCredentialRegistrationRequest(
      challenge: challenge,
      name: username,
      userID: userId
    )
  }

  func assertion(challenge: Data) -> ASAuthorizationPlatformPublicKeyCredentialAssertionRequest {
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingPartyIdentifier)
    return provider.createCredentialAssertionRequest(challenge: challenge)
  }
}
#endif
