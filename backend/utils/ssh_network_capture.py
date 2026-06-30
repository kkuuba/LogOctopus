import threading
import time
import socket
import logging

logger = logging.getLogger(__name__)


class SshNetworkCapture:
    """
    Captures network traffic from a remote host via `tcpdump` over an
    existing SSH connection, writing the raw pcap stream to a local file.

    Fixes vs. the original implementation:
      * No PTY is allocated for the capture session. `tcpdump -w -` writes
        *binary* pcap data to stdout; a PTY rewrites bytes (e.g. \n -> \r\n
        and other terminal-mode translation), which silently corrupts the
        capture. The command now runs "headless".
      * Because there's no PTY, Ctrl-C (\x03) sent on the channel never
        reached the remote process anyway. Stopping is now done by opening
        a *second*, short-lived session that signals the specific tcpdump
        process directly (SIGINT) so it exits cleanly and flushes, then
        closing the capture channel from our end.
      * The reader thread no longer dies silently on a network blip.
        recv() errors / EOF are treated as a dropped connection and
        trigger a bounded, backoff retry loop rather than just stopping.
      * On reconnect, capture resumes into a *new* file segment
        (capture.pcap, capture.pcap.part2, ...) instead of appending.
        A pcap file's global header is only valid once at the very start
        of the stream, so splicing two tcpdump sessions into one file
        would silently corrupt it.
      * A lock guards shared state (`running`, session, file handle) so
        start()/stop() are safe to call from another thread.
      * stop() closes the session *before* joining the reader thread, so
        it can't hang waiting on a blocked recv().
      * The capture command and the command used to stop it are both
        configurable, so this works with tools other than Linux tcpdump --
        e.g. tshark on a Windows host reachable via SSH (OpenSSH Server
        for Windows). Defaults still target Linux tcpdump for backward
        compatibility.

    Command templates:
        `capture_start_cmd` and `capture_stop_cmd` may contain a literal
        "{iface}" placeholder, which gets substituted with `interface`.
        If "{iface}" isn't present, the string is used as-is (useful when
        the interface is already baked in, e.g. a Windows tshark
        interface index/GUID you don't want re-derived each time).

        Examples:
          Linux tcpdump, no sudo:
            capture_start_cmd="tcpdump -i {iface} -w -"
            capture_stop_cmd="pkill -INT -f 'tcpdump -i {iface} -w -'"

          Windows tshark over SSH (OpenSSH Server for Windows):
            capture_start_cmd="tshark -i {iface} -w -"
            capture_stop_cmd="taskkill /IM tshark.exe /F"
            Notes:
              * Windows interfaces are usually referenced by index or GUID
                (run `tshark -D` on the host to list them) rather than a
                name like "eth0".
              * `taskkill /IM` matches by image name, so it will kill
                *every* tshark.exe on the box, not just this capture's --
                fine for a single-capture-at-a-time host, risky otherwise.
                There's no SIGINT-style graceful signal available remotely
                on Windows the way there is on Linux, so this is forceful;
                tshark still flushes reasonably well on termination but a
                clean `-w -` Linux capture is more guaranteed not to lose
                the last buffered packets.
              * If `capture_stop_cmd` is left as None, no stop command is
                run at all -- stop() will just close the SSH channel and
                rely on the remote process exiting when its stdout pipe
                goes away (which OpenSSH for Windows generally does on
                channel close, but it's less reliable than an explicit
                stop command).
    """

    DEFAULT_CAPTURE_START_CMD = "sudo tcpdump -i {iface} -w -"
    DEFAULT_CAPTURE_STOP_CMD = "sudo pkill -INT -f 'tcpdump -i {iface} -w -'"

    def __init__(self, connection, interface="eth0", local_file="capture.pcap",
                 capture_start_cmd=None, capture_stop_cmd=None,
                 max_reconnect_attempts=5, reconnect_backoff_base=1.0,
                 reconnect_backoff_max=30.0, recv_size=65536):
        """
        connection:         a fabric.Connection (or similar) for the
                             target host.
        interface:           interface name/index/GUID, substituted into
                             any "{iface}" placeholder in
                             capture_start_cmd/capture_stop_cmd.
        local_file:          path to write the captured pcap stream to.
        capture_start_cmd:   full remote command to run for the capture.
                             Defaults to Linux tcpdump. Must write pcap
                             data to stdout (e.g. tcpdump's/tshark's
                             "-w -").
        capture_stop_cmd:    full remote command used to stop a *running*
                             capture started with capture_start_cmd,
                             gracefully. Defaults to a matching tcpdump
                             pkill. If you override capture_start_cmd but
                             leave capture_stop_cmd as None, no stop
                             command is assumed (it can't safely guess how
                             to find/stop an arbitrary command) -- stop()
                             will fall back to just closing the channel.
        """
        self.conn = connection
        self.interface = interface
        self.local_file_base = local_file
        self.capture_start_cmd = capture_start_cmd or self.DEFAULT_CAPTURE_START_CMD
        if capture_start_cmd is not None:
            # A custom capture command invalidates the default stop
            # command (which targets tcpdump specifically) unless the
            # caller also gives us a matching one.
            self.capture_stop_cmd = capture_stop_cmd
        else:
            self.capture_stop_cmd = (
                capture_stop_cmd if capture_stop_cmd is not None
                else self.DEFAULT_CAPTURE_STOP_CMD
            )

        self.session = None
        self.thread = None
        self.running = False
        self.local_file = None
        self._segment_index = 1
        self._lock = threading.RLock()

        self.max_reconnect_attempts = max_reconnect_attempts
        self.reconnect_backoff_base = reconnect_backoff_base
        self.reconnect_backoff_max = reconnect_backoff_max
        self.recv_size = recv_size

        self._stopped_event = threading.Event()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def start(self):
        with self._lock:
            if self.running:
                logger.warning("capture already running")
                return

            self._segment_index = 1
            self.running = True
            self._stopped_event.clear()

            self._open_segment(self.local_file_base)
            self._open_session(self.interface)

            self.thread = threading.Thread(target=self._reader_loop, daemon=True)
            self.thread.start()

        logger.info("capture started on %s -> %s (cmd=%r)", self.interface,
                     self.local_file_base, self.capture_start_cmd)

    def stop(self, timeout=10):
        with self._lock:
            if not self.running:
                return
            self.running = False

        # Ask the remote tcpdump to exit gracefully (flush its output)
        # before we close the channel from our end.
        self._signal_remote_tcpdump()

        if self.session is not None:
            try:
                self.session.close()
            except Exception:
                logger.exception("error closing capture session")

        if self.thread is not None:
            self.thread.join(timeout=timeout)
            if self.thread.is_alive():
                logger.warning("reader thread did not exit within %ss", timeout)

        if self.local_file is not None:
            try:
                self.local_file.flush()
                self.local_file.close()
            except Exception:
                logger.exception("error closing local capture file")
            self.local_file = None

        logger.info("capture stopped")

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _open_segment(self, path):
        """(Re)open the local file that capture bytes are written to."""
        if self.local_file is not None:
            try:
                self.local_file.flush()
                self.local_file.close()
            except Exception:
                logger.exception("error closing previous capture segment")
        self.local_file = open(path, "wb")

    def _next_segment_path(self):
        self._segment_index += 1
        return f"{self.local_file_base}.part{self._segment_index}"

    def _get_transport(self):
        """conn is a fabric.Connection. Fabric doesn't expose open_session()
        itself -- the real paramiko transport lives at conn.client. This
        opens the underlying SSH connection (if needed) and returns an
        active paramiko Transport, or raises if it can't get one."""
        if not getattr(self.conn, "is_connected", False):
            self.conn.open()

        transport = self.conn.client.get_transport()
        if transport is None or not transport.is_active():
            raise ConnectionError("SSH transport is not active")
        return transport

    def _format_cmd(self, template, iface):
        if "{iface}" in template:
            return template.format(iface=iface)
        return template

    def _open_session(self, iface):
        cmd = self._format_cmd(self.capture_start_cmd, iface)
        transport = self._get_transport()
        channel = transport.open_session()
        # Intentionally NOT calling get_pty(): a "-w -"-style command
        # emits binary pcap data to stdout, and a pty would mangle it.
        channel.exec_command(cmd)
        # Bounded timeout so recv() periodically returns control to the
        # reader loop instead of blocking forever -- this is what lets us
        # notice both a dead connection and a stop() request promptly.
        channel.settimeout(1.0)
        self.session = channel

    def _signal_remote_tcpdump(self):
        """Best-effort: ask the remote capture process started for this
        session to terminate cleanly so it flushes any buffered packets.
        No-op if no stop command is configured for the current capture
        command (see start()'s docstring)."""
        if not self.capture_stop_cmd:
            logger.info("no stop command configured for this capture "
                        "command; relying on channel close to terminate "
                        "the remote process")
            return

        try:
            transport = self.conn.client.get_transport()
            if transport is None or not transport.is_active():
                return
            kill_cmd = self._format_cmd(self.capture_stop_cmd, self.interface)
            channel = transport.open_session()
            channel.exec_command(kill_cmd)
            channel.settimeout(5)
            try:
                channel.recv_exit_status()
            except Exception:
                pass
            channel.close()
        except Exception:
            logger.exception("failed to signal remote capture process to stop")

    def _reader_loop(self):
        consecutive_errors = 0

        while True:
            with self._lock:
                if not self.running:
                    break

            try:
                data = self.session.recv(self.recv_size)
            except socket.timeout:
                # Just a polling interval lapsing -- not an error. Loop
                # back around to re-check self.running.
                continue
            except Exception:
                logger.exception("recv() failed on capture session")
                data = None

            with self._lock:
                if not self.running:
                    break

            if data:
                consecutive_errors = 0
                try:
                    self.local_file.write(data)
                except Exception:
                    logger.exception("failed writing capture data to disk")
                    # A disk error isn't a network error - don't retry it
                    # as if it were.
                    with self._lock:
                        self.running = False
                    break
                continue

            # data is None (error) or b"" (remote closed) -> dropped
            # connection, try to recover.
            consecutive_errors += 1
            if not self._attempt_reconnect(consecutive_errors):
                logger.error("giving up after %s failed reconnect attempts",
                              consecutive_errors)
                with self._lock:
                    self.running = False
                break

        self._stopped_event.set()

    def _attempt_reconnect(self, attempt_number):
        """Try to re-establish the SSH session and a fresh capture using
        the configured capture command, rotating to a new local file
        segment so two pcap streams never get spliced into one file.
        Returns True if a new session is ready to read from."""
        if attempt_number > self.max_reconnect_attempts:
            return False

        delay = min(self.reconnect_backoff_base * (2 ** (attempt_number - 1)),
                    self.reconnect_backoff_max)
        logger.warning("capture connection lost, reconnect attempt %s/%s "
                        "in %.1fs", attempt_number, self.max_reconnect_attempts,
                        delay)
        time.sleep(delay)

        with self._lock:
            if not self.running:
                return False

        try:
            try:
                self.session.close()
            except Exception:
                pass

            try:
                self._get_transport()
            except Exception:
                # Transport is dead -- force Fabric to tear down and
                # re-establish the underlying SSH connection.
                try:
                    self.conn.close()
                except Exception:
                    pass
                self.conn.open()

            new_path = self._next_segment_path()
            self._open_segment(new_path)
            self._open_session(self.interface)
            logger.info("capture resumed -> new segment %s", new_path)
            return True
        except Exception:
            logger.exception("reconnect attempt %s failed", attempt_number)
            return False
