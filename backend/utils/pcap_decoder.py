from __future__ import annotations
import json
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import pandas as pd
from backend.models.log_snapshot import LogSnapshot

logger = logging.getLogger(__name__)

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
        Convert PacketInfo object to single string with all params divided by '|'.

        Returns:
            (str): String with all PacketInfo params divided by '|'
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
    """

    def __init__(self, dissectors_dir: str | os.PathLike):
        self.dissectors_dir = Path(dissectors_dir)
        self.dissectors_dir.mkdir(parents=True, exist_ok=True)

    def save(self, filename: str, data: bytes) -> Path:
        """
        Persist a dissector file.

        Args:
            filename (str): Bare filename of dissector (e.g. ``"my_proto.lua"``).
            data (bytes): Raw dissector file bytes.

        Returns:
            (str): Path to the saved file.

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
            filename (str): Bare dissector filename.

        Returns:
            (bool): True if the file existed and was deleted, False otherwise.
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
            (list): List of dicts with ``name``, ``size_bytes``, and ``extension`` keys, sorted alphabetically by name.
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

    def get_plugin_args(self) -> list[str]:
        """
        Build the tshark command-line arguments that load all registered dissector files.
        Lua scripts are loaded individually via ``-X lua_script:<path>``.
        Shared libraries (.so/.dll) are added via ``--plugin-path`` pointing
        at the dissectors directory (tshark scans the directory for plugins).

        Returns:
            (list): List of extra arguments to append to a tshark command.
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

        if has_native:
            args += ["--plugin-path", str(self.dissectors_dir)]

        return args


class PcapDecoder:
    """
    Decodes a pcap file using tshark (default) or a custom binary/command
    configured per-device, and exposes the packets both as PacketInfo objects
    and as a "time" + "content" DataFrame.

    Two decoding modes are supported:

    * **tshark mode** (``decoder_cmd`` is ``None`` or ``"tshark"``): the full
      tshark field-extraction pipeline is used, custom dissectors are loaded,
      and ``get_packet_details`` returns a rich JSON protocol tree.

    * **custom-binary mode** (``decoder_cmd`` is any other non-empty string):
      the command is treated as an opaque shell command that must accept a pcap
      file path as its last argument and write tab-separated lines whose columns
      match the order of ``_TSHARK_FIELDS`` to stdout.  Dissector plugins are
      **not** applied (they are tshark-specific), and ``get_packet_details``
      returns an empty dict because the JSON protocol-tree output format is
      tshark-specific.  The first token of ``decoder_cmd`` is checked for
      existence on PATH before the command is run.
    """

    TSHARK_BIN = "tshark"

    def __init__(
        self,
        pcap_file: str,
        dissectors_dir: str | os.PathLike | DissectorRegistry | None = None,
        decoder_cmd: str | None = None,
    ):
        self.pcap_file = pcap_file
        self.packets: list[PacketInfo] = []

        if isinstance(dissectors_dir, DissectorRegistry):
            self._registry: DissectorRegistry | None = dissectors_dir
        elif dissectors_dir is not None:
            self._registry = DissectorRegistry(dissectors_dir)
        else:
            self._registry = None

        # Normalise: treat None / empty / "tshark" as the default tshark path.
        raw = (decoder_cmd or "").strip()
        self._custom_cmd: str | None = raw if raw and raw != self.TSHARK_BIN else None

    # ── helpers ───────────────────────────────────────────────────────────────

    @property
    def _is_custom(self) -> bool:
        """True when a non-tshark decoder command has been configured."""
        return self._custom_cmd is not None

    @property
    def _decoder_bin(self) -> str:
        """The binary name/path actually used for decoding."""
        if self._is_custom:
            # First whitespace-separated token is the executable.
            return self._custom_cmd.split()[0]
        return self.TSHARK_BIN

    def _check_decoder(self) -> None:
        """
        Raise FileNotFoundError if the configured decoder binary is not on PATH.
        """
        bin_name = self._decoder_bin
        if shutil.which(bin_name) is None:
            if self._is_custom:
                raise FileNotFoundError(
                    f"Custom pcap decoder '{bin_name}' not found on PATH. "
                    f"Check the 'decoder_cmd' setting for this device."
                )
            raise FileNotFoundError(
                f"'{bin_name}' not found on PATH; install Wireshark/tshark to decode pcaps."
            )

    def _plugin_args(self) -> list[str]:
        """
        Return extra tshark args for custom dissectors (empty list if none or
        if a custom decoder is in use, since dissectors are tshark-specific).

        Returns:
            (list): Extra tshark args for custom dissectors.
        """
        if self._is_custom or self._registry is None:
            return []
        return self._registry.get_plugin_args()

    # ── class-method constructors ─────────────────────────────────────────────

    @classmethod
    def for_session(
        cls,
        device_data_dir: str,
        session_id: str,
        dissectors_dir: str | os.PathLike | DissectorRegistry | None = None,
        decoder_cmd: str | None = None,
    ) -> "PcapDecoder":
        """
        Build a PcapDecoder for a session's saved pcap file, i.e.
        <device_data_dir>/<session_id>.pcap -- the naming convention used by
        DeviceWatchdog.save_log_snapshots once it renames the raw capture.

        Args:
            device_data_dir (str): Per-device data directory.
            session_id (str): Session whose pcap should be decoded.
            dissectors_dir (str): Optional custom dissectors directory or registry.
            decoder_cmd (str | None): Optional custom decoder command.  When
                ``None`` or ``"tshark"``, the standard tshark pipeline is used.

        Returns:
            (PcapDecoder): PcapDecoder class object.
        """
        return cls(
            os.path.join(device_data_dir, f"{session_id}.pcap"),
            dissectors_dir=dissectors_dir,
            decoder_cmd=decoder_cmd,
        )

    @classmethod
    def get_session_packet_details(
        cls,
        device_data_dir: str,
        session_id: str,
        packet_number: int,
        dissectors_dir: str | os.PathLike | DissectorRegistry | None = None,
        decoder_cmd: str | None = None,
    ) -> dict:
        """
        Convenience one-shot: resolve a session's pcap path and decode a
        single packet's full field detail from it.

        Args:
            device_data_dir (str): Per-device data directory.
            session_id (str): Session whose pcap to decode.
            packet_number (int): 1-based frame number.
            dissectors_dir (str): Optional custom dissectors directory or registry.
            decoder_cmd (str | None): Optional custom decoder command.  Packet
                detail is only available in tshark mode; a custom decoder
                returns an empty dict.

        Returns:
            (dict): Single packet details extracted with tshark in dict format,
                or an empty dict when a custom decoder is configured.

        Raises:
            FileNotFoundError: The configured decoder is not installed / not on PATH.
        """
        decoder = cls.for_session(
            device_data_dir,
            session_id,
            dissectors_dir=dissectors_dir,
            decoder_cmd=decoder_cmd,
        )
        if not os.path.exists(decoder.pcap_file):
            return {}
        return decoder.get_packet_details(packet_number)

    # ── decoding ──────────────────────────────────────────────────────────────

    def decode(self) -> list[PacketInfo]:
        """
        Run the configured decoder over the pcap file and populate self.packets.

        In **tshark mode** the standard field-extraction pipeline is used and
        custom dissectors are loaded automatically.

        In **custom-binary mode** the ``decoder_cmd`` is split on whitespace,
        the pcap file path is appended as the final argument, and the process
        is expected to write tab-separated lines matching ``_TSHARK_FIELDS``
        order to stdout.  A non-zero exit status is not treated as fatal
        (matching the existing tshark behaviour).

        Returns:
            (list): The decoded list of PacketInfo objects (also stored on self.packets).

        Raises:
            FileNotFoundError: The decoder binary is not on PATH, or no
                ``pcap_file`` path was given.
        """
        if not self.pcap_file:
            raise FileNotFoundError("PcapDecoder was given no pcap_file path to decode.")

        self._check_decoder()

        if self._is_custom:
            cmd = self._custom_cmd.split() + [self.pcap_file]
            logger.debug("Custom pcap decoder command: %s", cmd)
        else:
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
        """
        Parse a single tab-separated decoder output line into a PacketInfo.

        The expected column order is defined by ``_TSHARK_FIELDS``.  Both the
        built-in tshark pipeline and any custom decoder must produce output in
        this format.

        Args:
            line (str): Single tab-separated decoder output line.

        Returns:
            (PacketInfo | None): PacketInfo object, or None if the line is malformed.
        """
        fields = line.split("\t")
        # Pad in case trailing empty fields were stripped by the decoder.
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

    def get_packet_details(self, packet_number: int) -> dict:
        """
        Decode a single packet's full field detail into a nested dict.

        This method is only meaningful in **tshark mode**.  When a custom
        decoder is configured it returns an empty dict immediately, because the
        JSON protocol-tree output format (``tshark -T json``) is tshark-specific
        and cannot be emulated by an arbitrary binary.

        When custom dissectors are registered via ``dissectors_dir``, tshark
        loads them before parsing so their protocol trees appear alongside the
        standard layers in the returned dict.

        Args:
            packet_number (int): Frame number ("packet index" shown in the
                "content" column).

        Returns:
            (dict): Nested dict of every layer/field tshark parsed for that
                packet, or an empty dict in custom-decoder mode.

        Raises:
            FileNotFoundError: tshark is not installed / not on PATH, or the
                pcap file doesn't exist (tshark mode only).
        """
        if self._is_custom:
            logger.debug(
                "get_packet_details is not supported for custom decoder '%s'; returning empty dict.",
                self._custom_cmd,
            )
            return {}

        if not self.pcap_file or not os.path.exists(self.pcap_file):
            raise FileNotFoundError(f"pcap file not found: {self.pcap_file}")

        self._check_decoder()

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

    def to_dataframe(self) -> pd.DataFrame:
        """
        Build a "time" / "content" DataFrame from the decoded packets.

        Returns:
            (pd.DataFrame): DataFrame object generated decoded packets.
        """
        if not self.packets:
            self.decode()

        if not self.packets:
            return pd.DataFrame({"time": [], "content": []})

        rows = [{"time": pkt.time, "content": pkt.to_content_str()} for pkt in self.packets]
        return pd.DataFrame(rows)

    def to_log_snapshot(self,
                        device_config_id: str,
                        device_name: str,
                        session_id: str,
                        session_scenario: str,
                        log_name: str = "network capture",
                        log_description: str = "Decoded network packet capture",
                        data_unit: str = "",
                        log_type: str = "text") -> LogSnapshot:
        """
        Wrap the decoded packets in a LogSnapshot, mirroring DeviceWatchdog.save_log_snapshots.
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