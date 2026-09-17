import Foundation
import XCTest
@testable import ClawDad

final class MacCodexAccountServerOptionsTests:XCTestCase {
  func testDefaultAndManagedServerRoutingPreservesOnlyReviewedFeatureFlags() throws {
    XCTAssertEqual(try MacCodexAccountActivity.serverOptions(["codex","app-server","--listen","unix:///private/s"],managed:false),[])
    XCTAssertEqual(try MacCodexAccountActivity.serverOptions(["codex","-c","cli_auth_credentials_store=\"keyring\"","-c","sqlite_home=\"/canonical home\"","app-server","--listen","unix:///private/s","-c","features.code_mode_host=true"],managed:true),["-c","features.code_mode_host=true"])
  }
  func testUnknownCredentialsProviderAndTransportCannotAuthorizeServerRestart() {
    for arguments in [["codex","app-server","-c","provider_key=secret"],["codex","app-server","--stdio"],
      ["codex","app-server","--listen","ws://remote"],["codex","app-server","--arbitrary"],
      ["codex","app-server","-c","cli_auth_credentials_store=\"keyring\""]] {
      XCTAssertThrowsError(try MacCodexAccountActivity.serverOptions(arguments,managed:false))
    }
  }
}

final class MacCodexAccountActivityTests:XCTestCase {
  private func row(_ pid:String,_ executable:String="/fixture/codex",time:String="00:00:01",uid:UInt32=getuid())->String {
    "\(pid) \(uid) Wed Sep 16 \(time) 2026 \(executable)"
  }
  func testProcessColumnPaddingDoesNotBecomePartOfExecutableOrLifetime() throws {
    let plain=try MacCodexAccountActivity.rows(row("10")),padded=try MacCodexAccountActivity.rows(row("10","    /fixture/codex"))
    XCTAssertEqual(plain,padded);XCTAssertEqual(padded.first?.executable,"/fixture/codex")
  }
  func testAllSupportedOwnersIncludeBackgroundProcessesWithoutReturningArgumentsOrCredentials() throws {
    let table=[row("10"),row("20"),row("30","/fixture/other"),row("40",uid:getuid()+1)].joined(separator:"\n")
    var inspected:[String]=[]
    let result=try MacCodexAccountActivity.inspect(home:"/fixture/profile",run:{_,_ in table},read:{pid in
      inspected.append(pid)
      return .init(arguments:["codex","--private-argument"],codexHome:pid=="10" ? "/fixture/profile":"/elsewhere",home:"/fixture/user",alternateAuthentication:true)
    },now:{Date(timeIntervalSince1970:1234)})
    XCTAssertEqual(inspected,["10","20"]);XCTAssertEqual(result["complete"]?.bool,true)
    XCTAssertEqual(result["owners"]?.array?.count,1);XCTAssertEqual(result["owners"]?.array?.first?.object?["pid"]?.string,"10")
    XCTAssertEqual(result["observedAt"]?.number,1234000)
    XCTAssertFalse(String(describing:result).contains("private-argument"));XCTAssertFalse(String(describing:result).contains("/elsewhere"))
  }
  func testDefaultHomeAndExactAlternateHomesRemainDistinct() throws {
    let result=try MacCodexAccountActivity.inspect(home:"/fixture/user/.codex",run:{_,_ in self.row("10")},read:{_ in
      .init(arguments:["codex"],home:"/fixture/user",alternateAuthentication:false)
    })
    XCTAssertEqual(result["owners"]?.array?.count,1)
  }
  func testUnavailableEnvironmentAndChangedProcessCensusFailClosed() throws {
    XCTAssertThrowsError(try MacCodexAccountActivity.inspect(home:"/fixture/profile",run:{_,_ in self.row("10")},read:{_ in nil})){
      XCTAssertEqual(($0 as? MacCodexInputFailure)?.code,"process_home_unavailable")
    }
    for changed in [row("10",time:"00:00:02"),row("20"),row("10")+"\n"+row("20"),""] {
      var calls=0
      XCTAssertThrowsError(try MacCodexAccountActivity.inspect(home:"/fixture/profile",run:{_,_ in calls += 1;return calls==1 ? self.row("10"):changed},read:{_ in
        .init(arguments:["codex"],codexHome:"/elsewhere",home:"/fixture/user",alternateAuthentication:false)
      })) {XCTAssertEqual(($0 as? MacCodexInputFailure)?.code,"process_inventory_changed")}
    }
  }
  func testKnownRenamedExecutableAndMalformedInventory() throws {
    XCTAssertEqual(try MacCodexAccountActivity.rows(row("10","/fixture/pinned-codex"),knownExecutables:["/fixture/pinned-codex"]).count,1)
    for invalid in ["unreadable",row("10")+"\n"+row("10")] {XCTAssertThrowsError(try MacCodexAccountActivity.rows(invalid))}
    XCTAssertThrowsError(try MacCodexAccountActivity.inspect(home:"relative"))
  }
  func testBareCommandUsesExactRunningExecutableAndPreservesLifetimeDigest() throws {
    let table=row("10","codex"),binary="/fixture/versions/0.154.0/codex"
    let result=try MacCodexAccountActivity.allOwners(run:{_,_ in table},read:{_ in
      .init(arguments:["codex","app-server","--listen","unix://"],home:"/fixture/user",alternateAuthentication:false)
    },executablePath:{pid in XCTAssertEqual(pid,"10");return binary})
    let owner=try XCTUnwrap(result["processes"]?.array?.first?.object)
    XCTAssertEqual(owner["executable"]?.string,binary)
    XCTAssertEqual(owner["processLifetime"]?.string,try MacCodexAccountActivity.rows(table).first?.identity)
    XCTAssertEqual(owner["serverOptions"]?.array,[]);XCTAssertNil(owner["reasonCode"])
  }
  func testMissingOrChangingExecutableCannotAuthorizeRestart() throws {
    for mode in 0..<3 {
      var reads=0
      let result=try MacCodexAccountActivity.allOwners(run:{_,_ in self.row("10","codex")},read:{_ in
        .init(arguments:["codex","app-server","--listen","unix://"],home:"/fixture/user",alternateAuthentication:false)
      },executablePath:{_ in
        reads += 1
        return mode==0 ? nil : mode==1 ? "codex" : reads==1 ? "/version/one/codex":"/version/two/codex"
      })
      XCTAssertEqual(result["processes"]?.array?.first?.object?["reasonCode"]?.string,"server_executable_unavailable")
    }
  }
  func testLiveActivityIsReadOnlyAndNeverChangesAccountState() throws {
    guard ProcessInfo.processInfo.environment["CLAWDAD_ACCOUNT_READONLY_LIVE"]=="1" else {throw XCTSkip("Explicit read-only account activity census")}
    let home=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex").path
    let result=try MacCodexAccountActivity.inspect(home:home)
    XCTAssertEqual(result["complete"]?.bool,true);XCTAssertFalse(result["owners"]?.array?.isEmpty ?? true)
    let profile=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ClawDad/Accounts/verification-2026-09-15/sun").path
    let inactive=try MacCodexAccountActivity.inspect(home:profile)
    XCTAssertEqual(inactive["complete"]?.bool,true);XCTAssertEqual(inactive["owners"]?.array?.count,0)
    print("Read-only account activity: canonical owners=\(result["owners"]?.array?.count ?? -1), retained Sun owners=\(inactive["owners"]?.array?.count ?? -1)")
  }
}
