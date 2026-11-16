"""
Single-container ASGI entry point: the API under ``/api`` plus the React SPA.

The DEISI platform runs one container per application on one port, so the
root ``Dockerfile`` serves everything from FastAPI through this module.  The
docker-compose deployment does not use it: there nginx serves the SPA and
proxies ``/api/`` to ``app.main:app``.

Run with ``uvicorn --factory app.site:create_site``.
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.types import Scope

from .main import app as api_app

# The root Dockerfile copies the SPA build (annotation_ui/dist) here.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


class SinglePageApp(StaticFiles):
    """
    Static file server that answers unknown paths with ``index.html``.

    Client-side routes such as ``/projects/3`` have no file on disk; serving
    the SPA shell lets React Router render them after a page reload.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        """Serve ``path`` if it exists, otherwise the SPA's ``index.html``."""
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            return await super().get_response("index.html", scope)


def create_site(frontend_dir: Path = FRONTEND_DIR) -> FastAPI:
    """
    Build the combined application.

    The API keeps its own routes, middleware and Swagger UI (``/api/docs``);
    the mount sets ``root_path``, so uvicorn needs no ``--root-path`` flag.
    Starlette does not run the lifespan of mounted apps, so the API's startup
    hook (first admin seeding) is forwarded through the outer app's lifespan.

    Args:
        frontend_dir: Directory holding the SPA build (``index.html`` and assets).

    Returns:
        The ASGI application to serve.
    """
    site = FastAPI(
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=api_app.router.lifespan_context,
    )
    site.mount("/api", api_app)
    site.mount("/", SinglePageApp(directory=frontend_dir, html=True))
    return site
