#if canImport(DeviceCheck)
import DeviceCheck
import Foundation

enum AppAttestClientError: Error {
  case unsupported
  case missingKeyIdentifier
  case missingAssertion
}

@MainActor
final class AppAttestClient {
  static let shared = AppAttestClient()

  private init() {}

  func generateKey() async throws -> String {
    guard DCAppAttestService.shared.isSupported else {
      throw AppAttestClientError.unsupported
    }

    return try await withCheckedThrowingContinuation { continuation in
      DCAppAttestService.shared.generateKey { keyIdentifier, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let keyIdentifier else {
          continuation.resume(throwing: AppAttestClientError.missingKeyIdentifier)
          return
        }
        continuation.resume(returning: keyIdentifier)
      }
    }
  }

  func attestKey(keyIdentifier: String, clientHash: Data) async throws -> Data {
    guard DCAppAttestService.shared.isSupported else {
      throw AppAttestClientError.unsupported
    }

    return try await withCheckedThrowingContinuation { continuation in
      DCAppAttestService.shared.attestKey(keyIdentifier, clientDataHash: clientHash) { attestation, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        continuation.resume(returning: attestation ?? Data())
      }
    }
  }

  func assertion(keyIdentifier: String, clientHash: Data) async throws -> Data {
    guard DCAppAttestService.shared.isSupported else {
      throw AppAttestClientError.unsupported
    }

    return try await withCheckedThrowingContinuation { continuation in
      DCAppAttestService.shared.generateAssertion(keyIdentifier, clientDataHash: clientHash) { assertion, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let assertion else {
          continuation.resume(throwing: AppAttestClientError.missingAssertion)
          return
        }
        continuation.resume(returning: assertion)
      }
    }
  }
}
#endif
