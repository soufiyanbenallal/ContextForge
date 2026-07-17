export const MIGRATIONS: string[] = [
  `-- 0001 schema
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT UNIQUE NOT NULL,
    git_remote TEXT,
    fingerprint TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    agent TEXT,
    model TEXT,
    task TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    response TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    interaction_id TEXT,
    project_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT DEFAULT 'normal',
    classification TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (interaction_id) REFERENCES interactions(id),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    scope TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed',
    priority INTEGER NOT NULL DEFAULT 50,
    confidence REAL NOT NULL DEFAULT 0.5,
    source_type TEXT NOT NULL,
    source_id TEXT,
    applies_to TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS conflicts (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    left_item_id TEXT NOT NULL,
    right_item_id TEXT NOT NULL,
    conflict_type TEXT NOT NULL,
    explanation TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    resolution TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (left_item_id) REFERENCES knowledge_items(id),
    FOREIGN KEY (right_item_id) REFERENCES knowledge_items(id)
);

CREATE TABLE IF NOT EXISTS capabilities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    source TEXT,
    config TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_checked_at TEXT,
    task_patterns TEXT NOT NULL DEFAULT '[]',
    conflicts_with TEXT NOT NULL DEFAULT '[]',
    required_config TEXT NOT NULL DEFAULT '{}',
    projects TEXT NOT NULL DEFAULT '[]',
    success_rate REAL
);

CREATE TABLE IF NOT EXISTS capability_usage (
    id TEXT PRIMARY KEY,
    capability_id TEXT NOT NULL,
    project_id TEXT,
    task_type TEXT,
    outcome TEXT,
    score REAL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (capability_id) REFERENCES capabilities(id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge_items(project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_items(status);
CREATE INDEX IF NOT EXISTS idx_feedback_project ON feedback(project_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_project ON conflicts(project_id);
`,
  `-- 0002 search index (plain table; sql.js has no FTS5)
CREATE TABLE IF NOT EXISTS knowledge_search (
    knowledge_item_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL,
    applies_to TEXT
);
CREATE INDEX IF NOT EXISTS idx_ksearch_text ON knowledge_search(title, content);
`,
  `-- 0003 migration tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
`,
  `-- 0004 lesson lifecycle
ALTER TABLE knowledge_items ADD COLUMN superseded_by TEXT;
ALTER TABLE knowledge_items ADD COLUMN supersedes TEXT;
ALTER TABLE knowledge_items ADD COLUMN rejected_reason TEXT;

CREATE TABLE IF NOT EXISTS knowledge_versions (
    id TEXT PRIMARY KEY,
    knowledge_item_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    scope TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL,
    confidence REAL NOT NULL,
    applies_to TEXT,
    reason TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (knowledge_item_id) REFERENCES knowledge_items(id)
);

CREATE INDEX IF NOT EXISTS idx_kv_item ON knowledge_versions(knowledge_item_id);
CREATE INDEX IF NOT EXISTS idx_ki_superseded ON knowledge_items(superseded_by);
`,
];
