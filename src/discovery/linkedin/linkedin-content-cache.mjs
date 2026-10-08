export class LinkedInContentCache {
  constructor(connection){this.connection=connection;}
  get(key){const row=this.connection.prepare("SELECT result_json FROM linkedin_content_cache WHERE identity_key=? AND expires_at>?").get(key,new Date().toISOString());return row?JSON.parse(row.result_json):null;}
  put(key,kind,result,ttlMs=86400000){const now=Date.now();this.connection.prepare("INSERT INTO linkedin_content_cache VALUES(?,?,?,?,?) ON CONFLICT(identity_key) DO UPDATE SET result_json=excluded.result_json,created_at=excluded.created_at,expires_at=excluded.expires_at").run(key,kind,JSON.stringify(result),new Date(now).toISOString(),new Date(now+ttlMs).toISOString());}
}
