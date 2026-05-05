"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

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
  const agentCandidateCursorRef = useRef(0);
  const lastMouseMoveAtRef = useRef(0);
  const startedRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("연결 준비 중");
  const [error, setError] = useState<string | null>(null);

  const teardownMedia = useCallback(() => {
    remoteStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.removeAttribute("src");
      videoRef.current.srcObject = null;
      videoRef.current.load();
    }
  }, []);

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
      setStatus("세션 생성 실패");
      return;
    }

    const sessionJson = (await sessionRes.json()) as { data: { sessionId: string } };
    const sessionId = sessionJson.data.sessionId;
    controlSessionIdRef.current = sessionId;

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
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
          setConnected(true);
          setStatus("RTC 제어 연결됨");
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "WebRTC playback error");
        });
    };

    const dc = pc.createDataChannel("remote-control", { ordered: true });
    dcRef.current = dc;
    dc.onopen = () => {
      setConnected(true);
      setStatus("RTC 제어 연결됨");
    };
    dc.onclose = () => {
      setConnected(false);
      setStatus("연결 종료");
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setConnected(true);
        setStatus("RTC 제어 연결됨");
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
  }, [stopControl, streamId, teardownMedia]);

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
    <div className={compact ? "bg-black" : "space-y-3"}>
      <div className="relative overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="aspect-video w-full bg-black"
          playsInline
          muted
          tabIndex={0}
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

        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/80 px-2 py-1 text-xs font-semibold text-white">
          <span className={connected ? "text-[hsl(var(--status-online))]" : "text-[hsl(var(--status-offline))]"}>
            {connected ? "ONLINE" : "WAIT"}
          </span>{" "}
          · {status}
        </div>

        {watermarkText ? (
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[80%] truncate rounded bg-black/70 px-2 py-1 text-xs text-white/80">
            {watermarkText}
          </div>
        ) : null}
      </div>

      {error ? <p className="border-t border-border bg-card p-3 text-xs text-primary">{error}</p> : null}
    </div>
  );
}
