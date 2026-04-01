# API Tests

Manual test flow covering authentication, project setup, and annotation operations — from login to annotation retrieval.

## Prerequisites

- A running backend instance (e.g., `http://localhost:8000`)
- Admin credentials (`FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD` from `.env`)
- `jq` installed for JSON formatting
- The following variables are set by earlier steps and reused throughout:
  - `ADMIN_TOKEN` — from admin login
  - `USER_TOKEN` — from regular user login (if different from admin)
  - `PROJECT_ID` — from project creation
  - `MESSAGE_ID` — from data import

---

## Test flow

### 1. Authentication

```bash
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="change-this-password"

ADMIN_TOKEN=$(curl -X POST "http://localhost:8000/api/v1/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$ADMIN_USERNAME&password=$ADMIN_PASSWORD" | jq -r .access_token)

echo "Admin Token: $ADMIN_TOKEN"
```

Regular user login (optional):

```bash
USER_TOKEN=$(curl -X POST "http://localhost:8000/api/v1/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$USER_USERNAME&password=$USER_PASSWORD" | jq -r .access_token)
```

### 2. Create a project (admin)

```bash
PROJECT_ID=$(curl -X POST "http://localhost:8000/api/v1/admin/projects" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Project", "description": "A project for testing annotations"}' | jq .id)

echo "Project ID: $PROJECT_ID"
```

### 3. Import chat data (admin)

```bash
CSV_FILE_PATH="path/to/your/chat_data.csv"

curl -X POST "http://localhost:8000/api/v1/admin/projects/$PROJECT_ID/import/preview" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "file=@$CSV_FILE_PATH" | jq
```

Then commit:

```bash
curl -X POST "http://localhost:8000/api/v1/admin/projects/$PROJECT_ID/import/commit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

After import, identify a `MESSAGE_ID` by listing the room's messages before running annotation steps.

### 4. Create an annotation

```bash
curl -X PUT "http://localhost:8000/api/v1/annotations/rooms/$ROOM_ID/messages/$MESSAGE_ID" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"thread_id": "Sample Annotation Tag"}' | jq
```

Expected response:

```json
{
  "message_id": 42,
  "thread_id": "Sample Annotation Tag",
  "annotator_id": 3,
  "project_id": 1
}
```

### 5. Retrieve annotations

```bash
curl -X GET "http://localhost:8000/api/v1/annotations/rooms/$ROOM_ID" \
  -H "Authorization: Bearer $USER_TOKEN" | jq
```

---

## Notes

- Replace placeholder values (usernames, passwords, file paths) with real data.
- `PROJECT_ID` from step 2 is needed for all subsequent calls.
- `MESSAGE_ID` must be identified after import before creating annotations.
