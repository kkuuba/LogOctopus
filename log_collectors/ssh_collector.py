import fabric


class SshCollector:

    def __init__(self, host, user, password, ssh_key=None):
        self.host = host
        self.user = user
        self.password = password
        self.ssh_key = ssh_key
        self.ssh_connection = "sad"
