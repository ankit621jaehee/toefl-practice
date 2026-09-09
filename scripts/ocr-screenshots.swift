import Foundation
import Vision
import AppKit

struct OCRLine: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct OCRResult: Codable {
    let path: String
    let lines: [OCRLine]
}

func recognize(_ path: String, categoryOnly: Bool) throws -> OCRResult {
    guard let image = NSImage(contentsOfFile: path),
          let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let cgImage = bitmap.cgImage else {
        throw NSError(domain: "OCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot load image: \(path)"])
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US", "zh-Hans"]
    if categoryOnly {
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.regionOfInterest = CGRect(x: 0.72, y: 0.76, width: 0.27, height: 0.18)
    }

    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    let observations = (request.results ?? []).sorted {
        if abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.008 {
            return $0.boundingBox.midY > $1.boundingBox.midY
        }
        return $0.boundingBox.minX < $1.boundingBox.minX
    }
    let lines = observations.compactMap { observation -> OCRLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return OCRLine(
            text: candidate.string,
            confidence: candidate.confidence,
            x: box.minX,
            y: box.minY,
            width: box.width,
            height: box.height
        )
    }
    return OCRResult(path: path, lines: lines)
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.withoutEscapingSlashes]

var arguments = Array(CommandLine.arguments.dropFirst())
var outputHandle = FileHandle.standardOutput
if arguments.count >= 2, arguments[0] == "--output" {
    let outputURL = URL(fileURLWithPath: arguments[1])
    FileManager.default.createFile(atPath: outputURL.path, contents: nil)
    outputHandle = try FileHandle(forWritingTo: outputURL)
    arguments.removeFirst(2)
}
var categoryOnly = false
if arguments.first == "--category" {
    categoryOnly = true
    arguments.removeFirst()
}

for path in arguments {
    do {
        let result = try recognize(path, categoryOnly: categoryOnly)
        outputHandle.write(try encoder.encode(result))
        outputHandle.write(Data("\n".utf8))
    } catch {
        FileHandle.standardError.write(Data("\(path): \(error)\n".utf8))
    }
}
