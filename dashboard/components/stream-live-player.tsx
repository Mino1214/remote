"use client";

import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

function iceServersFromEnv(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS;
  if (!raw) return [{ urls: "stun:stun.l.google.com:19302" }];
  try {
    const parsed = JSON.parse(raw) as RTCIceServer[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // ignore
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

type StreamLivePlayerProps = {
  streamId: string;
  watermarkText?: string | null;
  autoConnect?: boolean;
  compact?: boolean;
};

export function StreamLivePlayer({
  streamId,
  watermarkText,
  autoConnect = true,
  compact = false
}: StreamLivePlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const controlSessionIdRef = useRef<string | null>(null);
  const signalPollRef = useRef<number | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const webrtcTimeoutRef = useRef<number | null>(null);
  const videoReadyRef = useRef(false);
  const hlsFallbackStartedRef = useRef(false);
  const agentCandidateCursorRef = useRef(0);
  const lastMouseMoveAtRef = useRef(0);
  const startedRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("연결 준비 중");
  const [error, setError] = useState<string | null>(null);
  const [hasVideoFrame, setHasVideoFrame] = useState(false);
  const shouldShowIndicator =
    !compact ||
    !hasVideoFrame ||
    Boolean(error) ||
    status.includes("대기 지연") ||
    status.includes("폴백") ||
    status.includes("실패");

  const isBenignPlayInterrupt = useCallback((value: unknown) => {
    if (!(value instanceof DOMException)) return false;
    if (value.name === "AbortError") return true;
    return value.message.toLowerCase().includes("interrupted by a new load request");
  }, []);

  const teardownMedia = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (webrtcTimeoutRef.current !== null) {
      window.clearTimeout(webrtcTimeoutRef.current);
      webrtcTimeoutRef.current = null;
    }
    remoteStreamRef.current = null;
    videoReadyRef.current = false;
    hlsFallbackStartedRef.current = false;
    setHasVideoFrame(false);
    if (videoRef.current) {
      videoRef.current.removeAttribute("src");
      videoRef.current.srcObject = null;
    }
  }, []);

  const startHlsFallback = useCallback(async () => {
    if (!videoRef.current) return;
    if (hlsFallbackStartedRef.current) return;
    hlsFallbackStartedRef.current = true;
    try {
      const tokenRes = await fetch(`/api/streams/${streamId}/playback-token`, { cache: "no-store" });
      if (!tokenRes.ok) {
        hlsFallbackStartedRef.current = false;
        setError(`HLS token failed: ${tokenRes.status}`);
        return;
      }
      const tokenJson = (await tokenRes.json()) as { data: { hlsUrl: string } };
      const hlsUrl = tokenJson.data.hlsUrl;

      if (Hls.isSupported()) {
        const hls = new Hls({
          lowLatencyMode: true,
          liveSyncDurationCount: 1,
          liveMaxLatencyDurationCount: 3
        });
        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal) {
            setError(`HLS fallback error: ${data.details}`);
          }
        });
      } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
        videoRef.current.src = hlsUrl;
      } else {
        hlsFallbackStartedRef.current = false;
        setError("이 브라우저는 HLS 재생을 지원하지 않습니다.");
        return;
      }

      await videoRef.current.play();
      videoReadyRef.current = true;
      setConnected(true);
      setStatus("HLS fallback 재생 중");
    } catch (e) {
      if (isBenignPlayInterrupt(e)) return;
      hlsFallbackStartedRef.current = false;
      setError(e instanceof Error ? e.message : "HLS fallback failed");
    }
  }, [isBenignPlayInterrupt, streamId]);

  const stopSignalPoll = useCallback(() => {
    if (signalPollRef.current !== null) {
      window.clearInterval(signalPollRef.current);
      signalPollRef.current = null;
    }
  }, []);

  const stopControl = useCallback(() => {
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
    setConnected(false);
    setStatus("연결 종료");
  }, [stopSignalPoll]);

  const sendControlEvent = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      const body = JSON.stringify({
        v: 1,
        t: type,
        ts: Date.now(),
        ...payload
      });
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") {
        dc.send(body);
      }
      const sessionId = controlSessionIdRef.current;
      if (!sessionId) return;
      void fetch(`/api/streams/${streamId}/control/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, payload: body })
      });
    },
    [streamId]
  );

  const pointerMeta = useCallback((element: HTMLVideoElement, event: ReactMouseEvent<HTMLVideoElement>) => {
    const rect = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
    return { x, y, w: rect.width, h: rect.height };
  }, []);

  const startControl = useCallback(async () => {
    setError(null);
    if (typeof RTCPeerConnection === "undefined") {
      setError("이 브라우저는 WebRTC를 지원하지 않습니다.");
      setStatus("WebRTC 미지원");
      return;
    }

    stopControl();
    teardownMedia();
    setStatus("시그널링 세션 생성 중");

    const sessionRes = await fetch(`/api/streams/${streamId}/control/session`, { method: "POST" });
    if (!sessionRes.ok) {
      setError(`Control session failed: ${sessionRes.status}`);
      setStatus("세션 생성 실패 · HLS 폴백 시도");
      await startHlsFallback();
      return;
    }

    const sessionJson = (await sessionRes.json()) as { data: { sessionId: string } };
    const sessionId = sessionJson.data.sessionId;
    controlSessionIdRef.current = sessionId;

    const pc = new RTCPeerConnection({ iceServers: iceServersFromEnv() });
    pcRef.current = pc;
    remoteStreamRef.current = new MediaStream();

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.ontrack = (event) => {
      if (!videoRef.current) return;
      const [stream] = event.streams;
      const remoteStream = stream ?? remoteStreamRef.current ?? new MediaStream();
      if (!stream) {
        remoteStream.addTrack(event.track);
      }
      remoteStreamRef.current = remoteStream;
      videoRef.current.srcObject = remoteStream;
      void videoRef.current
        .play()
        .then(() => {
          videoReadyRef.current = true;
          setConnected(true);
          setStatus("RTC 제어 연결됨");
        })
        .catch((e: unknown) => {
          if (isBenignPlayInterrupt(e)) return;
          setError(e instanceof Error ? e.message : "WebRTC playback error");
        });
    };

    const dc = pc.createDataChannel("remote-control", { ordered: true });
    dcRef.current = dc;
    dc.onopen = () => {
      setStatus("RTC 제어 연결됨 (영상 대기)");
    };
    dc.onclose = () => {
      setConnected(false);
      setStatus("연결 종료");
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected" && !videoReadyRef.current) {
        setStatus("RTC 연결됨 (영상 대기)");
      }
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setConnected(false);
        setStatus("연결 불안정");
      }
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

    setStatus("에이전트 응답 대기 중");
    // WebRTC가 짧은 시간 내 연결되지 않으면 자동으로 HLS로 폴백한다.
    webrtcTimeoutRef.current = window.setTimeout(() => {
      if (!videoReadyRef.current) {
        setStatus("RTC 대기 지연 · HLS 폴백");
        void startHlsFallback();
      }
    }, 4500);
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
        // polling is best-effort
      }
    }, 1000);
  }, [isBenignPlayInterrupt, startHlsFallback, stopControl, streamId, teardownMedia]);

  useEffect(() => {
    if (autoConnect && !startedRef.current) {
      startedRef.current = true;
      void startControl();
    }
    return () => {
      teardownMedia();
      stopControl();
    };
  }, [autoConnect, startControl, stopControl, teardownMedia]);

  return (
    <div className={compact ? "h-full bg-black" : "space-y-3"}>
      <div className={compact ? "relative h-full overflow-hidden bg-black" : "relative overflow-hidden bg-black"}>
        <video
          ref={videoRef}
          className={compact ? "h-full w-full bg-black object-contain" : "aspect-video w-full bg-black"}
          playsInline
          muted
          tabIndex={0}
          onLoadedData={() => setHasVideoFrame(true)}
          onCanPlay={() => setHasVideoFrame(true)}
          onMouseDown={(e) => {
            if (!videoRef.current) return;
            const meta = pointerMeta(videoRef.current, e);
            sendControlEvent("mouse_down", { ...meta, button: e.button });
            e.currentTarget.focus();
          }}
          onMouseUp={(e) => {
            if (!videoRef.current) return;
            const meta = pointerMeta(videoRef.current, e);
            sendControlEvent("mouse_up", { ...meta, button: e.button });
          }}
          onMouseMove={(e) => {
            if (!videoRef.current) return;
            const now = Date.now();
            if (now - lastMouseMoveAtRef.current < 50) return;
            lastMouseMoveAtRef.current = now;
            const meta = pointerMeta(videoRef.current, e);
            sendControlEvent("mouse_move", meta);
          }}
          onWheel={(e) => {
            if (!videoRef.current) return;
            const meta = pointerMeta(videoRef.current, e);
            sendControlEvent("mouse_wheel", { ...meta, dx: e.deltaX, dy: e.deltaY });
          }}
          onKeyDown={(e) => {
            sendControlEvent("key_down", { key: e.key, code: e.code });
          }}
          onKeyUp={(e) => {
            sendControlEvent("key_up", { key: e.key, code: e.code });
          }}
        />

        {shouldShowIndicator ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/80 px-2 py-1 text-xs font-semibold text-white">
            <span className={connected ? "text-[hsl(var(--status-online))]" : "text-[hsl(var(--status-offline))]"}>
              {connected ? "ONLINE" : "WAIT"}
            </span>{" "}
            · {status}
          </div>
        ) : null}

        {!compact && watermarkText ? (
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[80%] truncate rounded bg-black/70 px-2 py-1 text-xs text-white/80">
            {watermarkText}
          </div>
        ) : null}
      </div>

      {!compact && error ? <p className="border-t border-border bg-card p-3 text-xs text-primary">{error}</p> : null}
    </div>
  );
}
