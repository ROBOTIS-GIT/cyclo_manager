"""Configuration loader for cyclo_manager.

Reads YAML configuration file and validates it using Pydantic models.
"""

import logging
import os
from pathlib import Path
from typing import Optional

import yaml
from pydantic import ValidationError

from cyclo_manager.models import SystemConfig

logger = logging.getLogger(__name__)


def load_config(config_path: Optional[str] = None) -> SystemConfig:
    """Load and validate configuration from YAML file.

    Args:
        config_path: Path to config file. If None, reads from CONFIG_FILE
            environment variable or defaults to 'config.yml' in current directory.

    Returns:
        Validated SystemConfig object.

    Raises:
        FileNotFoundError: If config file does not exist.
        ValidationError: If config file does not match expected schema.
        yaml.YAMLError: If config file is not valid YAML.
    """
    if config_path is None:
        config_path = os.getenv("CONFIG_FILE", "config.yml")

    config_file = Path(config_path)

    if not config_file.exists():
        raise FileNotFoundError(f"Configuration file not found: {config_path}")

    logger.info(f"Loading configuration from {config_path}")

    try:
        with open(config_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        if data is None:
            data = {}

        config = SystemConfig(**data)
        logger.info(f"Loaded configuration for {len(config.containers)} containers")
        return config

    except yaml.YAMLError as e:
        logger.error(f"Failed to parse YAML: {e}")
        raise
    except ValidationError as e:
        logger.error(f"Configuration validation failed: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error loading config: {e}")
        raise

