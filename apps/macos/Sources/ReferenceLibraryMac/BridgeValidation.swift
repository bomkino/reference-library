import CoreFoundation
import Foundation

enum BridgeValidation {
    private static let opaqueID = try! NSRegularExpression(
        pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        options: [.caseInsensitive]
    )

    static func isOpaqueID(_ value: String) -> Bool {
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        return opaqueID.firstMatch(in: value, range: range)?.range == range
    }

    static func assetResourceURL(sessionID: String, assetID: String, profile: String) throws -> URL {
        guard isOpaqueID(sessionID), isOpaqueID(assetID) else {
            throw ValidationError.invalidOpaqueID
        }
        guard profile == "grid_standard" || profile == "preview" else {
            throw ValidationError.invalidProfile
        }
        guard let url = URL(string: "pitchdog-asset://\(sessionID)/\(assetID)/\(profile)") else {
            throw ValidationError.invalidResourceURL
        }
        return url
    }

    static func optionalLibraryRevision(_ value: Any?) throws -> NSNumber? {
        if value == nil || value is NSNull { return nil }
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue >= 0,
              number.doubleValue <= 9_007_199_254_740_991,
              number.doubleValue.rounded(.towardZero) == number.doubleValue else {
            throw ValidationError.invalidArgument("expectedLibraryRevision")
        }
        return number
    }

    enum ValidationError: LocalizedError {
        case invalidOpaqueID
        case invalidProfile
        case invalidResourceURL
        case invalidArgument(String)

        var errorDescription: String? {
            switch self {
            case .invalidOpaqueID: "Expected an opaque identifier."
            case .invalidProfile: "Unsupported Asset resource profile."
            case .invalidResourceURL: "Could not create an Asset resource URL."
            case let .invalidArgument(name): "Invalid argument: \(name)."
            }
        }
    }
}
