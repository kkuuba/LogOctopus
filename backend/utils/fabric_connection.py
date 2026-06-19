"""
Shared Fabric Connection builder.

This module is the single source of truth for turning a device/gateway
config dict into a ``fabric.Connection``. It is imported by both:

- ``app.py``            (config builder's Test Connection / Exec Command
                          endpoints, plus persisted device configs)
- ``device_watchdog.py`` (the running collector service)

Having one implementation guarantees that a connection which passes
"Test Connection" in the config builder UI will behave identically when
the watchdog actually runs it — including which private-key types are
accepted and how passphrases are applied.

Supported auth fields on a hop dict:
    - password            (str)
    - ssh_key_string       (str)  - PEM private key contents
    - ssh_key_path         (str)  - path to a private key file on disk
    - ssh_key_passphrase   (str)  - passphrase for an encrypted key,
                                    applies to both ssh_key_string and
                                    ssh_key_path

Supported gateway shapes (both are accepted so existing saved configs
and the flat test-connection payload both keep working):
    - Nested:  hop["gateway"]  = {..., "gateway": {...}}   (single dict,
               recurses)
    - Flat:    a top-level ``gateways: [...]`` list, oldest hop first,
               folded left-to-right by ``build_nested_connection``.
"""

from __future__ import annotations

import io

import paramiko
from fabric import Connection
from paramiko import AutoAddPolicy

# Key classes tried in order until one successfully parses the PEM string.
# DSSKey (DSA) was removed in newer paramiko releases since DSA is
# deprecated/insecure; only include it if still present so this module
# doesn't fail to import on either old or new paramiko.
_KEY_CLASSES = tuple(
    cls for cls in (
        paramiko.RSAKey,
        paramiko.Ed25519Key,
        paramiko.ECDSAKey,
        getattr(paramiko, "DSSKey", None),
    )
    if cls is not None
)


def _load_private_key_from_string(key_str: str, passphrase: str | None = None) -> paramiko.PKey:
    """Parse a PEM private key string, trying each supported key type.

    Args:
        key_str (str): PEM-formatted private key contents.
        passphrase (str | None): Passphrase to decrypt the key, if any.

    Returns:
        paramiko.PKey: The parsed key.

    Raises:
        ValueError: If no supported key type can parse the string (for
                    example because the data is malformed, or because an
                    encrypted key was given the wrong passphrase).
    """
    key_file = io.StringIO(key_str.strip())
    last_error: Exception | None = None
    for key_cls in _KEY_CLASSES:
        try:
            key_file.seek(0)
            return key_cls.from_private_key(key_file, password=passphrase or None)
        except paramiko.SSHException as exc:
            last_error = exc
            continue
    tried = " / ".join(cls.__name__.replace("Key", "") for cls in _KEY_CLASSES)
    detail = f": {last_error}" if last_error else ""
    raise ValueError(
        f"ssh_key_string is not a recognised private key format ({tried}), "
        f"or the passphrase is incorrect{detail}"
    )


def build_connect_kwargs(hop: dict) -> dict:
    """Build Fabric's ``connect_kwargs`` for a single hop config.

    Tries, in order: an inline PEM string (``ssh_key_string``), a key
    file path (``ssh_key_path``), then falls back to ``password``. Both
    key forms honour ``ssh_key_passphrase`` if present. All three may be
    set at once (e.g. key + password fallback); Paramiko will use the
    key if present.

    Args:
        hop (dict): Keys: password, ssh_key_string, ssh_key_path,
                    ssh_key_passphrase. All optional.

    Returns:
        dict: Suitable for ``fabric.Connection(connect_kwargs=...)``.

    Raises:
        ValueError: If ``ssh_key_string`` is set but unparsable.
    """
    connect_kwargs: dict = {}
    passphrase = hop.get("ssh_key_passphrase") or None

    if hop.get("ssh_key_string"):
        connect_kwargs["pkey"] = _load_private_key_from_string(hop["ssh_key_string"], passphrase)
    elif hop.get("ssh_key_path"):
        connect_kwargs["key_filename"] = hop["ssh_key_path"]
        if passphrase:
            connect_kwargs["passphrase"] = passphrase

    if hop.get("password"):
        connect_kwargs["password"] = hop["password"]

    return connect_kwargs


def build_fabric_connection(hop: dict, gateway: Connection | None = None) -> Connection:
    """Construct a Fabric Connection for a single SSH hop.

    Args:
        hop (dict): Keys: ip_address, port (default 22), user, password,
                    ssh_key_string, ssh_key_path, ssh_key_passphrase.
                    May also carry a nested ``gateway`` dict, used only
                    when the caller doesn't already supply one via the
                    ``gateway`` argument (see :func:`build_nested_connection`).
        gateway (fabric.Connection | None): An already-constructed Fabric
                    Connection to use as the jump host, or None for a
                    direct connection.

    Returns:
        fabric.Connection: Ready-to-use (not yet open) connection.
    """
    if gateway is None and hop.get("gateway"):
        gateway = build_fabric_connection(hop["gateway"])

    conn = Connection(
        host=hop["ip_address"].strip(),
        user=hop.get("user", "").strip(),
        port=int(hop.get("port", 22)),
        gateway=gateway,
        connect_timeout=8,
        connect_kwargs=build_connect_kwargs(hop),
    )
    # Accept unknown host keys automatically (mirrors paramiko AutoAddPolicy)
    conn.client.set_missing_host_key_policy(AutoAddPolicy())
    return conn


def build_nested_connection(body: dict) -> Connection:
    """Build a (potentially multi-hop) Fabric Connection from a config dict.

    Accepts either gateway shape so both the persisted device config and
    the config builder's test/exec payloads work unchanged:

    - Flat:   body["gateways"] = [hop0, hop1, ...] (outermost first),
              folded left-to-right: hop0 -> hop1 -> ... -> target.
    - Nested: body["gateway"] = {..., "gateway": {...}}, recursed via
              :func:`build_fabric_connection`.

    If both are present, the flat ``gateways`` list takes precedence.

    Args:
        body (dict): Target hop config. Required: ip_address, user.
                     Optional: port (default 22), password,
                     ssh_key_string, ssh_key_path, ssh_key_passphrase,
                     gateways (flat list) or gateway (nested dict).

    Returns:
        fabric.Connection: Fully configured nested connection.

    Raises:
        ValueError: If required target fields are missing, or a key
                    string can't be parsed.
    """
    ip = body.get("ip_address", "").strip()
    user = body.get("user", "").strip()
    if not ip or not user:
        raise ValueError("missing required fields: ip_address, user")

    gateways = body.get("gateways") or []

    if gateways:
        gateway_conn = None
        for hop in gateways:
            gateway_conn = build_fabric_connection(hop, gateway=gateway_conn)
        return build_fabric_connection(body, gateway=gateway_conn)

    # Falls back to the nested body["gateway"] shape, if any.
    return build_fabric_connection(body)
