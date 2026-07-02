"""
PcapDecoder: decodes a pcap file (as produced by SshNetworkCapture) using
tshark, exposes each packet as a PacketInfo object, and can render the
result as a "time"/"content" DataFrame suitable for wrapping in a
LogSnapshot -- mirroring the shape DeviceWatchdog uses for its other logs
(see DeviceWatchdog._entries_to_dataframe).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime

import pandas as pd

from backend.models.log_snapshot import LogSnapshot

# tshark fields pulled for each packet. Keep this list in sync with the
# unpacking order in PcapDecoder._parse_line.
_TSHARK_FIELDS = [
    "frame.time_epoch",
    "frame.number",
    "frame.len",
    "frame.protocols",
    "ip.src",
    "ip.dst",
    "ipv6.src",
    "ipv6.dst",
    "tcp.srcport",
    "tcp.dstport",
    "udp.srcport",
    "udp.dstport",
    "_ws.col.Info",
]


@dataclass
class PacketInfo:
    """Decoded representation of a single captured packet."""

    number: int
    time: datetime
    length: int
    protocols: str
    src_ip: str
    dst_ip: str
    src_port: str
    dst_port: str
    info: str

    def to_content_str(self) -> str:
        """
        Basic decoded packet info as a single ' | '-delimited string, e.g.:
        "12 | eth:ip:tcp | 10.0.0.1:443 -> 10.0.0.2:51000 | len=1500 | TLS Application Data"
        """
        endpoints = f"{self.src_ip}:{self.src_port} -> {self.dst_ip}:{self.dst_port}"
        parts = [
            str(self.number),
            self.protocols,
            endpoints,
            f"len={self.length}",
            self.info,
        ]
        return " | ".join(p for p in parts if p)


class PcapDecoder:
    """
    Decodes a pcap file using tshark and exposes the packets both as
    PacketInfo objects and as a "time"/"content" DataFrame.
    """

    TSHARK_BIN = "tshark"

    def __init__(self, pcap_file: str):
        """
        Args:
            pcap_file: Path to the local .pcap/.pcapng file to decode
                (e.g. the local_file used by SshNetworkCapture).
        """
        self.pcap_file = pcap_file
        self.packets: list[PacketInfo] = []

    @classmethod
    def for_session(cls, device_data_dir: str, session_id: str) -> "PcapDecoder":
        """
        Build a PcapDecoder for a session's saved pcap file, i.e.
        <device_data_dir>/<session_id>.pcap -- the naming convention used by
        DeviceWatchdog.save_log_snapshots once it renames the raw capture.

        Args:
            device_data_dir: Per-device data directory (DeviceWatchdog.device_data_dir).
            session_id: Session whose pcap should be decoded.
        """
        return cls(os.path.join(device_data_dir, f"{session_id}.pcap"))

    @classmethod
    def get_session_packet_details(cls, device_data_dir: str, session_id: str, packet_number: int) -> dict:
        """
        Convenience one-shot: resolve a session's pcap path and decode a
        single packet's full field detail from it.

        Returns {} if the session's pcap file doesn't exist (rather than
        raising), since a missing session is an expected, non-exceptional
        case for callers -- e.g. an invalid/expired session_id.

        Raises:
            FileNotFoundError: tshark is not installed / not on PATH.
        """
        decoder = cls.for_session(device_data_dir, session_id)
        if not os.path.exists(decoder.pcap_file):
            return {}
        return decoder.get_packet_details(packet_number)

    # ------------------------------------------------------------------
    # Decoding
    # ------------------------------------------------------------------

    def decode(self) -> list[PacketInfo]:
        """
        Run tshark over the pcap file and populate self.packets.

        Parses whatever tshark writes to stdout on a best-effort basis;
        a non-zero tshark exit status is not treated as fatal (tshark can
        exit non-zero while still having emitted usable lines, e.g. for
        warnings on link-layer types or a still-growing capture file).

        Returns:
            The decoded list of PacketInfo objects (also stored on self.packets).

        Raises:
            FileNotFoundError: tshark is not installed / not on PATH, or no
                pcap_file path was given.
        """
        if not self.pcap_file:
            raise FileNotFoundError("PcapDecoder was given no pcap_file path to decode.")

        if shutil.which(self.TSHARK_BIN) is None:
            raise FileNotFoundError(
                f"'{self.TSHARK_BIN}' not found on PATH; install Wireshark/tshark to decode pcaps."
            )

        cmd = [
            self.TSHARK_BIN,
            "-r", self.pcap_file,
            "-T", "fields",
            "-E", "separator=\t",
            "-E", "quote=n",
            "-E", "occurrence=f",
        ]
        for f in _TSHARK_FIELDS:
            cmd += ["-e", f]

        result = subprocess.run(cmd, capture_output=True, text=True)

        self.packets = [
            pkt
            for pkt in (self._parse_line(line) for line in result.stdout.splitlines() if line.strip())
            if pkt is not None
        ]
        return self.packets

    def _parse_line(self, line: str) -> PacketInfo | None:
        """Parse a single tab-separated tshark output line into a PacketInfo."""
        fields = line.split("\t")
        # Pad in case trailing empty fields were stripped by tshark.
        fields += [""] * (len(_TSHARK_FIELDS) - len(fields))
        (
            time_epoch, number, length, protocols,
            ip_src, ip_dst, ipv6_src, ipv6_dst,
            tcp_sport, tcp_dport, udp_sport, udp_dport,
            info,
        ) = fields[: len(_TSHARK_FIELDS)]

        if not time_epoch:
            return None

        try:
            pkt_time = datetime.fromtimestamp(float(time_epoch))
        except ValueError:
            return None

        return PacketInfo(
            number=int(number) if number.isdigit() else 0,
            time=pkt_time,
            length=int(length) if length.isdigit() else 0,
            protocols=protocols,
            src_ip=ip_src or ipv6_src,
            dst_ip=ip_dst or ipv6_dst,
            src_port=tcp_sport or udp_sport,
            dst_port=tcp_dport or udp_dport,
            info=info,
        )

    # ------------------------------------------------------------------
    # Single-packet full detail
    # ------------------------------------------------------------------

    def get_packet_details(self, packet_number: int) -> dict:
        """
        Decode a single packet's full field detail into a nested dict.

        Args:
            packet_number: 1-based frame number, i.e. PacketInfo.number /
                the leading field of to_content_str() -- matches the
                "packet index" shown in the "content" column.

        Returns:
            Nested dict of every layer/field tshark parsed for that packet
            (protocol name -> field name -> value), or {} if no packet with
            that frame number exists in the file.

        Raises:
            FileNotFoundError: tshark is not installed / not on PATH, or the
                pcap file doesn't exist.
        """
        if not self.pcap_file or not os.path.exists(self.pcap_file):
            raise FileNotFoundError(f"pcap file not found: {self.pcap_file}")

        if shutil.which(self.TSHARK_BIN) is None:
            raise FileNotFoundError(
                f"'{self.TSHARK_BIN}' not found on PATH; install Wireshark/tshark to decode pcaps."
            )

        cmd = [
            self.TSHARK_BIN,
            "-r", self.pcap_file,
            "-Y", f"frame.number=={packet_number}",
            "-T", "json",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)

        stdout = result.stdout.strip()
        if not stdout:
            return {}

        try:
            parsed = json.loads(stdout)
        except json.JSONDecodeError:
            return {}

        if not parsed:
            return {}

        return parsed[0].get("_source", {}).get("layers", {})

    # ------------------------------------------------------------------
    # DataFrame / LogSnapshot output
    # ------------------------------------------------------------------

    def to_dataframe(self) -> pd.DataFrame:
        """
        Build a "time" / "content" DataFrame from the decoded packets.

        Decodes lazily: calls decode() first if it hasn't run yet. Each row's
        "content" is the '|'-delimited basic packet info from PacketInfo.to_content_str().
        """
        if not self.packets:
            self.decode()

        if not self.packets:
            return pd.DataFrame({"time": [], "content": []})

        rows = [{"time": pkt.time, "content": pkt.to_content_str()} for pkt in self.packets]
        return pd.DataFrame(rows)

    def to_log_snapshot(
        self,
        device_config_id: str,
        device_name: str,
        session_id: str,
        session_scenario: str,
        log_name: str = "network_capture",
        log_description: str = "Decoded network packet capture",
        data_unit: str = "",
        log_type: str = "text",
    ) -> LogSnapshot:
        """
        Wrap the decoded packets in a LogSnapshot, mirroring
        DeviceWatchdog.save_log_snapshots.
        """
        log_content = self.to_dataframe()
        return LogSnapshot(
            device_config_id,
            device_name,
            log_name,
            log_description,
            session_id,
            session_scenario,
            data_unit,
            log_type,
            log_content,
        )
