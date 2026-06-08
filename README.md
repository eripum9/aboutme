# aboutme

Standalone GitHub Pages project site for the `/aboutme/` page.

Publish this folder as the GitHub repository `aboutme` to keep root-site links to `/aboutme/` working.

## Add an album

Run this from the repo root:

```powershell
python scripts\add_album.py "C:\path\to\album-folder"
```

The tool asks for album name, artist, album Spotify link, cover image, song order, song titles, song artists, and per-song Spotify links. It uses ffmpeg to create compressed MP3 songs and a WebP album cover, then updates `assets/music/playlist.json`.

For a quick filename-based import:

```powershell
python scripts\add_album.py "C:\path\to\album-folder" --album "Album Name" --artist "Artist" --spotify "https://open.spotify.com/album/..." --cover cover.jpg --non-interactive
```
