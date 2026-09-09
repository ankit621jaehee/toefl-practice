import Foundation
import AppKit

guard CommandLine.arguments.count == 2 else {
    fatalError("Usage: swift scripts/spellcheck-question-import.swift <import.json>")
}

let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let items = root["items"] as? [[String: Any]] else {
    fatalError("Invalid import payload")
}

let checker = NSSpellChecker.shared
let skippedKeys = Set(["sourcePath", "displayDate", "category", "sampleAnswer", "type"])

func strings(in value: Any, key: String = "") -> [(String, String)] {
    if skippedKeys.contains(key) { return [] }
    if let text = value as? String { return [(key, text)] }
    if let array = value as? [Any] { return array.flatMap { strings(in: $0, key: key) } }
    if let object = value as? [String: Any] {
        return object.flatMap { strings(in: $0.value, key: $0.key) }
    }
    return []
}

for item in items {
    let path = item["sourcePath"] as? String ?? "unknown"
    var findings: [String] = []
    for (field, text) in strings(in: item) {
        var cursor = 0
        while cursor < text.utf16.count {
            let range = checker.checkSpelling(
                of: text,
                startingAt: cursor,
                language: "en_US",
                wrap: false,
                inSpellDocumentWithTag: 0,
                wordCount: nil
            )
            if range.location == NSNotFound { break }
            let word = (text as NSString).substring(with: range)
            if word.count >= 3, word.range(of: #"^[A-Za-z][A-Za-z'-]*$"#, options: .regularExpression) != nil {
                findings.append("\(field):\(word)")
            }
            cursor = max(range.location + max(range.length, 1), cursor + 1)
        }
    }
    if !findings.isEmpty {
        print(path)
        print(Array(Set(findings)).sorted().joined(separator: " | "))
    }
}
