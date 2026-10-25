import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Captions, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { formatClock } from '../lib/format';
import { Spinner } from './ui';

interface Props {
  /** Signed HLS manifest URL from the playback-token function. */
  src: string;
  poster?: string | null;
  title: string;
  startAt?: number;
  /** Called at most every few seconds while playing, and on pause/seek/exit. */
  onProgress?: (position: number, duration: number) => void;
  /** Called when the signed URL stops working (expired token) so the parent can refresh it. */
  onAuthError?: () => void;
}

export function VideoPlayer({ src, poster, title, startAt = 0, onProgress, onAuthError }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hls = useRef<Hls | null>(null);
  const lastSaved = useRef(0);
  const progressCb = useRef(onProgress);
  progressCb.current = onProgress;
  const authCb = useRef(onAuthError);
  authCb.current = onAuthError;

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [tracks, setTracks] = useState<{ id: number; name: string }[]>([]);
  const [track, setTrack] = useState(-1);
  const [showMenu, setShowMenu] = useState(false);

  const report = useCallback(() => {
    const v = video.current;
    if (v && v.duration > 0) progressCb.current?.(v.currentTime, v.duration);
  }, []);

  // Attach the HLS source (native HLS on Safari, hls.js elsewhere).
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    setError(null);
    setBuffering(true);
    let resumed = false;
    const resume = () => {
      if (resumed) return;
      resumed = true;
      if (startAt > 5 && v.duration && startAt < v.duration - 10) v.currentTime = startAt;
    };

    if (Hls.isSupported()) {
      const h = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.current = h;
      h.loadSource(src);
      h.attachMedia(v);
      h.on(Hls.Events.MANIFEST_PARSED, resume);
      h.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_e, d) => {
        setTracks(d.subtitleTracks.map((t, i) => ({ id: i, name: t.name || t.lang || `Track ${i + 1}` })));
        h.subtitleDisplay = true;
      });
      h.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        const code = data.response?.code;
        if (code === 401 || code === 403) {
          setError('Your viewing session expired. Refreshing…');
          authCb.current?.();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setError('Network problem while loading the video.');
          h.startLoad(); // retry
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          h.recoverMediaError();
        } else {
          setError('This video could not be played.');
          h.destroy();
        }
      });
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src;
      v.addEventListener('loadedmetadata', resume, { once: true });
    } else {
      setError('Your browser does not support video streaming.');
    }

    return () => {
      report();
      hls.current?.destroy();
      hls.current = null;
      v.removeAttribute('src');
      v.load();
    };
    // startAt intentionally excluded: it only applies to the first load of this source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, report]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapper.current);
    document.addEventListener('fullscreenchange', onFs);
    const onUnload = () => report();
    window.addEventListener('pagehide', onUnload);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('pagehide', onUnload);
    };
  }, [report]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setError('Playback was blocked. Press play to try again.'));
    else v.pause();
  };

  const seek = (t: number) => {
    const v = video.current;
    if (v) v.currentTime = Math.max(0, Math.min(t, v.duration || t));
  };

  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapper.current?.requestFullscreen?.();
  };

  const chooseTrack = (id: number) => {
    setTrack(id);
    if (hls.current) hls.current.subtitleTrack = id;
    setShowMenu(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const v = video.current;
    if (!v) return;
    switch (e.key) {
      case ' ': case 'k': e.preventDefault(); toggle(); break;
      case 'ArrowRight': e.preventDefault(); seek(v.currentTime + 10); break;
      case 'ArrowLeft': e.preventDefault(); seek(v.currentTime - 10); break;
      case 'ArrowUp': e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); break;
      case 'ArrowDown': e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); break;
      case 'm': v.muted = !v.muted; break;
      case 'f': toggleFs(); break;
    }
  };

  return (
    <div
      ref={wrapper}
      onKeyDown={onKeyDown}
      className="group relative aspect-video w-full overflow-hidden rounded-xl bg-black"
      role="region"
      aria-label={`Video player: ${title}`}
    >
      <video
        ref={video}
        poster={poster ?? undefined}
        playsInline
        className="h-full w-full"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); report(); }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => { setBuffering(false); setError(null); }}
        onCanPlay={() => setBuffering(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onSeeked={report}
        onEnded={report}
        onVolumeChange={(e) => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted); }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setTime(v.currentTime);
          const now = Date.now();
          if (now - lastSaved.current > 10_000 && !v.paused) {
            lastSaved.current = now;
            report();
          }
        }}
      />

      {buffering && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30"><Spinner label="Buffering" /></div>
      )}
      {error && (
        <div role="alert" className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center text-sm">{error}</div>
      )}

      <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/90 to-transparent px-3 pb-2 pt-10 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={Math.min(time, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
          className="h-1.5 w-full cursor-pointer accent-[#f2b84b]"
        />
        <div className="flex items-center gap-3">
          <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="rounded p-1.5 hover:bg-white/15">
            {playing ? <Pause className="h-5 w-5" aria-hidden /> : <Play className="h-5 w-5" aria-hidden />}
          </button>
          <button type="button" onClick={() => { if (video.current) video.current.muted = !video.current.muted; }} aria-label={muted ? 'Unmute' : 'Mute'} className="rounded p-1.5 hover:bg-white/15">
            {muted || volume === 0 ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
          </button>
          <input
            type="range" min={0} max={1} step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => { const v = video.current; if (v) { v.volume = Number(e.target.value); v.muted = false; } }}
            aria-label="Volume"
            className="hidden w-20 cursor-pointer accent-[#f2b84b] sm:block"
          />
          <span className="text-xs tabular-nums text-fog-300" aria-hidden>{formatClock(time)} / {formatClock(duration)}</span>
          <div className="ml-auto flex items-center gap-1">
            {tracks.length > 0 && (
              <div className="relative">
                <button type="button" onClick={() => setShowMenu((s) => !s)} aria-label="Subtitles" aria-expanded={showMenu} aria-haspopup="menu" className={`rounded p-1.5 hover:bg-white/15 ${track >= 0 ? 'text-gold-400' : ''}`}>
                  <Captions className="h-5 w-5" aria-hidden />
                </button>
                {showMenu && (
                  <ul role="menu" className="absolute bottom-10 right-0 min-w-36 rounded-lg border border-ink-500 bg-ink-800 p-1 text-sm shadow-xl">
                    <li role="none"><button role="menuitemradio" aria-checked={track === -1} type="button" onClick={() => chooseTrack(-1)} className="w-full rounded px-3 py-1.5 text-left hover:bg-ink-600">Off</button></li>
                    {tracks.map((t) => (
                      <li role="none" key={t.id}><button role="menuitemradio" aria-checked={track === t.id} type="button" onClick={() => chooseTrack(t.id)} className="w-full rounded px-3 py-1.5 text-left hover:bg-ink-600">{t.name}</button></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <button type="button" onClick={toggleFs} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} className="rounded p-1.5 hover:bg-white/15">
              {fullscreen ? <Minimize className="h-5 w-5" aria-hidden /> : <Maximize className="h-5 w-5" aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
