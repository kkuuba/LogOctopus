import threading
import time
import socket
import logging

logger = logging.getLogger(__name__)


class SshNetworkCapture:
    """
    A class used to start and stop network capture on targe remote device.
    """
    def __init__(self,
                 connection,
                 capture_start_cmd,
                 capture_stop_cmd,
                 local_file="capture.pcap",
                 max_reconnect_attempts=5,
                 reconnect_backoff_base=1.0,
                 reconnect_backoff_max=30.0,
                 recv_size=65536,
                 max_file_size_bytes=None,
                 on_limit_reached=None):
        """
        Initializes a SshNetworkCapture instance.

        Args:
            connection (Connection): Connection to trigger SSH network capture on remote device.
            capture_start_cmd (str): Command to start network capture on remote device.
            capture_stop_cmd (str): Command to stop network capture on remote device.
            local_file (str): Name for local file where pcap will be collected.
            max_reconnect_attempts (int): Max number of reconnect attempts.
            reconnect_backoff_base (float): Initial time for device to wait before next attempt to reconnect.
            reconnect_backoff_max (float): Max time for device to wait before next attempt to reconnect.
            recv_size (int): Size of buffer during network capture collection.
            max_file_size_bytes (int): Max size of network capture file.
            on_limit_reached (function): Function to trigger when max capture file limit is reached.
        """
        self.conn = connection
        self.capture_start_cmd = capture_start_cmd
        self.capture_stop_cmd = capture_stop_cmd
        self.local_file_base = local_file
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
        self.max_file_size_bytes = max_file_size_bytes
        self.on_limit_reached = on_limit_reached
        self._total_bytes_written = 0
        self.limit_reached = False
        self._stopped_event = threading.Event()

    def start(self):
        """
        Start network capture on remote device.
        """
        with self._lock:
            if self.running:
                logger.warning("capture already running")
                return

            self._segment_index = 1
            self.running = True
            self._total_bytes_written = 0
            self.limit_reached = False
            self._stopped_event.clear()

            self._open_segment(self.local_file_base)
            self._open_session()

            self.thread = threading.Thread(target=self._reader_loop, daemon=True)
            self.thread.start()

        logger.info("Network capture started -> %s (cmd=%r)", self.local_file_base, self.capture_start_cmd)

    def stop(self, timeout=10):
        """
        Stop network capture on remote device.

        Args:
            timeout (int): Number of seconds to wait for gracfull network capture stop.
        """
        with self._lock:
            if not self.running:
                return
            self.running = False

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

    def _open_segment(self, path):
        """
        (Re)open the local file that capture bytes are written to.

        Args:
            path (str): Path of segment local file.
        """
        if self.local_file is not None:
            try:
                self.local_file.flush()
                self.local_file.close()
            except Exception:
                logger.exception("error closing previous capture segment")
        self.local_file = open(path, "wb")

    def _next_segment_path(self):
        """
        Get next segment file path.

        Returns:
            str: Path of next segment file.
        """
        self._segment_index += 1
        return f"{self.local_file_base}.part{self._segment_index}"

    def _get_transport(self):
        """
        Get paramiko transport object if connection is active.

        Returns:
            object: Paramiko SSH transport object.
        """
        if not getattr(self.conn, "is_connected", False):
            self.conn.open()

        transport = self.conn.client.get_transport()
        if transport is None or not transport.is_active():
            raise ConnectionError("SSH transport is not active")
        return transport

    def _open_session(self):
        """
        Open SSH capturing session.
        """
        cmd = f"{self.capture_start_cmd} -w -"
        transport = self._get_transport()
        channel = transport.open_session()
        channel.exec_command(cmd)
        channel.settimeout(1.0)
        self.session = channel

    def _signal_remote_tcpdump(self):
        """
        Send target cmd to stop ongoing network capture.
        """
        if not self.capture_stop_cmd:
            logger.info("No stop command configured for this capture command; relying on channel close to terminate the remote process")
            return

        try:
            transport = self.conn.client.get_transport()
            if transport is None or not transport.is_active():
                return
            kill_cmd = self.capture_stop_cmd
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

    def _stop_due_to_limit(self):
        """
        Stop ongoing network capture when capture file size limit is reached.
        """
        with self._lock:
            if not self.running:
                return
            self.running = False

        logger.warning(
            "pcap size limit reached (%s bytes >= %s byte limit); stopping capture",
            self._total_bytes_written, self.max_file_size_bytes,
        )

        self._signal_remote_tcpdump()

        if self.session is not None:
            try:
                self.session.close()
            except Exception:
                logger.exception("error closing capture session")

        if self.local_file is not None:
            try:
                self.local_file.flush()
                self.local_file.close()
            except Exception:
                logger.exception("error closing local capture file")
            self.local_file = None

        self.limit_reached = True
        if self.on_limit_reached is not None:
            try:
                self.on_limit_reached()
            except Exception:
                logger.exception("on_limit_reached callback failed")

    def _reader_loop(self):
        """
        Main loop for SSH network capture colllector.
        """
        consecutive_errors = 0

        while True:
            with self._lock:
                if not self.running:
                    break

            try:
                data = self.session.recv(self.recv_size)
            except socket.timeout:
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
                    with self._lock:
                        self.running = False
                    break

                self._total_bytes_written += len(data)
                if (self.max_file_size_bytes is not None and self._total_bytes_written >= self.max_file_size_bytes):
                    self._stop_due_to_limit()
                    break
                continue

            consecutive_errors += 1
            if not self._attempt_reconnect(consecutive_errors):
                logger.error("giving up after %s failed reconnect attempts",
                              consecutive_errors)
                with self._lock:
                    self.running = False
                break

        self._stopped_event.set()

    def _attempt_reconnect(self, attempt_number):
        """
        Try to re-establish network capture collection with split new session to seperate file.

        Args:
            attempt_number (int): Number of re-establish network capture collection attempt.
        """
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
                try:
                    self.conn.close()
                except Exception:
                    pass
                self.conn.open()

            new_path = self._next_segment_path()
            self._open_segment(new_path)
            self._open_session()
            logger.info("capture resumed -> new segment %s", new_path)
            return True
        except Exception:
            logger.exception("reconnect attempt %s failed", attempt_number)
            return False
