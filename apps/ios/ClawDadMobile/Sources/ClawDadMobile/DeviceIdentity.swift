import CryptoKit
import Foundation
import Security

enum DeviceIdentityError: Error {
  case keychainReadFailed(OSStatus)
  case keychainWriteFailed(OSStatus)
  case invalidStoredKey
}

@MainActor
final class DeviceIdentity {
  static let shared = DeviceIdentity()

  private let service = "earth.frg.ClawDad.mobile"
  private let privateKeyAccount = "device-p256-private-key"
  private let deviceIdAccount = "device-id"

  private init() {}

  func deviceId() throws -> String {
    if let existing = try readString(account: deviceIdAccount), !existing.isEmpty {
      return existing
    }
    let generated = "ios-\(UUID().uuidString.lowercased())"
    try saveString(generated, account: deviceIdAccount)
    return generated
  }

  func publicKeyId() throws -> String {
    let digest = SHA256.hash(data: try publicKeySPKIDER())
    return Data(digest).base64UrlEncodedString().prefix(32).description
  }

  func sign(_ data: Data) throws -> CloudSignature {
    let privateKey = try signingKey()
    let signature = try privateKey.signature(for: data)
    return CloudSignature(
      alg: "ES256",
      keyId: try publicKeyId(),
      value: signature.derRepresentation.base64UrlEncodedString()
    )
  }

  func publicKeyExport() throws -> String {
    try publicKeyPEM()
  }

  func pairingJsonSnippet() throws -> String {
    let deviceId = try deviceId()
    let publicKey = try publicKeyPEM()
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\n", with: "\\n")
      .replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(deviceId)\": \"\(publicKey)\""
  }

  private func publicKeyPEM() throws -> String {
    let der = try publicKeySPKIDER()
    let body = der.base64EncodedString()
      .chunked(every: 64)
      .joined(separator: "\n")
    return "-----BEGIN PUBLIC KEY-----\n\(body)\n-----END PUBLIC KEY-----\n"
  }

  private func publicKeySPKIDER() throws -> Data {
    let privateKey = try signingKey()
    let spkiHeader = Data([
      0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86,
      0x48, 0xCE, 0x3D, 0x02, 0x01, 0x06, 0x08, 0x2A,
      0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03,
      0x42, 0x00,
    ])
    return spkiHeader + privateKey.publicKey.x963Representation
  }

  private func signingKey() throws -> P256.Signing.PrivateKey {
    if let data = try readData(account: privateKeyAccount) {
      guard let key = try? P256.Signing.PrivateKey(rawRepresentation: data) else {
        throw DeviceIdentityError.invalidStoredKey
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
      throw DeviceIdentityError.keychainReadFailed(status)
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
      throw DeviceIdentityError.keychainWriteFailed(status)
    }
  }
}

extension Data {
  func base64UrlEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

extension String {
  func chunked(every size: Int) -> [String] {
    guard size > 0 else {
      return [self]
    }
    var chunks: [String] = []
    var index = startIndex
    while index < endIndex {
      let next = self.index(index, offsetBy: size, limitedBy: endIndex) ?? endIndex
      chunks.append(String(self[index..<next]))
      index = next
    }
    return chunks
  }
}
