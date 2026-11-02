using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using NAudio.Wave;

// GhostMind Windows system-audio helper.
//
// Captures the default render endpoint via WASAPI loopback (the sound the
// PC is playing — the other side of a call) and writes it to stdout in
// GhostMind's framed-PCM wire format: UInt32 little-endian payload byte
// count, then Int16 mono 48 kHz PCM, one 100 ms frame (4,800 samples /
// 9,600 bytes) per message. This is byte-for-byte the contract of the
// macOS ScreenCaptureKit helper (native/system-audio), so the Electron
// main process (src/main/local/sysaudio-main.js) drives both identically:
// spawn with --stream, read framed PCM from stdout, logs from stderr.
//
// Exit codes: 0 clean, 2 no render device, 3 capture would not start,
// 4 unsupported device format, 64 bad usage.

internal static class Program
{
    private static int Main(string[] args)
    {
        bool stream = Array.IndexOf(args, "--stream") >= 0;
        int seconds = 0;
        int si = Array.IndexOf(args, "--seconds");
        if (si >= 0 && si + 1 < args.Length) int.TryParse(args[si + 1], out seconds);
        if (!stream)
        {
            Console.Error.WriteLine("usage: sysaudio-win --stream [--seconds N]");
            return 64;
        }

        WasapiLoopbackCapture capture;
        try
        {
            capture = new WasapiLoopbackCapture();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"NO_DEVICE: no default playback device could be opened ({ex.Message})");
            return 2;
        }

        var fmt = capture.WaveFormat;
        Console.Error.WriteLine($"DEVICE format={fmt.SampleRate}Hz channels={fmt.Channels} encoding={fmt.Encoding} bits={fmt.BitsPerSample}");
        bool supported = (fmt.Encoding == WaveFormatEncoding.IeeeFloat && fmt.BitsPerSample == 32)
            || (fmt.Encoding == WaveFormatEncoding.Pcm && (fmt.BitsPerSample == 16 || fmt.BitsPerSample == 32));
        if (!supported)
        {
            Console.Error.WriteLine($"UNSUPPORTED_FORMAT: {fmt.Encoding}/{fmt.BitsPerSample}");
            return 4;
        }

        var stdout = Console.OpenStandardOutput();
        var writer = new BinaryWriter(stdout);
        var converter = new Converter(fmt, writer);
        var done = new ManualResetEventSlim(false);
        int exitCode = 0;

        capture.DataAvailable += (_, e) =>
        {
            try { converter.Feed(e.Buffer, e.BytesRecorded); }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"CONVERT_ERROR: {ex.Message}");
                exitCode = 1;
                done.Set();
            }
        };
        capture.RecordingStopped += (_, e) =>
        {
            if (e.Exception != null)
            {
                Console.Error.WriteLine($"CAPTURE_ERROR: {e.Exception.Message}");
                exitCode = 1;
            }
            done.Set();
        };
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.Set(); };

        try
        {
            capture.StartRecording();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"START_FAILED: {ex.Message}");
            return 3;
        }
        Console.Error.WriteLine("STREAMING sampleRate=48000 chunkMs=100");

        if (seconds > 0) Thread.Sleep(TimeSpan.FromSeconds(seconds));
        else done.Wait();

        try { capture.StopRecording(); } catch { /* already stopped */ }
        done.Wait(TimeSpan.FromSeconds(2));
        converter.Flush();
        return exitCode;
    }
}

// Decodes the device mix format to mono float, resamples to 48 kHz with a
// streaming linear interpolator, quantizes to Int16 and emits whole
// 100 ms frames in the wire format.
internal sealed class Converter
{
    private const int OutRate = 48000;
    private const int FrameSamples = OutRate / 10; // 100 ms

    private readonly WaveFormat _fmt;
    private readonly BinaryWriter _writer;
    private readonly List<float> _in = new();   // mono input samples not yet consumed
    private double _pos;                        // fractional read position in _in
    private readonly List<short> _frame = new();
    private readonly object _gate = new();

    public Converter(WaveFormat fmt, BinaryWriter writer)
    {
        _fmt = fmt;
        _writer = writer;
    }

    public void Feed(byte[] buffer, int recorded)
    {
        lock (_gate)
        {
            DecodeToMono(buffer, recorded);
            ResampleAndEmit();
        }
    }

    public void Flush()
    {
        lock (_gate)
        {
            // Pad a trailing partial frame with silence so the consumer
            // sees a clean end of stream.
            if (_frame.Count > 0)
            {
                while (_frame.Count < FrameSamples) _frame.Add(0);
                EmitFrame();
            }
        }
    }

    private void DecodeToMono(byte[] buffer, int recorded)
    {
        int channels = Math.Max(1, _fmt.Channels);
        if (_fmt.Encoding == WaveFormatEncoding.IeeeFloat && _fmt.BitsPerSample == 32)
        {
            int frames = recorded / (4 * channels);
            for (int i = 0; i < frames; i++)
            {
                float sum = 0;
                for (int c = 0; c < channels; c++)
                    sum += BitConverter.ToSingle(buffer, (i * channels + c) * 4);
                _in.Add(sum / channels);
            }
        }
        else if (_fmt.Encoding == WaveFormatEncoding.Pcm && _fmt.BitsPerSample == 16)
        {
            int frames = recorded / (2 * channels);
            for (int i = 0; i < frames; i++)
            {
                float sum = 0;
                for (int c = 0; c < channels; c++)
                    sum += BitConverter.ToInt16(buffer, (i * channels + c) * 2) / 32768f;
                _in.Add(sum / channels);
            }
        }
        else if (_fmt.Encoding == WaveFormatEncoding.Pcm && _fmt.BitsPerSample == 32)
        {
            int frames = recorded / (4 * channels);
            for (int i = 0; i < frames; i++)
            {
                float sum = 0;
                for (int c = 0; c < channels; c++)
                    sum += BitConverter.ToInt32(buffer, (i * channels + c) * 4) / 2147483648f;
                _in.Add(sum / channels);
            }
        }
        else
        {
            throw new InvalidOperationException($"unsupported mix format {_fmt.Encoding}/{_fmt.BitsPerSample}");
        }
    }

    private void ResampleAndEmit()
    {
        double step = (double)_fmt.SampleRate / OutRate;
        while (true)
        {
            int i = (int)Math.Floor(_pos);
            if (i + 1 >= _in.Count) break;
            double f = _pos - i;
            float v = (float)(_in[i] * (1 - f) + _in[i + 1] * f);
            _pos += step;
            short s = (short)Math.Round(Math.Clamp(v, -1f, 1f) * 32767f);
            _frame.Add(s);
            if (_frame.Count == FrameSamples) EmitFrame();
        }
        int drop = (int)Math.Floor(_pos);
        if (drop > 0)
        {
            _in.RemoveRange(0, Math.Min(drop, _in.Count));
            _pos -= drop;
        }
    }

    private void EmitFrame()
    {
        _writer.Write((uint)(FrameSamples * 2));
        foreach (short s in _frame) _writer.Write(s);
        _writer.Flush();
        _frame.Clear();
    }
}
