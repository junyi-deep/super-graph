import { FormEvent, useState } from "react";
import { LockKeyhole, UserRound } from "lucide-react";
import { api } from "../api";
import type { User } from "../types";

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onLogin(await api.login(username, password));
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login">
      <form onSubmit={submit}>
        <h1>Super Graph</h1>
        <p className="muted">团队画板与 Mermaid 图表协作空间</p>
        <label>
          用户名
          <span className="login-input">
            <UserRound size={15} />
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={64}
              autoComplete="username"
            />
          </span>
        </label>
        <label>
          密码
          <span className="login-input">
            <LockKeyhole size={15} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
              autoComplete="current-password"
            />
          </span>
        </label>
        <button disabled={busy || !username.trim() || !password}>
          {busy ? "登录中…" : "登录"}
        </button>
        {error && <p className="error">{error}</p>}
        <small>普通用户首次登录默认密码：123456</small>
      </form>
    </main>
  );
}
