"""
PcapDecoder: decodes a pcap file (as produced by SshNetworkCapture) using
tshark, exposes each packet as a PacketInfo object, and can render the
result as a "time"/"content" DataFrame suitable for wrapping in a
LogSnapshot -- mirroring the shape DeviceWatchdog uses for its other logs
(see DeviceWatchdog._entries_to_dataframe).

Custom dissectors
-----------------
tshark honours Lua plugin files placed in its personal plugin directory
(``~/.config/wireshark/plugins/`` on Linux, or whatever
``tshark -G folders`` reports as ``Personal Lua Plugins``).  This class
adds first-class support for *uploading* dissector files at runtime so
that ``get_packet_details`` enriches its JSON output with the extra
protocol fields those dissectors expose.

Usage::

    decoder = PcapDecoder("capture.pcap", dissectors_dir="/path/to/dissectors")
    decoder.install_dissectors()     # copy *.lua / *.so files into tshark plugin dir
    details = decoder.get_packet_details(42)

The ``DissectorRegistry`` helper class manages the dissectors directory and
the backend API endpoints for upload/list/delete (see app.py integration
notes at the bottom of this module).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import pandas as pd

from backend.models.log_snapshot import LogSnapshot

logger = logging.getLogger(__name__)

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

# Supported dissector file extensions.  Lua plugins are universally supported
# by Wireshark/tshark; compiled .so/.dll plugins require a matching tshark
# build but are included for completeness.
DISSECTOR_EXTENSIONS = {".lua", ".so", ".dll"}


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


class DissectorRegistry:
    """
    Manages a directory of custom tshark dissector files (Lua plugins, shared
    libraries) that the user uploads through the settings UI.

    The registry keeps files in a persistent ``dissectors_dir`` on disk.
    ``PcapDecoder`` calls ``get_plugin_args()`` to obtain the ``-X lua_script:``
    / ``--plugin-path`` flags that inject those files into a tshark invocation.

    Typical flow
    ~~~~~~~~~~~~
    1. User uploads a ``.lua`` file via ``POST /api/settings/dissectors``.
    2. The backend saves it with ``registry.save(filename, file_bytes)``.
    3. When a packet-details query comes in, ``PcapDecoder`` (initialised with
       ``dissectors_dir``) picks up the file automatically via
       ``get_plugin_args()``.
    """

    def __init__(self, dissectors_dir: str | os.PathLike):
        self.dissectors_dir = Path(dissectors_dir)
        self.dissectors_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # File management
    # ------------------------------------------------------------------

    def save(self, filename: str, data: bytes) -> Path:
        """
        Persist a dissector file.

        Args:
            filename: Bare filename (e.g. ``"my_proto.lua"``).  Path components
                are stripped to prevent directory-traversal attacks.
            data: Raw file bytes.

        Returns:
            Path to the saved file.

        Raises:
            ValueError: The filename has an unsupported extension.
        """
        safe_name = Path(filename).name  # strip any path components
        if Path(safe_name).suffix.lower() not in DISSECTOR_EXTENSIONS:
            raise ValueError(
                f"Unsupported dissector extension '{Path(safe_name).suffix}'. "
                f"Allowed: {', '.join(sorted(DISSECTOR_EXTENSIONS))}"
            )
        dest = self.dissectors_dir / safe_name
        dest.write_bytes(data)
        logger.info("Dissector saved: %s (%d bytes)", dest, len(data))
        return dest

    def delete(self, filename: str) -> bool:
        """
        Remove a dissector file.

        Args:
            filename: Bare filename.

        Returns:
            True if the file existed and was deleted, False otherwise.
        """
        target = self.dissectors_dir / Path(filename).name
        if target.exists():
            target.unlink()
            logger.info("Dissector deleted: %s", target)
            return True
        return False

    def list_dissectors(self) -> list[dict]:
        """
        List all dissector files in the registry.

        Returns:
            List of dicts with ``name``, ``size_bytes``, and ``extension`` keys,
            sorted alphabetically by name.
        """
        entries = []
        for p in sorted(self.dissectors_dir.iterdir()):
            if p.is_file() and p.suffix.lower() in DISSECTOR_EXTENSIONS:
                entries.append(
                    {
                        "name": p.name,
                        "size_bytes": p.stat().st_size,
                        "extension": p.suffix.lower(),
                    }
                )
        return entries

    # ------------------------------------------------------------------
    # tshark integration
    # ------------------------------------------------------------------

    def get_plugin_args(self) -> list[str]:
        """
        Build the tshark command-line arguments that load all registered
        dissector files.

        Lua scripts are loaded individually via ``-X lua_script:<path>``.
        Shared libraries (.so/.dll) are added via ``--plugin-path`` pointing
        at the dissectors directory (tshark scans the directory for plugins).

        Returns:
            List of extra arguments to append to a tshark command.
        """
        args: list[str] = []
        has_native = False

        for p in sorted(self.dissectors_dir.iterdir()):
            if not p.is_file():
                continue
            ext = p.suffix.lower()
            if ext == ".lua":
                args += ["-X", f"lua_script:{p}"]
            elif ext in {".so", ".dll"}:
                has_native = True

        # A single --plugin-path covers all .so/.dll files in the directory.
        if has_native:
            args += ["--plugin-path", str(self.dissectors_dir)]

        return args


class PcapDecoder:
    """
    Decodes a pcap file using tshark and exposes the packets both as
    PacketInfo objects and as a "time"/"content" DataFrame.

    Custom dissectors
    ~~~~~~~~~~~~~~~~~
    Pass a ``dissectors_dir`` (or a pre-built ``DissectorRegistry``) to
    automatically inject all registered plugin files into every tshark
    invocation.  The extra protocol fields they expose will appear inside
    the nested dict returned by ``get_packet_details()``.

    Example::

        registry = DissectorRegistry("data/dissectors")
        decoder  = PcapDecoder("session.pcap", dissectors_dir=registry)
        decoder.decode()
        details = decoder.get_packet_details(5)
        # details["my_custom_proto"] now contains dissector-injected fields
    """

    TSHARK_BIN = "tshark"

    def __init__(
        self,
        pcap_file: str,
        dissectors_dir: str | os.PathLike | DissectorRegistry | None = None,
    ):
        """
        Args:
            pcap_file: Path to the local .pcap/.pcapng file to decode
                (e.g. the local_file used by SshNetworkCapture).
            dissectors_dir: Optional path to a directory of custom dissector
                files (Lua/so/dll), or an existing ``DissectorRegistry``
                instance.  When provided, all files in the directory are
                loaded into every tshark call so their decoded fields appear
                in ``get_packet_details()`` output.
        """
        self.pcap_file = pcap_file
        self.packets: list[PacketInfo] = []

        # Normalise dissectors_dir to a DissectorRegistry (or None).
        if isinstance(dissectors_dir, DissectorRegistry):
            self._registry: DissectorRegistry | None = dissectors_dir
        elif dissectors_dir is not None:
            self._registry = DissectorRegistry(dissectors_dir)
        else:
            self._registry = None

    # ------------------------------------------------------------------
    # Convenience constructors
    # ------------------------------------------------------------------

    @classmethod
    def for_session(
        cls,
        device_data_dir: str,
        session_id: str,
        dissectors_dir: str | os.PathLike | DissectorRegistry | None = None,
    ) -> "PcapDecoder":
        """
        Build a PcapDecoder for a session's saved pcap file, i.e.
        <device_data_dir>/<session_id>.pcap -- the naming convention used by
        DeviceWatchdog.save_log_snapshots once it renames the raw capture.

        Args:
            device_data_dir: Per-device data directory (DeviceWatchdog.device_data_dir).
            session_id: Session whose pcap should be decoded.
            dissectors_dir: Optional custom dissectors directory or registry.
        """
        return cls(
            os.path.join(device_data_dir, f"{session_id}.pcap"),
            dissectors_dir=dissectors_dir,
        )

    @classmethod
    def get_session_packet_details(
        cls,
        device_data_dir: str,
        session_id: str,
        packet_number: int,
        dissectors_dir: str | os.PathLike | DissectorRegistry | None = None,
    ) -> dict:
        """
        Convenience one-shot: resolve a session's pcap path and decode a
        single packet's full field detail from it.

        Returns {} if the session's pcap file doesn't exist (rather than
        raising), since a missing session is an expected, non-exceptional
        case for callers -- e.g. an invalid/expired session_id.

        Args:
            device_data_dir: Per-device data directory.
            session_id: Session whose pcap to decode.
            packet_number: 1-based frame number.
            dissectors_dir: Optional custom dissectors directory or registry.

        Raises:
            FileNotFoundError: tshark is not installed / not on PATH.
        """
        decoder = cls.for_session(device_data_dir, session_id, dissectors_dir=dissectors_dir)
        if not os.path.exists(decoder.pcap_file):
            return {}
        return decoder.get_packet_details(packet_number)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _plugin_args(self) -> list[str]:
        """Return extra tshark args for custom dissectors (empty list if none)."""
        if self._registry is None:
            return []
        return self._registry.get_plugin_args()

    def _check_tshark(self) -> None:
        """Raise FileNotFoundError if tshark is not on PATH."""
        if shutil.which(self.TSHARK_BIN) is None:
            raise FileNotFoundError(
                f"'{self.TSHARK_BIN}' not found on PATH; install Wireshark/tshark to decode pcaps."
            )

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

        Custom dissectors registered in ``dissectors_dir`` are loaded
        automatically; they do *not* affect the flat summary fields decoded
        here but do enrich ``get_packet_details()`` output.

        Returns:
            The decoded list of PacketInfo objects (also stored on self.packets).

        Raises:
            FileNotFoundError: tshark is not installed / not on PATH, or no
                pcap_file path was given.
        """
        if not self.pcap_file:
            raise FileNotFoundError("PcapDecoder was given no pcap_file path to decode.")

        self._check_tshark()

        cmd = [
            self.TSHARK_BIN,
            "-r", self.pcap_file,
            "-T", "fields",
            "-E", "separator=\t",
            "-E", "quote=n",
            "-E", "occurrence=f",
        ] + self._plugin_args()

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

        When custom dissectors are registered via ``dissectors_dir``, tshark
        loads them before parsing so their protocol trees appear alongside the
        standard layers in the returned dict.

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

        self._check_tshark()

        cmd = [
            self.TSHARK_BIN,
            "-r", self.pcap_file,
            "-Y", f"frame.number=={packet_number}",
            "-T", "json",
        ] + self._plugin_args()

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
        log_name: str = "network capture",
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


# ---------------------------------------------------------------------------
# app.py integration notes
# ---------------------------------------------------------------------------
# The three new endpoints below should be wired into app.py alongside the
# existing /api/snapshots/<id>/pcap route.  A single shared DissectorRegistry
# instance is created at startup and passed to every PcapDecoder call.
#
# Suggested wiring in app.py:
#
#   from backend.utils.pcap_decoder import PcapDecoder, DissectorRegistry
#
#   DISSECTORS_DIR = Path("data/dissectors")
#   dissector_registry = DissectorRegistry(DISSECTORS_DIR)
#
#   # Pass to decoder:
#   decoder = PcapDecoder.for_session(
#       device_data_dir, session_id, dissectors_dir=dissector_registry
#   )
#
# POST /api/settings/dissectors
#   body: multipart/form-data with field "file"
#   saves dissector_registry.save(file.filename, file.read())
#   returns {"name": ..., "size_bytes": ...}
#
# GET /api/settings/dissectors
#   returns dissector_registry.list_dissectors()
#
# DELETE /api/settings/dissectors/<filename>
#   dissector_registry.delete(filename)
#   returns {"deleted": true/false}
