(function () {
  'use strict';

  var TRANSPARENT_1x1 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  var MUSIC_DIR = 'assets/music/';

  var audio = new Audio();
  var preloadAudio = new Audio();
  preloadAudio.preload = 'auto';
  var preloadedIndex = -1;

  var playlist = [];
  var currentIndex = -1;
  var isPlaying = false;

  var elPlayer   = document.getElementById('music-player');
  var elThumb    = document.getElementById('mp-thumb');
  var elTitle    = document.getElementById('mp-title');
  var elArtist   = document.getElementById('mp-artist');
  var elPlay     = document.getElementById('mp-play');
  var elPrev     = document.getElementById('mp-prev');
  var elNext     = document.getElementById('mp-next');
  var elStop     = document.getElementById('mp-stop');
  var elBar      = document.getElementById('mp-progress-bar');
  var elProgress = document.getElementById('mp-progress');
  var iconPlay   = elPlay && elPlay.querySelector('.mp-icon-play');
  var iconPause  = elPlay && elPlay.querySelector('.mp-icon-pause');

  if (elThumb) {
    var existing = elThumb.getAttribute('src');
    if (!existing) {
      try {
        elThumb.src = TRANSPARENT_1x1;
        elThumb.width = 56;
        elThumb.height = 56;
      } catch (e) {}
    }
  }

  function preloadTrack(index) {
    if (!Array.isArray(playlist) || playlist.length === 0) return;
    var idx = ((index % playlist.length) + playlist.length) % playlist.length;
    if (preloadedIndex === idx) return;
    var track = playlist[idx];
    if (!track || !track.file) return;
    var src = MUSIC_DIR + track.file;
    try {
      preloadAudio.src = src;
      preloadAudio.preload = 'auto';
      preloadAudio.load();
      preloadedIndex = idx;
    } catch (e) {}
  }

  function loadPlaylist() {
    fetch(MUSIC_DIR + 'playlist.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (Array.isArray(data)) playlist = data;
        else if (data && Array.isArray(data.tracks)) playlist = data.tracks;
        else playlist = [];

        if (playlist.length > 0 && elPlayer) {
          elPlayer.style.display = '';
          var randomStartIndex = Math.floor(Math.random() * playlist.length);
          loadTrack(randomStartIndex, false);
        } else if (elPlayer) {
          elPlayer.style.display = 'none';
        }
      })
      .catch(function () {
        if (elPlayer) elPlayer.style.display = 'none';
      });
  }

  function loadTrack(index, autoplay) {
    if (!Array.isArray(playlist) || playlist.length === 0) return;
    index = ((index % playlist.length) + playlist.length) % playlist.length;
    currentIndex = index;
    var track = playlist[currentIndex];
    if (!track || !track.file) return;

    audio.src = MUSIC_DIR + track.file;

    if (elTitle) {
      elTitle.innerHTML = '';
      if (track.link) {
        var a = document.createElement('a');
        a.href = track.link;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = track.title || 'Unknown';
        a.style.color = 'inherit';
        elTitle.appendChild(a);
      } else {
        elTitle.textContent = track.title || 'Unknown';
      }
    }

    if (elArtist) elArtist.textContent = track.artist || '';
    if (elProgress) elProgress.style.width = '0%';

    var baseName = track.file.replace(/\.[^.]+$/, '');
    var candidates = track.thumbnail ? [track.thumbnail] : [baseName + '.png', baseName + '.jpg', baseName + '.jpeg'];

    var tryIdx = 0;
    function tryThumb() {
      if (!elThumb) return;
      if (tryIdx >= candidates.length) {
        elThumb.onerror = null;
        elThumb.onload = null;
        elThumb.src = TRANSPARENT_1x1;
        return;
      }
      var candidate = candidates[tryIdx++];
      var src = /^(?:https?:|\/)/.test(candidate) ? candidate : MUSIC_DIR + candidate;
      elThumb.onerror = tryThumb;
      elThumb.onload = function () { elThumb.onerror = null; elThumb.onload = null; };
      elThumb.src = src;
    }
    tryThumb();

    updateMediaSession(track);

    if (autoplay) {
      audio.play().catch(function () {});
      setPlaying(true);
    } else {
      setPlaying(false);
    }

    preloadTrack(index + 1);
  }

  function setPlaying(state) {
    isPlaying = state;
    if (iconPlay) iconPlay.style.display = state ? 'none' : '';
    if (iconPause) iconPause.style.display = state ? '' : 'none';
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state ? 'playing' : 'paused';
    }
  }

  function mimeFromExt(filename) {
    var ext = (filename.match(/\.([^.]+)$/) || [])[1];
    if (ext) ext = ext.toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    return 'image/jpeg';
  }

  function updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    var baseName = track.file.replace(/\.[^.]+$/, '');
    var thumbFile = track.thumbnail || baseName + '.jpg';
    var thumbSrc = /^(?:https?:|\/)/.test(thumbFile) ? thumbFile : MUSIC_DIR + thumbFile;
    var artworkUrl = new URL(thumbSrc, window.location.href).href;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Unknown',
      artist: track.artist || '',
      artwork: [
        { src: artworkUrl, sizes: '512x512', type: mimeFromExt(thumbFile) }
      ]
    });
  }

  function setupMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', function () {
      if (!Array.isArray(playlist) || playlist.length === 0) return;
      if (currentIndex < 0) { loadTrack(0, true); return; }
      audio.play().catch(function () {});
      setPlaying(true);
    });

    navigator.mediaSession.setActionHandler('pause', function () {
      audio.pause();
      setPlaying(false);
    });

    navigator.mediaSession.setActionHandler('previoustrack', function () {
      if (!Array.isArray(playlist) || playlist.length === 0) return;
      if (audio.currentTime > 3) {
        audio.currentTime = 0;
      } else {
        var prev = (currentIndex - 1 + playlist.length) % playlist.length;
        loadTrack(prev, true);
      }
    });

    navigator.mediaSession.setActionHandler('nexttrack', function () {
      if (!Array.isArray(playlist) || playlist.length === 0) return;
      var next = (currentIndex + 1) % playlist.length;
      loadTrack(next, true);
    });

    navigator.mediaSession.setActionHandler('stop', function () {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
      if (elProgress) elProgress.style.width = '0%';
    });

    try {
      navigator.mediaSession.setActionHandler('seekto', function (details) {
        if (!audio.duration) return;
        if (details.fastSeek && 'fastSeek' in audio) {
          audio.fastSeek(details.seekTime);
        } else {
          audio.currentTime = details.seekTime;
        }
      });
    } catch (e) {}
  }

  setupMediaSessionHandlers();

  if (elPlay) {
    elPlay.addEventListener('click', function () {
      if (!Array.isArray(playlist) || playlist.length === 0) return;
      if (isPlaying) {
        audio.pause();
        setPlaying(false);
      } else {
        if (currentIndex < 0) loadTrack(0, true);
        else {
          audio.play().catch(function () {});
          setPlaying(true);
        }
      }
    });
  }

  if (elStop) {
    elStop.addEventListener('click', function () {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
      if (elProgress) elProgress.style.width = '0%';
    });
  }

  if (elNext) {
    elNext.addEventListener('click', function () {
      if (!Array.isArray(playlist) || playlist.length === 0) return;
      var next = (currentIndex + 1) % playlist.length;
      loadTrack(next, true);
    });
  }

  if (elPrev) {
    elPrev.addEventListener('click', function () {
      if (!Array.isArray(playlist) || playlist.length === 0) return;
      if (audio.currentTime > 3) {
        audio.currentTime = 0;
      } else {
        var prev = (currentIndex - 1 + playlist.length) % playlist.length;
        loadTrack(prev, true);
      }
    });
  }

  var hasPositionState = 'mediaSession' in navigator && 'setPositionState' in navigator.mediaSession;

  audio.addEventListener('timeupdate', function () {
    if (audio.duration && elProgress) {
      elProgress.style.width = (audio.currentTime / audio.duration * 100) + '%';
    }
    if (hasPositionState && audio.duration) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime
        });
      } catch (e) {}
    }
  });

  audio.addEventListener('ended', function () {
    if (!Array.isArray(playlist) || playlist.length === 0) return;
    var next = (currentIndex + 1) % playlist.length;
    loadTrack(next, true);
  });

  if (elBar) {
    elBar.addEventListener('click', function (e) {
      if (!audio.duration) return;
      var rect = elBar.getBoundingClientRect();
      var ratio = (e.clientX - rect.left) / rect.width;
      audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration;
    });
  }

  if (elPlayer) elPlayer.style.display = 'none';
  loadPlaylist();

})();
