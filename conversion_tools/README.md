# Conversion Tools

Scripts for importing annotated Excel data into LACE.

## What it does

Reads Excel files with multiple sheets (one per annotator), creates users and a project in LACE via the API, and imports the messages and annotations. Primarily useful for migrating existing annotations from other systems into LACE.

## Structure

```
conversion_tools/
├── import_excel.py                 # Entry point
├── config.yaml                     # Configuration (generated on first run)
├── config.yaml.example             # Configuration template
├── requirements.txt                # Python dependencies
└── excel_import/
    ├── excel_parser.py             # Reads and validates Excel files
    ├── data_transformer.py         # Converts data to the API format
    ├── api_client.py               # Communicates with the LACE backend
    └── batch_import_manager.py     # Manages imports across multiple files
```

## Installation

```bash
cd conversion_tools
pip install -r requirements.txt
cp config.yaml.example config.yaml
```

Edit `config.yaml` with your credentials and backend URL before running.

## Usage

```bash
# Search for Excel files in default directories
python import_excel.py

# Point to a specific folder
python import_excel.py --folder ../uploads/Archive

# Verbose output for debugging
python import_excel.py --verbose
```

The script is interactive: it shows a preview of the data found and asks for confirmation before importing.

## Excel file format

Each file must have one sheet per annotator, with the same messages across all sheets. Required columns:

```csv
user_id,turn_id,turn_text,reply_to_turn,thread
123,msg_001,"Hello everyone!",,"thread_1"
456,msg_002,"Hi there!",msg_001,"thread_1"
789,msg_003,"How's it going?",,"thread_2"
```

| Column | Required | Description |
|--------|----------|-------------|
| `user_id` | ✅ | User who sent the message |
| `turn_id` | ✅ | Unique message identifier |
| `turn_text` | ✅ | Message content |
| `reply_to_turn` | ❌ | `turn_id` of the message being replied to |
| `thread` / `thread_id` | ✅ | Annotation thread |

Annotator names are extracted from sheet names by regex. Recognised patterns:

```python
ANNOTATOR_PATTERNS = [
    r"thread_(.+)",           # "thread_alice"      → "alice"
    r"(.+)_annotations",      # "alice_annotations" → "alice"
    r"(.+)_thread",           # "alice_thread"      → "alice"
    r"annotation_(.+)",       # "annotation_alice"  → "alice"
    r"^(.+)$"                 # fallback: full sheet name
]
```

## Configuration

`config.yaml`:

```yaml
api:
  base_url: "http://localhost:8000"
  admin_username: "admin"
  admin_password: "admin"

project:
  mode: "select_existing"   # create_new | select_existing | use_id
  project_id: 1
  new_project:
    name: "Excel Import Project"
    description: "Project created from Excel import tool"

import:
  default_user_password: "ChangeMe123!"
  auto_confirm: false

logging:
  level: "INFO"
  file: null

output:
  save_report: true
  report_file: "import_report_{timestamp}.txt"
```

Environment variables override file values:

```bash
export API_BASE_URL="https://api.production.com"
export API_ADMIN_PASSWORD="secure_password"
```

## Troubleshooting

**Connection error:**
```
APIError: Cannot connect to API at http://localhost:8000
```
Check that the backend is running and reachable.

**Authentication error:**
```
APIError: Authentication failed: 401 Unauthorized
```
Check credentials in `config.yaml`.

**Missing columns:**
```
ValueError: Missing required columns: ['turn_id', 'turn_text']
```
Check the Excel file structure against the format above.

**Upload error:**
```
APIError: Failed to create chat room and import messages
```
Run with `--verbose` and check the logs for details.
