(function () {
  'use strict';

  var TRANSPARENT_1x1 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  var MUSIC_DIR = 'assets/music/';

  var audio = new Audio();
  audio.preload = 'none';

  var preloadAudio = new Audio();
  preloadAudio.preload = 'metadata';
  var preloadedIndex = -1;

  var playlist = [];
  var currentIndex = -1;
  var isPlaying = false;
  var hasStartedPlayback = false;
  var pendingAudioSrc = '';
  var coverCache = Object.create(null);
  var thumbRequestId = 0;

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
    elThumb.decoding = 'async';
    var existing = elThumb.getAttribute('src');
    if (!existing) {
      try {
        elThumb.src = TRANSPARENT_1x1;
        elThumb.width = 56;
        elThumb.height = 56;
      } catch (e) {}
    }
  }

  function isExternalAsset(src) {
    return /^(?:https?:|\/|data:|blob:)/.test(src);
  }

  function mediaSrc(file) {
    return isExternalAsset(file) ? file : MUSIC_DIR + file;
  }

  function thumbCandidates(track) {
    var baseName = track.file.replace(/\.[^.]+$/, '');
    return track.thumbnail ? [track.thumbnail] : [baseName + '.webp', baseName + '.png', baseName + '.jpg', baseName + '.jpeg'];
  }

  function preloadCover(src) {
    if (coverCache[src]) return coverCache[src];

    coverCache[src] = new Promise(function (resolve, reject) {
      var img = new Image();
      var settled = false;

      function finish() {
        if (settled) return;
        settled = true;
        var decoded = img.decode ? img.decode().catch(function () {}) : Promise.resolve();
        decoded.then(function () { resolve(src); });
      }

      img.decoding = 'async';
      img.onload = finish;
      img.onerror = function () { reject(new Error('Cover failed: ' + src)); };
      img.src = src;
      if (img.complete && img.naturalWidth > 0) finish();
    }).catch(function (err) {
      delete coverCache[src];
      throw err;
    });

    return coverCache[src];
  }

  function setAudioSource(src, preloadMode) {
    audio.preload = preloadMode;
    if (audio.getAttribute('src') !== src) {
      audio.src = src;
    }
  }

  function prepareAudioForPlayback() {
    if (!pendingAudioSrc) return;
    setAudioSource(pendingAudioSrc, 'auto');
  }

  function preloadPlaylistCovers() {
    if (!Array.isArray(playlist)) return;
    var seen = Object.create(null);
    playlist.forEach(function (track) {
      if (!track || !track.file) return;
      var candidate = thumbCandidates(track)[0];
      if (!candidate) return;
      var src = mediaSrc(candidate);
      if (seen[src]) return;
      seen[src] = true;
      preloadCover(src).catch(function () {});
    });
  }

  function setThumb(track) {
    if (!elThumb) return;

    var candidates = thumbCandidates(track);
    var requestId = ++thumbRequestId;

    function tryCandidate(index) {
      if (requestId !== thumbRequestId) return;
      if (index >= candidates.length) {
        elThumb.src = TRANSPARENT_1x1;
        return;
      }

      var src = mediaSrc(candidates[index]);
      preloadCover(src)
        .then(function () {
          if (requestId === thumbRequestId && elThumb.src !== src) {
            elThumb.src = src;
          }
        })
        .catch(function () {
          tryCandidate(index + 1);
        });
    }

    tryCandidate(0);
  }

  function preloadTrack(index) {
    if (!hasStartedPlayback) return;
    if (!Array.isArray(playlist) || playlist.length === 0) return;
    var idx = ((index % playlist.length) + playlist.length) % playlist.length;
    if (preloadedIndex === idx) return;
    var track = playlist[idx];
    if (!track || !track.file) return;
    var src = mediaSrc(track.file);
    try {
      preloadAudio.src = src;
      preloadAudio.preload = 'metadata';
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
          preloadPlaylistCovers();
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

    pendingAudioSrc = mediaSrc(track.file);
    if (autoplay) {
      prepareAudioForPlayback();
    } else {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.preload = 'none';
    }

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

    setThumb(track);

    updateMediaSession(track);

    if (autoplay) {
      hasStartedPlayback = true;
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
    var thumbSrc = mediaSrc(thumbFile);
    var artworkUrl = new URL(thumbSrc, window.location.href).href;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Unknown',
      artist: track.artist || '',
      artwork: [
        { src: artworkUrl, sizes: '160x160', type: mimeFromExt(thumbFile) }
      ]
    });
  }

  function setupMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', function () {
      if (!Array.isArray(playlist) || playlist.length === 0) return;
      if (currentIndex < 0) { loadTrack(0, true); return; }
      prepareAudioForPlayback();
      hasStartedPlayback = true;
      audio.play().catch(function () {});
      setPlaying(true);
      preloadTrack(currentIndex + 1);
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
          prepareAudioForPlayback();
          hasStartedPlayback = true;
          audio.play().catch(function () {});
          setPlaying(true);
          preloadTrack(currentIndex + 1);
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
