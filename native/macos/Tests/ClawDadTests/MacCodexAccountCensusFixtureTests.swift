import Foundation
import XCTest
import Darwin
@testable import ClawDad

final class MacCodexAccountCensusFixtureTests:XCTestCase {
  func testPrivateReadOnlyCensusBridgeWhenAuthorized() throws {
    guard let root=ProcessInfo.processInfo.environment["CLAWDAD_ACCOUNT_CENSUS_FIXTURE"],
      root.hasPrefix("/private/tmp/clawdad-account-census-"),!root.dropFirst("/private/tmp/".count).contains("/")
    else {throw XCTSkip("Explicit private read-only census bridge")}
    let directory=URL(fileURLWithPath:root),attributes=try FileManager.default.attributesOfItem(atPath:root)
    guard let resolved=realpath(root,nil) else {throw NSError(domain:"fixture_directory_unverified",code:1)}
    defer {free(resolved)}
    guard attributes[.type] as? FileAttributeType == .typeDirectory,
      (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700,
      (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
      String(cString:resolved)==root else {throw NSError(domain:"fixture_directory_unverified",code:1)}
    try Data("ready".utf8).write(to:directory.appendingPathComponent("ready"),options:.atomic)
    let deadline=Date().addingTimeInterval(480);var handled:Set<String>=[]
    while Date()<deadline {
      if FileManager.default.fileExists(atPath:root+"/done") {return}
      if let data=try? Data(contentsOf:directory.appendingPathComponent("request.json")),
        let request=try? JSONSerialization.jsonObject(with:data) as? [String:String],let id=request["id"],
        UUID(uuidString:id) != nil,!handled.contains(id) {
        var result:[String:Any]=["id":id]
        do {
          let fields=try MacCodexAccountActivity.allOwners(),encoded=try JSONEncoder().encode(fields)
          result["inventory"]=try JSONSerialization.jsonObject(with:encoded)
        }catch {result["error"]="native_census_temporarily_unavailable"}
        try JSONSerialization.data(withJSONObject:result).write(to:directory.appendingPathComponent("reply.json"),options:.atomic)
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:root+"/reply.json");handled.insert(id)
      }
      Thread.sleep(forTimeInterval:0.05)
    }
    XCTFail("The bounded read-only fixture bridge timed out")
  }
}
