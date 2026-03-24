# Annotation Backend System

Backend for text annotation tasks, including chat disentanglement and adjacency pairs.

## Features
- User authentication and authorization
- Project and chat room management
- CSV import for chat rooms
- Chat disentanglement annotations
- Adjacency pairs annotations
- IAA analysis for disentanglement
- RESTful API with FastAPI
- SQLite database (default)

## Setup
```bash
cd annotation-backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

## Configuration
Create a .env in the repository root or in annotation-backend (for local dev):
```env
DATABASE_URL=sqlite:///./data/app.db
SECRET_KEY=change-me-min-32-chars
FIRST_ADMIN_USERNAME=admin
FIRST_ADMIN_PASSWORD=change-me-strong-123
CORS_ORIGINS=["http://localhost:3721"]
```

Optional security and limits:
```env
PASSWORD_MIN_LENGTH=10
PASSWORD_REQUIRE_DIGIT=true
PASSWORD_REQUIRE_LETTER=true
AUTH_RATE_LIMIT_REQUESTS=10
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
MAX_UPLOAD_MB=10
MAX_IMPORT_ROWS=50000
```

## Run the server
```bash
uvicorn app.main:app --reload
```

The API will be available at:
- API: http://localhost:8000
- Swagger UI: http://localhost:8000/docs

## Core endpoints
Authentication:
- POST /auth/token
- POST /auth/refresh
- GET /auth/me

Admin:
- GET /admin/users
- POST /admin/users
- DELETE /admin/users/{user_id}
- GET /admin/projects
- POST /admin/projects
- PUT /admin/projects/{project_id}
- DELETE /admin/projects/{project_id}
- POST /admin/projects/{project_id}/import-chat-room-csv/preview

Projects:
- GET /projects
- GET /projects/{project_id}
- GET /projects/{project_id}/users
- POST /projects/{project_id}/assign/{user_id}
- DELETE /projects/{project_id}/assign/{user_id}
- GET /projects/{project_id}/chat-rooms
- GET /projects/{project_id}/chat-rooms/{room_id}

Chat rooms and annotations:
- GET /projects/{project_id}/chat-rooms/{room_id}/messages
- GET /projects/{project_id}/chat-rooms/{room_id}/annotations
- POST /projects/{project_id}/messages/{message_id}/annotations
- DELETE /projects/{project_id}/messages/{message_id}/annotations/{annotation_id}
- POST /admin/chat-rooms/{chat_room_id}/import-annotations/preview
- POST /admin/chat-rooms/{chat_room_id}/import-batch-annotations/preview

Adjacency pairs:
- GET /projects/{project_id}/chat-rooms/{room_id}/adjacency-pairs
- POST /projects/{project_id}/chat-rooms/{room_id}/adjacency-pairs
- DELETE /projects/{project_id}/chat-rooms/{room_id}/adjacency-pairs/{pair_id}
- POST /projects/{project_id}/chat-rooms/{room_id}/adjacency-pairs/import

### Adjacency pairs import (`/adjacency-pairs/import`)

Accepts a CSV file (UTF-8) with three columns: `turnA, turnB, relation_type`. Query parameter `mode` controls conflict handling:

- `merge` (default) — keeps existing annotations and adds new ones (existing pairs are updated in place)
- `replace` — deletes all existing annotations for the annotator in this room before importing

**Validation rules — a line is skipped when:**
- fewer than 3 columns
- any required field is empty
- `relation_type` is not in the project's configured relation types
- `turnA` or `turnB` turn ID is not found in the chat room
- `turnA == turnB` (self-link)
- the pair `(turnA, turnB)` appears more than once in the same file (duplicate within the upload)

**Response:**
```json
{
  "message": "N relations imported.",
  "imported_count": 12,
  "skipped_count": 3,
  "errors": [
    "Line 4: invalid relation type 'AP Unknown'",
    "Line 7: cannot link a turn to itself",
    "Line 9: duplicate pair in file, skipped"
  ]
}
```

The UI displays a summary popup after import showing the imported and skipped counts plus the full list of skipped lines.

## Data import format (CSV)
Required columns:
- turn_id
- user_id
- turn_text
- reply_to_turn
