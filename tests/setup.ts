import { setDb } from "@/server/db";
import { _resetCryptoCache } from "@/server/crypto";
import { createSqliteDb } from "./helpers/sqliteDb";

// Every test file gets its own throwaway in-memory database (same schema as D1) and its own secrets.
process.env.ENCRYPTION_KEY = "test-encryption-key-0123456789abcdef";
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
// The suites use mock provider servers on 127.0.0.1.
process.env.MORPHIE_ALLOW_PRIVATE_URLS = "true";
_resetCryptoCache();
setDb(createSqliteDb());
