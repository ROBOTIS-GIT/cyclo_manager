"""Serial transport with PING, READ and one restricted HX5 mode write."""

import fcntl
import os
from pathlib import Path
import stat
import time


class DeviceLock:
    """Cooperative lock shared by diagnostics and the container's port mapper."""

    def __init__(self, port):
        device = os.stat(port)
        if not stat.S_ISCHR(device.st_mode):
            raise ValueError(f'Not a character device: {port}')
        self.path = Path('/dev/shm') / f'cyclo-dxl-{os.major(device.st_rdev)}-{os.minor(device.st_rdev)}.lock'
        self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o666)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except Exception:
            os.close(self.fd)
            self.fd = None
            raise RuntimeError(f'Another diagnostic or port-mapper task is using {port}') from None

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


class DynamixelBus:
    """Communicate with DYNAMIXEL devices over a serial bus."""

    def __init__(self, path, baud):
        from dynamixel_sdk import PacketHandler, PortHandler

        class BoundedPort(PortHandler):
            def getCurrentTime(self):
                return time.monotonic() * 1000

            def setPacketTimeout(self, packet_length):
                super().setPacketTimeout(packet_length)
                self.packet_timeout = min(self.packet_timeout, 100.0)

            def setPacketTimeoutMillis(self, milliseconds):
                super().setPacketTimeoutMillis(min(milliseconds, 1000.0))

        self.lock = DeviceLock(path)
        self.port = BoundedPort(path)
        self.packet = PacketHandler(2.0)
        try:
            if not self.port.setBaudRate(baud):
                raise ValueError(f'SDK cannot configure baud rate {baud}')
            self.port.ser.write_timeout = 0.2
        except Exception:
            self.close()
            raise

    def close(self):
        try:
            if self.port.is_open:
                self.port.closePort()
        finally:
            self.lock.close()

    def discover(self):
        found, result = self.packet.broadcastPing(self.port)
        return found, None if result == 0 else self.packet.getTxRxResult(result)

    def _check(self, result, error):
        if result != 0:
            raise RuntimeError(self.packet.getTxRxResult(result))
        # Alert means hardware error telemetry must still be read. Lower bits
        # describe an instruction error and do not constitute a valid read.
        if error & 0x7f:
            raise RuntimeError(self.packet.getRxPacketError(error))

    def ping(self, device_id):
        model, result, error = self.packet.ping(self.port, device_id)
        self._check(result, error)
        return model, error

    def read(self, device_id, register):
        data, result, error = self.packet.readTxRx(
            self.port, device_id, register.address, register.size)
        self._check(result, error)
        if len(data) != register.size:
            raise RuntimeError('Incomplete register response')
        return int.from_bytes(bytes(data), 'little'), error

    def enable_hand_bypass(self, device_id, register):
        """Only permit the known HX5 Table Sync Enable register to be cleared."""
        if (register.name, register.address, register.size) != ('Table Sync Enable', 70, 1):
            raise ValueError('Unsupported hand mode register layout')
        result, error = self.packet.write1ByteTxRx(self.port, device_id, 70, 0)
        self._check(result, error)
        return error
