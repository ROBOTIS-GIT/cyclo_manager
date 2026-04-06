FROM ros:jazzy-ros-base

WORKDIR /app

# Install system dependencies (venv for PEP 668 compliance, rmw_zenoh, control_msgs for msg/action)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git \
    python3-venv \
    ros-jazzy-rmw-zenoh-cpp \
    ros-jazzy-control-msgs \
    && rm -rf /var/lib/apt/lists/*

# Create venv and install pip dependencies
RUN python3 -m venv --system-site-packages /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy cyclo_manager package
COPY cyclo_manager/ ./cyclo_manager/
COPY cyclo_manager_cli/cyclo_manager_cli/config/config.yml ./config.yml

# Expose API port
EXPOSE 8081

# Run the cyclo_manager API (--no-access-log to suppress 200 OK etc.)
CMD ["uvicorn", "cyclo_manager.api:app", "--host", "0.0.0.0", "--port", "8081", "--no-access-log"]
