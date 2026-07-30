import Foundation
import StoreKit

struct ClawDadSubscriptionPlan: Identifiable, Equatable {
  var id: String { productId }
  let productId: String
  let title: String
  let fallbackPrice: String
  let periodLabel: String
}

struct ClawDadEntitlementSnapshot: Equatable {
  var productId: String
  var transactionId: String
  var originalTransactionId: String
  var purchasedAt: Date?
  var expiresAt: Date?
  var revokedAt: Date?
  var isInIntroductoryOffer: Bool
  var environment: String
  var signedTransaction: String
  var observedAt: Date

  var active: Bool {
    revokedAt == nil && (expiresAt == nil || expiresAt! > Date())
  }
}

@MainActor
final class SubscriptionManager: ObservableObject {
  static let monthlyProductId = "earth.frg.clawdad.pro.monthly"
  static let annualProductId = "earth.frg.clawdad.pro.annual"
  static let productIds = [monthlyProductId, annualProductId]
  static let plans = [
    ClawDadSubscriptionPlan(
      productId: monthlyProductId,
      title: "Monthly",
      fallbackPrice: "$9.99",
      periodLabel: "per month"
    ),
    ClawDadSubscriptionPlan(
      productId: annualProductId,
      title: "Annual",
      fallbackPrice: "$99.00",
      periodLabel: "per year"
    ),
  ]

  @Published private(set) var products: [Product] = []
  @Published private(set) var entitlement: ClawDadEntitlementSnapshot?
  @Published private(set) var loading = true
  @Published private(set) var purchasePending = false
  @Published private(set) var statusMessage = ""
  @Published private(set) var revision = UUID()

  private var started = false
  private var updatesTask: Task<Void, Never>?
  private let previewAccess: Bool

  init(previewAccess: Bool = false) {
    self.previewAccess = previewAccess
    if previewAccess {
      loading = false
    }
  }

  var foundingBetaAccess: Bool {
    if let value = Bundle.main.object(
      forInfoDictionaryKey: "ClawDadFoundingBetaAccess"
    ) as? Bool {
      return value
    }
    let value = String(
      describing: Bundle.main.object(
        forInfoDictionaryKey: "ClawDadFoundingBetaAccess"
      ) ?? ""
    ).lowercased()
    return ["1", "true", "yes"].contains(value)
  }

  var hasAccess: Bool {
    previewAccess || foundingBetaAccess || entitlement?.active == true
  }

  var requiresPurchase: Bool {
    !loading && !hasAccess
  }

  var accessLabel: String {
    if foundingBetaAccess && entitlement?.active != true {
      return "Founding beta access"
    }
    guard let entitlement, entitlement.active else {
      return loading ? "Checking subscription" : "Subscription needed"
    }
    if entitlement.isInIntroductoryOffer {
      return "Free trial active"
    }
    if let expiresAt = entitlement.expiresAt {
      return "Active through \(expiresAt.formatted(date: .abbreviated, time: .omitted))"
    }
    return "Subscription active"
  }

  func product(for productId: String) -> Product? {
    products.first { $0.id == productId }
  }

  func start() {
    guard !previewAccess else {
      loading = false
      return
    }
    guard !started else {
      return
    }
    started = true
    updatesTask = Task { [weak self] in
      for await result in Transaction.updates {
        guard let self else {
          return
        }
        await self.handle(result, finish: true)
      }
    }
    Task {
      await refresh()
    }
  }

  func refresh() async {
    loading = true
    statusMessage = ""
    do {
      products = try await Product.products(for: Self.productIds)
        .sorted { left, right in
          Self.productIds.firstIndex(of: left.id) ?? Int.max <
            Self.productIds.firstIndex(of: right.id) ?? Int.max
        }
    } catch {
      products = []
      statusMessage = "Subscriptions are temporarily unavailable."
    }
    await refreshEntitlement()
    loading = false
  }

  func purchase(_ product: Product) async {
    guard Self.productIds.contains(product.id), !purchasePending else {
      return
    }
    purchasePending = true
    statusMessage = ""
    defer {
      purchasePending = false
    }
    do {
      switch try await product.purchase() {
      case .success(let verification):
        await handle(verification, finish: true)
      case .pending:
        statusMessage = "Purchase approval is pending."
      case .userCancelled:
        statusMessage = ""
      @unknown default:
        statusMessage = "The App Store returned an unknown purchase state."
      }
    } catch {
      statusMessage = error.localizedDescription
    }
  }

  func restore() async {
    guard !purchasePending else {
      return
    }
    purchasePending = true
    statusMessage = "Restoring purchases..."
    defer {
      purchasePending = false
    }
    do {
      try await AppStore.sync()
      await refreshEntitlement()
      statusMessage = entitlement?.active == true
        ? "Subscription restored."
        : "No active ClawDad subscription was found."
    } catch {
      statusMessage = error.localizedDescription
    }
  }

  private func refreshEntitlement() async {
    var newest: ClawDadEntitlementSnapshot?
    for await result in Transaction.currentEntitlements {
      guard case .verified(let transaction) = result,
            Self.productIds.contains(transaction.productID) else {
        continue
      }
      let snapshot = snapshot(
        for: transaction,
        signedTransaction: result.jwsRepresentation
      )
      if newest == nil ||
          (snapshot.expiresAt ?? .distantFuture) >
          (newest?.expiresAt ?? .distantFuture) {
        newest = snapshot
      }
    }
    setEntitlement(newest)
  }

  private func handle(
    _ result: VerificationResult<Transaction>,
    finish: Bool
  ) async {
    guard case .verified(let transaction) = result else {
      statusMessage = "The App Store could not verify this purchase."
      return
    }
    guard Self.productIds.contains(transaction.productID) else {
      if finish {
        await transaction.finish()
      }
      return
    }
    setEntitlement(snapshot(
      for: transaction,
      signedTransaction: result.jwsRepresentation
    ))
    if finish {
      await transaction.finish()
    }
  }

  private func snapshot(
    for transaction: Transaction,
    signedTransaction: String
  ) -> ClawDadEntitlementSnapshot {
    ClawDadEntitlementSnapshot(
      productId: transaction.productID,
      transactionId: String(transaction.id),
      originalTransactionId: String(transaction.originalID),
      purchasedAt: transaction.purchaseDate,
      expiresAt: transaction.expirationDate,
      revokedAt: transaction.revocationDate,
      isInIntroductoryOffer: isIntroductoryOffer(transaction),
      environment: String(describing: transaction.environment),
      signedTransaction: signedTransaction,
      observedAt: Date()
    )
  }

  private func isIntroductoryOffer(_ transaction: Transaction) -> Bool {
#if os(macOS)
    if #available(macOS 14.2, *) {
      return transaction.offer?.type == .introductory
    }
    return transaction.offerType == .introductory
#else
    return transaction.offer?.type == .introductory
#endif
  }

  private func setEntitlement(_ next: ClawDadEntitlementSnapshot?) {
    guard entitlement != next else {
      return
    }
    entitlement = next
    revision = UUID()
  }
}
