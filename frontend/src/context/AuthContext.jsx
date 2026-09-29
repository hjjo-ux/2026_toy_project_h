import { createContext, useCallback, useContext, useState } from "react";

// 로그인 상태를 localStorage 에 저장해서 새로고침해도 유지되게 합니다
// ("로그인 상태를 유지한다" 요구사항). 임시 계정 관리 단계라 간단하게 갑니다.
const STORAGE_KEY = "rhh_auth";

const AuthContext = createContext(null);

function readStoredAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(readStoredAuth);

  const login = useCallback((token, userId, projectRecent = null, userName = null, userEmail = null) => {
    const next = { token, userId, projectRecent, userName, userEmail };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setAuth(next);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setAuth(null);
  }, []);

  // 최근 접속 프로젝트가 바뀔 때마다 세션에 반영합니다 — 새로고침해도
  // (재로그인 없이) 방금 선택한 프로젝트가 기본으로 뜨게 하기 위해서입니다.
  const setProjectRecent = useCallback((projectId) => {
    setAuth((prev) => {
      if (!prev) return prev;
      const next = { ...prev, projectRecent: projectId };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // 닉네임 변경 성공 직후 세션에도 바로 반영합니다(재로그인 없이 헤더/설정
  // 화면에 새 닉네임이 즉시 보이게 하기 위해서입니다).
  const setUserName = useCallback((userName) => {
    setAuth((prev) => {
      if (!prev) return prev;
      const next = { ...prev, userName };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // 이메일 변경 성공 직후 세션에도 바로 반영합니다(재로그인 없이 계정 설정
  // 화면에 새 이메일이 즉시 보이게 하기 위해서입니다).
  const setUserEmail = useCallback((userEmail) => {
    setAuth((prev) => {
      if (!prev) return prev;
      const next = { ...prev, userEmail };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token: auth?.token ?? null,
        userId: auth?.userId ?? null,
        userName: auth?.userName ?? null,
        userEmail: auth?.userEmail ?? null,
        projectRecent: auth?.projectRecent ?? null,
        login,
        logout,
        setProjectRecent,
        setUserName,
        setUserEmail,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
