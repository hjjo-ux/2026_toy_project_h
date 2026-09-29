import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useHistoryOptional } from "../../context/HistoryContext.jsx";
import Icon from "./Icon.jsx";
import styles from "./NotificationBell.module.css";

function formatTimestamp(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const COMMENT_PREVIEW_MAX = 40;
function truncate(text) {
  if (!text) return "";
  return text.length > COMMENT_PREVIEW_MAX ? `${text.slice(0, COMMENT_PREVIEW_MAX)}…` : text;
}

// 이력 읽음/안읽음은 아직 백엔드에 없어서(추후 백엔드 팀원과 별도 설계 예정), 지금은
// 세션 동안만 기억하는 lastSeenAt 기준으로 "새 이력"을 가립니다. HistoryContext의
// newEntryIds가 같은 기준을 이력 리스트 쪽(PRCard)과도 공유해서, 알림에 뜬 항목이
// 리스트에서도 동일하게 "새 이력"으로 보입니다. 댓글/대댓글 알림은 백엔드가
// tb_alarm_check 기반으로 진짜 안읽음을 내려주는 commentAlarms를 그대로 씁니다.
// "전부 확인"을 누르면 이력/댓글 알림이 한 번에 같이 사라집니다.
export default function NotificationBell() {
  const history = useHistoryOptional();
  const entries = history?.entries;
  const newEntryIds = history?.newEntryIds;
  const commentAlarms = history?.commentAlarms;
  const markAllSeen = history?.markAllSeen;
  const checkEntrySeen = history?.checkEntrySeen;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const newEntries = useMemo(() => {
    if (!entries || !newEntryIds || newEntryIds.size === 0) return [];
    return entries
      .filter((entry) => newEntryIds.has(entry.id))
      .sort((a, b) => new Date(b.savedAtRaw) - new Date(a.savedAtRaw));
  }, [entries, newEntryIds]);

  // 이력 알림과 댓글/대댓글 알림을 시간순으로 합쳐서 하나의 피드로 보여줍니다.
  const notifications = useMemo(() => {
    const entryItems = newEntries.map((entry) => ({
      key: entry.id,
      id: entry.id,
      to: `/history/${entry.id}`,
      isComment: false,
      label: entry.targetLabel,
      title: entry.title,
      time: entry.savedAt,
      timeRaw: entry.savedAtRaw,
    }));
    const commentItems = (commentAlarms ?? []).map((comment) => ({
      key: comment.id,
      id: comment.id,
      to: `/history/${comment.targetId}`,
      isComment: true,
      label: comment.parentCommentId != null ? "답글" : "댓글",
      title: `${comment.userId}: ${truncate(comment.content)}`,
      time: formatTimestamp(comment.createdAt),
      timeRaw: comment.createdAt,
    }));
    return [...entryItems, ...commentItems].sort(
      (a, b) => new Date(b.timeRaw) - new Date(a.timeRaw),
    );
  }, [newEntries, commentAlarms]);

  const unreadCount = (newEntryIds?.size ?? 0) + (commentAlarms?.length ?? 0);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.bellBtn}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="알림"
        title="알림"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={17} />
        {unreadCount > 0 && (
          <span className={styles.badge}>{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>알림</span>
            <button
              type="button"
              className={styles.markAllBtn}
              disabled={notifications.length === 0}
              onClick={() => markAllSeen?.()}
            >
              전부 확인
            </button>
          </div>

          {notifications.length === 0 ? (
            <p className={styles.empty}>아직 알림이 없습니다</p>
          ) : (
            <ul className={styles.list}>
              {notifications.map((item) => (
                <li key={item.key}>
                  <Link
                    to={item.to}
                    className={styles.item}
                    onClick={() => {
                      setOpen(false);
                      if (item.isComment) checkEntrySeen?.(item.id);
                    }}
                  >
                    {item.isComment ? (
                      <Icon name="comment" size={12} className={styles.commentIcon} />
                    ) : (
                      <span className={styles.dot} aria-hidden="true" />
                    )}
                    <span className={styles.itemBody}>
                      <span className={styles.itemTitleRow}>
                        <span className={styles.itemTarget}>{item.label}</span>
                        <span className={styles.itemTitle}>{item.title}</span>
                      </span>
                      <span className={styles.itemTime}>{item.time}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
