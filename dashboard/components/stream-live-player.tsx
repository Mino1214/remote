"use client";

import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type StreamLiveInfo = {
  hlsUrl: string;
  watermarkText: string | null;
  exp: number; // unix seconds
};

/**
 * 라이브 스트림 플레이어.
 * - HLS.js로 저지연(LL-HLS) 재생.
 * - 토큰 만료 시 자동 갱신.
 * - 항상 우상단 워터마크(클라이언트 화면에 박힌 것과 별개로 시청자 측 표시).
 * - 본인이 보고 있다는 사실을 시청자도 인지하도록 watermark + 시청 시작/중지 버튼 명시.
 */
export function StreamLivePlayer({
  streamId,
  initialInfo
}: {
  streamId: string;
  initialInfo: StreamLiveInfo;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [info, setInfo] = useState<StreamLiveInfo>(initialInfo);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshToken(): Promise<StreamLiveInfo | null> {
    try {
      const res = await fetch(`/api/streams/${streamId}/playback-token`, { cache: "no-store" });
      if (!res.ok) {
        setError(`Token refresh failed: ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { data: StreamLiveInfo };
      setInfo(json.data);
      return json.data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Token refresh error");
      return null;
    }
  }

  function teardown() {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
  }

  async function start() {
    setError(null);
    if (!videoRef.current) return;
    teardown();

    let current = info;
    if (current.exp - Math.floor(Date.now() / 1000) < 30) {
      const refreshed = await refreshToken();
      if (!refreshed) return;
      current = refreshed;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        liveSyncDuration: 2,
        liveMaxLatencyDuration: 6,
        backBufferLength: 30
      });
      hlsRef.current = hls;
      hls.loadSource(current.hlsUrl);
      hls.attachMedia(videoRef.current);
      hls.on(Hls.Events.ERROR, async (_evt, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.response?.code === 401) {
            const refreshed = await refreshToken();
            if (refreshed) {
              hls.loadSource(refreshed.hlsUrl);
              hls.startLoad();
              return;
            }
          }
          setError(`HLS fatal: ${data.type} / ${data.details}`);
          teardown();
          setPlaying(false);
        }
      });
    } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
      videoRef.current.src = current.hlsUrl;
    } else {
      setError("이 브라우저는 HLS 재생을 지원하지 않습니다.");
      return;
    }

    try {
      await videoRef.current.play();
      setPlaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Playback error");
    }
  }

  function stop() {
    teardown();
    setPlaying(false);
  }

  useEffect(() => {
    return () => teardown();
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border bg-black">
        <video
          ref={videoRef}
          className="aspect-video w-full"
          controls
          playsInline
          muted
        />
        {playing ? (
          <div className="pointer-events-none absolute right-3 top-3 rounded bg-red-600/90 px-2 py-1 text-xs font-semibold text-white shadow">
            ● LIVE — 시청 중 (피관찰자에게 통지됨)
          </div>
        ) : null}
        {info.watermarkText ? (
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[80%] truncate rounded bg-black/60 px-2 py-1 text-[11px] text-white/80">
            {info.watermarkText}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {!playing ? (
          <Button onClick={start}>● 시청 시작</Button>
        ) : (
          <Button variant="outline" onClick={stop}>
            ■ 시청 중지
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          이 시청 행위는 audit log에 기록되며, 클라이언트 화면에는 항상 ● REC 워터마크가 표시됩니다.
        </span>
      </div>
      {error ? (
        <p className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
