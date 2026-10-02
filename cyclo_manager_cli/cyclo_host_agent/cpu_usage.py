#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Author: Hyungyu Kim

"""Continuous host CPU sampling, independent of HTTP requests."""

from collections import deque
import logging
import threading

import psutil

logger = logging.getLogger(__name__)

CPU_SAMPLE_INTERVAL_SECONDS = 1.0
CPU_AVERAGE_SAMPLES = 3


class CpuUsageSampler:
    """Keep the mean of the latest three consecutive one-second CPU samples."""

    def __init__(self, interval: float = CPU_SAMPLE_INTERVAL_SECONDS) -> None:
        """Initialize the sampler without starting a background thread."""
        self._interval = interval
        self._samples: deque[float] = deque(maxlen=CPU_AVERAGE_SAMPLES)
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Start one sampling thread and discard samples from any previous run."""
        if self._thread is not None and self._thread.is_alive():
            return
        with self._lock:
            self._samples.clear()
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name='host-cpu-sampler', daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        """Wake and join the sampler on application shutdown."""
        self._stop.set()
        if self._thread is not None:
            self._thread.join()
            self._thread = None

    def average(self) -> float | None:
        """Return a cached average, or None before the first complete interval."""
        with self._lock:
            if not self._samples:
                return None
            return round(sum(self._samples) / len(self._samples), 1)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                # Prime and read on the same thread. The initial value is not a sample.
                psutil.cpu_percent(interval=None)
                while not self._stop.wait(self._interval):
                    sample = psutil.cpu_percent(interval=None)
                    with self._lock:
                        self._samples.append(float(sample))
            except Exception:
                # Re-prime after a failure instead of mixing stale measurement intervals.
                with self._lock:
                    self._samples.clear()
                logger.exception('Failed to sample host CPU usage')
                self._stop.wait(self._interval)
