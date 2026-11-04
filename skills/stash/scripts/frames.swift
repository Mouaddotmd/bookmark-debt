// Pulls a few evenly spaced frames out of a video using macOS's own AVFoundation.
// Reads straight from a URL (no download of the whole video) or a local file.
//   swift frames.swift <video url or path> <outPrefix> [count]
// Writes <outPrefix>-1.jpg … <outPrefix>-N.jpg (640px wide).
import AVFoundation
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: frames.swift <video> <outPrefix> [count]"); exit(1) }
let count = args.count > 3 ? Int(args[3]) ?? 3 : 3
let source = args[1].hasPrefix("http") ? URL(string: args[1])! : URL(fileURLWithPath: args[1])
let asset = AVURLAsset(url: source)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.maximumSize = CGSize(width: 640, height: 640)
gen.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
gen.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)

let duration = CMTimeGetSeconds(asset.duration)
guard duration > 0 else { print("could not read video"); exit(1) }

var written = 0
for i in 0..<count {
    // Skip the very start and end, where intros and outros live.
    let t = duration * (Double(i) + 0.5) / Double(count)
    guard let cg = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) else { continue }
    let rep = NSBitmapImageRep(cgImage: cg)
    guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7]) else { continue }
    try? data.write(to: URL(fileURLWithPath: "\(args[2])-\(i + 1).jpg"))
    written += 1
}
print(written)
