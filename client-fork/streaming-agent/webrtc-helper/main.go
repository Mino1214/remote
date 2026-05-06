package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

type config struct {
	DashboardBase string
	StreamID      string
	StreamKey     string
	IngestSecret  string
	FfmpegPath    string
	FPS           int
	BitrateKbps   int
	PollInterval  time.Duration
	IceServersJSON string
}

type sessionResponse struct {
	Data *struct {
		SessionID string `json:"sessionId"`
	} `json:"data"`
}

type signalResponse struct {
	Data struct {
		OfferSDP   *string  `json:"offerSdp"`
		Candidates []string `json:"candidates"`
	} `json:"data"`
}

type helper struct {
	cfg    config
	client *http.Client
}

func main() {
	cfg := parseFlags()
	if cfg.FfmpegPath == "" {
		cfg.FfmpegPath = "ffmpeg"
	}
	if cfg.FPS < 5 {
		cfg.FPS = 5
	}
	if cfg.BitrateKbps < 600 {
		cfg.BitrateKbps = 600
	}

	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	h := &helper{
		cfg: cfg,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
	if err := h.run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("webrtc helper stopped: %v", err)
	}
}

func parseFlags() config {
	var cfg config
	var pollMS int
	flag.StringVar(&cfg.DashboardBase, "dashboard-base", "", "dashboard base URL")
	flag.StringVar(&cfg.StreamID, "stream-id", "", "stream id")
	flag.StringVar(&cfg.StreamKey, "stream-key", "", "stream key")
	flag.StringVar(&cfg.IngestSecret, "ingest-secret", "", "ingest secret")
	flag.StringVar(&cfg.FfmpegPath, "ffmpeg-path", "", "ffmpeg executable path")
	flag.IntVar(&cfg.FPS, "fps", 15, "capture framerate")
	flag.IntVar(&cfg.BitrateKbps, "bitrate-kbps", 1500, "video bitrate")
	flag.IntVar(&pollMS, "poll-ms", 1000, "signaling poll interval in milliseconds")
	flag.StringVar(&cfg.IceServersJSON, "ice-servers-json", "", "JSON array of RTCIceServer objects (optional)")
	flag.Parse()

	if strings.TrimSpace(cfg.DashboardBase) == "" || strings.TrimSpace(cfg.StreamID) == "" || strings.TrimSpace(cfg.IngestSecret) == "" {
		log.Fatal("--dashboard-base, --stream-id, and --ingest-secret are required")
	}
	cfg.DashboardBase = strings.TrimRight(cfg.DashboardBase, "/")
	if pollMS < 250 {
		pollMS = 250
	}
	cfg.PollInterval = time.Duration(pollMS) * time.Millisecond
	return cfg
}

func iceServersFromJSON(raw string) []webrtc.ICEServer {
	if strings.TrimSpace(raw) == "" {
		return []webrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}}
	}
	var out []webrtc.ICEServer
	if err := json.Unmarshal([]byte(raw), &out); err != nil || len(out) == 0 {
		return []webrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}}
	}
	return out
}

func (h *helper) run(ctx context.Context) error {
	log.Printf("started streamId=%s streamKey=%s fps=%d bitrateKbps=%d", h.cfg.StreamID, h.cfg.StreamKey, h.cfg.FPS, h.cfg.BitrateKbps)
	var activeCancel context.CancelFunc
	var activeSession string
	defer func() {
		if activeCancel != nil {
			activeCancel()
		}
	}()

	ticker := time.NewTicker(h.cfg.PollInterval)
	defer ticker.Stop()
	for {
		sessionID, err := h.latestSession(ctx)
		if err != nil {
			log.Printf("latest session poll failed: %v", err)
		}
		if sessionID != "" && sessionID != activeSession {
			if activeCancel != nil {
				activeCancel()
				activeCancel = nil
			}
			childCtx, cancel := context.WithCancel(ctx)
			activeCancel = cancel
			activeSession = sessionID
			go func(id string) {
				if err := h.serveSession(childCtx, id); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("session %s ended: %v", id, err)
				}
			}(sessionID)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (h *helper) latestSession(ctx context.Context) (string, error) {
	var out sessionResponse
	if err := h.getJSON(ctx, fmt.Sprintf("/api/streams/%s/control/session?role=agent", h.cfg.StreamID), &out); err != nil {
		return "", err
	}
	if out.Data == nil {
		return "", nil
	}
	return out.Data.SessionID, nil
}

func (h *helper) serveSession(ctx context.Context, sessionID string) error {
	log.Printf("attaching signaling session=%s", sessionID)
	offer, candidates, err := h.waitOffer(ctx, sessionID)
	if err != nil {
		return err
	}

	mediaEngine := &webrtc.MediaEngine{}
	if err := mediaEngine.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000},
		PayloadType:        96,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return err
	}
	interceptors := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(mediaEngine, interceptors); err != nil {
		return err
	}
	api := webrtc.NewAPI(webrtc.WithMediaEngine(mediaEngine), webrtc.WithInterceptorRegistry(interceptors))
	pc, err := api.NewPeerConnection(webrtc.Configuration{
		ICEServers: iceServersFromJSON(h.cfg.IceServersJSON),
	})
	if err != nil {
		return err
	}
	defer pc.Close()

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("peer state session=%s state=%s", sessionID, state.String())
	})
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		log.Printf("datachannel opened label=%s", dc.Label())
		dc.OnMessage(func(msg webrtc.DataChannelMessage) {
			log.Printf("datachannel message ignored bytes=%d; dashboard HTTP event path remains authoritative", len(msg.Data))
		})
	})
	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		if err := h.postSignal(context.Background(), sessionID, map[string]string{
			"candidate": candidate.ToJSON().Candidate,
		}); err != nil {
			log.Printf("post local candidate failed: %v", err)
		}
	})

	track, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000},
		"screen",
		"streammonitor-"+h.cfg.StreamID,
	)
	if err != nil {
		return err
	}
	sender, err := pc.AddTrack(track)
	if err != nil {
		return err
	}
	go drainRTCP(ctx, sender)

	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offer}); err != nil {
		return err
	}
	for _, c := range candidates {
		if err := pc.AddICECandidate(webrtc.ICECandidateInit{Candidate: c}); err != nil {
			log.Printf("initial remote candidate ignored: %v", err)
		}
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		return err
	}
	gatherComplete := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(answer); err != nil {
		return err
	}
	<-gatherComplete
	local := pc.LocalDescription()
	if local == nil {
		return errors.New("missing local description")
	}
	if err := h.postSignal(ctx, sessionID, map[string]string{"answerSdp": local.SDP}); err != nil {
		return err
	}

	streamCtx, stopStream := context.WithCancel(ctx)
	defer stopStream()
	if err := h.startRTPForwarder(streamCtx, track); err != nil {
		return err
	}

	return h.pollRemoteCandidates(ctx, sessionID, pc, len(candidates))
}

func (h *helper) waitOffer(ctx context.Context, sessionID string) (string, []string, error) {
	ticker := time.NewTicker(h.cfg.PollInterval)
	defer ticker.Stop()
	for {
		var out signalResponse
		err := h.getJSON(ctx, fmt.Sprintf("/api/streams/%s/control/signal?sessionId=%s&role=agent", h.cfg.StreamID, sessionID), &out)
		if err != nil {
			log.Printf("offer poll failed: %v", err)
		} else if out.Data.OfferSDP != nil && *out.Data.OfferSDP != "" {
			return *out.Data.OfferSDP, out.Data.Candidates, nil
		}

		select {
		case <-ctx.Done():
			return "", nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (h *helper) pollRemoteCandidates(ctx context.Context, sessionID string, pc *webrtc.PeerConnection, cursor int) error {
	ticker := time.NewTicker(h.cfg.PollInterval)
	defer ticker.Stop()
	for {
		var out signalResponse
		if err := h.getJSON(ctx, fmt.Sprintf("/api/streams/%s/control/signal?sessionId=%s&role=agent", h.cfg.StreamID, sessionID), &out); err != nil {
			log.Printf("candidate poll failed: %v", err)
		} else {
			for cursor < len(out.Data.Candidates) {
				if err := pc.AddICECandidate(webrtc.ICECandidateInit{Candidate: out.Data.Candidates[cursor]}); err != nil {
					log.Printf("remote candidate ignored: %v", err)
				}
				cursor++
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (h *helper) startRTPForwarder(ctx context.Context, track *webrtc.TrackLocalStaticRTP) error {
	conn, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		return err
	}

	udpAddr := conn.LocalAddr().(*net.UDPAddr)
	cmd := exec.CommandContext(ctx, h.cfg.FfmpegPath,
		"-hide_banner",
		"-loglevel", "warning",
		"-f", "gdigrab",
		"-framerate", fmt.Sprintf("%d", h.cfg.FPS),
		"-i", "desktop",
		"-an",
		"-c:v", "libvpx",
		"-deadline", "realtime",
		"-cpu-used", "8",
		"-b:v", fmt.Sprintf("%dk", h.cfg.BitrateKbps),
		"-maxrate", fmt.Sprintf("%dk", h.cfg.BitrateKbps),
		"-bufsize", fmt.Sprintf("%dk", h.cfg.BitrateKbps*2),
		"-pix_fmt", "yuv420p",
		"-payload_type", "96",
		"-f", "rtp",
		fmt.Sprintf("rtp://127.0.0.1:%d?pkt_size=1200", udpAddr.Port),
	)
	var stderr bytes.Buffer
	cmd.Stdout = io.Discard
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		_ = conn.Close()
		return fmt.Errorf("start ffmpeg: %w", err)
	}
	log.Printf("ffmpeg RTP started pid=%d port=%d", cmd.Process.Pid, udpAddr.Port)

	go func() {
		<-ctx.Done()
		_ = conn.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}()
	go func() {
		if err := cmd.Wait(); err != nil && ctx.Err() == nil {
			log.Printf("ffmpeg RTP exited: %v stderr=%s", err, strings.TrimSpace(stderr.String()))
		}
		_ = conn.Close()
	}()
	go forwardRTP(ctx, conn, track)
	return nil
}

func forwardRTP(ctx context.Context, conn net.PacketConn, track *webrtc.TrackLocalStaticRTP) {
	buf := make([]byte, 1600)
	packet := &rtp.Packet{}
	for {
		n, _, err := conn.ReadFrom(buf)
		if err != nil {
			if ctx.Err() == nil {
				log.Printf("RTP read stopped: %v", err)
			}
			return
		}
		if err := packet.Unmarshal(buf[:n]); err != nil {
			log.Printf("RTP unmarshal ignored: %v", err)
			continue
		}
		if err := track.WriteRTP(packet); err != nil {
			if ctx.Err() == nil {
				log.Printf("RTP write stopped: %v", err)
			}
			return
		}
	}
}

func drainRTCP(ctx context.Context, sender *webrtc.RTPSender) {
	rtcpBuf := make([]byte, 1500)
	for {
		if _, _, err := sender.Read(rtcpBuf); err != nil {
			if ctx.Err() == nil {
				log.Printf("RTCP read stopped: %v", err)
			}
			return
		}
	}
}

func (h *helper) getJSON(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.cfg.DashboardBase+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+h.cfg.IngestSecret)
	res, err := h.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("GET %s: %s %s", path, res.Status, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(res.Body).Decode(out)
}

func (h *helper) postSignal(ctx context.Context, sessionID string, values map[string]string) error {
	body := map[string]string{
		"sessionId": sessionID,
		"role":      "agent",
	}
	for k, v := range values {
		body[k] = v
	}
	return h.postJSON(ctx, fmt.Sprintf("/api/streams/%s/control/signal", h.cfg.StreamID), body)
}

func (h *helper) postJSON(ctx context.Context, path string, body any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.cfg.DashboardBase+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+h.cfg.IngestSecret)
	req.Header.Set("Content-Type", "application/json")
	res, err := h.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		text, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("POST %s: %s %s", path, res.Status, strings.TrimSpace(string(text)))
	}
	return nil
}
