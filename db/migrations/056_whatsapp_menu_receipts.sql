CREATE TABLE whatsapp_menu_receipts (
  message_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE INDEX whatsapp_menu_receipts_created_idx ON whatsapp_menu_receipts(created_at);
