import CryptoKit
import Foundation
import Security

enum MacControllerIdentityError: LocalizedError {
  case keychainReadFailed(OSStatus)
  case keychainWriteFailed(OSStatus)
  case invalidStoredKey

  var errorDescription: String? {
    switch self {
    case .keychainReadFailed:
      return "ClawDad could not read the Mac controller identity from Keychain."
    case .keychainWriteFailed:
      return "ClawDad could not protect the Mac controller identity in Keychain."
    case .invalidStoredKey:
      return "The saved Mac controller identity is damaged."
    }
  }
}

final class MacControllerIdentity {
  static let shared = MacControllerIdentity()

  private let service = "earth.frg.ClawDad.mac-controller"
  private let privateKeyAccount = "device-p256-private-key"
  private let deviceIdAccount = "device-id"

  private init() {}

  func deviceId() throws -> String {
    if let existing = try readString(account: deviceIdAccount), !existing.isEmpty {
      return existing
    }
    let generated = "mac-controller-\(UUID().uuidString.lowercased())"
    try saveString(generated, account: deviceIdAccount)
    return generated
  }

  func publicKeyId() throws -> String {
    let digest = SHA256.hash(data: try publicKeySPKIDER())
    return Data(digest).base64UrlEncodedString().prefix(32).description
  }

  func publicKeyExport() throws -> String {
    let body = try publicKeySPKIDER().base64EncodedString()
      .chunkedForPEM(every: 64)
      .joined(separator: "\n")
    return "-----BEGIN PUBLIC KEY-----\n\(body)\n-----END PUBLIC KEY-----\n"
  }

  func sign(_ data: Data) throws -> RemoteCloudSignature {
    let signature = try signingKey().signature(for: data)
    return RemoteCloudSignature(
      alg: "ES256",
      keyId: try publicKeyId(),
      value: signature.derRepresentation.base64UrlEncodedString()
    )
  }

  func relayAccessToken(for profile: MacPairedComputerProfile) throws -> String {
    try readString(account: relayAccessAccount(for: profile)) ?? ""
  }

  func saveRelayAccessToken(
    _ token: String,
    for profile: MacPairedComputerProfile
  ) throws {
    let normalized = token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else {
      return
    }
    try saveString(normalized, account: relayAccessAccount(for: profile))
  }

  func deleteRelayAccessToken(for profile: MacPairedComputerProfile) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: relayAccessAccount(for: profile)
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw MacControllerIdentityError.keychainWriteFailed(status)
    }
  }

  private func relayAccessAccount(for profile: MacPairedComputerProfile) -> String {
    let scope = "\(profile.accountId)\n\(profile.workspaceId)\n\(profile.hostId)"
    let digest = SHA256.hash(data: Data(scope.utf8))
    return "relay-access-\(Data(digest).base64UrlEncodedString())"
  }

  private func publicKeySPKIDER() throws -> Data {
    let spkiHeader = Data([
      0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86,
      0x48, 0xCE, 0x3D, 0x02, 0x01, 0x06, 0x08, 0x2A,
      0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03,
      0x42, 0x00
    ])
    return spkiHeader + (try signingKey()).publicKey.x963Representation
  }

  private func signingKey() throws -> P256.Signing.PrivateKey {
    if let data = try readData(account: privateKeyAccount) {
      guard let key = try? P256.Signing.PrivateKey(rawRepresentation: data) else {
        throw MacControllerIdentityError.invalidStoredKey
      }
      return key
    }
    let key = P256.Signing.PrivateKey()
    try saveData(key.rawRepresentation, account: privateKeyAccount)
    return key
  }

  private func readString(account: String) throws -> String? {
    guard let data = try readData(account: account) else {
      return nil
    }
    return String(data: data, encoding: .utf8)
  }

  private func saveString(_ value: String, account: String) throws {
    try saveData(Data(value.utf8), account: account)
  }

  private func readData(account: String) throws -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound {
      return nil
    }
    guard status == errSecSuccess else {
      throw MacControllerIdentityError.keychainReadFailed(status)
    }
    return result as? Data
  }

  private func saveData(_ data: Data, account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account
    ]
    SecItemDelete(query as CFDictionary)
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw MacControllerIdentityError.keychainWriteFailed(status)
    }
  }
}

private extension String {
  func chunkedForPEM(every size: Int) -> [String] {
    guard size > 0 else {
      return [self]
    }
    var result: [String] = []
    var index = startIndex
    while index < endIndex {
      let next = self.index(index, offsetBy: size, limitedBy: endIndex) ?? endIndex
      result.append(String(self[index..<next]))
      index = next
    }
    return result
  }
}
