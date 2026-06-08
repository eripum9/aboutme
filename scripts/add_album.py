#!/usr/bin/env python3
"""Import an album folder into the static music player.

The script is intentionally interactive by default:
  python scripts/add_album.py "C:/path/to/album folder"

It prompts for album metadata, lets you sort detected songs, asks for each
song title/artist/Spotify link, then uses ffmpeg to create site-ready MP3 and
WebP assets before updating assets/music/playlist.json.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


AUDIO_EXTS = {".aac", ".aiff", ".aif", ".alac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".wma"}
IMAGE_EXTS = {".avif", ".jpeg", ".jpg", ".png", ".webp"}


def natural_key(value: Path) -> list[object]:
    parts = re.split(r"(\d+)", value.stem.lower())
    return [int(part) if part.isdigit() else part for part in parts]


def slugify(value: str, fallback: str = "album") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or fallback


def prompt(label: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{label}{suffix}: ").strip()
    return value or default


def prompt_required(label: str, default: str = "") -> str:
    while True:
        value = prompt(label, default)
        if value:
            return value
        print("This value is required.")


def find_ffmpeg(explicit: str | None) -> str:
    candidates = []
    if explicit:
      candidates.append(explicit)
    candidates.extend([
        "ffmpeg",
        str(Path.home() / "AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe"),
        str(Path.home() / "AppData/Local/Programs/Python/Python313/Scripts/ffmpeg.exe"),
    ])
    for candidate in candidates:
        found = shutil.which(candidate) if candidate == "ffmpeg" else candidate
        if found and Path(found).exists():
            return found
    raise SystemExit("ffmpeg was not found. Install ffmpeg or pass --ffmpeg C:/path/to/ffmpeg.exe")


def run_ffmpeg(ffmpeg: str, args: list[str]) -> None:
    command = [ffmpeg, "-hide_banner", "-y", *args]
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"ffmpeg failed with exit code {exc.returncode}: {' '.join(command)}") from exc


def load_playlist(path: Path) -> dict:
    if not path.exists():
        return {"version": 2, "albums": []}

    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("albums"), list):
        data.setdefault("version", 2)
        return data

    tracks = data if isinstance(data, list) else data.get("tracks", [])
    return {
        "version": 2,
        "albums": [
            {
                "id": "favorites",
                "name": "Favorites",
                "artist": "",
                "cover": tracks[0].get("thumbnail", "") if tracks else "",
                "spotify": "",
                "tracks": tracks,
            }
        ],
    }


def choose_cover(folder: Path, explicit: str | None) -> Path:
    if explicit:
        cover = Path(explicit).expanduser()
        if not cover.is_absolute():
            cover = folder / cover
        if cover.exists():
            return cover
        raise SystemExit(f"Cover does not exist: {cover}")

    images = sorted((p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS), key=natural_key)
    if images:
        print("\nCover candidates:")
        for idx, image in enumerate(images, 1):
            print(f"  {idx}. {image.name}")
        choice = prompt("Cover number or path", "1")
        if choice.isdigit() and 1 <= int(choice) <= len(images):
            return images[int(choice) - 1]
        cover = Path(choice).expanduser()
        if not cover.is_absolute():
            cover = folder / cover
        if cover.exists():
            return cover
        raise SystemExit(f"Cover does not exist: {cover}")

    cover = Path(prompt_required("Cover image path")).expanduser()
    if not cover.exists():
        raise SystemExit(f"Cover does not exist: {cover}")
    return cover


def choose_song_order(audio_files: list[Path], non_interactive: bool) -> list[Path]:
    if non_interactive:
        return audio_files

    print("\nDetected songs:")
    for idx, song in enumerate(audio_files, 1):
        print(f"  {idx}. {song.name}")

    order = prompt("Sort order as comma-separated numbers, blank keeps this order")
    if not order:
        return audio_files

    selected = []
    seen = set()
    for item in order.split(","):
        item = item.strip()
        if not item.isdigit():
            raise SystemExit(f"Invalid sort item: {item}")
        index = int(item)
        if index < 1 or index > len(audio_files):
            raise SystemExit(f"Sort item out of range: {item}")
        if index in seen:
            raise SystemExit(f"Duplicate sort item: {item}")
        seen.add(index)
        selected.append(audio_files[index - 1])

    if len(selected) != len(audio_files):
        missing = [str(i) for i in range(1, len(audio_files) + 1) if i not in seen]
        raise SystemExit("Sort order must include every song. Missing: " + ", ".join(missing))
    return selected


def unique_file(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    counter = 2
    while True:
        candidate = path.with_name(f"{stem}-{counter}{suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def convert_cover(ffmpeg: str, source: Path, destination: Path, size: int, quality: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    filter_arg = f"scale={size}:{size}:force_original_aspect_ratio=increase,crop={size}:{size}"
    try:
        run_ffmpeg(ffmpeg, ["-i", str(source), "-vf", filter_arg, "-frames:v", "1", "-quality", str(quality), str(destination)])
    except SystemExit:
        run_ffmpeg(ffmpeg, ["-i", str(source), "-vf", f"scale={size}:{size}", "-frames:v", "1", "-quality", str(quality), str(destination)])


def convert_audio(ffmpeg: str, source: Path, destination: Path, bitrate: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(ffmpeg, ["-i", str(source), "-map", "0:a:0", "-vn", "-codec:a", "libmp3lame", "-b:a", bitrate, str(destination)])


def build_album(args: argparse.Namespace) -> dict:
    root = Path(__file__).resolve().parents[1]
    folder = Path(args.folder).expanduser().resolve()
    if not folder.is_dir():
        raise SystemExit(f"Album folder does not exist: {folder}")

    audio_files = sorted((p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXTS), key=natural_key)
    if not audio_files:
        raise SystemExit(f"No supported audio files found in {folder}")

    ffmpeg = find_ffmpeg(args.ffmpeg)
    album_name = args.album or prompt_required("Album name", folder.name)
    album_artist = args.artist or prompt("Album artist")
    album_spotify = args.spotify or prompt("Album Spotify link")
    album_id = slugify(args.id or album_name)
    cover_source = choose_cover(folder, args.cover)
    ordered_files = choose_song_order(audio_files, args.non_interactive)

    music_root = root / "assets" / "music"
    album_dir = music_root / "albums" / album_id
    album_dir.mkdir(parents=True, exist_ok=True)

    cover_dest = album_dir / "cover.webp"
    convert_cover(ffmpeg, cover_source, cover_dest, args.cover_size, args.cover_quality)

    tracks = []
    print("")
    for index, source in enumerate(ordered_files, 1):
        default_title = re.sub(r"^\d+[\s._-]+", "", source.stem).replace("_", " ").strip()
        if args.non_interactive:
            title = default_title
            artist = album_artist
            spotify = ""
        else:
            print(f"Track {index}: {source.name}")
            title = prompt_required("  Song title", default_title)
            artist = prompt("  Song artist", album_artist)
            spotify = prompt("  Song Spotify link")

        song_slug = slugify(f"{index:02d}-{title}", f"track-{index:02d}")
        song_dest = unique_file(album_dir / f"{song_slug}.mp3")
        convert_audio(ffmpeg, source, song_dest, args.audio_bitrate)

        relative_file = song_dest.relative_to(music_root).as_posix()
        tracks.append({
            "track": index,
            "file": relative_file,
            "title": title,
            "artist": artist,
            "spotify": spotify,
        })

    return {
        "id": album_id,
        "name": album_name,
        "artist": album_artist,
        "cover": cover_dest.relative_to(music_root).as_posix(),
        "spotify": album_spotify,
        "tracks": tracks,
    }


def save_album(album: dict, replace: bool) -> Path:
    root = Path(__file__).resolve().parents[1]
    playlist_path = root / "assets" / "music" / "playlist.json"
    playlist = load_playlist(playlist_path)
    albums = playlist.setdefault("albums", [])

    existing_index = next((idx for idx, item in enumerate(albums) if item.get("id") == album["id"]), None)
    if existing_index is not None:
        if not replace:
            answer = prompt(f"Album '{album['id']}' exists. Replace it?", "n").lower()
            if answer not in {"y", "yes"}:
                raise SystemExit("Import cancelled.")
        albums[existing_index] = album
    else:
        albums.append(album)

    playlist["version"] = 2
    playlist_path.write_text(json.dumps(playlist, indent=2) + "\n", encoding="utf-8")
    return playlist_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add an album folder to the aboutme music player.")
    parser.add_argument("folder", help="Folder containing audio files and optionally a cover image.")
    parser.add_argument("--album", help="Album name. Prompts when omitted.")
    parser.add_argument("--artist", help="Album artist. Prompts when omitted.")
    parser.add_argument("--spotify", help="Album Spotify link. Prompts when omitted.")
    parser.add_argument("--cover", help="Cover image path. Defaults to an interactive choice from the album folder.")
    parser.add_argument("--id", help="Album id/slug. Defaults to a slug from the album name.")
    parser.add_argument("--replace", action="store_true", help="Replace an existing album with the same id without prompting.")
    parser.add_argument("--non-interactive", action="store_true", help="Use sorted filenames and stem-derived titles without prompts.")
    parser.add_argument("--audio-bitrate", default="192k", help="MP3 bitrate for converted songs. Default: 192k.")
    parser.add_argument("--cover-size", type=int, default=160, help="Output cover size in px. Default: 160.")
    parser.add_argument("--cover-quality", type=int, default=78, help="WebP cover quality. Default: 78.")
    parser.add_argument("--ffmpeg", help="Path to ffmpeg.exe if it is not on PATH.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    album = build_album(args)
    playlist_path = save_album(album, args.replace)
    print(f"\nAdded album '{album['name']}' with {len(album['tracks'])} songs.")
    print(f"Updated {playlist_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
