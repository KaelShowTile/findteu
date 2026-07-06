DROP TABLE IF EXISTS containers;

CREATE TABLE containers (
    container_number TEXT PRIMARY KEY,
    status TEXT,
    first_data TEXT,
    latest_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
