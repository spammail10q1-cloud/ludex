Ludex Portable Mode
===================

Everything lives on this drive:

  LudexData/   settings, profile pictures, cache, Proton prefixes, runners
  Games/       default game install folder
  Mods/        per-game mod data lives inside each game folder

Windows:
  1. Put Ludex.exe next to LudexPortable.bat.
  2. Double-click LudexPortable.bat.

Linux / Steam Deck:
  1. Put Ludex.AppImage next to LudexPortable.sh.
  2. chmod +x LudexPortable.sh && ./LudexPortable.sh

No installer is needed and nothing is written to the host PC's home folder.
Keep the drive on the same filesystem (NTFS/exFAT for Windows, ext4 for Linux
is safest for Proton prefixes).
