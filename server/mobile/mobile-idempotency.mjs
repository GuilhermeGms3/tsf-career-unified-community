import { AppError } from "../errors.mjs";
import { snapshotHash } from "../../src/application/submission-snapshot.mjs";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{11,199}$/;

export class MobileIdempotencyStore {
  constructor(connection, { ttlMs = 24 * 60 * 60 * 1000 } = {}) {
    this.connection = connection;
    this.ttlMs = ttlMs;
  }

  key(req) {
    const key = String(req.headers["idempotency-key"] || "").trim();
    if (!KEY_PATTERN.test(key))
      throw new AppError(
        "Envie uma Idempotency-Key entre 12 e 200 caracteres seguros.",
        { status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" },
      );
    return key;
  }

  claim(key, { action, userLogin }) {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.ttlMs);
    this.connection
      .prepare("DELETE FROM mobile_gateway_requests WHERE expires_at<=?")
      .run(createdAt.toISOString());
    const inserted = this.connection
      .prepare(
        `INSERT INTO mobile_gateway_requests(
          idempotency_key,action,user_login,state,response_status,response_json,created_at,expires_at
        ) VALUES(?,?,?,'PROCESSING',NULL,NULL,?,?)
        ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run(
        key,
        action,
        userLogin,
        createdAt.toISOString(),
        expiresAt.toISOString(),
      );
    if (inserted.changes === 1) return { owned: true };

    const row = this.connection
      .prepare(
        "SELECT * FROM mobile_gateway_requests WHERE idempotency_key=? AND expires_at>?",
      )
      .get(key, createdAt.toISOString());
    if (!row)
      throw new AppError("Não foi possível reservar esta ação. Tente novamente.", {
        status: 409,
        code: "IDEMPOTENCY_RESERVATION_FAILED",
      });
    if (row.action !== action || row.user_login !== userLogin)
      throw new AppError("A chave de idempotência já pertence a outra ação.", {
        status: 409,
        code: "IDEMPOTENCY_KEY_CONFLICT",
      });
    if (row.state === "PROCESSING") {
      const hasDecisions=this.connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='application_decision_commands'").get();
      const committed=hasDecisions?this.connection.prepare("SELECT actor_hash,kind,result_json FROM application_decision_commands WHERE idempotency_key=?").get(key):null;
      if(committed&&committed.actor_hash===snapshotHash(userLogin)){
        const body={ok:true,result:JSON.parse(committed.result_json)},status=action.startsWith("application-action:")&&committed.kind==="APPROVE"?202:200;
        this.complete(key,{action,userLogin,status,body});return {owned:false,status,body};
      }
      // A crashed synchronous decision can be retried; the domain command key
      // remains the authority if the original transaction actually committed.
      if(/^application-(?:action|question):/.test(action)&&Date.now()-Date.parse(row.created_at)>30000){
        const changed=this.connection.prepare("DELETE FROM mobile_gateway_requests WHERE idempotency_key=? AND action=? AND user_login=? AND state='PROCESSING' AND created_at=?").run(key,action,userLogin,row.created_at);
        if(changed.changes)return this.claim(key,{action,userLogin});
      }
      throw new AppError("Esta ação já está em andamento.", {
        status: 409,
        code: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
      });
    }
    return {
      owned: false,
      status: row.response_status,
      body: JSON.parse(row.response_json),
    };
  }

  complete(key, { action, userLogin, status, body }) {
    const completed = this.connection
      .prepare(
        `UPDATE mobile_gateway_requests
         SET state='COMPLETED',response_status=?,response_json=?
         WHERE idempotency_key=? AND action=? AND user_login=? AND state='PROCESSING'`,
      )
      .run(
        status,
        JSON.stringify(body),
        key,
        action,
        userLogin,
      );
    if (completed.changes !== 1)
      throw new AppError("A reserva idempotente desta ação não está mais ativa.", {
        status: 409,
        code: "IDEMPOTENCY_RESERVATION_LOST",
      });
    return body;
  }

  release(key, { action, userLogin }) {
    this.connection
      .prepare(
        `DELETE FROM mobile_gateway_requests
         WHERE idempotency_key=? AND action=? AND user_login=? AND state='PROCESSING'`,
      )
      .run(key, action, userLogin);
  }
}
