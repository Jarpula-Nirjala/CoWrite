import type { Op, Vector } from '../../../shared/crdt.ts';
import type { SyncClient } from '../../../shared/sync-client.ts';

const ICE: RTCConfiguration = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

type Signal = { ch: 'mesh' | 'call'; kind: 'offer' | 'answer' | 'ice' | 'bye'; sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit };
type Wire = { t: 'vector'; v: Vector } | { t: 'ops'; ops: Op[] };

const waitIce = (pc: RTCPeerConnection) =>
  new Promise<void>((done) => {
    if (pc.iceGatheringState === 'complete') return done();
    const t = setTimeout(done, 3000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        done();
      }
    });
  });

const encode = (d: RTCSessionDescriptionInit) => btoa(unescape(encodeURIComponent(JSON.stringify(d))));
const decode = (s: string) => JSON.parse(decodeURIComponent(escape(atob(s.trim())))) as RTCSessionDescriptionInit;

/**
 * Peer-to-peer sync: a WebRTC data channel to every other editor in the room.
 * Edits flow directly between browsers, so people on the same network keep
 * editing together even if the server goes away. Connections are set up
 * through the server while it is reachable, or with copy-paste codes.
 */
export class PeerMesh {
  readonly links = new Map<string, { pc: RTCPeerConnection; dc: RTCDataChannel | null; manual: boolean; since: number }>();
  private off: (() => void)[] = [];
  private listeners = new Set<() => void>();
  sent = 0;
  received = 0;

  private client: SyncClient;

  constructor(client: SyncClient) {
    this.client = client;
    this.off.push(
      client.on((e, payload) => {
        if (e === 'local') this.broadcast({ t: 'ops', ops: payload as Op[] });
        if (e === 'signal') {
          const { from, data } = payload as { from: string; data: Signal };
          if (data?.ch === 'mesh') void this.onSignal(from, data);
        }
        if (e === 'peers') this.connectAll();
      }),
    );
    // Tell the others we are ready; whoever has the lower site id makes the offer.
    client.setExt({ p2p: true });
    this.connectAll();
    this.retry = setInterval(() => this.connectAll(), 5000);
  }

  private retry: ReturnType<typeof setInterval>;

  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private changed() {
    for (const cb of this.listeners) cb();
  }

  get open(): string[] {
    return [...this.links].filter(([, l]) => l.dc?.readyState === 'open').map(([site]) => site);
  }

  /** The lower site id makes the offer, so each pair connects exactly once. */
  private connectAll() {
    if (this.client.status !== 'online') return;
    const now = Date.now();
    for (const [site, peer] of this.client.peers) {
      if (!peer.ext?.p2p || this.client.doc.site > site) continue;
      const link = this.links.get(site);
      // Retry handshakes that never completed (e.g. the other side was not ready yet).
      if (link && (link.dc?.readyState === 'open' || now - link.since < 8000)) continue;
      link?.pc.close();
      void this.offer(site);
    }
    // Forget peers that left or turned direct sync off.
    for (const [site, link] of this.links) {
      if (link.manual) continue;
      if (!this.client.peers.get(site)?.ext?.p2p) {
        link.pc.close();
        this.links.delete(site);
      }
    }
    this.changed();
  }

  private makePc(site: string, manual: boolean) {
    const pc = new RTCPeerConnection(ICE);
    const link = { pc, dc: null as RTCDataChannel | null, manual, since: Date.now() };
    this.links.set(site, link);
    pc.onicecandidate = (ev) => {
      if (ev.candidate && !manual) this.client.sendSignal(site, { ch: 'mesh', kind: 'ice', cand: ev.candidate.toJSON() } satisfies Signal);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (this.links.get(site)?.pc === pc) this.links.delete(site);
      }
      this.changed();
    };
    pc.ondatachannel = (ev) => this.attach(site, ev.channel);
    return link;
  }

  private attach(site: string, dc: RTCDataChannel) {
    const link = this.links.get(site);
    if (!link) return;
    link.dc = dc;
    dc.onopen = () => {
      // Exchange state vectors; each side then sends what the other lacks.
      dc.send(JSON.stringify({ t: 'vector', v: this.client.doc.vector } satisfies Wire));
      this.changed();
    };
    dc.onclose = () => this.changed();
    dc.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as Wire;
      if (msg.t === 'vector') {
        const missing = this.client.doc.missingFor(msg.v);
        for (let i = 0; i < missing.length; i += 500) dc.send(JSON.stringify({ t: 'ops', ops: missing.slice(i, i + 500) } satisfies Wire));
        this.sent += missing.length;
      } else if (msg.t === 'ops') {
        this.received += this.client.applyRemote(msg.ops).length;
      }
      this.changed();
    };
  }

  private broadcast(msg: Wire) {
    const data = JSON.stringify(msg);
    for (const l of this.links.values()) {
      if (l.dc?.readyState === 'open') {
        l.dc.send(data);
        if (msg.t === 'ops') this.sent += msg.ops.length;
      }
    }
  }

  private async offer(site: string) {
    const { pc } = this.makePc(site, false);
    this.attach(site, pc.createDataChannel('ops'));
    await pc.setLocalDescription(await pc.createOffer());
    this.client.sendSignal(site, { ch: 'mesh', kind: 'offer', sdp: pc.localDescription!.toJSON() } satisfies Signal);
  }

  private async onSignal(from: string, s: Signal) {
    try {
      if (s.kind === 'offer') {
        this.links.get(from)?.pc.close();
        const { pc } = this.makePc(from, false);
        await pc.setRemoteDescription(s.sdp!);
        await pc.setLocalDescription(await pc.createAnswer());
        this.client.sendSignal(from, { ch: 'mesh', kind: 'answer', sdp: pc.localDescription!.toJSON() } satisfies Signal);
      } else if (s.kind === 'answer') {
        await this.links.get(from)?.pc.setRemoteDescription(s.sdp!);
      } else if (s.kind === 'ice' && s.cand) {
        await this.links.get(from)?.pc.addIceCandidate(s.cand).catch(() => {});
      }
    } catch {
      // A failed handshake just means no direct link to that peer.
    }
  }

  // ------------------------------------------------ manual (no server) pairing

  /** Step 1 on device A: a code to give to device B. */
  async createInvite(): Promise<{ code: string; accept(answer: string): Promise<void> }> {
    const id = `manual-${Math.random().toString(36).slice(2, 8)}`;
    const { pc } = this.makePc(id, true);
    this.attach(id, pc.createDataChannel('ops'));
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    return {
      code: encode(pc.localDescription!.toJSON()),
      accept: async (answer: string) => {
        await pc.setRemoteDescription(decode(answer));
      },
    };
  }

  /** Step 2 on device B: turn A's code into a reply code. */
  async acceptInvite(code: string): Promise<string> {
    const id = `manual-${Math.random().toString(36).slice(2, 8)}`;
    const { pc } = this.makePc(id, true);
    await pc.setRemoteDescription(decode(code));
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    return encode(pc.localDescription!.toJSON());
  }

  close() {
    clearInterval(this.retry);
    for (const f of this.off) f();
    for (const l of this.links.values()) l.pc.close();
    this.links.clear();
    this.client.setExt({ p2p: false });
    this.changed();
  }
}

/**
 * Voice and video calls inside a document: a mesh of WebRTC connections
 * between everyone who joined the call (works best for small groups).
 */
export class CallManager {
  local: MediaStream | null = null;
  readonly remotes = new Map<string, MediaStream>();
  private pcs = new Map<string, RTCPeerConnection>();
  private off: (() => void) | null = null;
  private listeners = new Set<() => void>();
  muted = false;
  cameraOff = false;

  private client: SyncClient;

  constructor(client: SyncClient) {
    this.client = client;
  }

  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private changed() {
    for (const cb of this.listeners) cb();
  }

  get active() {
    return !!this.local;
  }

  async join(video: boolean) {
    this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { width: 640, height: 360 } : false });
    this.cameraOff = !video;
    this.client.setExt({ inCall: true });
    this.off = this.client.on((e, payload) => {
      if (e === 'signal') {
        const { from, data } = payload as { from: string; data: Signal };
        if (data?.ch === 'call') void this.onSignal(from, data);
      }
      if (e === 'peers') this.sync();
    });
    this.sync();
    this.changed();
  }

  /** Calls everyone in the call we are not connected to yet (lower site id calls). */
  private sync() {
    if (!this.local) return;
    for (const [site, peer] of this.client.peers) {
      if (!peer.ext?.inCall) {
        this.drop(site);
        continue;
      }
      if (!this.pcs.has(site) && this.client.doc.site < site) void this.call(site);
    }
  }

  private makePc(site: string) {
    const pc = new RTCPeerConnection(ICE);
    this.pcs.set(site, pc);
    for (const t of this.local!.getTracks()) pc.addTrack(t, this.local!);
    pc.onicecandidate = (ev) => ev.candidate && this.client.sendSignal(site, { ch: 'call', kind: 'ice', cand: ev.candidate.toJSON() } satisfies Signal);
    pc.ontrack = (ev) => {
      this.remotes.set(site, ev.streams[0]);
      this.changed();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(site);
    };
    return pc;
  }

  private async call(site: string) {
    const pc = this.makePc(site);
    await pc.setLocalDescription(await pc.createOffer());
    this.client.sendSignal(site, { ch: 'call', kind: 'offer', sdp: pc.localDescription!.toJSON() } satisfies Signal);
  }

  private async onSignal(from: string, s: Signal) {
    if (!this.local) return;
    try {
      if (s.kind === 'offer') {
        // Reuse the connection for renegotiation (e.g. a camera added mid-call).
        let pc = this.pcs.get(from);
        if (!pc || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          pc?.close();
          pc = this.makePc(from);
        }
        await pc.setRemoteDescription(s.sdp!);
        await pc.setLocalDescription(await pc.createAnswer());
        this.client.sendSignal(from, { ch: 'call', kind: 'answer', sdp: pc.localDescription!.toJSON() } satisfies Signal);
      } else if (s.kind === 'answer') await this.pcs.get(from)?.setRemoteDescription(s.sdp!);
      else if (s.kind === 'ice' && s.cand) await this.pcs.get(from)?.addIceCandidate(s.cand).catch(() => {});
      else if (s.kind === 'bye') this.drop(from);
    } catch {
      this.drop(from);
    }
  }

  private drop(site: string) {
    this.pcs.get(site)?.close();
    this.pcs.delete(site);
    if (this.remotes.delete(site)) this.changed();
  }

  toggleMute() {
    this.muted = !this.muted;
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !this.muted;
    this.changed();
  }

  async toggleCamera() {
    if (!this.local) return;
    const track = this.local.getVideoTracks()[0];
    if (track) {
      track.enabled = this.cameraOff;
      this.cameraOff = !this.cameraOff;
    } else {
      // Joined audio-only: add a camera track and renegotiate with everyone.
      const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
      const t = cam.getVideoTracks()[0];
      this.local.addTrack(t);
      this.cameraOff = false;
      for (const [site, pc] of this.pcs) {
        pc.addTrack(t, this.local);
        await pc.setLocalDescription(await pc.createOffer());
        this.client.sendSignal(site, { ch: 'call', kind: 'offer', sdp: pc.localDescription!.toJSON() } satisfies Signal);
      }
    }
    this.changed();
  }

  leave() {
    for (const site of this.pcs.keys()) this.client.sendSignal(site, { ch: 'call', kind: 'bye' } satisfies Signal);
    for (const pc of this.pcs.values()) pc.close();
    this.pcs.clear();
    this.remotes.clear();
    for (const t of this.local?.getTracks() ?? []) t.stop();
    this.local = null;
    this.off?.();
    this.off = null;
    this.client.setExt({ inCall: false });
    this.changed();
  }
}
