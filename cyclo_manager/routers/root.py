"""Root endpoint router."""

from fastapi import APIRouter

router = APIRouter(tags=["root"])


@router.get(
    "/",
    summary="API Information",
    description="Get API information and links to documentation",
    response_description="API metadata and documentation links",
)
async def root():
    """Root endpoint with API information and documentation links.

    Returns:
        API metadata including version and links to interactive documentation.
    """
    return {
        "message": "cyclo_manager API",
        "version": "0.1.0",
        "docs": {
            "swagger_ui": "/docs",
            "redoc": "/redoc",
            "openapi_schema": "/openapi.json",
        },
        "description": "Unified REST API for managing ROS2-based robot containers",
    }

