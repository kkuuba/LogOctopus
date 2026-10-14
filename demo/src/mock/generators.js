// Deterministic content generators. Every function is a pure function of a
// snapshot meta record (its id is the seed), so content is stable across opens,
// reloads and shared links.

import { rngFor, hashString, fmtRowTime, fmtSyslogTime } from "./prng.js";

// ── helpers ──────────────────────────────────────────────────────────────────
/** n sorted timestamps in [start, finish] — Poisson-ish, so logs look bursty. */
function timeline(rng, n, startMs, finishMs) {
  const span = Math.max(1, finishMs - startMs);
  const raw = Array.from({ length: n }, () => rng()).sort((a, b) => a - b);
  return raw.map((x) => Math.round(startMs + x * span));
}

const USERS = ["netadmin", "admin", "deploy", "monitor"];
const LAN = ["10.0.0.50", "10.0.0.51", "10.0.1.44", "10.0.1.201", "10.0.2.17"];
const EXT = ["185.220.101.34", "45.155.205.12", "103.77.192.8", "194.26.135.89"];
const pid = (r) => r.int(600, 31000);

// ── TEXT LOGS ────────────────────────────────────────────────────────────────
// Each table entry: [(rng, host) => content, weight]

const SYSLOG = [
  [(r, h) => `${h} sshd[${pid(r)}]: Accepted publickey for ${r.pick(USERS)} from ${r.pick(LAN)} port ${r.int(40000, 65000)} ssh2: ED25519 SHA256:${r.hex(12)}`, 4],
  [(r, h) => `${h} sshd[${pid(r)}]: pam_unix(sshd:session): session opened for user ${r.pick(USERS)}(uid=${r.int(1000, 1010)}) by (uid=0)`, 3],
  [(r, h) => `${h} sshd[${pid(r)}]: Failed password for invalid user ${r.pick(["guest", "oracle", "test", "ubnt", "pi"])} from ${r.pick(EXT)} port ${r.int(30000, 65000)} ssh2`, 2],
  [(r, h) => `${h} systemd[1]: Started Session ${r.int(10, 900)} of user ${r.pick(USERS)}.`, 3],
  [(r, h) => `${h} CRON[${pid(r)}]: (root) CMD (/usr/local/bin/rotate-logs.sh)`, 3],
  [(r, h) => `${h} ntpd[${pid(r)}]: adjusting local clock by ${r.pick(["-", ""])}0.00${r.int(10, 99)}s`, 2],
  [(r, h) => `${h} dhclient[${pid(r)}]: DHCPREQUEST for ${r.pick(LAN)} on eth0 to 10.0.0.1 port 67`, 2],
  [(r, h) => `${h} systemd-resolved[${pid(r)}]: Using degraded feature set UDP instead of UDP+EDNS0 for DNS server 10.0.0.53.`, 1],
  [(r, h) => `${h} collectd[${pid(r)}]: plugin_read_thread: read-function of the "interface" plugin took ${r.float(1, 3).toFixed(3)} seconds, which is above its read interval.`, 1],
  [(r, h) => `${h} logoctopus-agent[${pid(r)}]: heartbeat ok (rtt=${r.int(2, 19)}ms)`, 3],
  [(r, h) => `${h} kernel: nf_conntrack: table full, dropping packet`, 0.4],
  [(r, h) => `${h} smartd[${pid(r)}]: Device: /dev/sda [SAT], SMART Prefailure Attribute: 1 Raw_Read_Error_Rate changed from 100 to 99`, 0.3],
];

const JOURNAL = [
  [(r, h) => `${h} systemd[1]: Started Daily apt download activities.`, 2],
  [(r, h) => `${h} systemd[1]: apt-daily.service: Succeeded.`, 2],
  [(r, h) => `${h} NetworkManager[812]: <info> device (eth0): carrier: link connected`, 1],
  [(r, h) => `${h} avahi-daemon[644]: Joining mDNS multicast group on interface eth0.IPv4 with address ${r.pick(LAN)}.`, 1],
  [(r, h) => `${h} systemd-timesyncd[501]: Contacted time server 162.159.200.1:123 (time.cloudflare.com).`, 2],
  [(r, h) => `${h} logoctopus-agent[2210]: heartbeat ok (rtt=${r.int(2, 19)}ms)`, 3],
  [(r, h) => `${h} mosquitto[951]: New client connected from ${r.pick(LAN)}:${r.int(40000, 65000)} as sensor-hub-3 (p2, c1, k60).`, 2],
  [(r, h) => `${h} mosquitto[951]: Client sensor-hub-3 closed its connection.`, 1],
  [(r, h) => `${h} sshd[${pid(r)}]: Connection closed by authenticating user ${r.pick(USERS)} ${r.pick(LAN)} port ${r.int(40000, 65000)} [preauth]`, 1],
  [(r, h) => `${h} kernel: eth0: Link is Up - 1Gbps/Full - flow control rx/tx`, 0.4],
];

const DMESG = [
  [() => "eth0: Link is Up - 1Gbps/Full - flow control rx/tx", 1],
  [() => "br0: port 2(eth1) entered forwarding state", 1],
  [(r) => `usb 1-1: new high-speed USB device number ${r.int(2, 9)} using xhci_hcd`, 1],
  [() => "EXT4-fs (mmcblk0p2): re-mounted. Opts: (null)", 1],
  [() => "nf_conntrack: nf_conntrack: table full, dropping packet", 0.5],
  [(r) => `mmc0: new high speed SDHC card at address ${r.hex(4)}`, 0.5],
  [() => "random: crng init done", 0.3],
];

const FIREWALL = [
  [(r, h) => `${h} kernel: [UFW BLOCK] IN=eth0 OUT= MAC=${r.hex(2)}:${r.hex(2)}:${r.hex(2)}:${r.hex(2)}:${r.hex(2)}:${r.hex(2)} SRC=${r.pick(EXT)} DST=10.0.0.1 LEN=${r.int(40, 80)} TTL=${r.int(40, 60)} ID=${r.int(1000, 65000)} PROTO=TCP SPT=${r.int(30000, 65000)} DPT=${r.pick([22, 23, 3389, 445, 8080, 5900])} WINDOW=${r.pick([1024, 5840, 65535])} SYN`, 6],
  [(r, h) => `${h} kernel: [UFW ALLOW] IN=eth1 OUT=eth0 SRC=${r.pick(LAN)} DST=${r.pick(["142.250.74.14", "151.101.1.69", "52.94.236.248"])} LEN=${r.int(52, 1400)} TTL=63 PROTO=TCP SPT=${r.int(32768, 60999)} DPT=443 ACK`, 5],
  [(r, h) => `${h} kernel: [UFW AUDIT] IN=eth1 OUT= SRC=${r.pick(LAN)} DST=10.0.0.1 PROTO=ICMP TYPE=8 CODE=0`, 1],
];

const GENERIC = [
  [(r, h) => `${h} app[${pid(r)}]: processed ${r.int(1, 400)} records in ${r.int(2, 90)}ms`, 3],
  [(r, h) => `${h} app[${pid(r)}]: heartbeat ok`, 3],
  [(r, h) => `${h} app[${pid(r)}]: WARN queue depth ${r.int(50, 400)} above soft limit`, 1],
];

const TABLES = { syslog: SYSLOG, journalctl: JOURNAL, dmesg: DMESG, firewall: FIREWALL };

const BGP_FLAP = (h) => [
  `${h} bgpd[812]: %NOTIFICATION: received from neighbor 10.0.1.1 4/0 (Hold Timer Expired) 0 bytes`,
  `${h} bgpd[812]: %ADJCHANGE: neighbor 10.0.1.1 Down BGP Notification received`,
  `${h} kernel: eth0: Link is Down`,
  `${h} zebra[790]: interface eth0 is down`,
  `${h} kernel: eth0: Link is Up - 1Gbps/Full - flow control rx/tx`,
  `${h} bgpd[812]: %ADJCHANGE: neighbor 10.0.1.1 Up`,
];

export function genTextRows(meta) {
  const rng = rngFor(meta.id);
  const host = String(meta.deviceName).toLowerCase();
  const table = TABLES[meta.logName] || GENERIC;
  const times = timeline(rng, meta.rowCount, meta.startMs, meta.finishMs);
  const contents = times.map(() => rng.weighted(table)(rng, host));

  // Plant a short incident in router syslogs so there is something to find.
  if (meta.logName === "syslog" && /router/i.test(meta.deviceName) && contents.length > 40) {
    const at = rng.int(10, contents.length - 10);
    BGP_FLAP(host).forEach((line, k) => { if (contents[at + k]) contents[at + k] = line; });
  }

  return times.map((t, i) => ({
    time: fmtRowTime(t),
    log_name: meta.logName,
    content: contents[i],
  }));
}

// ── CHART LOGS ───────────────────────────────────────────────────────────────
const SERIES = {
  cpu_temp:     { base: 46,  amp: 5,   noise: 0.5, period: 38, min: 25, dec: 2 },
  bandwidth:    { base: 210, amp: 90,  noise: 18,  period: 25, min: 0,  dec: 1, spikes: 3 },
  link_latency: { base: 4.5, amp: 1.2, noise: 0.5, period: 60, min: 0.5, dec: 2, spikes: 3 },
  humidity:     { base: 54,  amp: 7,   noise: 0.7, period: 80, min: 5, max: 100, dec: 1 },
  rssi:         { base: -58, amp: 6,   noise: 1.5, period: 30, max: -20, dec: 0 },
  memory_free:  { base: 820, amp: 60,  noise: 8,   period: 70, min: 0, dec: 0 },
};

export function genChartRows(meta) {
  const rng = rngFor(meta.id);
  const n = meta.rowCount;
  const step = (meta.finishMs - meta.startMs) / Math.max(1, n - 1);
  const jit = Math.floor(Math.min(120, step * 0.3));
  const time = (i) => fmtRowTime(Math.round(meta.startMs + i * step + (jit ? rng.int(-jit, jit) : 0)));

  if (meta.logName === "link_state") {
    // Categorical: sticky Markov chain.
    let state = "up";
    return Array.from({ length: n }, (_, i) => {
      const x = rng();
      if (state === "up" && x < 0.04) state = "degraded";
      else if (state === "degraded") state = x < 0.45 ? "up" : x < 0.6 ? "down" : "degraded";
      else if (state === "down" && x < 0.5) state = "degraded";
      return { time: time(i), content: state };
    });
  }

  const s = SERIES[meta.logName] || { base: 50, amp: 15, noise: 2, period: 40, dec: 1 };
  const phase = rng.float(0, Math.PI * 2);
  const drift = rng.float(-s.amp * 0.4, s.amp * 0.4);
  const spikeAt = Array.from({ length: s.spikes || 0 }, () => rng.int(3, Math.max(4, n - 4)));
  return Array.from({ length: n }, (_, i) => {
    let v = s.base + s.amp * Math.sin((2 * Math.PI * i) / s.period + phase) + drift * (i / n);
    v += (rng() + rng() + rng() - 1.5) * 2 * s.noise;
    for (const at of spikeAt) {
      const d = i - at;
      if (d >= 0 && d < 4) v += s.amp * 2.2 * Math.exp(-d * 0.9);
    }
    if (s.min != null) v = Math.max(s.min, v);
    if (s.max != null) v = Math.min(s.max, v);
    return { time: time(i), content: Number(v.toFixed(s.dec)) };
  });
}

// ── PACKET CAPTURES ──────────────────────────────────────────────────────────
// One coherent packet model per snapshot; rows, per-packet detail trees and the
// downloadable .pcap are all views of it.

const mac = (ip) => {
  const a = hashString(ip), b = hashString(`${ip}#`);
  const hex = (n) => (n & 255).toString(16).padStart(2, "0");
  return `02:${hex(a)}:${hex(a >>> 8)}:${hex(b)}:${hex(b >>> 8)}:${hex(a >>> 16)}`;
};
const BCAST = "ff:ff:ff:ff:ff:ff";

const DNS_NAMES = ["pool.ntp.org", "api.example-cloud.io", "updates.vendor.net", "mqtt.example-cloud.io", "www.wikipedia.org", "deb.debian.org"];
const MQTT_TOPICS = ["sensors/hub3/temperature", "sensors/hub3/humidity", "sensors/hub3/rssi", "gateway/iot-gw/status"];
const HTTP_PATHS = ["/v1/telemetry", "/api/v1/status", "/index.html", "/metrics"];

// weight, kind, app, client [ip, port|null], server [ip, port], payload range, rounds
const FLOWS = {
  core: [
    { w: 22, kind: "tcp", app: "tls",  c: ["10.0.1.44", null],  s: ["142.250.74.14", 443], pl: [90, 1448], rounds: [4, 14] },
    { w: 14, kind: "tcp", app: "tls",  c: ["10.0.1.45", null],  s: ["151.101.1.69", 443],  pl: [90, 1448], rounds: [3, 10] },
    { w: 8,  kind: "tcp", app: "tls",  c: ["10.0.1.201", null], s: ["52.94.236.248", 443], pl: [90, 1448], rounds: [3, 9] },
    { w: 9,  kind: "tcp", app: "ssh",  c: ["10.0.0.50", null],  s: ["10.0.1.11", 22],      pl: [36, 180],  rounds: [5, 20] },
    { w: 6,  kind: "tcp", app: "http", c: ["10.0.0.50", null],  s: ["10.0.0.10", 80],      pl: [120, 900], rounds: [2, 6] },
    { w: 4,  kind: "tcp", app: "bgp",  c: ["10.0.1.11", null],  s: ["10.0.1.1", 179],      pl: [19, 19],   rounds: [2, 6] },
    { w: 10, kind: "udp", app: "dns",  c: ["10.0.1.44", null],  s: ["10.0.0.53", 53] },
    { w: 3,  kind: "udp", app: "ntp",  c: ["10.0.0.2", 123],    s: ["129.6.15.28", 123] },
    { w: 5,  kind: "udp", app: "snmp", c: ["10.0.0.60", null],  s: ["10.0.0.2", 161] },
    { w: 4,  kind: "icmp", c: ["10.0.0.2", null], s: ["10.0.1.11", null] },
    { w: 2,  kind: "arp",  c: ["10.0.1.44", null], s: ["10.0.1.1", null] },
  ],
  iot: [
    { w: 26, kind: "tcp", app: "mqtt", c: ["10.0.2.9", null], s: ["10.0.2.5", 1883],      pl: [20, 90],   rounds: [4, 16] },
    { w: 18, kind: "tcp", app: "tls",  c: ["10.0.2.5", null], s: ["52.17.34.211", 8883],  pl: [60, 400],  rounds: [3, 10] },
    { w: 8,  kind: "tcp", app: "http", c: ["10.0.2.5", null], s: ["34.120.55.8", 80],     pl: [150, 700], rounds: [2, 4] },
    { w: 8,  kind: "udp", app: "dns",  c: ["10.0.2.5", null], s: ["10.0.0.53", 53] },
    { w: 3,  kind: "udp", app: "ntp",  c: ["10.0.2.9", 123],  s: ["129.6.15.28", 123] },
    { w: 5,  kind: "icmp", c: ["10.0.2.5", null], s: ["10.0.2.9", null] },
    { w: 3,  kind: "arp",  c: ["10.0.2.5", null], s: ["10.0.2.1", null] },
  ],
};

const dnsNameLen = (name) => name.length + 2; // labels + length bytes + root
const DNS_QLEN = (name) => 12 + dnsNameLen(name) + 4;
const DNS_RLEN = (name) => DNS_QLEN(name) + 16;

function buildPackets(meta) {
  const rng = rngFor(`pkt:${meta.id}`);
  const flows = FLOWS[meta.profile] || FLOWS.core;
  const target = meta.rowCount;
  const span = Math.max(1000, meta.finishMs - meta.startMs);
  const pkts = [];

  const add = (flow, t, from, to, f) => {
    pkts.push({
      t,
      src: { ip: from[0], port: from[1], mac: from[0] ? mac(from[0]) : BCAST },
      dst: { ip: to[0], port: to[1], mac: to[0] ? mac(to[0]) : BCAST },
      ...f,
    });
  };

  while (pkts.length < target * 1.15) {
    const fl = rng.weighted(flows.map((f) => [f, f.w]));
    let t = meta.startMs + rng() * span * 0.97;
    const dt = () => rng.float(0.0004, 0.06) * 1000;
    const client = [fl.c[0], fl.c[1] ?? rng.int(32768, 60999)];
    const server = [fl.s[0], fl.s[1]];

    if (fl.kind === "arp") {
      // ARP has no IP layer: endpoints stay empty (the app shows them as "(no IP)").
      const arp = (op, sender, target, srcMac, dstMac, info) => {
        add(fl, t, [null, null], [null, null], {
          chain: "eth:ethertype:arp", proto: "arp", l3: "arp", len: 42, arp: { op, spa: sender, tpa: target }, info,
        });
        const last = pkts[pkts.length - 1];
        last.src.mac = srcMac; last.dst.mac = dstMac;
      };
      arp(1, client[0], fl.s[0], mac(client[0]), BCAST, `Who has ${fl.s[0]}? Tell ${client[0]}`);
      t += dt();
      arp(2, fl.s[0], client[0], mac(fl.s[0]), mac(client[0]), `${fl.s[0]} is at ${mac(fl.s[0])}`);
    } else if (fl.kind === "icmp") {
      const id = rng.int(1, 65535), count = rng.int(2, 6);
      for (let k = 0; k < count; k++) {
        for (const reply of [false, true]) {
          add(fl, t, reply ? [fl.s[0], null] : [fl.c[0], null], reply ? [fl.c[0], null] : [fl.s[0], null], {
            chain: "eth:ethertype:ip:icmp", proto: "icmp", l3: "ip", l4: "icmp", len: 98,
            icmp: { type: reply ? 0 : 8, id, seq: k + 1 },
            info: `Echo (ping) ${reply ? "reply  " : "request"} id=0x${id.toString(16).padStart(4, "0")}, seq=${k + 1}/${(k + 1) * 256}, ttl=64`,
          });
          t += reply ? rng.float(900, 1000) : rng.float(0.2, 3);
        }
      }
    } else if (fl.kind === "udp") {
      const id = rng.int(1, 65535);
      const name = rng.pick(DNS_NAMES);
      const spec = {
        dns:  { q: DNS_QLEN(name), r: DNS_RLEN(name), qi: `Standard query 0x${id.toString(16).padStart(4, "0")} A ${name}`, ri: `Standard query response 0x${id.toString(16).padStart(4, "0")} A ${name} A ${rng.pick(["93.184.216.34", "151.101.1.69", "130.211.14.8"])}` },
        ntp:  { q: 48, r: 48, qi: "NTP Version 4, client", ri: "NTP Version 4, server" },
        snmp: { q: 43, r: 52, qi: `get-request 1.3.6.1.2.1.1.3.0`, ri: `get-response 1.3.6.1.2.1.1.3.0` },
      }[fl.app];
      for (const reply of [false, true]) {
        add(fl, t, reply ? server : client, reply ? client : server, {
          chain: `eth:ethertype:ip:udp:${fl.app}`, proto: fl.app, l3: "ip", l4: "udp", app: fl.app,
          len: 42 + (reply ? spec.r : spec.q), dns: { name, id },
          info: reply ? spec.ri : spec.qi, reply,
        });
        t += dt() * 2;
      }
    } else {
      // TCP: handshake → request/response rounds → (sometimes) teardown
      const isnC = rng.int(1e6, 4e9), isnS = rng.int(1e6, 4e9);
      const win = rng.pick([502, 1024, 2048, 64240]);
      let relC = 1, relS = 1; // relative seq (after SYN consumed 1)
      const tcp = (from, flags, seq, ack, plen, extra = {}) => {
        const isClient = from === "c";
        const [a, b] = isClient ? [client, server] : [server, client];
        const syn = flags.includes("SYN");
        const info = (app, text) =>
          app
            ? `${text}, Seq=${seq} Ack=${ack} Len=${plen}`
            : `[${flags.join(", ")}] Seq=${seq} Ack=${ack} Win=${win} Len=0${syn ? " MSS=1460 SACK_PERM WS=128" : ""}`;
        const isData = plen > 0;
        add(fl, t, a, b, {
          chain: isData ? `eth:ethertype:ip:tcp:${fl.app}` : "eth:ethertype:ip:tcp",
          proto: isData ? fl.app : "tcp", l3: "ip", l4: "tcp", app: isData ? fl.app : null,
          len: 14 + 20 + (syn ? 40 : 32) + plen, plen,
          tcp: { seq, ack, flags, win, isn: isClient ? isnC : isnS, peerIsn: isClient ? isnS : isnC },
          info: isData ? info(fl.app, extra.text || "Application Data") : info(null),
          ...extra,
        });
        t += dt();
      };
      tcp("c", ["SYN"], 0, 0, 0);
      tcp("s", ["SYN", "ACK"], 0, 1, 0);
      tcp("c", ["ACK"], 1, 1, 0);
      const rounds = rng.int(fl.rounds[0], fl.rounds[1]);
      for (let k = 0; k < rounds; k++) {
        const cl = rng.int(fl.pl[0], fl.pl[1]);
        const sl = rng.chance(0.55) ? rng.int(fl.pl[0], fl.pl[1]) : 0;
        const ct = textFor(fl.app, "c", rng, k), st = textFor(fl.app, "s", rng, k);
        tcp("c", ["PSH", "ACK"], relC, relS, cl, { text: ct });
        relC += cl;
        if (sl) { tcp("s", ["PSH", "ACK"], relS, relC, sl, { text: st }); relS += sl; tcp("c", ["ACK"], relC, relS, 0); }
        else tcp("s", ["ACK"], relS, relC, 0);
      }
      if (rng.chance(0.3)) {
        tcp("c", ["FIN", "ACK"], relC, relS, 0);
        tcp("s", ["FIN", "ACK"], relS, relC + 1, 0);
        tcp("c", ["ACK"], relC + 1, relS + 1, 0);
      }
    }
  }

  pkts.sort((a, b) => a.t - b.t);
  pkts.length = Math.min(pkts.length, target);
  pkts.forEach((p, i) => { p.n = i + 1; p.t = Math.min(p.t, meta.finishMs); });
  return pkts;
}

function textFor(app, side, rng, k) {
  switch (app) {
    case "tls":  return "Application Data";
    case "ssh":  return side === "c" ? "Client: Encrypted packet" : "Server: Encrypted packet";
    case "http": return side === "c" ? `${k % 2 ? "POST" : "GET"} ${rng.pick(HTTP_PATHS)} HTTP/1.1` : "HTTP/1.1 200 OK";
    case "mqtt": return side === "c" ? `Publish Message [${rng.pick(MQTT_TOPICS)}]` : "Ping Response";
    case "bgp":  return "KEEPALIVE Message";
    default:     return "Data";
  }
}

const cache = new Map();
export function packetModel(meta) {
  let m = cache.get(meta.id);
  if (!m || m.rowCount !== meta.rowCount) {
    m = { rowCount: meta.rowCount, pkts: buildPackets(meta) };
    cache.set(meta.id, m);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
  }
  return m.pkts;
}

const endpoint = (e) => (e.ip ? (e.port != null ? `${e.ip}:${e.port}` : e.ip) : "");

/** Rows in the exact "N | chain | src -> dst | len=L | info" shape the app parses. */
export function genPacketRows(meta) {
  return packetModel(meta).map((p) => ({
    time: fmtRowTime(p.t),
    log_name: "network capture",
    content: `${p.n} | ${p.chain} | ${endpoint(p.src)} -> ${endpoint(p.dst)} | len=${p.len} | ${p.info}`,
  }));
}

// ── packet details tree (what tshark -T json would give, flattened a bit) ────
const hex = (n, w = 4) => `0x${n.toString(16).padStart(w, "0")}`;
const setFlag = (flags, f) => (flags.includes(f) ? "Set" : "Not set");

export function genPacketDetails(meta, n) {
  const p = packetModel(meta)[n - 1];
  if (!p) return null;
  const rng = rngFor(`pd:${meta.id}:${n}`);
  const first = packetModel(meta)[0];
  const d = {};

  d["Frame"] = {
    "Frame Number": String(p.n),
    "Arrival Time": fmtRowTime(p.t),
    "Time since first packet": `${((p.t - first.t) / 1000).toFixed(6)} seconds`,
    "Frame Length": `${p.len} bytes (${p.len * 8} bits)`,
    "Capture Length": `${p.len} bytes (${p.len * 8} bits)`,
    "Protocols in frame": p.chain,
  };
  d["Ethernet II"] = {
    "Destination": p.dst.mac,
    "Source": p.src.mac,
    "Type": p.l3 === "arp" ? "ARP (0x0806)" : "IPv4 (0x0800)",
  };

  if (p.l3 === "arp") {
    d["Address Resolution Protocol"] = {
      "Hardware type": "Ethernet (1)",
      "Protocol type": "IPv4 (0x0800)",
      "Opcode": p.arp.op === 1 ? "request (1)" : "reply (2)",
      "Sender MAC address": p.src.mac,
      "Sender IP address": p.arp.spa,
      "Target MAC address": p.arp.op === 1 ? "00:00:00:00:00:00" : p.dst.mac,
      "Target IP address": p.arp.tpa,
    };
    return d;
  }

  d["Internet Protocol Version 4"] = {
    "Source Address": p.src.ip,
    "Destination Address": p.dst.ip,
    "Time to Live": String(p.l4 === "icmp" ? 64 : rng.pick([52, 57, 63, 64, 117])),
    "Protocol": p.l4 === "tcp" ? "TCP (6)" : p.l4 === "udp" ? "UDP (17)" : "ICMP (1)",
    "Total Length": String(p.len - 14),
    "Identification": `${hex(rng.int(1, 65535))}`,
    "Flags": { "Reserved bit": "Not set", "Don't fragment": "Set", "More fragments": "Not set" },
  };

  if (p.l4 === "tcp") {
    d["Transmission Control Protocol"] = {
      "Source Port": String(p.src.port),
      "Destination Port": String(p.dst.port),
      "Sequence Number (relative)": String(p.tcp.seq),
      "Acknowledgment Number (relative)": String(p.tcp.ack),
      "Header Length": p.tcp.flags.includes("SYN") ? "40 bytes (10)" : "32 bytes (8)",
      "Flags": {
        "SYN": setFlag(p.tcp.flags, "SYN"), "ACK": setFlag(p.tcp.flags, "ACK"),
        "PSH": setFlag(p.tcp.flags, "PSH"), "FIN": setFlag(p.tcp.flags, "FIN"), "RST": "Not set",
      },
      "Window": String(p.tcp.win),
      "TCP payload": `${p.plen} bytes`,
    };
  } else if (p.l4 === "udp") {
    d["User Datagram Protocol"] = { "Source Port": String(p.src.port), "Destination Port": String(p.dst.port), "Length": String(p.len - 34) };
  } else if (p.l4 === "icmp") {
    d["Internet Control Message Protocol"] = {
      "Type": p.icmp.type === 8 ? "8 (Echo (ping) request)" : "0 (Echo (ping) reply)",
      "Code": "0",
      "Identifier": `${p.icmp.id} (${hex(p.icmp.id)})`,
      "Sequence Number": String(p.icmp.seq),
      "Data": "56 bytes",
    };
  }

  const app = p.app;
  if (app === "dns") {
    d["Domain Name System"] = {
      "Transaction ID": hex(p.dns.id),
      "Flags": p.reply ? "0x8180 Standard query response, No error" : "0x0100 Standard query",
      "Questions": "1",
      "Queries": { [p.dns.name]: { "Name": p.dns.name, "Type": "A (Host Address)", "Class": "IN (0x0001)" } },
    };
  } else if (app === "tls") {
    d["Transport Layer Security"] = { "TLSv1.3 Record Layer": { "Content Type": "Application Data (23)", "Version": "TLS 1.2 (0x0303)", "Length": String(p.plen - 5) } };
  } else if (app === "http") {
    d["Hypertext Transfer Protocol"] = { "Summary": p.info.split(",")[0], "Host": "api.example-cloud.io", "User-Agent": "logoctopus-agent/2.4.1" };
  } else if (app === "mqtt") {
    d["MQ Telemetry Transport Protocol"] = { "Summary": p.info.split(",")[0], "QoS": "At most once delivery (0)", "Retain": "Not set" };
  } else if (app === "ssh") {
    d["SSH Protocol"] = { "Packet Length (encrypted)": String(p.plen - 4), "Encrypted Packet": `${p.plen} bytes` };
  } else if (app === "bgp") {
    d["Border Gateway Protocol"] = { "Marker": "ffffffffffffffffffffffffffffffff", "Length": "19", "Type": "KEEPALIVE Message (4)" };
  } else if (app === "ntp") {
    d["Network Time Protocol (NTP Version 4)"] = { "Mode": p.reply ? "server (4)" : "client (3)", "Stratum": p.reply ? "2" : "0", "Poll Interval": "6 (64 seconds)" };
  } else if (app === "snmp") {
    d["Simple Network Management Protocol"] = { "Version": "v2c (1)", "Community": "<redacted>", "PDU": p.reply ? "get-response" : "get-request", "OID": "1.3.6.1.2.1.1.3.0 (sysUpTime)" };
  }
  return d;
}

// ── .pcap file (libpcap classic, Ethernet) ───────────────────────────────────
const ipB = (ip) => ip.split(".").map(Number);
const macB = (m) => m.split(":").map((h) => parseInt(h, 16));

function frameBytes(p, rng) {
  const f = new Uint8Array(p.len);
  const dv = new DataView(f.buffer);
  let o = 0;
  f.set(macB(p.dst.mac), 0); f.set(macB(p.src.mac), 6);
  dv.setUint16(12, p.l3 === "arp" ? 0x0806 : 0x0800); o = 14;

  if (p.l3 === "arp") {
    dv.setUint16(o, 1); dv.setUint16(o + 2, 0x0800); f[o + 4] = 6; f[o + 5] = 4; dv.setUint16(o + 6, p.arp.op);
    f.set(macB(p.src.mac), o + 8); f.set(ipB(p.arp.spa), o + 14);
    f.set(p.arp.op === 1 ? [0, 0, 0, 0, 0, 0] : macB(p.dst.mac), o + 18); f.set(ipB(p.arp.tpa), o + 24);
    return f;
  }

  // IPv4
  f[o] = 0x45; dv.setUint16(o + 2, p.len - 14); dv.setUint16(o + 4, (p.n * 37) & 0xffff); dv.setUint16(o + 6, 0x4000);
  f[o + 8] = 64; f[o + 9] = p.l4 === "tcp" ? 6 : p.l4 === "udp" ? 17 : 1;
  f.set(ipB(p.src.ip), o + 12); f.set(ipB(p.dst.ip), o + 16);
  let sum = 0;
  for (let i = o; i < o + 20; i += 2) sum += dv.getUint16(i);
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  dv.setUint16(o + 10, ~sum & 0xffff);
  o += 20;

  if (p.l4 === "tcp") {
    const syn = p.tcp.flags.includes("SYN");
    const hl = syn ? 40 : 32;
    dv.setUint16(o, p.src.port); dv.setUint16(o + 2, p.dst.port);
    dv.setUint32(o + 4, (p.tcp.isn + p.tcp.seq) >>> 0);
    dv.setUint32(o + 8, p.tcp.ack ? ((p.tcp.peerIsn + p.tcp.ack) >>> 0) : 0);
    f[o + 12] = (hl / 4) << 4;
    const bits = { FIN: 1, SYN: 2, RST: 4, PSH: 8, ACK: 16 };
    f[o + 13] = p.tcp.flags.reduce((a, x) => a | bits[x], 0);
    dv.setUint16(o + 14, p.tcp.win);
    if (syn) f.set([2, 4, 5, 0xb4, 4, 2, 8, 10, 0, 0, 0, 1, 0, 0, 0, 0, 1, 3, 3, 7], o + 20);
    else f.set([1, 1, 8, 10, 0, 0, 0, 1, 0, 0, 0, 1], o + 20);
    o += hl;
    if (p.app === "tls") { f[o] = 23; f[o + 1] = 3; f[o + 2] = 3; dv.setUint16(o + 3, p.plen - 5); for (let i = o + 5; i < f.length; i++) f[i] = rng.int(0, 255); }
    else if (p.app === "bgp") { f.fill(255, o, o + 16); dv.setUint16(o + 16, 19); f[o + 18] = 4; }
    else if (p.app === "http") { const t = new TextEncoder().encode(`${p.info.split(",")[0]}\r\nHost: api.example-cloud.io\r\n\r\n`); f.fill(32, o); f.set(t.slice(0, f.length - o), o); }
    return f;
  }

  if (p.l4 === "udp") {
    dv.setUint16(o, p.src.port); dv.setUint16(o + 2, p.dst.port); dv.setUint16(o + 4, p.len - 34);
    o += 8;
    if (p.app === "dns") {
      dv.setUint16(o, p.dns.id); dv.setUint16(o + 2, p.reply ? 0x8180 : 0x0100); dv.setUint16(o + 4, 1); dv.setUint16(o + 6, p.reply ? 1 : 0);
      let q = o + 12;
      for (const label of p.dns.name.split(".")) { f[q++] = label.length; f.set(new TextEncoder().encode(label), q); q += label.length; }
      q += 1; dv.setUint16(q, 1); dv.setUint16(q + 2, 1); q += 4;
      if (p.reply) { dv.setUint16(q, 0xc00c); dv.setUint16(q + 2, 1); dv.setUint16(q + 4, 1); dv.setUint32(q + 6, 300); dv.setUint16(q + 10, 4); f.set([93, 184, 216, 34], q + 12); }
    } else if (p.app === "ntp") f[o] = p.reply ? 0x24 : 0x23;
    return f;
  }

  // ICMP echo
  f[o] = p.icmp.type; dv.setUint16(o + 4, p.icmp.id); dv.setUint16(o + 6, p.icmp.seq);
  for (let i = o + 8; i < f.length; i++) f[i] = 0x10 + ((i - o) % 48);
  return f;
}

export function buildPcap(meta) {
  const pkts = packetModel(meta);
  const rng = rngFor(`pcap:${meta.id}`);
  const frames = pkts.map((p) => frameBytes(p, rng));
  const total = 24 + frames.reduce((s, f) => s + 16 + f.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0xa1b2c3d4, false); dv.setUint16(4, 2, false); dv.setUint16(6, 4, false);
  dv.setUint32(16, 65535, false); dv.setUint32(20, 1, false);
  let o = 24;
  frames.forEach((f, i) => {
    const t = pkts[i].t;
    dv.setUint32(o, Math.floor(t / 1000), false);
    dv.setUint32(o + 4, (t % 1000) * 1000, false);
    dv.setUint32(o + 8, f.length, false); dv.setUint32(o + 12, f.length, false);
    out.set(f, o + 16);
    o += 16 + f.length;
  });
  return out;
}

// ── shell simulator (device config builder → "run command") ──────────────────
export function simulateShell({ command, user = "pi", host = "device", now = Date.now() }) {
  const cmd = String(command || "").trim().replace(/^sudo\s+/, "");
  const rng = rngFor(`sh:${cmd}:${Math.floor(now / 5000)}`);
  const h = String(host).toLowerCase();
  const lines = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join("\n");
  const ok = (stdout) => ({ stdout, stderr: "", exit_code: 0 });

  if (/journalctl/.test(cmd))
    return ok(lines(8, (i) => {
      const t = new Date(now - (8 - i) * 2300);
      const iso = fmtRowTime(t.getTime()).slice(0, 19) + "+0000";
      return rng.weighted(JOURNAL)(rng, h).replace(/^/, `${iso} `);
    }));
  if (/dmesg/.test(cmd))
    return ok(lines(8, (i) => `[${String(1234 + i * 3).padStart(8, " ")}.${String(rng.int(0, 999999)).padStart(6, "0")}] ${rng.weighted(DMESG)(rng)}`));
  if (/ufw/.test(cmd))
    return ok(lines(6, (i) => `${fmtSyslogTime(now - (6 - i) * 1800)} ${rng.weighted(FIREWALL)(rng, h)}`));
  if (/syslog|messages|auth\.log|\/var\/log/.test(cmd))
    return ok(lines(8, (i) => `${fmtSyslogTime(now - (8 - i) * 2100)} ${rng.weighted(SYSLOG)(rng, h)}`));
  if (/thermal|temp/.test(cmd)) return ok((44 + rng() * 6).toFixed(2));
  if (/humidity/.test(cmd)) return ok((50 + rng() * 10).toFixed(1));
  if (/signal|\biw\b/.test(cmd)) return ok(String(-Math.round(52 + rng() * 14)));
  if (/ifstat|\/proc\/net\/dev|bandwidth/.test(cmd)) return ok((160 + rng() * 120).toFixed(1));
  if (/uplink\.state/.test(cmd)) return ok(rng.pick(["up", "up", "up", "degraded"]));
  if (/^ping\b/.test(cmd)) return ok(`64 bytes from 10.0.1.1: icmp_seq=1 ttl=64 time=${(3 + rng() * 3).toFixed(2)} ms`);
  if (/tcpdump/.test(cmd)) return ok("tcpdump: listening on any, link-type LINUX_SLL2 (Linux cooked v2), snapshot length 262144 bytes");
  if (/^pkill\b/.test(cmd)) return ok("");
  if (/^date\b/.test(cmd)) return ok(new Date(now).toString());
  if (/^uptime\b/.test(cmd)) return ok(` ${new Date(now).toTimeString().slice(0, 8)} up 12 days,  3:41,  1 user,  load average: 0.12, 0.18, 0.15`);
  if (/^whoami\b/.test(cmd)) return ok(user);
  if (/^hostname\b/.test(cmd)) return ok(h);
  if (/^uname\b/.test(cmd)) return ok(`Linux ${h} 6.1.0-rpi8-rpi-v8 #1 SMP PREEMPT Debian 1:6.1.73-1+rpt1 aarch64 GNU/Linux`);
  if (/^echo\b/.test(cmd)) return ok(cmd.replace(/^echo\s+/, "").replace(/^["']|["']$/g, ""));
  if (/^df\b/.test(cmd)) return ok("Filesystem      Size  Used Avail Use% Mounted on\n/dev/mmcblk0p2   29G   11G   17G  40% /");
  if (/^free\b/.test(cmd)) return ok("               total        used        free      shared  buff/cache   available\nMem:            3790         912        1604          38        1273        2790");
  if (/^ls\b/.test(cmd)) return ok("bin  logs  scripts  collect.sh");
  return ok(`[demo] "${cmd}" ran on ${h} — output is simulated, no real device is connected.`);
}
