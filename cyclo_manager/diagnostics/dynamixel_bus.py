"""Serial transport with reads and restricted hand diagnostic commands."""

import time

class DynamixelBus:
    """Communicate with DYNAMIXEL devices over a serial bus."""

    def __init__(self, path, baud):
        from dynamixel_sdk import PacketHandler, PortHandler

        class BoundedPort(PortHandler):
            def getCurrentTime(self):
                return time.monotonic() * 1000

            def setPacketTimeout(self, packet_length):
                super().setPacketTimeout(packet_length)
                self.packet_timeout = getattr(self, 'clear_timeout_ms', None) or min(self.packet_timeout, 100.0)

            def setPacketTimeoutMillis(self, milliseconds):
                super().setPacketTimeoutMillis(min(milliseconds, 1000.0))

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
        if self.port.is_open:
            self.port.closePort()

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

    def calibrate_tactile(self, device_id, model_number):
        """Request calibration of an identified HX tactile sensor."""
        if type(device_id) is not int or not 0 <= device_id <= 252:
            raise ValueError('Invalid tactile sensor ID')
        if model_number not in {250, 253}:
            raise ValueError('Unsupported tactile sensor model')
        result, error = self.packet.write1ByteTxRx(self.port, device_id, 71, 1)
        self._check(result, error)
        return error

    def clear_multi_turn(self, device_id):
        """Wait for a delayed Y-series response without changing other timeouts."""
        self.port.clear_timeout_ms = 10000.0
        try:
            return self.packet.clearMultiTurn(self.port, device_id)
        finally:
            self.port.clear_timeout_ms = None
