# sysaudio-win — Windows system-audio helper

WASAPI loopback capture of the default playback device, emitted on stdout
in the same framed-PCM format as the macOS ScreenCaptureKit helper
(UInt32 LE length + Int16 mono 48 kHz, 100 ms frames), so GhostMind's main
process drives both identically. Logs go to stderr.

Build (on Windows, or the release-windows CI workflow):

    dotnet publish native/system-audio-win/sysaudio-win.csproj -c Release -o native/system-audio-win/publish

Produces a self-contained `sysaudio-win.exe` (no .NET runtime needed on
the target machine), which package.json bundles via extraResources into
`Resources/sysaudio-win/`.
