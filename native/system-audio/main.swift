import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import CoreGraphics

// GhostMind native system-audio capture helper (ScreenCaptureKit).
//
// Two modes:
//   sysaudio [output.wav] [seconds]   capture the system audio mix for a
//                                     fixed time and write a mono WAV
//                                     (prototype / smoke-test mode).
//   sysaudio --stream                 stream the mix to stdout as framed
//                                     chunks until killed: each frame is
//                                     a UInt32 little-endian payload byte
//                                     count followed by that many bytes of
//                                     Int16 mono PCM at 48 kHz, exactly
//                                     100 ms (4800 samples) per frame.
//                                     This is the mode GhostMind uses.
//
// This is the Cluely-style approach: no BlackHole / virtual driver, no
// audio routing changes. ScreenCaptureKit taps the system output mix
// directly, gated by the Screen & System Audio Recording permission.
// The video side of the stream is configured at 2x2 @ 1 fps and never
// given an output handler, so frames are discarded by the system.
//
// All human-readable logs go to stderr; stdout carries ONLY frames in
// stream mode, so the parent process can parse it as a binary stream.

func logErr(_ s: String) { fputs(s + "\n", stderr) }

let args = CommandLine.arguments
let streaming = args.contains("--stream")
let outPath = (!streaming && args.count > 1) ? args[1] : "/tmp/sysaudio.wav"
let seconds: Double = (!streaming && args.count > 2) ? (Double(args[2]) ?? 10) : 10

final class Collector: NSObject, SCStreamOutput, SCStreamDelegate {
    var samples: [Float] = []          // file mode accumulation
    var pending: [Int16] = []          // stream mode: partial 100 ms chunk
    let chunkSamples = 4800            // 100 ms at 48 kHz
    var frames: Int64 = 0

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, CMSampleBufferIsValid(sampleBuffer) else { return }
        var blockBuffer: CMBlockBuffer?
        // The buffer list must have room for TWO AudioBuffers: ScreenCaptureKit
        // delivers planar audio (one buffer per channel), and a list sized for
        // a single buffer makes the call fail with -12737 (ArrayTooSmall).
        let ablCapacity = MemoryLayout<AudioBufferList>.size + MemoryLayout<AudioBuffer>.size
        let ablRaw = UnsafeMutableRawPointer.allocate(byteCount: ablCapacity, alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { ablRaw.deallocate() }
        let ablPtr = ablRaw.assumingMemoryBound(to: AudioBufferList.self)
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: ablPtr,
            bufferListSize: ablCapacity,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer)
        guard status == noErr else { return }
        let buffers = UnsafeMutableAudioBufferListPointer(ablPtr)
        var mono: [Float] = []
        if buffers.count == 1 {
            // Interleaved (usually stereo): downmix channel pairs to mono.
            let b = buffers[0]
            guard let data = b.mData else { return }
            let count = Int(b.mDataByteSize) / MemoryLayout<Float>.size
            let ptr = data.bindMemory(to: Float.self, capacity: count)
            let channels = max(1, Int(b.mNumberChannels))
            var i = 0
            while i + channels - 1 < count {
                var sum: Float = 0
                for c in 0..<channels { sum += ptr[i + c] }
                mono.append(sum / Float(channels))
                i += channels
            }
        } else if buffers.count >= 2 {
            // Planar: one buffer per channel; average L and R.
            let b0 = buffers[0], b1 = buffers[1]
            guard let d0 = b0.mData, let d1 = b1.mData else { return }
            let n = min(Int(b0.mDataByteSize), Int(b1.mDataByteSize)) / MemoryLayout<Float>.size
            let p0 = d0.bindMemory(to: Float.self, capacity: n)
            let p1 = d1.bindMemory(to: Float.self, capacity: n)
            mono.reserveCapacity(n)
            for i in 0..<n { mono.append((p0[i] + p1[i]) * 0.5) }
        } else {
            return
        }
        frames += Int64(mono.count)
        if streaming {
            emitStream(mono)
        } else {
            samples.append(contentsOf: mono)
        }
    }

    // Convert Float samples to Int16 and write out whole 100 ms frames,
    // each prefixed with its payload byte count (UInt32 little-endian).
    func emitStream(_ mono: [Float]) {
        for f in mono {
            let v = max(-1.0, min(1.0, f))
            pending.append(Int16(v * 32767.0))
        }
        while pending.count >= chunkSamples {
            let chunk = Array(pending.prefix(chunkSamples))
            pending.removeFirst(chunkSamples)
            var payload = Data(count: chunk.count * 2)
            payload.withUnsafeMutableBytes { raw in
                let dst = raw.bindMemory(to: Int16.self)
                for (i, s) in chunk.enumerated() { dst[i] = s.littleEndian }
            }
            var header = UInt32(payload.count).littleEndian
            var frame = Data(bytes: &header, count: 4)
            frame.append(payload)
            do {
                try FileHandle.standardOutput.write(contentsOf: frame)
            } catch {
                logErr("WRITE FAILED: \(error.localizedDescription)")
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        logErr("STREAM STOPPED WITH ERROR: \(error.localizedDescription)")
        if streaming { exit(3) }
    }
}

func writeWav(path: String, samples: [Float], sampleRate: Int) {
    let n = samples.count
    var data = Data()
    func appendStr(_ s: String) { data.append(s.data(using: .ascii)!) }
    func appendU32(_ v: UInt32) { var x = v.littleEndian; data.append(Data(bytes: &x, count: 4)) }
    func appendU16(_ v: UInt16) { var x = v.littleEndian; data.append(Data(bytes: &x, count: 2)) }
    appendStr("RIFF"); appendU32(UInt32(36 + n * 2)); appendStr("WAVE")
    appendStr("fmt "); appendU32(16); appendU16(1); appendU16(1)
    appendU32(UInt32(sampleRate)); appendU32(UInt32(sampleRate * 2)); appendU16(2); appendU16(16)
    appendStr("data"); appendU32(UInt32(n * 2))
    var peak: Float = 0
    for s in samples {
        let v = max(-1.0, min(1.0, s))
        if abs(v) > peak { peak = abs(v) }
        var iv = Int16(v * 32767.0).littleEndian
        data.append(Data(bytes: &iv, count: 2))
    }
    do {
        try data.write(to: URL(fileURLWithPath: path))
        logErr("WROTE \(path) bytes=\(data.count) sampleRate=\(sampleRate) peak=\(peak)")
    } catch {
        logErr("ERROR writing WAV: \(error.localizedDescription)")
        exit(2)
    }
}

// MARK: - main

let collector = Collector()
var activeStream: SCStream? = nil  // retained for as long as we stream

Task {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            logErr("ERROR: no display found")
            exit(2)
        }
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let cfg = SCStreamConfiguration()
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        cfg.queueDepth = 5
        cfg.capturesAudio = true
        cfg.sampleRate = 48000
        cfg.channelCount = 2
        cfg.excludesCurrentProcessAudio = true
        let stream = SCStream(filter: filter, configuration: cfg, delegate: collector)
        try stream.addStreamOutput(collector, type: .audio, sampleHandlerQueue: DispatchQueue(label: "gm.sysaudio"))
        try await stream.startCapture()
        if streaming {
            activeStream = stream
            logErr("STREAMING sampleRate=48000 chunkMs=100")
            return  // the dispatchMain() below keeps the process alive
                    // until the parent kills it; the stream delegate
                    // exits(3) on error.
        }
        logErr("CAPTURING seconds=\(seconds)")
        try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        try await stream.stopCapture()
        logErr("STOPPED frames=\(collector.frames)")
        writeWav(path: outPath, samples: collector.samples, sampleRate: 48000)
        exit(0)
    } catch {
        logErr("ERROR: \(error)")
        exit(1)
    }
}

dispatchMain()
