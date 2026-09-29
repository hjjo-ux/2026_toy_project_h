import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { fetchHistoryEntries, updateHistoryMetadata, setImportant } from "../services/historyApi.js";
import { fetchAlarms, checkAlarm, checkAllAlarms } from "../services/alarmApi.js";
import { useAuth } from "./AuthContext.jsx";
import { useProjects } from "./ProjectContext.jsx";

const HistoryContext = createContext(null);

// 새 이력이 생겨도 새로고침을 눌러야만 보이는 문제를 완화하기 위한 백그라운드
// 폴링 주기입니다. 짧을수록 "실시간"에 가깝지만 그만큼 서버에 불필요한 요청이
// 늘어나므로, 사람이 RENOBIT에서 가끔 저장하는 정도의 빈도에 맞춘 값입니다.
const POLL_INTERVAL_MS = 20000;

export function HistoryProvider({ children }) {
  const { token } = useAuth();
  const { currentProject, loading: projectsLoading } = useProjects();
  const projectId = currentProject?.id ?? null;

  const [entries, setEntries] = useState([]);
  // silentRefresh가 받아온 데이터가 기존과 같은지 비교할 때 씁니다 — entries를
  // silentRefresh의 의존성에 그대로 넣으면 목록이 바뀔 때마다 아래 폴링
  // useEffect도 다시 실행돼서 20초 카운트가 계속 리셋되므로, ref로만 최신값을
  // 들고 있습니다.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // 화면의 "갱신" 시각 표시용입니다 — 수동 새로고침이든 백그라운드 폴링이든,
  // 서버에서 실제로 이력을 성공적으로 다시 받아온 시점에만 갱신합니다
  // (updateMetadata처럼 항목 하나만 로컬로 바꾸는 경우는 포함하지 않습니다).
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  // 알림/목록에서 "새 이력"으로 표시할 기준 시각입니다. 백엔드에 읽음/안읽음이
  // 아직 없어서 세션 동안만 기억하는 임시 개념입니다 — 프로젝트를 열 때(전환
  // 포함) 그 순간으로 기준선을 다시 잡아서, 이미 있던 이력이 전부 "새 이력"으로
  // 보이는 걸 막습니다. 그 이후 폴링 등으로 새로 생긴 이력만 새 것으로 간주됩니다.
  const [lastSeenAt, setLastSeenAt] = useState(null);
  // 백엔드의 진짜 미확인 이력 목록(tb_alarm_check 기반)입니다. 아직 배포 전이라
  // null(=모름)로 시작하고, 첫 조회에 성공하면 그때부터 이 값이 lastSeenAt
  // 추정치보다 우선합니다. 배포되면 프론트 수정 없이 자동으로 이 값이 쓰이게 됩니다.
  const [serverAlarmIds, setServerAlarmIds] = useState(null);
  // 미확인 댓글/대댓글 알림 — 이력과 달리 로컬 추정치가 없어서(원래 없던 개념),
  // 배포 전에는 그냥 빈 배열입니다.
  const [commentAlarms, setCommentAlarms] = useState([]);
  useEffect(() => {
    if (projectId) setLastSeenAt(new Date());
    setServerAlarmIds(null);
    setCommentAlarms([]);
  }, [projectId]);

  const refreshAlarms = useCallback(() => {
    if (!token || !projectId) return;
    fetchAlarms(token, projectId)
      .then((data) => {
        setServerAlarmIds(new Set((data.entries ?? []).map((entry) => entry.id)));
        setCommentAlarms(data.comments ?? []);
      })
      .catch(() => {
        // /api/alarms가 아직 없거나(404) 실패하면 조용히 넘어가고, 아래
        // lastSeenAt 기반 추정치를 계속 씁니다(댓글 알림은 이 경우 그냥 빈 채로 둠).
      });
  }, [token, projectId]);

  useEffect(() => {
    refreshAlarms();
  }, [refreshAlarms]);

  const markAllSeen = useCallback(() => {
    setLastSeenAt(new Date());
    if (token && projectId) {
      checkAllAlarms(token, projectId)
        .then(() => {
          setServerAlarmIds(new Set());
          setCommentAlarms([]);
        })
        .catch(() => {
          // 백엔드 준비 전이면 위에서 이미 처리한 lastSeenAt만으로 동작합니다.
        });
    }
  }, [token, projectId]);

  // 이력 상세/Diff 화면에 들어가면 그 이력 하나만 "확인함"으로 표시합니다. 댓글/
  // 대댓글 알림(comment-42 형식 id)을 확인 처리할 때도 같은 함수를 씁니다. 백엔드
  // 준비 전이면 실패를 조용히 무시합니다(로컬 추정치는 lastSeenAt 기준으로 계속
  // 동작하므로 화면엔 영향 없습니다).
  const checkEntrySeen = useCallback(
    (id) => {
      if (!token || !projectId || !id) return;
      checkAlarm(token, projectId, id)
        .then(() => {
          setServerAlarmIds((prev) => {
            if (!prev || !prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          setCommentAlarms((prev) => prev.filter((c) => c.id !== id));
        })
        .catch(() => {});
    },
    [token, projectId],
  );

  const localNewEntryIds = useMemo(() => {
    if (!lastSeenAt) return new Set();
    const ids = new Set();
    entries.forEach((entry) => {
      if (new Date(entry.savedAtRaw) > lastSeenAt) ids.add(entry.id);
    });
    return ids;
  }, [entries, lastSeenAt]);

  // 서버가 실제로 응답한 적이 있으면(=배포됨) 그 값을 그대로 신뢰하고,
  // 아직이면(null) lastSeenAt 기반 추정치로 대신합니다.
  const newEntryIds = serverAlarmIds ?? localNewEntryIds;

  // 중요 표시(⭐)는 서버(tb_history_starred, 로그인한 사용자 본인만의 값)가
  // 진실 값입니다 — GET /api/history 가 내려주는 entry.important 를 그대로
  // 반영합니다. 낙관적으로 먼저 반영하고, 실패하면(예: 이 프로젝트에 아직
  // tb_history_starred 테이블이 없는 경우) 원래 상태로 되돌립니다.
  const starredIds = useMemo(
    () => new Set(entries.filter((entry) => entry.important).map((entry) => entry.id)),
    [entries],
  );

  const toggleStar = useCallback(
    (id) => {
      if (!projectId) return;
      const target = entries.find((entry) => entry.id === id);
      if (!target) return;
      const nextImportant = !target.important;
      setEntries((prev) =>
        prev.map((entry) => (entry.id === id ? { ...entry, important: nextImportant } : entry)),
      );
      setImportant(token, projectId, id, nextImportant).catch(() => {
        setEntries((prev) =>
          prev.map((entry) => (entry.id === id ? { ...entry, important: !nextImportant } : entry)),
        );
      });
    },
    [projectId, token, entries],
  );

  // "다시 시도"를 연달아 누르는 경우 등, 늦게 도착한 이전 요청의 결과가 최신 결과를
  // 덮어쓰지 않도록 requestId 로 "가장 최근 요청"만 반영합니다. 백그라운드 폴링은
  // loading 상태를 공유하지 않는 별도 흐름이라 카운터도 따로 둡니다 — 같이 쓰면
  // 폴링 응답이 늦게 와서 reload()의 요청을 "낡은 것"으로 취급해버려 loading이
  // false로 안 돌아오는 문제가 생길 수 있습니다.
  const requestIdRef = useRef(0);
  const silentRequestIdRef = useRef(0);
  // 응답이 폴링 주기(20초)보다 오래 걸리는 상황에서 요청이 계속 쌓이는 걸
  // 막습니다 — 이전 폴링이 아직 안 끝났으면 이번 tick은 건너뜁니다.
  const silentInFlightRef = useRef(false);

  const reload = useCallback(() => {
    if (!token) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }
    // 프로젝트 목록이 아직 로딩 중이면(=currentProject가 잠깐 null일 수 있음) 그
    // "프로젝트 없음" 상태로 오판하지 않도록 로딩을 유지하고 기다립니다.
    if (projectsLoading) {
      setLoading(true);
      return;
    }
    if (!projectId) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    // 이력만 새로 받아오고 미확인 목록(serverAlarmIds)은 다음 20초 폴링을 기다리면,
    // 방금 들어온 이력이 "새 이력" 배지 없이 보이다가 한참 뒤에야 배지가 붙는
    // 것처럼 보입니다 — 수동 새로고침 때도 같이 갱신합니다.
    refreshAlarms();
    fetchHistoryEntries(token, projectId)
      .then((data) => {
        if (requestIdRef.current !== requestId) return;
        setEntries(data);
        setLastFetchedAt(new Date());
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setEntries([]);
        setError(err.message);
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setLoading(false);
      });
  }, [token, projectId, projectsLoading, refreshAlarms]);

  useEffect(() => {
    reload();
  }, [reload]);

  // reload()와 달리 loading/error를 건드리지 않는 조용한 새로고침입니다 — 화면은
  // 그대로 둔 채로 데이터만 최신화해서, 폴링 때마다 목록이 사라졌다 다시 뜨는
  // 깜빡임 없이 새 이력이 자연스럽게 섞여 들어오게 합니다. 카드 목록은 이미
  // entry.id를 key로 쓰고 있어서 배열이 새로 생겨도 기존 카드가 재사용됩니다.
  const silentRefresh = useCallback(() => {
    if (!token || projectsLoading || !projectId) return;
    if (silentInFlightRef.current) return;

    silentInFlightRef.current = true;
    const requestId = ++silentRequestIdRef.current;
    fetchHistoryEntries(token, projectId)
      .then((data) => {
        if (silentRequestIdRef.current !== requestId) return;
        setLastFetchedAt(new Date());
        // 받아온 내용이 기존과 완전히 같으면(흔한 경우 — 그 20초 동안 아무도
        // 저장 안 함) setEntries를 건너뛰어서 리렌더/정렬 재계산을 피합니다.
        // "갱신 시각"은 그와 무관하게 위에서 이미 갱신했습니다.
        if (JSON.stringify(data) !== JSON.stringify(entriesRef.current)) {
          setEntries(data);
        }
      })
      .catch(() => {
        // 백그라운드 폴링 실패는 화면에 드러내지 않고 조용히 넘어갑니다 —
        // 다음 폴링 때 다시 시도하면 됩니다.
      })
      .finally(() => {
        silentInFlightRef.current = false;
      });
  }, [token, projectId, projectsLoading]);

  // 휴지통(/trash), Diff 비교(/compare) 화면은 이 목록을 화면에 그대로 쓰지
  // 않으므로(휴지통은 자기 지역 상태로 따로 조회) 거기 있는 동안은 폴링해봐야
  // 낭비입니다. 인터벌 자체를 매 네비게이션마다 재설정하면 20초 카운트가 계속
  // 리셋되니, ref에 최신 경로만 담아두고 tick마다 검사합니다.
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const isListRelevantPath = (path) => path === "/" || path.startsWith("/history/");

  useEffect(() => {
    if (!token || !projectId) return undefined;

    const timerId = setInterval(() => {
      // 탭이 백그라운드에 있거나, 지금 화면이 이 목록을 안 쓰는 화면이면 건너뜁니다.
      if (document.visibilityState === "visible" && isListRelevantPath(pathnameRef.current)) {
        silentRefresh();
        refreshAlarms();
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timerId);
  }, [token, projectId, silentRefresh, refreshAlarms]);

  const updateMetadata = useCallback(
    async (id, fields) => {
      const updated = await updateHistoryMetadata(token, projectId, id, fields);
      // 숨김 처리된 이력은 GET /api/history 응답에도 더는 안 나오므로, 로컬
      // 상태에서도 같이 걷어내서 "전체 이력 보기"에 즉시 반영되게 합니다.
      setEntries((prev) =>
        updated.hidden
          ? prev.filter((entry) => entry.id !== id)
          : prev.map((entry) => (entry.id === id ? updated : entry)),
      );
      // 삭제한 이력이 "새 이력"으로 잡혀 있었다면, 다음 폴링을 기다리지 않고
      // 알림 배지에서도 바로 빼줍니다 — 안 그러면 목록에선 이미 사라졌는데
      // 배지 숫자만 그대로 남아있는 것처럼 보입니다.
      if (updated.hidden) {
        setServerAlarmIds((prev) => {
          if (!prev || !prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [token, projectId],
  );

  // "이력 삭제" = 실제로는 hidden 플래그만 세우는 소프트 삭제입니다. 클릭 즉시 API를
  // 호출하지 않고, 화면에서 먼저 숨긴 뒤(pendingHideIds) 잠시 기다렸다가 실제로
  // 저장합니다 — 그사이 "실행 취소"를 누르면 API 호출 자체가 안 일어납니다. 이력
  // 전체보기(목록)와 사이드바(각 타겟별 카운트)가 형제 컴포넌트라 목록 페이지의
  // 로컬 상태만으론 사이드바 카운트가 그레이스 기간 동안 낡은 값을 보여주는
  // 문제가 있어서, 여기 context에 둬서 entries 자체를 걸러 양쪽이 같은 값을 보게 합니다.
  const [pendingHideIds, setPendingHideIds] = useState([]);
  const pendingHideIdsRef = useRef(pendingHideIds);
  pendingHideIdsRef.current = pendingHideIds;
  const pendingHideTimerRef = useRef(null);
  // 이 화면(이력 리스트)을 벗어날 때 남은 유예시간을 안 기다리고 바로
  // flushPendingHides를 부르는데, 그 안의 updateMetadata 호출들은 await 없이
  // 그냥 쏘고 끝내는 방식이라("fire and forget"), 곧바로 휴지통 화면으로
  // 넘어가면 그 화면의 목록 조회가 이 숨김 처리보다 먼저 끝나버릴 수 있습니다 —
  // "방금 지운 게 휴지통에 안 보인다"는 가끔 재현되는 버그가 여기서 납니다.
  // 마지막 flush의 Promise를 들고 있다가, 휴지통 화면이 자기 목록을 불러오기
  // 전에 이 Promise를 기다리게 해서 순서를 보장합니다.
  const pendingHideFlushRef = useRef(Promise.resolve());

  const flushPendingHides = useCallback(() => {
    if (pendingHideTimerRef.current) {
      clearTimeout(pendingHideTimerRef.current);
      pendingHideTimerRef.current = null;
    }
    const ids = pendingHideIdsRef.current;
    if (ids.length === 0) return pendingHideFlushRef.current;
    setPendingHideIds([]);
    const flush = Promise.all(ids.map((id) => updateMetadata(id, { hidden: true })));
    pendingHideFlushRef.current = flush;
    return flush;
  }, [updateMetadata]);

  const hidePending = useCallback(
    (id, graceMs) => {
      setPendingHideIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      if (pendingHideTimerRef.current) clearTimeout(pendingHideTimerRef.current);
      pendingHideTimerRef.current = setTimeout(flushPendingHides, graceMs);
    },
    [flushPendingHides],
  );

  const undoHidePending = useCallback(() => {
    if (pendingHideTimerRef.current) {
      clearTimeout(pendingHideTimerRef.current);
      pendingHideTimerRef.current = null;
    }
    setPendingHideIds([]);
  }, []);

  const visibleEntries = useMemo(
    () =>
      pendingHideIds.length > 0
        ? entries.filter((entry) => !pendingHideIds.includes(entry.id))
        : entries,
    [entries, pendingHideIds],
  );

  return (
    <HistoryContext.Provider
      value={{
        entries: visibleEntries,
        pendingHideIds,
        hidePending,
        undoHidePending,
        flushPendingHides,
        loading,
        error,
        reload,
        updateMetadata,
        hasProject: Boolean(projectId),
        lastFetchedAt,
        newEntryIds,
        commentAlarms,
        markAllSeen,
        checkEntrySeen,
        starredIds,
        toggleStar,
      }}
    >
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error("useHistory must be used within a HistoryProvider");
  return ctx;
}

// Header처럼 HistoryProvider가 없는 화면(계정 설정 등)에도 함께 쓰이는 컴포넌트를
// 위한 안전한 버전입니다 — 프로바이더가 없으면 에러 대신 null을 돌려줍니다.
export function useHistoryOptional() {
  return useContext(HistoryContext);
}
