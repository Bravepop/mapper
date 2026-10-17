import Peer, { type DataConnection } from 'peerjs';
import type { App } from '../app';
import type { Compass } from '../core/compass';
import { TILE_SIZE } from '../core/constants';
import type { Label } from '../core/labels';
import { isTileEmpty, tileKey, type TileLayer } from '../core/layer';
import { isLayerId, type LayerId } from '../core/layers';
import type { Autosave } from '../core/storage';
import { applyDiff, encodeDiff } from './codec';

/** Prefix for session ids on the public PeerJS matchmaking server, so codes stay short. */
const ID_PREFIX = 'vmapper-';
/** How often local paint is sent while drawing (ms). */
const TICK_MS = 80;
const CURSOR_MS = 50;
const CONNECT_TIMEOUT_MS = 15_000;
const NAME_KEY = 'mapper.name';
const COLORS = ['#d9a441', '#4fa3d9', '#e0614d', '#6fbf73', '#b07fd9', '#e07fb0', '#4fd9c4', '#d9d24f'];

export type Role = 'idle' | 'connecting' | 'host' | 'guest';
export interface Person {
  id: string;
  name: string;
  color: string;
  host?: boolean;
}

/** A paint layer or the fog of war mask. */
type Source = LayerId | 'fog';

type Message =
  | { t: 'hello'; name: string }
  | { t: 'peers'; list: Person[] }
  | { t: 'snap-start' }
  | { t: 'snap-tile'; layer: Source; x: number; y: number; png: ArrayBuffer }
  | { t: 'snap-end'; labels: Label[]; compass: Compass | null }
  | { t: 'px'; layer: Source; x: number; y: number; diff: ArrayBuffer }
  | { t: 'label'; id: string; label: Label | null }
  | { t: 'compass'; c: Compass | null }
  | { t: 'cur'; from: string; x: number | null; y: number | null };

/** Edits to the shared map (as opposed to presence and session bookkeeping). */
const isEdit = (m: Message) => m.t === 'px' || m.t === 'label' || m.t === 'compass';

const randomCode = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

/** Accept a bare code or a full join link. */
export function parseJoinCode(input: string): string | null {
  const s = input.trim();
  const fromUrl = /[?&]join=([a-z0-9]+)/i.exec(s);
  const code = (fromUrl ? fromUrl[1] : s.replace(new RegExp(`^${ID_PREFIX}`), '')).toLowerCase();
  return /^[a-z0-9]{4,32}$/.test(code) ? code : null;
}

/**
 * Live shared editing. One person hosts and shares a link; others join. It's
 * peer-to-peer (WebRTC via PeerJS): the public PeerJS server only introduces
 * the browsers, then map data flows directly between them.
 *
 * The host is the hub. Guests send their edits to the host, which applies them
 * and passes them on to everyone, the sender included. Every copy therefore
 * ends up applying edits in the host's order, so all copies converge even
 * when two people paint the same pixels at once.
 *
 * Paint is sent as pixel diffs: when a tile is about to change locally, its
 * pixels are captured, and every TICK_MS the changes since then are sent. Only
 * changed pixels travel, so people drawing in the same tile don't overwrite
 * each other.
 */
export class Collab {
  role: Role = 'idle';
  /** The session code (hosting or joined). */
  code: string | null = null;
  /** Everyone in the session, host first. */
  people: Person[] = [];
  /** A problem to show the user, if any. */
  error = '';
  name: string;

  private peer: Peer | null = null;
  /** Host: connections to guests that have said hello, by peer id. */
  private guests = new Map<string, DataConnection>();
  /** Host: guests still receiving the map; their live edits wait until it's sent. */
  private pending = new Map<string, Message[]>();
  /** Guest: the connection to the host. */
  private hostConn: DataConnection | null = null;
  /** Pixels of tiles as last sent or received, keyed `layer|tx,ty`. */
  private baselines = new Map<string, { data: Uint8ClampedArray; idle: number }>();
  /** True while applying someone else's edit, so it isn't sent back out. */
  private applying = false;
  private timer = 0;
  private cursorTimer = 0;
  private lastCursor = 0;
  private inbox: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor(
    private app: App,
    private autosave: Autosave,
  ) {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(NAME_KEY);
    } catch {
      // Storage unavailable: fall back to a generated name.
    }
    this.name = stored || `Viking ${Math.floor(10 + Math.random() * 90)}`;

    for (const layer of app.layers.all) layer.tiles.onBeforeWrite((tx, ty) => this.capture(layer.id, tx, ty));
    app.fog.onBeforeWrite((tx, ty) => this.capture('fog', tx, ty));
    app.labels.onUpdate((id, label) => this.local({ t: 'label', id, label }));
    app.compass.onChange(() => this.local({ t: 'compass', c: app.compass.get() }));
    app.onView(() => this.queueCursor());
    app.onDocumentReplaced(() => {
      if (this.role === 'host') this.resendToAll();
    });
    window.addEventListener('pagehide', () => this.leave());
  }

  get live(): boolean {
    return this.role === 'host' || this.role === 'guest';
  }

  /** The link a guest opens to join this session. */
  get link(): string | null {
    if (!this.code) return null;
    const url = new URL(location.href);
    url.search = `?join=${this.code}`;
    url.hash = '';
    return url.toString();
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  setName(name: string): void {
    this.name = name.trim().slice(0, 24) || this.name;
    try {
      localStorage.setItem(NAME_KEY, this.name);
    } catch {
      // Not critical.
    }
    this.emit();
  }

  // ---- Starting and ending ------------------------------------------------

  host(): void {
    if (this.role !== 'idle') return;
    this.code = randomCode();
    this.connecting();
    const peer = new Peer(ID_PREFIX + this.code);
    this.peer = peer;
    peer.on('open', (id) => {
      this.role = 'host';
      this.people = [{ id, name: this.name, color: COLORS[0], host: true }];
      this.started();
    });
    peer.on('connection', (conn) => this.acceptGuest(conn));
    peer.on('disconnected', () => {
      // Lost the matchmaking server; existing connections keep working. Reconnect so new guests can still join.
      if (this.role === 'host' && !peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Code already taken: try another.
        this.reset();
        this.host();
      } else this.fail(err);
    });
  }

  join(code: string): void {
    if (this.role !== 'idle') return;
    this.code = code;
    this.connecting();
    const peer = new Peer();
    this.peer = peer;
    const timeout = window.setTimeout(() => {
      if (this.role === 'connecting') this.fail({ type: 'timeout' });
    }, CONNECT_TIMEOUT_MS);
    peer.on('error', (err) => this.fail(err));
    peer.on('open', () => {
      const conn = peer.connect(ID_PREFIX + code, { reliable: true });
      this.hostConn = conn;
      conn.on('open', () => {
        clearTimeout(timeout);
        this.role = 'guest';
        conn.send({ t: 'hello', name: this.name } satisfies Message);
        this.app.replaceBlocked = "You're in a shared map. Leave the session first to start or open another map.";
        this.app.paintBlocked = 'Loading the shared map…';
        this.started();
      });
      conn.on('data', (data) => this.receive(data as Message, conn));
      conn.on('close', () => {
        if (this.role === 'guest') this.end('The host ended the session. You keep a copy of the map.');
      });
      conn.on('error', (err) => this.fail(err));
    });
  }

  /** Leave (or, as host, end) the session. Everyone keeps their copy of the map. */
  leave(): void {
    if (this.role === 'idle') return;
    this.end('');
  }

  private connecting(): void {
    this.role = 'connecting';
    this.error = '';
    this.emit();
  }

  private started(): void {
    this.baselines.clear();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.emit();
  }

  private end(message: string): void {
    this.reset();
    this.error = message;
    this.emit();
  }

  private reset(): void {
    clearInterval(this.timer);
    clearTimeout(this.cursorTimer);
    for (const c of this.guests.values()) c.close();
    this.hostConn?.close();
    this.peer?.destroy();
    this.peer = null;
    this.hostConn = null;
    this.guests.clear();
    this.pending.clear();
    this.baselines.clear();
    this.people = [];
    this.role = 'idle';
    this.code = null;
    this.app.paintBlocked = null;
    this.app.replaceBlocked = null;
    this.app.remoteCursors.clear();
    this.app.requestRender();
  }

  private fail(err: { type: string; message?: string }): void {
    const messages: Record<string, string> = {
      'peer-unavailable': 'No session found with that code. Check it, and that the host still has Mapper open.',
      network: "Couldn't reach the matchmaking server. Check your internet connection.",
      'server-error': 'The matchmaking server had a problem. Try again in a moment.',
      'socket-error': "Couldn't reach the matchmaking server. Check your internet connection.",
      'browser-incompatible': "This browser can't do peer-to-peer connections. Try Chrome, Edge or Firefox.",
      timeout: "Couldn't connect to the host. Their network (or yours) may block direct connections.",
    };
    if (this.role === 'host' && this.guests.size > 0 && err.type !== 'browser-incompatible') {
      // A hiccup with one guest or the matchmaking server; the session itself carries on.
      console.warn('Shared session problem', err);
      return;
    }
    console.warn('Shared session failed', err);
    this.end(messages[err.type] ?? `Connection problem (${err.type}).`);
  }

  // ---- Host: guests ---------------------------------------------------------

  private acceptGuest(conn: DataConnection): void {
    conn.on('data', (data) => this.receive(data as Message, conn));
    conn.on('close', () => this.dropGuest(conn.peer));
    conn.on('error', () => this.dropGuest(conn.peer));
  }

  private dropGuest(id: string): void {
    if (!this.guests.delete(id)) return;
    this.pending.delete(id);
    this.people = this.people.filter((p) => p.id !== id);
    this.app.remoteCursors.delete(id);
    this.app.requestRender();
    this.broadcast({ t: 'peers', list: this.people });
    this.emit();
  }

  private welcome(conn: DataConnection, name: string): void {
    const used = new Set(this.people.map((p) => p.color));
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[this.people.length % COLORS.length];
    this.people.push({ id: conn.peer, name: name.slice(0, 24) || 'Guest', color });
    this.guests.set(conn.peer, conn);
    this.broadcast({ t: 'peers', list: this.people });
    this.emit();
    void this.sendSnapshot([conn]);
  }

  /** After New/Open, send the whole map to every guest again. */
  private resendToAll(): void {
    this.baselines.clear();
    void this.sendSnapshot([...this.guests.values()]);
  }

  /**
   * Send the whole map. Tiles are copied synchronously first; live edits made
   * meanwhile are held back and sent after the snapshot, so nothing is lost.
   */
  private async sendSnapshot(conns: DataConnection[]): Promise<void> {
    const sources: [Source, TileLayer][] = [...this.app.layers.all.map((l) => [l.id, l.tiles] as [Source, TileLayer]), ['fog', this.app.fog]];
    const copies: { layer: Source; x: number; y: number; canvas: HTMLCanvasElement }[] = [];
    for (const [layer, tiles] of sources) {
      for (const tile of tiles.values()) {
        if (isTileEmpty(tile)) continue;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = TILE_SIZE;
        canvas.getContext('2d')!.drawImage(tile.canvas, 0, 0);
        copies.push({ layer, x: tile.tx, y: tile.ty, canvas });
      }
    }
    const end: Message = { t: 'snap-end', labels: this.app.labels.all(), compass: this.app.compass.get() };
    for (const c of conns) this.pending.set(c.peer, []);

    const send = (m: Message) => conns.forEach((c) => c.open && c.send(m));
    send({ t: 'snap-start' });
    for (const copy of copies) {
      const blob = await new Promise<Blob | null>((r) => copy.canvas.toBlob(r, 'image/png'));
      if (blob) send({ t: 'snap-tile', layer: copy.layer, x: copy.x, y: copy.y, png: await blob.arrayBuffer() });
    }
    send(end);
    // Now the edits that happened while the snapshot was going out.
    for (const c of conns) {
      const held = this.pending.get(c.peer) ?? [];
      this.pending.delete(c.peer);
      for (const m of held) if (c.open) c.send(m);
    }
  }

  /** Host: send to every guest (or all but one), holding edits for guests still loading the map. */
  private broadcast(m: Message, except?: string): void {
    for (const [id, conn] of this.guests) {
      if (id === except || !conn.open) continue;
      const held = this.pending.get(id);
      if (held && isEdit(m)) held.push(m);
      else conn.send(m);
    }
  }

  // ---- Sending local changes ----------------------------------------------

  private tiles(source: Source): TileLayer {
    return source === 'fog' ? this.app.fog : this.app.layers.get(source).tiles;
  }

  /** A local edit is about to change this tile: remember how it looks now. */
  private capture(layer: Source, tx: number, ty: number): void {
    if (!this.live || this.applying) return;
    const key = `${layer}|${tileKey(tx, ty)}`;
    const known = this.baselines.get(key);
    if (known) {
      known.idle = 0;
      return;
    }
    const tile = this.tiles(layer).get(tx, ty);
    const data = tile ? tile.ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data : new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    this.baselines.set(key, { data, idle: 0 });
  }

  /** Send the pixels that changed since the last tick. */
  private tick(): void {
    if (!this.live || (this.role === 'guest' && this.app.paintBlocked)) return;
    for (const [key, base] of this.baselines) {
      const [layer, tk] = key.split('|') as [Source, string];
      const [x, y] = tk.split(',').map(Number);
      const tile = this.tiles(layer).get(x, y);
      if (!tile) {
        this.baselines.delete(key);
        continue;
      }
      const now = tile.ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
      const diff = encodeDiff(base.data, now);
      if (diff) {
        this.send({ t: 'px', layer, x, y, diff });
        base.data = now;
        base.idle = 0;
      } else if (++base.idle > 4) {
        this.baselines.delete(key);
      }
    }
  }

  /** A local label or compass change. */
  private local(m: Message): void {
    if (!this.live || this.applying) return;
    this.send(m);
  }

  private send(m: Message): void {
    if (this.role === 'host') this.broadcast(m);
    else if (this.hostConn?.open) this.hostConn.send(m);
  }

  private queueCursor(): void {
    if (!this.live || !this.peer?.id) return;
    const wait = CURSOR_MS - (performance.now() - this.lastCursor);
    clearTimeout(this.cursorTimer);
    if (wait > 0) {
      this.cursorTimer = window.setTimeout(() => this.queueCursor(), wait);
      return;
    }
    this.lastCursor = performance.now();
    const c = this.app.cursor;
    this.send({ t: 'cur', from: this.peer.id, x: c ? c.wx : null, y: c ? c.wy : null });
  }

  // ---- Receiving ------------------------------------------------------------

  /** Messages are handled strictly in order (some need async decoding). */
  private receive(m: Message, from: DataConnection): void {
    this.inbox = this.inbox.then(() => this.handle(m, from)).catch((err) => console.error('Shared session message failed', err));
  }

  private async handle(m: Message, from: DataConnection): Promise<void> {
    if (this.role === 'host') {
      if (m.t === 'hello') return this.welcome(from, m.name);
      if (!this.guests.has(from.peer)) return;
      if (m.t === 'cur') {
        this.showCursor(m);
        this.broadcast(m, from.peer);
      } else if (isEdit(m)) {
        this.applyEdit(m);
        // Pixel edits go back to the sender too, so every copy applies them in the host's order.
        this.broadcast(m, m.t === 'px' ? undefined : from.peer);
      }
      return;
    }
    if (this.role !== 'guest') return;
    switch (m.t) {
      case 'peers':
        this.people = m.list;
        for (const id of [...this.app.remoteCursors.keys()]) if (!m.list.some((p) => p.id === id)) this.app.remoteCursors.delete(id);
        this.emit();
        break;
      case 'snap-start':
        this.app.paintBlocked = 'Loading the shared map…';
        this.withoutEcho(() => this.app.resetDocument());
        this.baselines.clear();
        break;
      case 'snap-tile': {
        const bitmap = await createImageBitmap(new Blob([m.png], { type: 'image/png' }));
        this.tiles(m.layer).getOrCreate(m.x, m.y).ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        break;
      }
      case 'snap-end':
        this.withoutEcho(() => {
          this.app.labels.load(m.labels);
          this.app.compass.load(m.compass);
        });
        this.app.renderer.clearCaches();
        this.app.paintBlocked = null;
        this.app.requestRender();
        this.autosave.fileName = null;
        await this.autosave.replaceAll();
        this.emit();
        break;
      case 'cur':
        this.showCursor(m);
        break;
      default:
        if (isEdit(m)) this.applyEdit(m);
    }
  }

  private withoutEcho(fn: () => void): void {
    this.applying = true;
    try {
      fn();
    } finally {
      this.applying = false;
    }
  }

  private applyEdit(m: Message): void {
    this.withoutEcho(() => {
      if (m.t === 'px') {
        if (m.layer !== 'fog' && !isLayerId(m.layer)) return;
        const tiles = this.tiles(m.layer);
        const tile = tiles.getOrCreate(m.x, m.y);
        const img = tile.ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
        // Also update our baseline, so these pixels aren't later mistaken for our own edits.
        const base = this.baselines.get(`${m.layer}|${tile.key}`);
        if (base) applyDiff(m.diff, img.data, base.data);
        else applyDiff(m.diff, img.data);
        tile.ctx.putImageData(img, 0, 0);
        tiles.notify(tile.key);
      } else if (m.t === 'label') {
        if (m.label) this.app.labels.put(m.label);
        else this.app.labels.remove(m.id);
      } else if (m.t === 'compass') {
        this.app.compass.load(m.c);
      }
    });
  }

  private showCursor(m: Extract<Message, { t: 'cur' }>): void {
    if (m.from === this.peer?.id) return;
    const person = this.people.find((p) => p.id === m.from);
    if (m.x === null || m.y === null || !person) this.app.remoteCursors.delete(m.from);
    else this.app.remoteCursors.set(m.from, { name: person.name, color: person.color, x: m.x, y: m.y });
    this.app.requestRender();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
