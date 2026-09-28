import { API_ORIGIN } from "./apiBase.js";

const BASE = `${API_ORIGIN}/api/rhh`;

export async function register(userId, password) {
  const res = await fetch(`${BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `회원가입에 실패했습니다 (${res.status})`);
  return data; // { userId }
}

export async function login(userId, password) {
  let res;
  try {
    res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, password }),
    });
  } catch {
    // fetch 자체가 실패 — 백엔드 서버까지 아예 요청이 안 간 경우입니다.
    throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 500번대는 아이디/비밀번호 문제가 아니라 서버(DB 등) 쪽 문제라, "아이디 또는
    // 비밀번호가 올바르지 않습니다" 같은 인증 실패 메시지로 오해하지 않게 구분합니다.
    if (res.status >= 500) {
      throw new Error("서버에 문제가 있어 로그인할 수 없습니다. 잠시 후 다시 시도해 주세요");
    }
    throw new Error(data.error || `로그인에 실패했습니다 (${res.status})`);
  }
  return data; // { token, userId, projectRecent, userName }
}

// 로그인이 안 된 상태에서 아이디만으로 비밀번호를 바꿉니다. 본인 확인(인증)
// 절차가 없는 임시 버전이라 아이디만 맞으면 바뀝니다.
export async function resetPassword(userId, newPassword) {
  const res = await fetch(`${BASE}/users/password-reset`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `비밀번호 변경에 실패했습니다 (${res.status})`);
  return data; // { ok: true }
}

// 빈 문자열을 보내면 닉네임을 지웁니다(백엔드가 null로 저장).
export async function changeNickname(token, userName) {
  const res = await fetch(`${BASE}/users/me/nickname`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `닉네임 변경에 실패했습니다 (${res.status})`);
  return data; // { userName }
}

export async function changePassword(token, currentPassword, newPassword) {
  const res = await fetch(`${BASE}/users/me/password`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `비밀번호 변경에 실패했습니다 (${res.status})`);
  return data; // { ok: true }
}

// 실제로 지우지 않고 use=false 로만 바뀝니다(연결된 프로젝트도 같이 비활성화).
export async function deleteAccount(token, password) {
  const res = await fetch(`${BASE}/users/me`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `계정 삭제에 실패했습니다 (${res.status})`);
  return data; // { ok: true }
}
