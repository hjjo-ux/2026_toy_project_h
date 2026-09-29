import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Button from "../components/common/Button.jsx";
import PasswordInput from "../components/common/PasswordInput.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { login } from "../services/authApi.js";
import { fetchProjects } from "../services/projectApi.js";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login: setAuth } = useAuth();

  const [userId, setUserId] = useState(location.state?.userId ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(location.state?.notice ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const { token, userId: loggedInUserId, projectRecent, userName, userEmail } = await login(userId, password);
      setAuth(token, loggedInUserId, projectRecent, userName, userEmail);

      // 등록된 프로젝트가 있으면 바로 이력 화면으로, 없으면 프로젝트 연결 화면으로 보냅니다.
      try {
        const projects = await fetchProjects(token);
        navigate(projects.length > 0 ? "/" : "/connect");
      } catch {
        navigate("/connect");
      }
    } catch (err) {
      setError(err.message || "로그인에 실패했습니다");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <span className={styles.brand}>RHH</span>
        <h1 className={styles.title}>RENOBIT History Hub</h1>
        <p className={styles.subtitle}>계정으로 로그인하세요</p>

        {notice && !error && <p className={styles.notice}>{notice}</p>}

        {error && (
          <p className={styles.error}>
            {error}
            <br />
            <button
              type="button"
              className={styles.forgotLink}
              onClick={() => navigate("/reset-password", { state: { userId } })}
            >
              비밀번호를 잊으셨나요?
            </button>
          </p>
        )}

        <label className={styles.field}>
          <span className={styles.label}>아이디</span>
          <input
            type="text"
            className={styles.input}
            placeholder="아이디를 입력하세요"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            autoComplete="username"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>비밀번호</span>
          <PasswordInput
            className={styles.input}
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>

        <Button type="submit" variant="primary" className={styles.submit} disabled={submitting}>
          {submitting ? "로그인 중..." : "로그인"}
        </Button>

        <p className={styles.switchLink}>
          계정이 없으신가요?{" "}
          <button type="button" onClick={() => navigate("/signup")}>
            회원가입
          </button>
        </p>
      </form>
    </div>
  );
}
