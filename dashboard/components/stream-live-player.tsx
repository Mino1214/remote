"use client";

import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
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
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const controlSessionIdRef = useRef<string | null>(null);
  const signalPollRef = useRef<number | null>(null);
  const agentCandidateCursorRef = useRef(0);
  const lastMouseMoveAtRef = useRef(0);
  const [info, setInfo] = useState<StreamLiveInfo>(initialInfo);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controlConnected, setControlConnected] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [controlStatus, setControlStatus] = useState<string>("미연결");

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

  function stopSignalPoll() {
    if (signalPollRef.current !== null) {
      window.clearInterval(signalPollRef.current);
      signalPollRef.current = null;
    }
  }

  function stopControl() {
    stopSignalPoll();
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {}
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }
    controlSessionIdRef.current = null;
    setControlEnabled(false);
    setControlConnected(false);
    setControlStatus("미연결");
  }

  function sendControlEvent(type: string, payload: Record<string, unknown>) {
    const body = JSON.stringify({
      v: 1,
      t: type,
      ts: Date.now(),
      ...payload
    });
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      dc.send(body);
      return;
    }
    const sessionId = controlSessionIdRef.current;
    if (!sessionId) return;
    void fetch(`/api/streams/${streamId}/control/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, payload: body })
    });
  }

  function pointerMeta(element: HTMLVideoElement, event: ReactMouseEvent<HTMLVideoElement>) {
    const rect = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
    return { x, y, w: rect.width, h: rect.height };
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
        // 일반 HLS(mpegts) 환경에서도 라이브 추종을 공격적으로 유지해 지연을 줄인다.
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
        maxLiveSyncPlaybackRate: 1.2,
        backBufferLength: 10,
        maxBufferLength: 8
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

  async function startControl() {
    setError(null);
    if (typeof RTCPeerConnection === "undefined") {
      setError("이 브라우저는 WebRTC를 지원하지 않습니다.");
      return;
    }

    stopControl();
    setControlStatus("시그널링 세션 생성 중...");

    const sessionRes = await fetch(`/api/streams/${streamId}/control/session`, { method: "POST" });
    if (!sessionRes.ok) {
      setError(`Control session failed: ${sessionRes.status}`);
      setControlStatus("세션 생성 실패");
      return;
    }
    const sessionJson = (await sessionRes.json()) as { data: { sessionId: string } };
    const sessionId = sessionJson.data.sessionId;
    controlSessionIdRef.current = sessionId;
    setControlEnabled(true);
    setControlStatus("HTTP 제어 활성, DataChannel 협상 중...");

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;

    const dc = pc.createDataChannel("remote-control", { ordered: true });
    dcRef.current = dc;
    dc.onopen = () => {
      setControlConnected(true);
      setControlStatus("연결됨");
    };
    dc.onclose = () => {
      setControlConnected(false);
      setControlStatus("연결 종료");
    };

    pc.onicecandidate = async (event) => {
      if (!event.candidate) return;
      await fetch(`/api/streams/${streamId}/control/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          role: "viewer",
          candidate: event.candidate.candidate
        })
      });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await fetch(`/api/streams/${streamId}/control/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        role: "viewer",
        offerSdp: offer.sdp
      })
    });

    setControlStatus("에이전트 응답 대기 중... (미연결 시 HTTP 폴백)");
    agentCandidateCursorRef.current = 0;
    signalPollRef.current = window.setInterval(async () => {
      try {
        const pollRes = await fetch(
          `/api/streams/${streamId}/control/signal?sessionId=${encodeURIComponent(sessionId)}&role=viewer`,
          { cache: "no-store" }
        );
        if (!pollRes.ok) return;
        const pollJson = (await pollRes.json()) as {
          data: { answerSdp: string | null; candidates: string[] };
        };
        const answerSdp = pollJson.data.answerSdp;
        if (answerSdp && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
        }

        const candidates = pollJson.data.candidates || [];
        const startIndex = agentCandidateCursorRef.current;
        for (let i = startIndex; i < candidates.length; i += 1) {
          await pc.addIceCandidate({ candidate: candidates[i] });
        }
        agentCandidateCursorRef.current = candidates.length;
      } catch {
        // polling은 best-effort
      }
    }, 1000);
  }

  useEffect(() => {
    return () => {
      teardown();
      stopControl();
    };
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
          tabIndex={0}
          onMouseDown={(e) => {
            if (!controlEnabled || !videoRef.current) return;
            const meta = pointerMeta(videoRef.current, e);
            sendControlEvent("mouse_down", { ...meta, button: e.button });
            e.currentTarget.focus();
          }}
          onMouseUp={(e) => {
            if (!controlEnabled || !videoRef.current) return;
            const meta = pointerMeta(videoRef.current, e);
            sendControlEvent("mouse_up", { ...meta, button: e.button });
          }}
          onMouseMove={(e) => {
            if (!controlEnabled || !videoRef.current) return;
            const now = Date.now();
            if (now - lastMouseMoveAtRef.current < 50) return;
            lastMouseMoveAtRef.current = now;
            const meta = pointerMeta(videoRef.current, e);
            sendControlEvent("mouse_move", meta);
          }}
          onWheel={(e) => {
            if (!controlEnabled || !videoRef.current) return;
            const meta = pointerMeta(videoRef.current, e);
            sendControlEvent("mouse_wheel", { ...meta, dx: e.deltaX, dy: e.deltaY });
          }}
          onKeyDown={(e) => {
            if (!controlEnabled) return;
            sendControlEvent("key_down", { key: e.key, code: e.code });
          }}
          onKeyUp={(e) => {
            if (!controlEnabled) return;
            sendControlEvent("key_up", { key: e.key, code: e.code });
          }}
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
        {!controlEnabled ? (
          <Button variant="outline" onClick={startControl}>
            제어 채널 연결 (Beta)
          </Button>
        ) : (
          <Button variant="outline" onClick={stopControl}>
            제어 채널 종료
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          이 시청 행위는 audit log에 기록되며, 클라이언트 화면에는 항상 ● REC 워터마크가 표시됩니다.
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        원격 제어 상태: <span className="font-mono">{controlStatus}</span>
      </p>
      {error ? (
        <p className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
